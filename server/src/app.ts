import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import { createServer as createHttpServer } from 'http';
import { createServer as createHttpsServer } from 'https';
import { readFileSync, existsSync } from 'fs';
import { resolve, join } from 'path';
import { Server } from 'socket.io';
import { initializeDatabase, getPool } from './database/init.js';
import { ensureAdminExists, verifyToken } from './services/authService.js';
import { authenticate } from './middleware/auth.js';
import { initPermissions } from './services/permissionService.js';

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
import backupRouter, { backupProgressRouter } from './routes/backup.js';
import permissionsRouter from './routes/permissions.js';
import activityLogRouter from './routes/activityLog.js';
import verificarRouter from './routes/verificar.js';
import misUsuariosRouter from './routes/misUsuarios.js';

const app = express();

// SSL certs for HTTPS (Railway/PaaS manejan SSL via proxy inverso)
let httpServer: ReturnType<typeof createHttpsServer> | ReturnType<typeof createHttpServer>;
const certsPath = resolve(process.cwd(), 'certs');
if (existsSync(resolve(certsPath, 'key.pem')) && existsSync(resolve(certsPath, 'cert.pem'))) {
  const sslKey = readFileSync(resolve(certsPath, 'key.pem'));
  const sslCert = readFileSync(resolve(certsPath, 'cert.pem'));
  httpServer = createHttpsServer({ key: sslKey, cert: sslCert }, app);
  console.log('🔒 HTTPS habilitado');
} else {
  httpServer = createHttpServer(app);
  if (process.env.NODE_ENV === 'production') {
    console.log('🔒 HTTP mode — SSL manejado por proxy inverso (Railway/PaaS)');
  } else {
    console.warn('⚠️  Sin certificados SSL, usando HTTP (solo desarrollo)');
  }
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
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", "wss:", "ws:"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// Rate limiting en login
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 20, // max 20 intentos por IP
  message: { success: false, error: 'Demasiados intentos de login. Intente en 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/auth/login', loginLimiter);

// Rate limiting en cambio de contraseña
const authSensitiveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, error: 'Demasiados intentos. Intente en 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/auth/change-password', authSensitiveLimiter);

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

// Rutas públicas
app.use('/verificar', verificarRouter); // verificación de cartón vía QR (sin auth)
app.use('/api/auth', authRouter);
app.use('/api/backup', backupProgressRouter); // progreso sin auth (jobId es secreto)

// Rutas API protegidas
app.use('/api/events', authenticate, eventsRouter);
app.use('/api/cards', authenticate, cardsRouter);
app.use('/api/games', authenticate, gamesRouter);
app.use('/api/dashboard', authenticate, dashboardRouter);
app.use('/api/export', authenticate, exportRouter);
app.use('/api/reports', authenticate, reportsRouter);
app.use('/api/promo', authenticate, promoRouter);
app.use('/api/inventario', authenticate, inventarioRouter);
app.use('/api/backup', authenticate, backupRouter);
app.use('/api/permissions', authenticate, permissionsRouter);
app.use('/api/activity-log', authenticate, activityLogRouter);
app.use('/api/mis-usuarios', misUsuariosRouter); // auth interno en el router

// Ruta de salud
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Servir archivos estáticos del client build (producción)
const clientDistPath = existsSync(resolve(process.cwd(), '../client/dist'))
  ? resolve(process.cwd(), '../client/dist')
  : resolve(process.cwd(), 'client/dist');

const ADMIN_HOSTS = (process.env.ADMIN_HOSTS || 'admin.verificatubingo.com,localhost').split(',');

function isAdminHost(host: string | undefined): boolean {
  if (!host) return false;
  const hostname = host.split(':')[0];
  return ADMIN_HOSTS.some(h => hostname === h || hostname.endsWith('.railway.app'));
}

if (existsSync(clientDistPath)) {
  // Assets estáticos (JS, CSS, imágenes) se sirven a todos los hosts
  app.use('/assets', express.static(resolve(clientDistPath, 'assets')));
  app.use('/bingo.svg', express.static(resolve(clientDistPath, 'bingo.svg')));

  // SPA catch-all SOLO para admin subdomain
  app.get('*', (_req, res, next) => {
    if (_req.path.startsWith('/api') || _req.path.startsWith('/socket.io') || _req.path.startsWith('/verificar')) {
      return next();
    }

    // Admin host → servir SPA
    if (isAdminHost(_req.headers.host)) {
      return res.sendFile(resolve(clientDistPath, 'index.html'));
    }

    // Dominio público — landing page
    if (_req.path === '/' || _req.path === '') {
      return res.send(renderPublicLanding());
    }

    // Cualquier otra ruta en dominio público → 404
    return res.status(404).send(renderPublic404());
  });
  console.log('📦 Admin SPA solo via:', ADMIN_HOSTS.join(', '));
}

function renderPublicLanding(): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verifica Tu Bingo</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; color: #e2e8f0; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 16px; padding: 48px 32px; max-width: 480px; width: 100%; box-shadow: 0 25px 50px rgba(0,0,0,0.5); text-align: center; }
    h1 { font-size: 32px; font-weight: 700; background: linear-gradient(90deg, #3b82f6, #8b5cf6); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 12px; }
    .subtitle { color: #94a3b8; font-size: 16px; margin-bottom: 32px; }
    .info { background: #0f172a; border: 1px solid #334155; border-radius: 12px; padding: 20px; margin-bottom: 24px; }
    .info p { color: #cbd5e1; font-size: 14px; line-height: 1.6; }
    .info strong { color: #3b82f6; }
    .footer { color: #475569; font-size: 12px; margin-top: 24px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>🎱 Verifica Tu Bingo</h1>
    <p class="subtitle">Plataforma de verificación de cartones</p>
    <div class="info">
      <p>Escanea el <strong>código QR</strong> de tu cartón de bingo para verificar su autenticidad y estado.</p>
    </div>
    <div class="info">
      <p>Si tienes el código de tu cartón, ingresa a:<br><strong>verificatubingo.com/verificar/TU-CODIGO</strong></p>
    </div>
    <div class="footer">Bingo Manager &copy; ${new Date().getFullYear()}</div>
  </div>
</body>
</html>`;
}

function renderPublic404(): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Página no encontrada — Verifica Tu Bingo</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; color: #e2e8f0; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 16px; padding: 48px 32px; max-width: 400px; width: 100%; box-shadow: 0 25px 50px rgba(0,0,0,0.5); text-align: center; }
    h1 { font-size: 64px; margin-bottom: 12px; }
    h2 { font-size: 20px; margin-bottom: 8px; }
    p { color: #94a3b8; font-size: 14px; margin-bottom: 20px; }
    a { color: #3b82f6; text-decoration: none; font-weight: 600; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="card">
    <h1>404</h1>
    <h2>Página no encontrada</h2>
    <p>La página que buscas no existe.</p>
    <a href="/">Volver al inicio</a>
  </div>
</body>
</html>`;
}

// Error handler centralizado — no leakear detalles internos
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  const isProduction = process.env.NODE_ENV === 'production';
  res.status(500).json({
    success: false,
    error: isProduction ? 'Error interno del servidor' : err.message,
  });
});

// Socket.IO con autenticación via cookie httpOnly
io.use((socket, next) => {
  // Extraer token de la cookie httpOnly o del handshake auth (NO de query string)
  const cookieHeader = socket.handshake.headers.cookie || '';
  const tokenMatch = cookieHeader.match(/bingo_token=([^;]+)/);
  const token = tokenMatch?.[1] || socket.handshake.auth?.token;

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

    // Ejecutar migración de permisos/auditoría
    const pool = getPool();
    const __dirname_app = new URL('.', import.meta.url).pathname;
    const migrationPath = resolve(__dirname_app, 'database/migration_roles_audit.sql');
    try {
      const migrationSQL = readFileSync(migrationPath, 'utf-8');
      await pool.query(migrationSQL);
      console.log('✅ Migración de permisos/auditoría aplicada');
    } catch (err) {
      console.warn('⚠️  Migración permisos/auditoría:', (err as Error).message);
    }

    // Crear usuario admin por defecto si no existe
    await ensureAdminExists(pool);

    // Inicializar cache de permisos
    await initPermissions(pool);

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
