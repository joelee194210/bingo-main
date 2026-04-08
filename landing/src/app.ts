process.env.TZ = 'America/Panama';

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { resolve } from 'path';
import { initPool, getPool } from './database.js';
import ventaRouter from './routes/venta.js';
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

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'bingo-landing' }));

// Test email temporal (quitar después)
app.get('/test-email', async (_req, res) => {
  const API_KEY = 're_MG1PKHUc_DSvcC4m6rVE7qj4c2w1sfaNE';
  const BASE = process.env.PUBLIC_URL || 'https://www.megabingodigital.com';
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333;">
  <div style="text-align:center;margin-bottom:30px;">
    <img src="${BASE}/assets/logo.png" alt="Mega Bingo TV Mundial" style="max-width:220px;height:auto;" />
  </div>
  <p>Hola <strong>Jose Test</strong>,</p>
  <p>Tu compra ha sido confirmada exitosamente. Ya eres parte del <strong style="color:#dc2626;">Mega Bingo TV Mundial</strong>. Tus cartones digitales están listos para descargar.</p>
  <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:20px;margin:20px 0;">
    <h3 style="margin-top:0;color:#0369a1;">Detalle de tu compra</h3>
    <table style="width:100%;border-collapse:collapse;">
      <tr><td style="padding:5px 0;color:#666;">Orden:</td><td style="padding:5px 0;font-weight:bold;">ORD-TEST1</td></tr>
      <tr><td style="padding:5px 0;color:#666;">Cantidad:</td><td style="padding:5px 0;">2 cartones</td></tr>
      <tr><td style="padding:5px 0;color:#666;">Total pagado:</td><td style="padding:5px 0;font-weight:bold;font-size:1.2em;color:#059669;">$10.00</td></tr>
      <tr><td style="padding:5px 0;color:#666;">Confirmación Yappy:</td><td style="padding:5px 0;font-weight:bold;">TXN-2026040812345</td></tr>
    </table>
  </div>
  <div style="text-align:center;margin:30px 0;">
    <a href="${BASE}" style="display:inline-block;background:linear-gradient(135deg,#1e40af,#3b82f6);color:white;text-decoration:none;padding:16px 36px;border-radius:10px;font-size:16px;font-weight:bold;">Descargar mis cartones</a>
  </div>
  <div style="background:#f8fafc;border-radius:8px;padding:15px;margin:20px 0;">
    <p style="margin:0 0 10px 0;font-weight:bold;color:#475569;">Seriales de tus cartones:</p>
    <p style="margin:0;font-family:monospace;font-size:14px;color:#64748b;">00001-01 &bull; 00001-02</p>
  </div>
  <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:15px;margin:20px 0;">
    <p style="margin:0;font-size:13px;color:#92400e;"><strong>Importante:</strong> Guarda este correo como comprobante de tu compra. El enlace de descarga es personal y seguro.</p>
  </div>
  <div style="text-align:center;margin:30px 0;">
    <a href="${BASE}" style="display:inline-block;background:linear-gradient(135deg,#b91c1c,#dc2626);color:white;text-decoration:none;padding:16px 36px;border-radius:10px;font-size:16px;font-weight:bold;">Comprar cartones digitales</a>
  </div>
  <p style="color:#94a3b8;font-size:11px;margin-top:30px;text-align:center;">Mega Bingo TV Mundial &copy; 2026 | Vendedor autorizado: Yotumi S.A.</p>
</body></html>`;

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'ventas@megabingodigital.com',
        to: ['joelee@507sc.com'],
        subject: 'Mega Bingo TV Mundial - Tus cartones están listos (ORD-TEST1)',
        html,
      }),
    });
    const data = await r.json();
    res.json({ success: r.ok, status: r.status, data });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

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
// deploy 1775244785
// redeploy 1749240900
