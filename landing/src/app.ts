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
