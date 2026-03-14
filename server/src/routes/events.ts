import { Router } from 'express';
import type { Request, Response } from 'express';
import { getPool } from '../database/init.js';
import { requirePermission } from '../middleware/auth.js';
import type { BingoEvent, CreateEventRequest } from '../types/index.js';
import { logActivity, auditFromReq } from '../services/auditService.js';

const router = Router();

// GET /api/events - Listar todos los eventos
router.get('/', async (_req: Request, res: Response) => {
  try {
    const pool = getPool();
    const { rows: events } = await pool.query(`
      SELECT * FROM events ORDER BY created_at DESC
    `);
    res.json({ success: true, data: events });
  } catch (error) {
    console.error('Error listando eventos:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// GET /api/events/:id - Obtener evento específico
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const { rows } = await pool.query('SELECT * FROM events WHERE id = $1', [req.params.id]);
    const event = rows[0] as BingoEvent | undefined;

    if (!event) {
      return res.status(404).json({ success: false, error: 'Evento no encontrado' });
    }
    res.json({ success: true, data: event });
  } catch (error) {
    console.error('Error obteniendo evento:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// POST /api/events - Crear evento (solo admin)
router.post('/', requirePermission('events:create'), async (req: Request, res: Response) => {
  try {
    const { name, description, use_free_center } = req.body as CreateEventRequest & { use_free_center?: boolean };

    if (!name?.trim()) {
      return res.status(400).json({ success: false, error: 'El nombre es requerido' });
    }

    const pool = getPool();
    const useFreeCenter = use_free_center !== false;
    const result = await pool.query(`
      INSERT INTO events (name, description, use_free_center) VALUES ($1, $2, $3) RETURNING id
    `, [name.trim(), description?.trim() || null, useFreeCenter]);

    const { rows } = await pool.query('SELECT * FROM events WHERE id = $1', [result.rows[0].id]);
    const event = rows[0] as BingoEvent;

    logActivity(pool, auditFromReq(req, 'event_created', 'events', { event_id: event.id, name: event.name }));

    res.status(201).json({ success: true, data: event });
  } catch (error) {
    console.error('Error creando evento:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// PUT /api/events/:id - Actualizar evento (solo admin)
router.put('/:id', requirePermission('events:update'), async (req: Request, res: Response) => {
  try {
    const { name, description, status, use_free_center } = req.body;
    const pool = getPool();

    const { rows: existingRows } = await pool.query('SELECT * FROM events WHERE id = $1', [req.params.id]);
    const existing = existingRows[0] as BingoEvent | undefined;
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Evento no encontrado' });
    }

    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ success: false, error: 'El nombre no puede estar vacío' });
      }
      updates.push(`name = $${paramIdx++}`); values.push(name.trim());
    }
    if (description !== undefined) { updates.push(`description = $${paramIdx++}`); values.push(description?.trim() || null); }
    if (status !== undefined) {
      const validStatuses = ['draft', 'active', 'completed', 'cancelled'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ success: false, error: 'Estado inválido' });
      }
      updates.push(`status = $${paramIdx++}`); values.push(status);
    }
    if (use_free_center !== undefined) {
      // Solo permitir cambiar si no hay cartones generados
      if (existing.total_cards > 0) {
        return res.status(400).json({ success: false, error: 'No se puede cambiar use_free_center después de generar cartones' });
      }
      updates.push(`use_free_center = $${paramIdx++}`); values.push(use_free_center ? true : false);
    }

    if (updates.length > 0) {
      updates.push('updated_at = CURRENT_TIMESTAMP');
      values.push(req.params.id);
      await pool.query(`UPDATE events SET ${updates.join(', ')} WHERE id = $${paramIdx}`, values);
    }

    const { rows } = await pool.query('SELECT * FROM events WHERE id = $1', [req.params.id]);
    const event = rows[0] as BingoEvent;

    logActivity(pool, auditFromReq(req, 'event_updated', 'events', { event_id: event.id, changes: { name, description, status } }));

    res.json({ success: true, data: event });
  } catch (error) {
    console.error('Error actualizando evento:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// DELETE /api/events/:id (solo admin)
router.delete('/:id', requirePermission('events:delete'), async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const { rows } = await pool.query('SELECT * FROM events WHERE id = $1', [req.params.id]);

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Evento no encontrado' });
    }

    await pool.query('DELETE FROM events WHERE id = $1', [req.params.id]);

    logActivity(pool, auditFromReq(req, 'event_deleted', 'events', { event_id: parseInt(req.params.id as string) }));

    res.json({ success: true, message: 'Evento eliminado' });
  } catch (error) {
    console.error('Error eliminando evento:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// GET /api/events/:id/stats
router.get('/:id/stats', async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const { rows: eventRows } = await pool.query('SELECT * FROM events WHERE id = $1', [req.params.id]);
    const event = eventRows[0] as BingoEvent | undefined;

    if (!event) {
      return res.status(404).json({ success: false, error: 'Evento no encontrado' });
    }

    const cardStats = (await pool.query(`
      SELECT COUNT(*) as total, SUM(CASE WHEN is_sold = true THEN 1 ELSE 0 END) as sold
      FROM cards WHERE event_id = $1
    `, [req.params.id])).rows[0] as { total: number; sold: number };

    const gameStats = (await pool.query(`
      SELECT COUNT(*) as total,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as active
      FROM games WHERE event_id = $1
    `, [req.params.id])).rows[0] as { total: number; completed: number; active: number };

    res.json({
      success: true,
      data: {
        event,
        cards: { total: cardStats.total, sold: cardStats.sold || 0, available: cardStats.total - (cardStats.sold || 0) },
        games: gameStats,
      },
    });
  } catch (error) {
    console.error('Error obteniendo stats:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

export default router;
