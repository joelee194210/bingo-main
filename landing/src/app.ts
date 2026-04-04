process.env.TZ = 'America/Panama';

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { resolve } from 'path';
import { initPool, getPool } from './database.js';
import ventaRouter from './routes/venta.js';
import { expireStaleOrders } from './services/orderService.js';

const app = express();
const PORT = process.env.PORT || 3002;

app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://bt-cdn.yappy.cloud", "https://bt-cdn-uat.yappycloud.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https://*.yappy.cloud", "https://*.yappycloud.com"],
      connectSrc: ["'self'", "https://apipagosbg.bgeneral.cloud", "https://api-comecom-uat.yappycloud.com", "https://*.yappy.cloud", "https://*.googleapis.com", "https://*.firebaseio.com", "wss://*.firebaseio.com"],
      frameSrc: ["'self'", "https://*.yappy.cloud", "https://*.yappycloud.com", "https://*.bgeneral.cloud"],
    },
  },
}));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir assets estáticos (logo) — busca en src/ o dist/
const assetsPath = resolve(process.cwd(), 'src', 'assets');
const altAssetsPath = resolve(process.cwd(), 'assets');
app.use('/assets', express.static(assetsPath, { maxAge: '7d' }));
app.use('/assets', express.static(altAssetsPath, { maxAge: '7d' }));

// Rate limits
const orderLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, error: 'Demasiados intentos. Intente en 15 minutos.' },
});
app.use('/venta/api/orders', orderLimiter);

const confirmLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, error: 'Demasiados intentos.' },
});
app.use('/venta/api/yappy/confirm-success', confirmLimiter);

const ipnLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 60,
  message: { success: false },
});
app.use('/venta/api/yappy/ipn', ipnLimiter);

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'bingo-landing' }));

// Página "Próximamente" cuando LANDING_ENABLED != true
function renderComingSoon(): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mega Bingo TV Mundial</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Inter', -apple-system, sans-serif; background: #ffffff; color: #1e293b; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .container { max-width: 520px; text-align: center; padding: 40px 20px; }
    .logo img { max-width: 280px; height: auto; filter: drop-shadow(0 4px 12px rgba(0,0,0,0.3)); margin-bottom: 32px; }
    .card { background: white; border-radius: 20px; box-shadow: 0 8px 40px rgba(0,0,0,0.12); padding: 40px 32px; position: relative; overflow: hidden; }
    .card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 5px; background: linear-gradient(90deg, #ef4444, #f97316, #eab308, #22c55e, #3b82f6, #8b5cf6); }
    h1 { font-size: 24px; font-weight: 800; color: #1e40af; margin-bottom: 16px; }
    p { font-size: 16px; color: #64748b; line-height: 1.6; }
    .badge { display: inline-block; margin-top: 24px; padding: 10px 24px; background: linear-gradient(135deg, #eff6ff, #dbeafe); border: 2px solid #bfdbfe; border-radius: 24px; font-size: 14px; font-weight: 700; color: #1e40af; letter-spacing: 0.3px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">
      <img src="/assets/logo.png" alt="Mega Bingo TV Mundial" id="siteLogo">
    </div>
    <div class="card">
      <h1>Próximamente</h1>
      <p>Pronto podrá comprar sus cartones del <strong style="color:#dc2626;">Mega Bingo TV Mundial</strong> aquí.</p>
      <div class="badge">Venta digital en camino</div>
    </div>
  </div>
  <script src="/assets/checkout.js"></script>
</body>
</html>`;
}

// Guard: si LANDING_ENABLED != true, mostrar "Próximamente" en rutas públicas
app.use((req, res, next) => {
  const enabled = process.env.LANDING_ENABLED === 'true';
  if (enabled) return next();
  // Permitir health check, assets y APIs internas siempre
  if (req.path === '/health' || req.path.startsWith('/assets')) return next();
  // API endpoints retornan JSON de error
  if (req.path.includes('/api/')) {
    return res.status(503).json({ success: false, error: 'Venta digital no disponible' });
  }
  res.status(200).send(renderComingSoon());
});

// Todas las rutas de venta
app.use('/venta', ventaRouter);

// Ruta raíz redirige a /venta con el evento por defecto (configurable)
app.get('/', (_req, res) => {
  const defaultEvent = process.env.DEFAULT_EVENT_ID;
  if (defaultEvent) {
    res.redirect(`/venta/${defaultEvent}`);
  } else {
    res.status(200).send('Mega Bingo Digital');
  }
});

// Ruta /go para tracking de QR codes
app.get('/go', (req, res) => {
  const source = (req.query.a as string) || 'direct';
  const defaultEvent = process.env.DEFAULT_EVENT_ID;

  // Guardar escaneo en BD (fire-and-forget)
  getPool().query(
    'INSERT INTO qr_scans (source, ip, user_agent, referer) VALUES ($1, $2, $3, $4)',
    [source, req.ip, req.headers['user-agent'] || null, req.headers['referer'] || null]
  ).catch(err => console.error('Error guardando QR scan:', err));

  console.log(`📊 QR scan: source=${source}, ip=${req.ip}`);
  if (defaultEvent) {
    res.redirect(`/venta/${defaultEvent}?ref=${source}`);
  } else {
    res.redirect('/');
  }
});

async function start() {
  try {
    await initPool();
    console.log('✅ Conectado a PostgreSQL');

    app.listen(PORT, () => {
      console.log(`
╔═══════════════════════════════════════════╗
║  🎱 BINGO LANDING — Mega Bingo Digital   ║
║  Puerto: ${PORT}                            ║
║  Venta:  http://localhost:${PORT}/venta/:id ║
╚═══════════════════════════════════════════╝
      `);
    });

    // Expirar órdenes viejas cada 5 min
    setInterval(() => expireStaleOrders(), 5 * 60 * 1000);
  } catch (err) {
    console.error('❌ Error iniciando landing:', err);
    process.exit(1);
  }
}

start();
// deploy 1775244785
