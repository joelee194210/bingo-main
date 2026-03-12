import { Router } from 'express';
import type { Request, Response } from 'express';
import { getDatabase } from '../database/init.js';
import { requirePermission } from '../middleware/auth.js';
import {
  getCentros,
  getCentroTree,
  createCentro,
  updateCentro,
  getCentro,
  getCentroInventory,
} from '../services/inventoryService.js';

const router = Router();

function isKnownError(msg: string): boolean {
  return ['no encontrad', 'no se puede', 'no está', 'ya fue', 'ya ha', 'no quedan', 'no hay', 'inválid', 'debe estar', 'solo se'].some(k => msg.toLowerCase().includes(k));
}

// GET /api/centros - Listar centros de un evento
router.get('/', requirePermission('inventory:read'), (req: Request, res: Response) => {
  const db = getDatabase();
  try {
    const { event_id } = req.query;
    if (!event_id) {
      res.status(400).json({ success: false, error: 'Se requiere event_id' });
      return;
    }
    const eventId = parseInt(event_id as string, 10);
    const centros = getCentros(db, eventId);
    res.json({ success: true, data: centros });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Error desconocido';
    console.error('Error listando centros:', error);
    if (isKnownError(msg)) {
      res.status(400).json({ success: false, error: msg });
    } else {
      res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
  } finally {
    db.close();
  }
});

// GET /api/centros/tree/:eventId - Árbol jerárquico de centros
router.get('/tree/:eventId', requirePermission('inventory:read'), (req: Request, res: Response) => {
  const db = getDatabase();
  try {
    const eventId = parseInt(req.params.eventId as string, 10);
    const tree = getCentroTree(db, eventId);
    res.json({ success: true, data: tree });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Error desconocido';
    console.error('Error obteniendo árbol de centros:', error);
    if (isKnownError(msg)) {
      res.status(400).json({ success: false, error: msg });
    } else {
      res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
  } finally {
    db.close();
  }
});

// POST /api/centros - Crear centro de distribución
router.post('/', requirePermission('inventory:manage'), (req: Request, res: Response) => {
  const db = getDatabase();
  try {
    const { event_id, name, code, parent_id, address, contact_name, contact_phone } = req.body;
    if (!event_id || !name) {
      res.status(400).json({ success: false, error: 'Se requiere event_id y name' });
      return;
    }
    const centro = createCentro(db, event_id, {
      name,
      code,
      parentId: parent_id,
      address,
      contactName: contact_name,
      contactPhone: contact_phone,
    });
    res.status(201).json({ success: true, data: centro });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Error desconocido';
    console.error('Error creando centro:', error);
    if (isKnownError(msg)) {
      res.status(400).json({ success: false, error: msg });
    } else {
      res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
  } finally {
    db.close();
  }
});

// PUT /api/centros/:id - Actualizar centro de distribución
router.put('/:id', requirePermission('inventory:manage'), (req: Request, res: Response) => {
  const db = getDatabase();
  try {
    const id = parseInt(req.params.id as string, 10);
    const { name, address, contact_name, contact_phone, is_active } = req.body;
    const centro = updateCentro(db, id, {
      name,
      address,
      contactName: contact_name,
      contactPhone: contact_phone,
      isActive: is_active,
    });
    res.json({ success: true, data: centro });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Error desconocido';
    console.error('Error actualizando centro:', error);
    if (isKnownError(msg)) {
      res.status(400).json({ success: false, error: msg });
    } else {
      res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
  } finally {
    db.close();
  }
});

// GET /api/centros/:id - Detalle de centro
router.get('/:id', requirePermission('inventory:read'), (req: Request, res: Response) => {
  const db = getDatabase();
  try {
    const id = parseInt(req.params.id as string, 10);
    const centro = getCentro(db, id);
    if (!centro) {
      res.status(404).json({ success: false, error: 'Centro no encontrado' });
      return;
    }
    res.json({ success: true, data: centro });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Error desconocido';
    console.error('Error obteniendo centro:', error);
    if (isKnownError(msg)) {
      res.status(400).json({ success: false, error: msg });
    } else {
      res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
  } finally {
    db.close();
  }
});

// GET /api/centros/:id/inventory - Inventario de un centro (cajas, lotes, resumen)
router.get('/:id/inventory', requirePermission('inventory:read'), (req: Request, res: Response) => {
  const db = getDatabase();
  try {
    const id = parseInt(req.params.id as string, 10);
    const { status } = req.query;
    const inventory = getCentroInventory(db, id, {
      status: status as string | undefined,
    });
    res.json({ success: true, data: inventory });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Error desconocido';
    console.error('Error obteniendo inventario del centro:', error);
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
