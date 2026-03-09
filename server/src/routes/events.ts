import { Router } from 'express';
import type { Request, Response } from 'express';
import { getDatabase } from '../database/init.js';
import { requirePermission } from '../middleware/auth.js';
import type { BingoEvent, CreateEventRequest } from '../types/index.js';

const router = Router();

// GET /api/events - Listar todos los eventos
router.get('/', (_req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const events = db.prepare(`
      SELECT * FROM events ORDER BY created_at DESC
    `).all() as BingoEvent[];
    db.close();
    res.json({ success: true, data: events });
  } catch (error) {
    console.error('Error listando eventos:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// GET /api/events/:id - Obtener evento específico
router.get('/:id', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id) as BingoEvent | undefined;
    db.close();

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
router.post('/', requirePermission('events:create'), (req: Request, res: Response) => {
  try {
    const { name, description, use_free_center } = req.body as CreateEventRequest & { use_free_center?: boolean };

    if (!name?.trim()) {
      return res.status(400).json({ success: false, error: 'El nombre es requerido' });
    }

    const db = getDatabase();
    const useFreeCenter = use_free_center !== false ? 1 : 0; // Por defecto true
    const result = db.prepare(`
      INSERT INTO events (name, description, use_free_center) VALUES (?, ?, ?)
    `).run(name.trim(), description?.trim() || null, useFreeCenter);

    const event = db.prepare('SELECT * FROM events WHERE id = ?').get(result.lastInsertRowid) as BingoEvent;
    db.close();

    res.status(201).json({ success: true, data: event });
  } catch (error) {
    console.error('Error creando evento:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// PUT /api/events/:id - Actualizar evento (solo admin)
router.put('/:id', requirePermission('events:update'), (req: Request, res: Response) => {
  try {
    const { name, description, status, use_free_center } = req.body;
    const db = getDatabase();

    const existing = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id) as BingoEvent | undefined;
    if (!existing) {
      db.close();
      return res.status(404).json({ success: false, error: 'Evento no encontrado' });
    }

    const updates: string[] = [];
    const values: unknown[] = [];

    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) {
        db.close();
        return res.status(400).json({ success: false, error: 'El nombre no puede estar vacío' });
      }
      updates.push('name = ?'); values.push(name.trim());
    }
    if (description !== undefined) { updates.push('description = ?'); values.push(description?.trim() || null); }
    if (status !== undefined) {
      const validStatuses = ['draft', 'active', 'completed', 'cancelled'];
      if (!validStatuses.includes(status)) {
        db.close();
        return res.status(400).json({ success: false, error: 'Estado inválido' });
      }
      updates.push('status = ?'); values.push(status);
    }
    if (use_free_center !== undefined) {
      // Solo permitir cambiar si no hay cartones generados
      if (existing.total_cards > 0) {
        db.close();
        return res.status(400).json({ success: false, error: 'No se puede cambiar use_free_center después de generar cartones' });
      }
      updates.push('use_free_center = ?'); values.push(use_free_center ? 1 : 0);
    }

    if (updates.length > 0) {
      updates.push('updated_at = CURRENT_TIMESTAMP');
      values.push(req.params.id);
      db.prepare(`UPDATE events SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    }

    const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id) as BingoEvent;
    db.close();
    res.json({ success: true, data: event });
  } catch (error) {
    console.error('Error actualizando evento:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// DELETE /api/events/:id (solo admin)
router.delete('/:id', requirePermission('events:delete'), (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const existing = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);

    if (!existing) {
      db.close();
      return res.status(404).json({ success: false, error: 'Evento no encontrado' });
    }

    db.prepare('DELETE FROM events WHERE id = ?').run(req.params.id);
    db.close();
    res.json({ success: true, message: 'Evento eliminado' });
  } catch (error) {
    console.error('Error eliminando evento:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// GET /api/events/:id/stats
router.get('/:id/stats', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id) as BingoEvent | undefined;

    if (!event) {
      db.close();
      return res.status(404).json({ success: false, error: 'Evento no encontrado' });
    }

    const cardStats = db.prepare(`
      SELECT COUNT(*) as total, SUM(CASE WHEN is_sold = 1 THEN 1 ELSE 0 END) as sold
      FROM cards WHERE event_id = ?
    `).get(req.params.id) as { total: number; sold: number };

    const gameStats = db.prepare(`
      SELECT COUNT(*) as total,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as active
      FROM games WHERE event_id = ?
    `).get(req.params.id) as { total: number; completed: number; active: number };

    db.close();
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
