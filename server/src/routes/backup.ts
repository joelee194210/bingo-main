import { Router } from 'express';
import multer from 'multer';
import { spawn } from 'child_process';
import { getPool } from '../database/init.js';
import { requireRole } from '../middleware/auth.js';
import {
  exportEventBackup,
  restoreEventBackup,
  getEventsForBackup,
  createJob,
  getJob,
  streamEventDump,
  restoreEventDumpFromFile,
} from '../services/backupService.js';
import { logActivity, auditFromReq } from '../services/auditService.js';
import { readdirSync, unlinkSync, mkdirSync } from 'fs';

// Limpiar archivos temporales de uploads anteriores al iniciar
try {
  mkdirSync('/tmp/bingo-uploads', { recursive: true });
  for (const f of readdirSync('/tmp/bingo-uploads')) {
    try { unlinkSync(`/tmp/bingo-uploads/${f}`); } catch {}
  }
} catch {}

const router = Router();
// Todos los uploads van a disco para no cargar RAM
const uploadDisk = multer({ dest: '/tmp/bingo-uploads/', limits: { fileSize: 500 * 1024 * 1024 } });

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://slacker@localhost:5432/bingo';
// Timeout para procesos pg_dump/psql (5 minutos)
const PG_PROCESS_TIMEOUT = 5 * 60 * 1000;

// Router publico para progreso (se monta sin authenticate en app.ts)
export const backupProgressRouter = Router();
backupProgressRouter.get('/progress/:jobId', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) return res.status(404).json({ success: false, error: 'Job no encontrado' });
  res.json({ success: true, data: job });
});

// Solo admin puede acceder a backups
router.use(requireRole('admin'));

// Listar eventos disponibles para backup
router.get('/events', async (_req, res) => {
  try {
    const pool = getPool();
    const events = await getEventsForBackup(pool);
    res.json({ success: true, data: events });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// Backup completo - PostgreSQL dump streaming (cero buffering en RAM)
router.get('/full', async (req, res) => {
  const pool = getPool();
  const filename = `bingo_dump_full_${new Date().toISOString().slice(0, 10)}.sql`;

  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/sql');

  const proc = spawn('pg_dump', [DATABASE_URL, '--no-owner', '--no-privileges', '--clean', '--if-exists']);

  // Kill si tarda demasiado
  const timer = setTimeout(() => { proc.kill('SIGTERM'); }, PG_PROCESS_TIMEOUT);

  let stderr = '';
  let bytesSent = 0;
  proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
  proc.stdout.on('data', (chunk: Buffer) => { bytesSent += chunk.length; });

  // Pipear stdout de pg_dump directo al response HTTP
  proc.stdout.pipe(res);

  proc.on('close', (code) => {
    clearTimeout(timer);
    if (code === 0) {
      logActivity(pool, auditFromReq(req, 'backup_full_export', 'backup', {
        filename, format: 'pg_dump_stream', size_mb: (bytesSent / 1024 / 1024).toFixed(2),
      }));
    } else {
      console.error(`pg_dump falló (code ${code}): ${stderr}`);
      logActivity(pool, auditFromReq(req, 'backup_full_export_error', 'backup', { error: stderr.slice(0, 500) }));
      // Si aún no se envió nada, podemos mandar error
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: `pg_dump error: ${stderr.slice(0, 300)}` });
      }
    }
  });

  proc.on('error', (err) => {
    clearTimeout(timer);
    console.error('pg_dump spawn error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: `pg_dump no disponible: ${err.message}` });
    }
  });
});

// Backup por evento (con progreso)
router.get('/event/:eventId', async (req, res) => {
  const pool = getPool();
  const job = createJob('backup_event');
  try {
    const eventId = parseInt(req.params.eventId, 10);
    if (!eventId) return res.status(400).json({ success: false, error: 'eventId inválido' });
    const backup = await exportEventBackup(pool, eventId, job);
    const safeName = (backup.event.name || 'evento').replace(/[^a-zA-Z0-9]/g, '_');
    const filename = `bingo_backup_${safeName}_${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/json');

    logActivity(pool, auditFromReq(req, 'backup_event_export', 'backup', {
      event_id: eventId,
      event_name: backup.event.name,
      filename,
      total_cards: backup.tables.cards?.length || 0,
      total_games: backup.tables.games?.length || 0,
    }));

    res.json(backup);
  } catch (error) {
    logActivity(pool, auditFromReq(req, 'backup_event_export_error', 'backup', {
      event_id: req.params.eventId,
      error: (error as Error).message,
    }));
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// Restaurar evento desde backup (async con job)
router.post('/restore-event', uploadDisk.single('file'), async (req, res) => {
  const pool = getPool();
  if (!req.file) return res.status(400).json({ success: false, error: 'Archivo de backup requerido' });

  let data: any;
  try {
    const { readFileSync } = await import('fs');
    data = JSON.parse(readFileSync(req.file.path, 'utf-8'));
  } catch {
    // Limpiar archivo temporal
    import('fs').then(fs => fs.unlink(req.file!.path, () => {}));
    return res.status(400).json({ success: false, error: 'El archivo no es un JSON válido' });
  }
  // Limpiar archivo temporal (ya lo parseamos)
  import('fs').then(fs => fs.unlink(req.file!.path, () => {}));

  const job = createJob('restore_event');
  // Devolver jobId inmediatamente para que el cliente haga polling
  res.json({ success: true, data: { jobId: job.jobId } });

  // Ejecutar restauración en background
  try {
    const result = await restoreEventBackup(pool, data, job);

    logActivity(pool, auditFromReq(req, 'backup_event_restore', 'backup', {
      original_event: data.event?.name,
      new_event_id: result.event_id,
      new_event_name: result.event_name,
      cards_restored: result.cards_restored,
      games_restored: result.games_restored,
      file_name: req.file!.originalname,
      file_size_mb: (req.file!.size / 1024 / 1024).toFixed(2),
    }));
  } catch (error) {
    const err = error as Error;
    console.error('Error restaurando evento:', err);
    const detail = (error as any)?.detail || '';
    const constraint = (error as any)?.constraint || '';
    const table = (error as any)?.table || '';
    const msg = detail
      ? `${err.message} [tabla: ${table}, constraint: ${constraint}, detalle: ${detail}]`
      : err.message;

    job.status = 'error';
    job.error = msg;
    job.step = 'Error';
    job.details = msg;

    logActivity(pool, auditFromReq(req, 'backup_event_restore_error', 'backup', {
      original_event: data.event?.name,
      file_name: req.file?.originalname,
      error: msg,
      constraint,
      table,
    }));
  }
});

// Restaurar backup completo - PostgreSQL dump via disco (cero RAM)
router.post('/restore-full', uploadDisk.single('file'), async (req, res) => {
  const pool = getPool();
  if (!req.file) return res.status(400).json({ success: false, error: 'Archivo de backup requerido' });

  const filePath = req.file.path;
  const job = createJob('restore_full');
  res.json({ success: true, data: { jobId: job.jobId } });

  try {
    // psql -f lee directo del disco — cero buffering en Node.js
    const result = await new Promise<{ message: string }>((resolve, reject) => {
      job.step = 'Restaurando dump PostgreSQL...';
      job.details = `Procesando ${(req.file!.size / 1024 / 1024).toFixed(2)} MB...`;
      job.updatedAt = Date.now();

      const proc = spawn('psql', [DATABASE_URL, '-f', filePath]);
      const timer = setTimeout(() => { proc.kill('SIGTERM'); }, PG_PROCESS_TIMEOUT);

      let stderr = '';
      proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

      proc.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve({ message: 'Dump PostgreSQL restaurado exitosamente' });
        } else {
          reject(new Error(`psql finalizó con código ${code}: ${stderr.slice(0, 500)}`));
        }
      });
      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`No se pudo ejecutar psql: ${err.message}`));
      });
    });

    job.status = 'completed';
    job.step = 'Restauración completada';
    job.details = result.message;
    job.updatedAt = Date.now();
    job.result = result;

    logActivity(pool, auditFromReq(req, 'backup_full_restore', 'backup', {
      format: 'pg_dump_disk',
      file_name: req.file!.originalname,
      file_size_mb: (req.file!.size / 1024 / 1024).toFixed(2),
      message: result.message,
    }));
  } catch (error) {
    const err = error as Error;
    console.error('Error restaurando dump completo:', err);

    job.status = 'error';
    job.error = err.message;
    job.step = 'Error';
    job.details = err.message;
    job.updatedAt = Date.now();

    logActivity(pool, auditFromReq(req, 'backup_full_restore_error', 'backup', {
      file_name: req.file?.originalname,
      error: err.message,
    }));
  } finally {
    // Limpiar archivo temporal
    import('fs').then(fs => fs.unlink(filePath, () => {}));
  }
});

// Backup evento como dump SQL — streaming directo (sin buffering en memoria)
router.get('/event/:eventId/dump', async (req, res) => {
  const pool = getPool();
  try {
    const eventId = parseInt(req.params.eventId, 10);
    if (!eventId) return res.status(400).json({ success: false, error: 'eventId invalido' });

    const { rows } = await pool.query('SELECT name FROM events WHERE id = $1', [eventId]);
    if (!rows[0]) return res.status(404).json({ success: false, error: 'Evento no encontrado' });
    const eventName = rows[0].name;

    const safeName = (eventName || 'evento').replace(/[^a-zA-Z0-9]/g, '_');
    const filename = `bingo_dump_${safeName}_${new Date().toISOString().slice(0, 10)}.sql`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/sql');

    // Streamear dump directamente via psql → response HTTP (cero buffering)
    await streamEventDump(pool, eventId, eventName, res);

    logActivity(pool, auditFromReq(req, 'backup_event_export', 'backup', {
      event_id: eventId,
      event_name: eventName,
      format: 'sql_dump_stream',
      filename,
    }));
  } catch (error) {
    logActivity(pool, auditFromReq(req, 'backup_event_export_error', 'backup', {
      event_id: req.params.eventId,
      format: 'sql_dump',
      error: (error as Error).message,
    }));
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  }
});

// Restaurar evento desde dump SQL — usa disco + psql -f (cero RAM)
router.post('/restore-event-dump', uploadDisk.single('file'), async (req, res) => {
  const pool = getPool();
  if (!req.file) return res.status(400).json({ success: false, error: 'Archivo SQL requerido' });

  const filePath = req.file.path;
  const job = createJob('restore_event');
  res.json({ success: true, data: { jobId: job.jobId } });

  try {
    const result = await restoreEventDumpFromFile(pool, filePath, job);

    logActivity(pool, auditFromReq(req, 'backup_event_restore', 'backup', {
      format: 'sql_dump',
      file_name: req.file!.originalname,
      file_size_mb: (req.file!.size / 1024 / 1024).toFixed(2),
      message: result.message,
    }));
  } catch (error) {
    const err = error as Error;
    console.error('Error restaurando dump de evento:', err);

    job.status = 'error';
    job.error = err.message;
    job.step = 'Error';
    job.details = err.message;

    logActivity(pool, auditFromReq(req, 'backup_event_restore_error', 'backup', {
      file_name: req.file?.originalname,
      format: 'sql_dump',
      error: err.message,
    }));
  } finally {
    // Limpiar archivo temporal
    import('fs').then(fs => fs.unlink(filePath, () => {}));
  }
});

export default router;
