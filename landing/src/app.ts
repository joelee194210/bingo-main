process.env.TZ = 'America/Panama';

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { resolve, join } from 'path';
import { initPool, getPool } from './database.js';
import ventaRouter, { renderLayout } from './routes/venta.js';
import { expireStaleOrders } from './services/orderService.js';
import { captureRequestData } from './services/tracking.js';

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
      formAction: ["'self'"],
      baseUri: ["'self'"],
    },
  },
}));
// SEC-C3: CORS con whitelist explícita cuando ALLOWED_ORIGINS está seteada.
// Si no está seteada, permite todo (comportamiento por defecto) para no romper
// el landing en producción si el admin no ha configurado la env var aún.
const allowedOriginsRaw = process.env.ALLOWED_ORIGINS || '';
const allowedOrigins = allowedOriginsRaw
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

if (allowedOrigins.length > 0) {
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        return callback(new Error(`Origen no permitido por CORS: ${origin}`));
      },
      methods: ['GET', 'POST'],
      credentials: false,
    })
  );
} else {
  // SEC: si no hay ALLOWED_ORIGINS, default a same-origin (no abrir CORS a todos)
  app.use(cors({ origin: false }));
}
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir assets estáticos (logo) — busca en src/ o dist/
const assetsPath = resolve(process.cwd(), 'src', 'assets');
const altAssetsPath = resolve(process.cwd(), 'assets');
app.use('/assets', express.static(assetsPath, { maxAge: '7d' }));
app.use('/assets', express.static(altAssetsPath, { maxAge: '7d' }));

// Imágenes para correos — URLs absolutas planas bajo /mail/*.png.
// Se sirven siempre, incluso con LANDING_ENABLED=false (ver guard abajo).
app.use('/mail', express.static(resolve(assetsPath, 'mail'), { maxAge: '7d' }));

// Rate limits
const orderLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, error: 'Demasiados intentos. Intente en 15 minutos.' },
});

// SEC-H7: rate limit específico para polling de status (GET), separado del
// POST de creación (estricto). Sin esto, el limiter estricto rompía el
// polling legítimo y, si se quitaba, permitía enumerar order codes.
const statusPollLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120, // 2 req/s por IP
  message: { success: false, error: 'Demasiados intentos.' },
});

app.use('/venta/api/orders', (req, res, next) => {
  if (req.method === 'POST') return orderLimiter(req, res, next);
  if (req.method === 'GET') return statusPollLimiter(req, res, next);
  return next();
});

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

// SEC: rate limit en páginas de estado para evitar enumeración de order codes
const statusPageLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: 'Demasiados intentos.',
});
app.use('/venta/estado', statusPageLimiter);

// SEC: rate limit estricto en endpoint interno. Solo el server admin lo llama
// vía proxy con un secret. Aun con secret, limitamos brute-force y abuse.
const internalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { success: false, error: 'Rate limit excedido' },
});
app.use('/venta/internal', internalLimiter);

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'bingo-landing' }));

// Página "Próximamente" cuando LANDING_ENABLED != true
function renderComingSoon(): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#c0272d">
  <title>Mega Bingo TV Mundial</title>
  <link rel="preload" as="image" href="/assets/fondo.jpg" fetchpriority="high">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html { height: 100%; }
    body { font-family: 'Inter', -apple-system, sans-serif; background-color: #c0272d; color: #1e293b; min-height: 100%; overflow-x: hidden; display: flex; align-items: center; justify-content: center; }
    body::before { content: ''; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: url('/assets/fondo.jpg') no-repeat center center / cover; z-index: -1; }
    .container { max-width: 520px; text-align: center; padding: 40px 20px; position: relative; z-index: 1; }
    .logo img { max-width: 280px; height: auto; filter: drop-shadow(0 4px 12px rgba(0,0,0,0.3)); margin-bottom: 32px; }
    .card { background: white; border-radius: 20px; box-shadow: 0 8px 40px rgba(0,0,0,0.15); padding: 40px 32px; position: relative; overflow: hidden; }
    h1 { font-size: 24px; font-weight: 800; color: #1e40af; margin-bottom: 16px; }
    p { font-size: 16px; color: #64748b; line-height: 1.6; }
    .badge { display: inline-block; margin-top: 24px; padding: 10px 24px; background: linear-gradient(135deg, #eff6ff, #dbeafe); border: 2px solid #bfdbfe; border-radius: 24px; font-size: 14px; font-weight: 700; color: #1e40af; letter-spacing: 0.3px; }
    .sponsors { background: #991b1b; border-radius: 16px; padding: 24px 16px; margin-top: 20px; text-align: center; }
    .sponsors-row { display: flex; align-items: center; justify-content: center; gap: 24px; }
    .sponsors-side { display: flex; flex-direction: column; align-items: center; gap: 6px; }
    .sponsors-side img { height: 65px; width: auto; object-fit: contain; }
    .sponsors-side span { color: #ffffff; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; }
    .sponsors-center { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 0 12px; }
    .sponsors-center img { height: 75px; width: auto; object-fit: contain; }
    .sponsors-text { color: #ffffff; font-size: 10px; line-height: 1.4; opacity: 0.9; text-align: center; }
    .footer { text-align: center; margin-top: 20px; padding: 16px; font-size: 11px; color: #94a3b8; }
    .footer span { display: block; margin-bottom: 8px; }
    .footer img { max-width: 80px; height: auto; opacity: 0.6; }
    @media (max-width: 480px) { .card { padding: 24px 20px; } .sponsors-row img { height: 50px; } .sponsors-row .primera-dama { height: 60px; } }
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
    <div class="sponsors">
      <div class="sponsors-row">
        <div class="sponsors-side">
          <img src="/assets/bingos_nacionales.png" alt="Bingos Nacionales">
          <span>Organiza</span>
        </div>
        <div class="sponsors-center">
          <img src="/assets/primera_dama.png" alt="Despacho de la Primera Dama">
          <p class="sponsors-text">A beneficio de APROB del Despacho de la Primera Dama<br>de la República de Panamá.</p>
        </div>
      </div>
    </div>
    <div class="footer">
      <a href="https://www.megabingotv.com" target="_blank" rel="noopener" style="color:#fff;font-size:13px;text-decoration:underline;opacity:0.85;">Para más información acerca del Mega Bingo TV Mundial da clic aquí</a>
    </div>
  </div>
</body>
</html>`;
}

// Guard: si LANDING_ENABLED != true, mostrar "Próximamente" en rutas públicas
app.use((req, res, next) => {
  const enabled = process.env.LANDING_ENABLED === 'true';
  if (enabled) return next();
  // Permitir health check, assets y APIs internas siempre
  if (req.path === '/health' || req.path.startsWith('/assets') || req.path.startsWith('/mail')) return next();
  // API endpoints retornan JSON de error
  if (req.path.includes('/api/')) {
    return res.status(503).json({ success: false, error: 'Venta digital no disponible' });
  }
  res.status(200).send(renderComingSoon());
});

// Todas las rutas de venta
app.use('/venta', ventaRouter);

// Ruta /panama — landing promocional con diseño propio.
// Sirve el archivo HTML estático ubicado en src/assets/panama/index.html.
// El HTML declara <base href="/assets/panama/"> para que style.css e imágenes
// resuelvan bajo /assets/panama/* (servido por el static middleware).
app.get('/panama', (_req, res) => {
  res.sendFile(join(assetsPath, 'panama', 'index.html'));
});

// Ruta raíz redirige a /venta con el evento por defecto (configurable)
app.get('/', (_req, res) => {
  const defaultEvent = process.env.DEFAULT_EVENT_ID;
  if (defaultEvent) {
    res.redirect(`/venta/${defaultEvent}`);
  } else {
    res.status(200).send('Mega Bingo TV Mundial');
  }
});

// Ruta /go para tracking de enlaces referidos.
// DEFAULT_EVENT_ID: env var (Railway) con el ID del evento activo al que
// redirige cualquier escaneo. Si no está seteada, /go registra el scan
// y redirige a '/' (fallback). Debe coincidir con un evento con
// online_sales_config.is_enabled = TRUE, o la landing mostrará error.
app.get('/go', (req, res) => {
  const data = captureRequestData(req);
  const defaultEvent = process.env.DEFAULT_EVENT_ID;

  // Guardar escaneo en BD (fire-and-forget)
  getPool().query(
    `INSERT INTO qr_scans (
      source, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
      gclid, fbclid, raw_query,
      ip, ip_chain, country, region, city, timezone, lat, lon,
      user_agent, browser_name, browser_version, os_name, os_version,
      device_type, device_vendor, device_model, engine_name, is_bot, language,
      ch_ua, ch_ua_mobile, ch_ua_platform,
      dnt, sec_gpc,
      referer, host, protocol, visitor_hash
    ) VALUES (
      $1, $2, $3, $4, $5, $6,
      $7, $8, $9,
      $10, $11, $12, $13, $14, $15, $16, $17,
      $18, $19, $20, $21, $22,
      $23, $24, $25, $26, $27, $28,
      $29, $30, $31,
      $32, $33,
      $34, $35, $36, $37
    )`,
    [
      data.source, data.utm_source, data.utm_medium, data.utm_campaign, data.utm_content, data.utm_term,
      data.gclid, data.fbclid, data.raw_query,
      data.ip, data.ip_chain, data.country, data.region, data.city, data.timezone, data.lat, data.lon,
      data.user_agent, data.browser_name, data.browser_version, data.os_name, data.os_version,
      data.device_type, data.device_vendor, data.device_model, data.engine_name, data.is_bot, data.language,
      data.ch_ua, data.ch_ua_mobile, data.ch_ua_platform,
      data.dnt, data.sec_gpc,
      data.referer, data.host, data.protocol, data.visitor_hash,
    ]
  ).catch(err => console.error('Error guardando QR scan:', err));

  console.log(`📊 Scan: source=${data.source} country=${data.country ?? '?'} device=${data.device_type ?? '?'} bot=${data.is_bot} visitor=${data.visitor_hash?.slice(0, 8) ?? '?'}`);

  if (defaultEvent) {
    res.redirect(`/venta/${defaultEvent}?ref=${encodeURIComponent(data.source)}`);
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
║  🎱 BINGO LANDING — Mega Bingo TV Mundial   ║
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
