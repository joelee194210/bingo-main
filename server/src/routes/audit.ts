import { Router } from 'express';
import type { Request, Response } from 'express';
import { getDatabase } from '../database/init.js';
import { requirePermission } from '../middleware/auth.js';
import { getAuditLog } from '../services/inventoryService.js';

const router = Router();

function isKnownError(msg: string): boolean {
  return ['no encontrad', 'no se puede', 'no está', 'ya fue', 'ya ha', 'no quedan', 'no hay', 'inválid', 'debe estar', 'solo se'].some(k => msg.toLowerCase().includes(k));
}

// GET /api/audit/events/:eventId - Obtener log de auditoría de un evento
router.get('/events/:eventId', requirePermission('inventory:read'), (req: Request, res: Response) => {
  const db = getDatabase();
  try {
    const eventId = parseInt(req.params.eventId as string, 10);
    const { entity_type, action, centro_id, page = '1', limit = '50' } = req.query;

    const result = getAuditLog(db, eventId, {
      entityType: entity_type as string | undefined,
      action: action as string | undefined,
      centroId: centro_id ? parseInt(centro_id as string, 10) : undefined,
      page: Math.max(1, parseInt(page as string, 10)),
      limit: Math.min(200, Math.max(1, parseInt(limit as string, 10))),
    });

    res.json({
      success: true,
      data: result.entries,
      pagination: result.pagination,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Error desconocido';
    console.error('Error obteniendo log de auditoría:', error);
    if (isKnownError(msg)) {
      res.status(400).json({ success: false, error: msg });
    } else {
      res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
  } finally {
    db.close();
  }
});

export default router;
