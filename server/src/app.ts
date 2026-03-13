import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import { createServer as createHttpServer } from 'http';
import { createServer as createHttpsServer } from 'https';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import { initializeDatabase, getPool } from './database/init.js';
import { ensureAdminExists, verifyToken } from './services/authService.js';
import { authenticate, requireRole, requirePermission } from './middleware/auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Importar rutas
import authRouter from './routes/auth.js';
import eventsRouter from './routes/events.js';
import cardsRouter from './routes/cards.js';
import gamesRouter from './routes/games.js';
import dashboardRouter from './routes/dashboard.js';
import exportRouter from './routes/export.js';
import reportsRouter from './routes/reports.js';
import promoRouter from './routes/promo.js';
import inventarioRouter from './routes/inventario.js';

const app = express();

// SSL certs for HTTPS
let httpServer;
try {
  const sslKey = readFileSync(resolve(__dirname, '../certs/key.pem'));
  const sslCert = readFileSync(resolve(__dirname, '../certs/cert.pem'));
  httpServer = createHttpsServer({ key: sslKey, cert: sslCert }, app);
  console.log('🔒 HTTPS habilitado');
} catch {
  if (process.env.NODE_ENV === 'production') {
    console.error('❌ HTTPS requerido en producción. Configure certificados SSL en server/certs/');
    process.exit(1);
  }
  httpServer = createHttpServer(app);
  console.warn('⚠️  Sin certificados SSL, usando HTTP (solo desarrollo)');
}

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);

function corsOrigin(origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) {
  // Permitir requests sin origin (mobile apps, curl, same-origin)
  if (!origin) return cb(null, true);
  // En desarrollo o si no hay origins configurados, permitir LAN (192.168.x.x, localhost)
  if (ALLOWED_ORIGINS.length === 0) {
    const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+)(:\d+)?$/.test(origin);
    return cb(null, isLocal);
  }
  return cb(null, ALLOWED_ORIGINS.includes(origin));
}

const io = new Server(httpServer, {
  cors: {
    origin: corsOrigin,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: corsOrigin,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true,
}));
app.use(express.json({ limit: '5mb' }));
app.use(cookieParser());
app.use(helmet({ contentSecurityPolicy: false }));

// Rate limiting en login
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 20, // max 20 intentos por IP
  message: { success: false, error: 'Demasiados intentos de login. Intente en 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/auth/login', loginLimiter);

// Rate limiting general
const generalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 200, // 200 requests por minuto por IP
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', generalLimiter);

// Logging middleware
app.use((req, _res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// Rutas API públicas
app.use('/api/auth', authRouter);

// Rutas API protegidas
app.use('/api/events', authenticate, eventsRouter);
app.use('/api/cards', authenticate, cardsRouter);
app.use('/api/games', authenticate, gamesRouter);
app.use('/api/dashboard', authenticate, dashboardRouter);
app.use('/api/export', authenticate, exportRouter);
app.use('/api/reports', authenticate, reportsRouter);
app.use('/api/promo', authenticate, promoRouter);
app.use('/api/inventario', authenticate, inventarioRouter);

// Ruta de salud
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handler centralizado — no leakear detalles internos
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  const isProduction = process.env.NODE_ENV === 'production';
  res.status(500).json({
    success: false,
    error: isProduction ? 'Error interno del servidor' : err.message,
  });
});

// Socket.IO con autenticación
io.use((socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.query?.token;
  if (!token) {
    return next(new Error('Token de autenticación requerido'));
  }
  const payload = verifyToken(token as string);
  if (!payload) {
    return next(new Error('Token inválido o expirado'));
  }
  (socket as unknown as { user: unknown }).user = payload;
  next();
});

io.on('connection', (socket) => {
  console.log('Cliente conectado:', socket.id);

  // Unirse a sala de juego
  socket.on('join-game', (gameId: number) => {
    socket.join(`game-${gameId}`);
    console.log(`Socket ${socket.id} se unió al juego ${gameId}`);
  });

  // Salir de sala de juego
  socket.on('leave-game', (gameId: number) => {
    socket.leave(`game-${gameId}`);
    console.log(`Socket ${socket.id} salió del juego ${gameId}`);
  });

  socket.on('disconnect', () => {
    console.log('Cliente desconectado:', socket.id);
  });
});

// Exponer io para usar en rutas si es necesario
export { io };

// Función para emitir actualizaciones de juego
export function emitGameUpdate(gameId: number, data: unknown) {
  io.to(`game-${gameId}`).emit('game-update', data);
}

export function emitBallCalled(gameId: number, data: unknown) {
  io.to(`game-${gameId}`).emit('ball-called', data);
}

export function emitWinnerFound(gameId: number, data: unknown) {
  io.to(`game-${gameId}`).emit('winner-found', data);
}

// Iniciar servidor
async function start() {
  try {
    // Inicializar base de datos PostgreSQL
    console.log('🔧 Inicializando base de datos...');
    await initializeDatabase();

    // Crear usuario admin por defecto si no existe
    const pool = getPool();
    await ensureAdminExists(pool);

    const protocol = httpServer instanceof (await import('https')).Server ? 'https' : 'http';
    const wsProtocol = protocol === 'https' ? 'wss' : 'ws';
    httpServer.listen(Number(PORT), '0.0.0.0', () => {
      console.log(`
╔══════════════════════════════════════════════════════════╗
║                                                          ║
║   🎱  BINGO SERVER INICIADO                              ║
║                                                          ║
║   API:        ${protocol}://0.0.0.0:${PORT}/api                ║
║   WebSocket:  ${wsProtocol}://0.0.0.0:${PORT}                  ║
║   Health:     ${protocol}://localhost:${PORT}/api/health        ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
      `);
    });
  } catch (error) {
    console.error('❌ Error iniciando servidor:', error);
    process.exit(1);
  }
}

start();
