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

// Railway/Cloudflare usan proxy inverso — necesario para rate-limit y req.ip
app.set('trust proxy', 1);

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
      scriptSrc: ["'self'", "https://challenges.cloudflare.com"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", "wss:", "ws:"],
      fontSrc: ["'self'"],
      frameSrc: ["https://challenges.cloudflare.com"],
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
  app.use('/logo.png', express.static(resolve(clientDistPath, 'logo.png')));

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
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #ffffff; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; color: #1f2937; }
    .container { max-width: 440px; width: 100%; text-align: center; }
    .logo img { max-width: 240px; height: auto; margin-bottom: 16px; }
    .divider { height: 3px; background: linear-gradient(90deg, #e53e3e, #dd6b20, #ecc94b, #38a169, #3182ce, #805ad5); border-radius: 2px; margin-bottom: 28px; }
    .card { background: #ffffff; border: 1px solid #e5e7eb; border-radius: 16px; padding: 40px 28px; box-shadow: 0 4px 24px rgba(0,0,0,0.06); }
    h2 { font-size: 22px; font-weight: 800; color: #111827; margin-bottom: 8px; }
    .subtitle { color: #6b7280; font-size: 14px; margin-bottom: 28px; }
    .info { background: #f9fafb; border: 1px solid #f3f4f6; border-radius: 12px; padding: 20px; margin-bottom: 16px; text-align: left; }
    .info p { color: #4b5563; font-size: 14px; line-height: 1.6; }
    .info strong { color: #3182ce; }
    .url-box { display: inline-block; padding: 10px 20px; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 10px; color: #1d4ed8; font-weight: 700; font-size: 14px; margin-top: 8px; }
    .footer { color: #9ca3af; font-size: 11px; margin-top: 24px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">
      <img src="/logo.png" alt="Mega Bingo Mundial" onerror="this.style.display='none'">
    </div>
    <div class="divider"></div>
    <div class="card">
      <h2>🎱 Verifica Tu Carton</h2>
      <p class="subtitle">Plataforma de verificacion de cartones de bingo</p>
      <div class="info">
        <p>Escanea el <strong>codigo QR</strong> de tu carton de bingo para verificar su autenticidad y estado.</p>
      </div>
      <div class="info">
        <p>Si tienes el codigo de tu carton, ingresa a:</p>
      </div>
      <div class="url-box">verificatubingo.com/verificar/TU-CODIGO</div>
    </div>
    <div class="footer">Mega Bingo Mundial &copy; ${new Date().getFullYear()}</div>
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
  <title>Pagina no encontrada - Mega Bingo Mundial</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #ffffff; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; color: #1f2937; }
    .container { max-width: 420px; width: 100%; text-align: center; }
    .logo img { max-width: 200px; height: auto; margin-bottom: 16px; }
    .divider { height: 3px; background: linear-gradient(90deg, #e53e3e, #dd6b20, #ecc94b, #38a169, #3182ce, #805ad5); border-radius: 2px; margin-bottom: 28px; }
    .card { background: #ffffff; border: 1px solid #e5e7eb; border-radius: 16px; padding: 40px 28px; box-shadow: 0 4px 24px rgba(0,0,0,0.06); }
    .num { font-size: 72px; font-weight: 800; color: #e5e7eb; line-height: 1; margin-bottom: 8px; }
    h2 { font-size: 18px; font-weight: 700; color: #374151; margin-bottom: 8px; }
    p { color: #6b7280; font-size: 14px; margin-bottom: 24px; }
    a { display: inline-block; padding: 10px 24px; background: #3182ce; color: #fff; text-decoration: none; font-weight: 600; font-size: 14px; border-radius: 10px; transition: background 0.2s; }
    a:hover { background: #2563eb; }
    .footer { color: #9ca3af; font-size: 11px; margin-top: 24px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">
      <img src="/logo.png" alt="Mega Bingo Mundial" onerror="this.style.display='none'">
    </div>
    <div class="divider"></div>
    <div class="card">
      <div class="num">404</div>
      <h2>Pagina no encontrada</h2>
      <p>La pagina que buscas no existe o ha sido movida.</p>
      <a href="/">Volver al inicio</a>
    </div>
    <div class="footer">Mega Bingo Mundial &copy; ${new Date().getFullYear()}</div>
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
