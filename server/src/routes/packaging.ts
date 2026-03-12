import { Router } from 'express';
import type { Request, Response } from 'express';
import { getDatabase } from '../database/init.js';
import { requirePermission } from '../middleware/auth.js';
import {
  createLotesForEvent,
  createCajas,
  getCajas,
  getLotes,
  getCajaWithLotes,
  openCaja,
  assignCajaToCentro,
  getLoteWithCards,
  sellWholeLote,
  sellCardsInLote,
  returnLote,
  assignLoteToCentro,
  scanCode,
} from '../services/inventoryService.js';

const router = Router();

function isKnownError(msg: string): boolean {
  return ['no encontrad', 'no se puede', 'no está', 'ya fue', 'ya ha', 'no quedan', 'no hay', 'inválid', 'debe estar', 'solo se'].some(k => msg.toLowerCase().includes(k));
}

// POST /api/packaging/events/:eventId/create-lotes - Crear lotes a partir de cartones existentes
router.post('/events/:eventId/create-lotes', requirePermission('inventory:manage'), (req: Request, res: Response) => {
  const db = getDatabase();
  try {
    const eventId = parseInt(req.params.eventId as string, 10);
    const result = createLotesForEvent(db, eventId);
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Error desconocido';
    console.error('Error creando lotes:', error);
    if (isKnownError(msg)) {
      res.status(400).json({ success: false, error: msg });
    } else {
      res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
  } finally {
    db.close();
  }
});

// POST /api/packaging/events/:eventId/create-boxes - Agrupar lotes en cajas
router.post('/events/:eventId/create-boxes', requirePermission('inventory:manage'), (req: Request, res: Response) => {
  const db = getDatabase();
  try {
    const eventId = parseInt(req.params.eventId as string, 10);
    const { lotes_per_caja, centro_id } = req.body;

    if (!lotes_per_caja || lotes_per_caja < 1) {
      res.status(400).json({ success: false, error: 'Se requiere lotes_per_caja (mínimo 1)' });
      return;
    }

    const result = createCajas(db, eventId, lotes_per_caja, centro_id);
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Error desconocido';
    console.error('Error creando cajas:', error);
    if (isKnownError(msg)) {
      res.status(400).json({ success: false, error: msg });
    } else {
      res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
  } finally {
    db.close();
  }
});

// GET /api/packaging/events/:eventId/cajas - Listar cajas de un evento
router.get('/events/:eventId/cajas', requirePermission('inventory:read'), (req: Request, res: Response) => {
  const db = getDatabase();
  try {
    const eventId = parseInt(req.params.eventId as string, 10);
    const { status, centro_id } = req.query;
    const cajas = getCajas(db, eventId, {
      status: status as string | undefined,
      centroId: centro_id ? parseInt(centro_id as string, 10) : undefined,
    });
    res.json({ success: true, data: cajas });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Error desconocido';
    console.error('Error listando cajas:', error);
    if (isKnownError(msg)) {
      res.status(400).json({ success: false, error: msg });
    } else {
      res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
  } finally {
    db.close();
  }
});

// GET /api/packaging/events/:eventId/lotes - Listar lotes de un evento
router.get('/events/:eventId/lotes', requirePermission('inventory:read'), (req: Request, res: Response) => {
  const db = getDatabase();
  try {
    const eventId = parseInt(req.params.eventId as string, 10);
    const { status, caja_id, centro_id, page = '1', limit = '50' } = req.query;
    const result = getLotes(db, eventId, {
      status: status as string | undefined,
      cajaId: caja_id ? parseInt(caja_id as string, 10) : undefined,
      centroId: centro_id ? parseInt(centro_id as string, 10) : undefined,
      page: Math.max(1, parseInt(page as string, 10)),
      limit: Math.min(200, Math.max(1, parseInt(limit as string, 10))),
    });
    res.json({ success: true, data: result.lotes, pagination: result.pagination });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Error desconocido';
    console.error('Error listando lotes:', error);
    if (isKnownError(msg)) {
      res.status(400).json({ success: false, error: msg });
    } else {
      res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
  } finally {
    db.close();
  }
});

// GET /api/packaging/cajas/:id - Detalle de caja con sus lotes
router.get('/cajas/:id', requirePermission('inventory:read'), (req: Request, res: Response) => {
  const db = getDatabase();
  try {
    const id = parseInt(req.params.id as string, 10);
    const caja = getCajaWithLotes(db, id);
    if (!caja) {
      res.status(404).json({ success: false, error: 'Caja no encontrada' });
      return;
    }
    res.json({ success: true, data: caja });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Error desconocido';
    console.error('Error obteniendo caja:', error);
    if (isKnownError(msg)) {
      res.status(400).json({ success: false, error: msg });
    } else {
      res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
  } finally {
    db.close();
  }
});

// POST /api/packaging/cajas/:id/open - Abrir caja
router.post('/cajas/:id/open', requirePermission('inventory:manage'), (req: Request, res: Response) => {
  const db = getDatabase();
  try {
    const id = parseInt(req.params.id as string, 10);
    const userId = (req as any).jwtPayload?.username || 'system';
    const caja = openCaja(db, id, userId);
    res.json({ success: true, data: caja });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Error desconocido';
    console.error('Error abriendo caja:', error);
    if (isKnownError(msg)) {
      res.status(400).json({ success: false, error: msg });
    } else {
      res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
  } finally {
    db.close();
  }
});

// POST /api/packaging/cajas/:id/assign - Asignar caja a un centro
router.post('/cajas/:id/assign', requirePermission('inventory:manage'), (req: Request, res: Response) => {
  const db = getDatabase();
  try {
    const id = parseInt(req.params.id as string, 10);
    const { to_centro_id } = req.body;
    const userId = (req as any).jwtPayload?.username || 'system';

    if (!to_centro_id) {
      res.status(400).json({ success: false, error: 'Se requiere to_centro_id' });
      return;
    }

    const caja = assignCajaToCentro(db, id, to_centro_id, userId);
    res.json({ success: true, data: caja });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Error desconocido';
    console.error('Error asignando caja a centro:', error);
    if (isKnownError(msg)) {
      res.status(400).json({ success: false, error: msg });
    } else {
      res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
  } finally {
    db.close();
  }
});

// GET /api/packaging/lotes/:id - Detalle de lote con sus cartones
router.get('/lotes/:id', requirePermission('inventory:read'), (req: Request, res: Response) => {
  const db = getDatabase();
  try {
    const id = parseInt(req.params.id as string, 10);
    const lote = getLoteWithCards(db, id);
    if (!lote) {
      res.status(404).json({ success: false, error: 'Lote no encontrado' });
      return;
    }
    res.json({ success: true, data: lote });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Error desconocido';
    console.error('Error obteniendo lote:', error);
    if (isKnownError(msg)) {
      res.status(400).json({ success: false, error: msg });
    } else {
      res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
  } finally {
    db.close();
  }
});

// POST /api/packaging/lotes/:id/sell - Vender lote completo
router.post('/lotes/:id/sell', requirePermission('cards:sell'), (req: Request, res: Response) => {
  const db = getDatabase();
  try {
    const id = parseInt(req.params.id as string, 10);
    const { buyer_name, buyer_phone } = req.body;
    const userId = (req as any).jwtPayload?.username || 'system';
    const result = sellWholeLote(db, id, { buyerName: buyer_name, buyerPhone: buyer_phone }, userId);
    res.json({ success: true, data: result });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Error desconocido';
    console.error('Error vendiendo lote:', error);
    if (isKnownError(msg)) {
      res.status(400).json({ success: false, error: msg });
    } else {
      res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
  } finally {
    db.close();
  }
});

// POST /api/packaging/lotes/:id/sell-cards - Vender cartones individuales de un lote
router.post('/lotes/:id/sell-cards', requirePermission('cards:sell'), (req: Request, res: Response) => {
  const db = getDatabase();
  try {
    const id = parseInt(req.params.id as string, 10);
    const { card_ids, buyer_name, buyer_phone } = req.body;
    const userId = (req as any).jwtPayload?.username || 'system';

    if (!card_ids || !Array.isArray(card_ids) || card_ids.length === 0) {
      res.status(400).json({ success: false, error: 'Se requiere card_ids (array de IDs)' });
      return;
    }

    const result = sellCardsInLote(db, id, card_ids, { buyerName: buyer_name, buyerPhone: buyer_phone }, userId);
    res.json({ success: true, data: result });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Error desconocido';
    console.error('Error vendiendo cartones del lote:', error);
    if (isKnownError(msg)) {
      res.status(400).json({ success: false, error: msg });
    } else {
      res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
  } finally {
    db.close();
  }
});

// POST /api/packaging/lotes/:id/return - Devolver lote a un centro
router.post('/lotes/:id/return', requirePermission('inventory:manage'), (req: Request, res: Response) => {
  const db = getDatabase();
  try {
    const id = parseInt(req.params.id as string, 10);
    const { to_centro_id } = req.body;
    const userId = (req as any).jwtPayload?.username || 'system';

    if (!to_centro_id) {
      res.status(400).json({ success: false, error: 'Se requiere to_centro_id' });
      return;
    }

    const lote = returnLote(db, id, to_centro_id, userId);
    res.json({ success: true, data: lote });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Error desconocido';
    console.error('Error devolviendo lote:', error);
    if (isKnownError(msg)) {
      res.status(400).json({ success: false, error: msg });
    } else {
      res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
  } finally {
    db.close();
  }
});

// POST /api/packaging/lotes/:id/assign - Asignar lote a un centro
router.post('/lotes/:id/assign', requirePermission('inventory:manage'), (req: Request, res: Response) => {
  const db = getDatabase();
  try {
    const id = parseInt(req.params.id as string, 10);
    const { to_centro_id } = req.body;
    const userId = (req as any).jwtPayload?.username || 'system';

    if (!to_centro_id) {
      res.status(400).json({ success: false, error: 'Se requiere to_centro_id' });
      return;
    }

    const lote = assignLoteToCentro(db, id, to_centro_id, userId);
    res.json({ success: true, data: lote });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Error desconocido';
    console.error('Error asignando lote a centro:', error);
    if (isKnownError(msg)) {
      res.status(400).json({ success: false, error: msg });
    } else {
      res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
  } finally {
    db.close();
  }
});

// GET /api/packaging/scan/:code - Escaneo universal de código QR
router.get('/scan/:code', requirePermission('inventory:read'), (req: Request, res: Response) => {
  const db = getDatabase();
  try {
    const code = req.params.code as string;
    const result = scanCode(db, code);
    if (!result) {
      res.status(404).json({ success: false, error: 'Código no encontrado' });
      return;
    }
    res.json({ success: true, data: result });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Error desconocido';
    console.error('Error escaneando código:', error);
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
