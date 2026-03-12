import { Router } from 'express';
import type { Request, Response } from 'express';
import { getDatabase } from '../database/init.js';
import { requirePermission } from '../middleware/auth.js';
import {
  getEnvios,
  createEnvio,
  getEnvio,
  addItemToEnvio,
  removeItemFromEnvio,
  sendEnvio,
  receiveEnvio,
  receiveItem,
  cancelEnvio,
} from '../services/inventoryService.js';

const router = Router();

function isKnownError(msg: string): boolean {
  return ['no encontrad', 'no se puede', 'no está', 'ya fue', 'ya ha', 'no quedan', 'no hay', 'inválid', 'debe estar', 'solo se'].some(k => msg.toLowerCase().includes(k));
}

// GET /api/envios - Listar envíos de un evento
router.get('/', requirePermission('inventory:read'), (req: Request, res: Response) => {
  const db = getDatabase();
  try {
    const { event_id, status, centro_id } = req.query;
    if (!event_id) {
      res.status(400).json({ success: false, error: 'Se requiere event_id' });
      return;
    }
    const eventId = parseInt(event_id as string, 10);
    const envios = getEnvios(db, eventId, {
      status: status as string | undefined,
      centroId: centro_id ? parseInt(centro_id as string, 10) : undefined,
    });
    res.json({ success: true, data: envios });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Error desconocido';
    console.error('Error listando envíos:', error);
    if (isKnownError(msg)) {
      res.status(400).json({ success: false, error: msg });
    } else {
      res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
  } finally {
    db.close();
  }
});

// POST /api/envios - Crear envío
router.post('/', requirePermission('inventory:manage'), (req: Request, res: Response) => {
  const db = getDatabase();
  try {
    const { event_id, from_centro_id, to_centro_id } = req.body;
    const userId = (req as any).jwtPayload?.username || 'system';

    if (!event_id || !from_centro_id || !to_centro_id) {
      res.status(400).json({ success: false, error: 'Se requiere event_id, from_centro_id y to_centro_id' });
      return;
    }

    const envio = createEnvio(db, event_id, from_centro_id, to_centro_id, userId);
    res.status(201).json({ success: true, data: envio });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Error desconocido';
    console.error('Error creando envío:', error);
    if (isKnownError(msg)) {
      res.status(400).json({ success: false, error: msg });
    } else {
      res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
  } finally {
    db.close();
  }
});

// GET /api/envios/:id - Detalle de envío con items
router.get('/:id', requirePermission('inventory:read'), (req: Request, res: Response) => {
  const db = getDatabase();
  try {
    const id = parseInt(req.params.id as string, 10);
    const envio = getEnvio(db, id);
    if (!envio) {
      res.status(404).json({ success: false, error: 'Envío no encontrado' });
      return;
    }
    res.json({ success: true, data: envio });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Error desconocido';
    console.error('Error obteniendo envío:', error);
    if (isKnownError(msg)) {
      res.status(400).json({ success: false, error: msg });
    } else {
      res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
  } finally {
    db.close();
  }
});

// POST /api/envios/:id/add-item - Agregar item al envío
router.post('/:id/add-item', requirePermission('inventory:manage'), (req: Request, res: Response) => {
  const db = getDatabase();
  try {
    const id = parseInt(req.params.id as string, 10);
    const { item_type, item_id } = req.body;

    if (!item_type || !item_id) {
      res.status(400).json({ success: false, error: 'Se requiere item_type y item_id' });
      return;
    }

    if (!['caja', 'lote'].includes(item_type)) {
      res.status(400).json({ success: false, error: 'item_type inválido. Debe ser: caja o lote' });
      return;
    }

    const item = addItemToEnvio(db, id, item_type, item_id);
    res.status(201).json({ success: true, data: item });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Error desconocido';
    console.error('Error agregando item al envío:', error);
    if (isKnownError(msg)) {
      res.status(400).json({ success: false, error: msg });
    } else {
      res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
  } finally {
    db.close();
  }
});

// POST /api/envios/:id/remove-item - Remover item del envío
router.post('/:id/remove-item', requirePermission('inventory:manage'), (req: Request, res: Response) => {
  const db = getDatabase();
  try {
    const { envio_item_id } = req.body;

    if (!envio_item_id) {
      res.status(400).json({ success: false, error: 'Se requiere envio_item_id' });
      return;
    }

    removeItemFromEnvio(db, envio_item_id);
    res.json({ success: true, data: { removed: envio_item_id } });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Error desconocido';
    console.error('Error removiendo item del envío:', error);
    if (isKnownError(msg)) {
      res.status(400).json({ success: false, error: msg });
    } else {
      res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
  } finally {
    db.close();
  }
});

// POST /api/envios/:id/send - Despachar envío
router.post('/:id/send', requirePermission('inventory:manage'), (req: Request, res: Response) => {
  const db = getDatabase();
  try {
    const id = parseInt(req.params.id as string, 10);
    const userId = (req as any).jwtPayload?.username || 'system';
    const envio = sendEnvio(db, id, userId);
    res.json({ success: true, data: envio });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Error desconocido';
    console.error('Error enviando envío:', error);
    if (isKnownError(msg)) {
      res.status(400).json({ success: false, error: msg });
    } else {
      res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
  } finally {
    db.close();
  }
});

// POST /api/envios/:id/receive - Recibir envío completo
router.post('/:id/receive', requirePermission('inventory:manage'), (req: Request, res: Response) => {
  const db = getDatabase();
  try {
    const id = parseInt(req.params.id as string, 10);
    const userId = (req as any).jwtPayload?.username || 'system';
    const envio = receiveEnvio(db, id, userId);
    res.json({ success: true, data: envio });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Error desconocido';
    console.error('Error recibiendo envío:', error);
    if (isKnownError(msg)) {
      res.status(400).json({ success: false, error: msg });
    } else {
      res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
  } finally {
    db.close();
  }
});

// POST /api/envios/:id/receive-item - Recibir un item individual del envío
router.post('/:id/receive-item', requirePermission('inventory:manage'), (req: Request, res: Response) => {
  const db = getDatabase();
  try {
    const id = parseInt(req.params.id as string, 10);
    const { item_id } = req.body;
    const userId = (req as any).jwtPayload?.username || 'system';

    if (!item_id) {
      res.status(400).json({ success: false, error: 'Se requiere item_id' });
      return;
    }

    const item = receiveItem(db, id, item_id, userId);
    res.json({ success: true, data: item });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Error desconocido';
    console.error('Error recibiendo item de envío:', error);
    if (isKnownError(msg)) {
      res.status(400).json({ success: false, error: msg });
    } else {
      res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
  } finally {
    db.close();
  }
});

// POST /api/envios/:id/cancel - Cancelar envío
router.post('/:id/cancel', requirePermission('inventory:manage'), (req: Request, res: Response) => {
  const db = getDatabase();
  try {
    const id = parseInt(req.params.id as string, 10);
    const userId = (req as any).jwtPayload?.username || 'system';
    const envio = cancelEnvio(db, id, userId);
    res.json({ success: true, data: envio });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Error desconocido';
    console.error('Error cancelando envío:', error);
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
