import { Router } from 'express';
import multer from 'multer';
import { getPool } from '../database/init.js';
import { requireRole } from '../middleware/auth.js';
import {
  exportEventBackup,
  restoreEventBackup,
  getEventsForBackup,
  createJob,
  getJob,
  exportFullDump,
  restoreFullDump,
  exportEventDump,
  restoreEventDump,
} from '../services/backupService.js';
import { logActivity, auditFromReq } from '../services/auditService.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } }); // 500MB max

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

// Backup completo - PostgreSQL dump (pg_dump)
router.get('/full', async (req, res) => {
  const pool = getPool();
  try {
    const dumpBuffer = await exportFullDump();
    const filename = `bingo_dump_full_${new Date().toISOString().slice(0, 10)}.sql`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/sql');

    logActivity(pool, auditFromReq(req, 'backup_full_export', 'backup', {
      filename,
      format: 'pg_dump',
      size_mb: (dumpBuffer.length / 1024 / 1024).toFixed(2),
    }));

    res.send(dumpBuffer);
  } catch (error) {
    logActivity(pool, auditFromReq(req, 'backup_full_export_error', 'backup', {
      error: (error as Error).message,
    }));
    res.status(500).json({ success: false, error: (error as Error).message });
  }
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
router.post('/restore-event', upload.single('file'), async (req, res) => {
  const pool = getPool();
  if (!req.file) return res.status(400).json({ success: false, error: 'Archivo de backup requerido' });

  let data: any;
  try {
    data = JSON.parse(req.file.buffer.toString('utf-8'));
  } catch {
    return res.status(400).json({ success: false, error: 'El archivo no es un JSON válido' });
  }

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

// Restaurar backup completo - PostgreSQL dump (psql)
router.post('/restore-full', upload.single('file'), async (req, res) => {
  const pool = getPool();
  if (!req.file) return res.status(400).json({ success: false, error: 'Archivo de backup requerido' });

  const job = createJob('restore_full');
  res.json({ success: true, data: { jobId: job.jobId } });

  try {
    const result = await restoreFullDump(req.file.buffer, job);

    logActivity(pool, auditFromReq(req, 'backup_full_restore', 'backup', {
      format: 'pg_dump',
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

    logActivity(pool, auditFromReq(req, 'backup_full_restore_error', 'backup', {
      file_name: req.file?.originalname,
      error: err.message,
    }));
  }
});

// Backup evento como dump SQL
router.get('/event/:eventId/dump', async (req, res) => {
  const pool = getPool();
  try {
    const eventId = parseInt(req.params.eventId, 10);
    if (!eventId) return res.status(400).json({ success: false, error: 'eventId invalido' });
    const sql = await exportEventDump(pool, eventId);
    const { rows } = await pool.query('SELECT name FROM events WHERE id = $1', [eventId]);
    const safeName = (rows[0]?.name || 'evento').replace(/[^a-zA-Z0-9]/g, '_');
    const filename = `bingo_dump_${safeName}_${new Date().toISOString().slice(0, 10)}.sql`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/sql');

    logActivity(pool, auditFromReq(req, 'backup_event_export', 'backup', {
      event_id: eventId,
      event_name: rows[0]?.name,
      format: 'sql_dump',
      filename,
    }));

    res.send(sql);
  } catch (error) {
    logActivity(pool, auditFromReq(req, 'backup_event_export_error', 'backup', {
      event_id: req.params.eventId,
      format: 'sql_dump',
      error: (error as Error).message,
    }));
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// Restaurar evento desde dump SQL
router.post('/restore-event-dump', upload.single('file'), async (req, res) => {
  const pool = getPool();
  if (!req.file) return res.status(400).json({ success: false, error: 'Archivo SQL requerido' });

  const sql = req.file.buffer.toString('utf-8');
  if (!sql.trim()) {
    return res.status(400).json({ success: false, error: 'El archivo SQL esta vacio' });
  }

  const job = createJob('restore_event');
  res.json({ success: true, data: { jobId: job.jobId } });

  try {
    const result = await restoreEventDump(pool, sql, job);

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
  }
});

export default router;
