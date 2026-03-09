import { Router } from 'express';
import { requirePermission } from '../middleware/auth.js';
import { getDatabase } from '../database/init.js';
import {
  getEventLevels,
  setEventLevels,
  getNodeTree,
  getNodeFlat,
  getNode,
  createNode,
  updateNode,
  resolveCardSelection,
  initialLoadCards,
  assignCardsDown,
  returnCardsUp,
  markCardsSold,
  getNodeSummary,
  getConsolidatedInventory,
  getCardsAtNode,
  getEventOverview,
  getMovements,
  type CardSelection,
} from '../services/inventoryService.js';

const router = Router();

// =====================================================
// HIERARCHY LEVELS
// =====================================================

// GET /events/:eventId/levels
router.get('/events/:eventId/levels', requirePermission('inventory:read'), (req, res) => {
  const db = getDatabase();
  try {
    const levels = getEventLevels(db, Number(req.params.eventId));
    res.json({ success: true, data: levels });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error obteniendo niveles' });
  } finally {
    db.close();
  }
});

// POST /events/:eventId/levels
router.post('/events/:eventId/levels', requirePermission('inventory:manage'), (req, res) => {
  const db = getDatabase();
  try {
    const { levels } = req.body as { levels: { level: number; name: string }[] };
    if (!Array.isArray(levels) || levels.length === 0) {
      return res.status(400).json({ success: false, error: 'Debe proporcionar al menos un nivel' });
    }
    setEventLevels(db, Number(req.params.eventId), levels);
    const result = getEventLevels(db, Number(req.params.eventId));
    res.json({ success: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error configurando niveles';
    res.status(400).json({ success: false, error: message });
  } finally {
    db.close();
  }
});

// =====================================================
// NODE MANAGEMENT
// =====================================================

// GET /events/:eventId/nodes
router.get('/events/:eventId/nodes', requirePermission('inventory:read'), (req, res) => {
  const db = getDatabase();
  try {
    const eventId = Number(req.params.eventId);
    if (req.query.tree === 'true') {
      const tree = getNodeTree(db, eventId);
      res.json({ success: true, data: tree });
    } else {
      const nodes = getNodeFlat(db, eventId);
      res.json({ success: true, data: nodes });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error obteniendo nodos' });
  } finally {
    db.close();
  }
});

// GET /nodes/:nodeId
router.get('/nodes/:nodeId', requirePermission('inventory:read'), (req, res) => {
  const db = getDatabase();
  try {
    const node = getNode(db, Number(req.params.nodeId));
    if (!node) return res.status(404).json({ success: false, error: 'Nodo no encontrado' });
    res.json({ success: true, data: node });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error obteniendo nodo' });
  } finally {
    db.close();
  }
});

// POST /events/:eventId/nodes
router.post('/events/:eventId/nodes', requirePermission('inventory:manage'), (req, res) => {
  const db = getDatabase();
  try {
    const eventId = Number(req.params.eventId);
    const { parent_id, name, code, contact_name, contact_phone } = req.body;
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ success: false, error: 'Nombre requerido' });
    }
    const node = createNode(db, eventId, { parent_id, name, code, contact_name, contact_phone });
    res.status(201).json({ success: true, data: node });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error creando nodo';
    res.status(400).json({ success: false, error: message });
  } finally {
    db.close();
  }
});

// PUT /nodes/:nodeId
router.put('/nodes/:nodeId', requirePermission('inventory:manage'), (req, res) => {
  const db = getDatabase();
  try {
    const node = updateNode(db, Number(req.params.nodeId), req.body);
    res.json({ success: true, data: node });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error actualizando nodo';
    res.status(400).json({ success: false, error: message });
  } finally {
    db.close();
  }
});

// =====================================================
// CARD OPERATIONS
// =====================================================

// POST /nodes/:nodeId/load - Initial load to root node
router.post('/nodes/:nodeId/load', requirePermission('inventory:assign'), (req, res) => {
  const db = getDatabase();
  try {
    const nodeId = Number(req.params.nodeId);
    const node = getNode(db, nodeId);
    if (!node) return res.status(404).json({ success: false, error: 'Nodo no encontrado' });

    const { selection } = req.body as { selection: CardSelection };
    if (!selection) return res.status(400).json({ success: false, error: 'Seleccion de cartones requerida' });

    const cardIds = resolveCardSelection(db, node.event_id, selection);
    if (cardIds.length === 0) return res.status(400).json({ success: false, error: 'No se encontraron cartones con esa seleccion' });

    const userId = (req as unknown as { jwtPayload: { userId: number } }).jwtPayload.userId;
    const result = initialLoadCards(db, node.event_id, nodeId, cardIds, userId);
    res.json({ success: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error en carga inicial';
    res.status(400).json({ success: false, error: message });
  } finally {
    db.close();
  }
});

// POST /nodes/:nodeId/assign - Assign cards down to child
router.post('/nodes/:nodeId/assign', requirePermission('inventory:assign'), (req, res) => {
  const db = getDatabase();
  try {
    const fromNodeId = Number(req.params.nodeId);
    const { target_node_id, selection, notes } = req.body as { target_node_id: number; selection: CardSelection; notes?: string };

    if (!target_node_id) return res.status(400).json({ success: false, error: 'Nodo destino requerido' });
    if (!selection) return res.status(400).json({ success: false, error: 'Seleccion de cartones requerida' });

    const fromNode = getNode(db, fromNodeId);
    if (!fromNode) return res.status(404).json({ success: false, error: 'Nodo origen no encontrado' });

    const cardIds = resolveCardSelection(db, fromNode.event_id, selection);
    if (cardIds.length === 0) return res.status(400).json({ success: false, error: 'No se encontraron cartones' });

    const userId = (req as unknown as { jwtPayload: { userId: number } }).jwtPayload.userId;
    const result = assignCardsDown(db, fromNodeId, target_node_id, cardIds, userId, notes);
    res.json({ success: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error asignando cartones';
    res.status(400).json({ success: false, error: message });
  } finally {
    db.close();
  }
});

// POST /nodes/:nodeId/return - Return cards up to parent
router.post('/nodes/:nodeId/return', requirePermission('inventory:assign'), (req, res) => {
  const db = getDatabase();
  try {
    const fromNodeId = Number(req.params.nodeId);
    const { selection, notes } = req.body as { selection: CardSelection; notes?: string };
    if (!selection) return res.status(400).json({ success: false, error: 'Seleccion requerida' });

    const fromNode = getNode(db, fromNodeId);
    if (!fromNode) return res.status(404).json({ success: false, error: 'Nodo no encontrado' });

    const cardIds = resolveCardSelection(db, fromNode.event_id, selection);
    if (cardIds.length === 0) return res.status(400).json({ success: false, error: 'No se encontraron cartones' });

    const userId = (req as unknown as { jwtPayload: { userId: number } }).jwtPayload.userId;
    const result = returnCardsUp(db, fromNodeId, cardIds, userId, notes);
    res.json({ success: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error devolviendo cartones';
    res.status(400).json({ success: false, error: message });
  } finally {
    db.close();
  }
});

// POST /nodes/:nodeId/sell - Mark cards as sold
router.post('/nodes/:nodeId/sell', requirePermission('inventory:sell'), (req, res) => {
  const db = getDatabase();
  try {
    const nodeId = Number(req.params.nodeId);
    const { selection, buyer_name, buyer_phone } = req.body as { selection: CardSelection; buyer_name?: string; buyer_phone?: string };
    if (!selection) return res.status(400).json({ success: false, error: 'Seleccion requerida' });

    const node = getNode(db, nodeId);
    if (!node) return res.status(404).json({ success: false, error: 'Nodo no encontrado' });

    const cardIds = resolveCardSelection(db, node.event_id, selection);
    if (cardIds.length === 0) return res.status(400).json({ success: false, error: 'No se encontraron cartones' });

    const userId = (req as unknown as { jwtPayload: { userId: number } }).jwtPayload.userId;
    const result = markCardsSold(db, nodeId, cardIds, userId, buyer_name, buyer_phone);
    res.json({ success: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error marcando venta';
    res.status(400).json({ success: false, error: message });
  } finally {
    db.close();
  }
});

// =====================================================
// INVENTORY VIEWS
// =====================================================

// GET /nodes/:nodeId/cards
router.get('/nodes/:nodeId/cards', requirePermission('inventory:read'), (req, res) => {
  const db = getDatabase();
  try {
    const status = (req.query.status as string) || 'assigned';
    const page = Number(req.query.page) || 1;
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const result = getCardsAtNode(db, Number(req.params.nodeId), status, page, limit);
    res.json({
      success: true,
      data: result.cards,
      pagination: { total: result.total, page, limit, totalPages: Math.ceil(result.total / limit) },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error obteniendo cartones' });
  } finally {
    db.close();
  }
});

// GET /nodes/:nodeId/summary
router.get('/nodes/:nodeId/summary', requirePermission('inventory:read'), (req, res) => {
  const db = getDatabase();
  try {
    const summary = getNodeSummary(db, Number(req.params.nodeId));
    res.json({ success: true, data: summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error';
    res.status(400).json({ success: false, error: message });
  } finally {
    db.close();
  }
});

// GET /nodes/:nodeId/consolidated
router.get('/nodes/:nodeId/consolidated', requirePermission('inventory:read'), (req, res) => {
  const db = getDatabase();
  try {
    const result = getConsolidatedInventory(db, Number(req.params.nodeId));
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error obteniendo consolidado' });
  } finally {
    db.close();
  }
});

// GET /events/:eventId/overview
router.get('/events/:eventId/overview', requirePermission('inventory:read'), (req, res) => {
  const db = getDatabase();
  try {
    const result = getEventOverview(db, Number(req.params.eventId));
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error obteniendo resumen' });
  } finally {
    db.close();
  }
});

// GET /events/:eventId/movements
router.get('/events/:eventId/movements', requirePermission('inventory:read'), (req, res) => {
  const db = getDatabase();
  try {
    const filters = {
      node_id: req.query.node_id ? Number(req.query.node_id) : undefined,
      movement_type: req.query.movement_type as string | undefined,
      from_date: req.query.from_date as string | undefined,
      to_date: req.query.to_date as string | undefined,
      page: Number(req.query.page) || 1,
      limit: Math.min(Number(req.query.limit) || 50, 200),
    };
    const result = getMovements(db, Number(req.params.eventId), filters);
    res.json({
      success: true,
      data: result.movements,
      pagination: {
        total: result.total,
        page: filters.page,
        limit: filters.limit,
        totalPages: Math.ceil(result.total / filters.limit),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error obteniendo movimientos' });
  } finally {
    db.close();
  }
});

export default router;
