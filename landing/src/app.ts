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
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir assets estáticos (logo)
const assetsPath = resolve(import.meta.dirname, 'assets');
app.use('/assets', express.static(assetsPath, { maxAge: '7d' }));

// Rate limit en creación de órdenes
const orderLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, error: 'Demasiados intentos. Intente en 15 minutos.' },
});
app.use('/venta/api/orders', orderLimiter);

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
  const source = req.query.a || 'direct';
  const defaultEvent = process.env.DEFAULT_EVENT_ID;
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
