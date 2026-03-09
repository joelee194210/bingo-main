import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

// =====================================================
// TYPES
// =====================================================

export interface InventoryLevel {
  id: number;
  event_id: number;
  level: number;
  name: string;
}

export interface InventoryNode {
  id: number;
  event_id: number;
  parent_id: number | null;
  level: number;
  name: string;
  code: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  is_active: number;
  total_assigned: number;
  total_distributed: number;
  total_sold: number;
  total_returned: number;
  created_at: string;
  updated_at: string;
  level_name?: string;
  children?: InventoryNodeTree[];
}

export interface InventoryNodeTree extends InventoryNode {
  children: InventoryNodeTree[];
  available_in_hand: number;
}

export interface InventorySummary {
  total_assigned: number;
  distributed_to_children: number;
  sold: number;
  returned: number;
  available_in_hand: number;
}

export interface ConsolidatedSummary extends InventorySummary {
  descendants: { id: number; name: string; level: number; level_name: string; summary: InventorySummary }[];
}

export interface CardSelection {
  type: 'series_range' | 'card_range' | 'card_ids';
  from_series?: string;
  to_series?: string;
  from_card?: number;
  to_card?: number;
  card_ids?: number[];
}

export interface BatchResult {
  batch_id: string;
  cards_affected: number;
  movement_type: string;
}

export interface MovementRecord {
  id: number;
  event_id: number;
  card_id: number;
  card_number: number;
  serial: string;
  card_code: string;
  movement_type: string;
  from_node_id: number | null;
  from_node_name: string | null;
  to_node_id: number | null;
  to_node_name: string | null;
  performed_by_name: string;
  batch_id: string | null;
  notes: string | null;
  created_at: string;
}

// =====================================================
// HIERARCHY LEVELS
// =====================================================

export function getEventLevels(db: Database.Database, eventId: number): InventoryLevel[] {
  return db.prepare(
    'SELECT * FROM inventory_levels WHERE event_id = ? ORDER BY level'
  ).all(eventId) as InventoryLevel[];
}

export function setEventLevels(db: Database.Database, eventId: number, levels: { level: number; name: string }[]): void {
  // Validate levels are sequential 1..N
  const sorted = [...levels].sort((a, b) => a.level - b.level);
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].level !== i + 1) {
      throw new Error('Los niveles deben ser secuenciales empezando desde 1');
    }
  }
  if (sorted.length > 5) throw new Error('Maximo 5 niveles');

  // Check if reducing levels would orphan existing nodes
  const maxNodeLevel = db.prepare(
    'SELECT MAX(level) as max_level FROM inventory_nodes WHERE event_id = ? AND is_active = 1'
  ).get(eventId) as { max_level: number | null };

  if (maxNodeLevel.max_level && maxNodeLevel.max_level > sorted.length) {
    throw new Error(`Existen nodos en nivel ${maxNodeLevel.max_level}, no puede reducir a ${sorted.length} niveles`);
  }

  const setLevels = db.transaction(() => {
    db.prepare('DELETE FROM inventory_levels WHERE event_id = ?').run(eventId);
    const insert = db.prepare('INSERT INTO inventory_levels (event_id, level, name) VALUES (?, ?, ?)');
    for (const lvl of sorted) {
      insert.run(eventId, lvl.level, lvl.name);
    }
  });
  setLevels();
}

// =====================================================
// NODE MANAGEMENT
// =====================================================

export function getNodeTree(db: Database.Database, eventId: number): InventoryNodeTree[] {
  const nodes = db.prepare(`
    SELECT n.*, il.name as level_name
    FROM inventory_nodes n
    LEFT JOIN inventory_levels il ON il.event_id = n.event_id AND il.level = n.level
    WHERE n.event_id = ? AND n.is_active = 1
    ORDER BY n.level, n.name
  `).all(eventId) as (InventoryNode & { level_name: string })[];

  // Build tree
  const nodeMap = new Map<number, InventoryNodeTree>();
  const roots: InventoryNodeTree[] = [];

  for (const node of nodes) {
    const treeNode: InventoryNodeTree = {
      ...node,
      children: [],
      available_in_hand: node.total_assigned - node.total_distributed - node.total_sold,
    };
    nodeMap.set(node.id, treeNode);
  }

  for (const node of nodeMap.values()) {
    if (node.parent_id && nodeMap.has(node.parent_id)) {
      nodeMap.get(node.parent_id)!.children.push(node);
    } else if (!node.parent_id) {
      roots.push(node);
    }
  }

  return roots;
}

export function getNodeFlat(db: Database.Database, eventId: number): InventoryNode[] {
  return db.prepare(`
    SELECT n.*, il.name as level_name
    FROM inventory_nodes n
    LEFT JOIN inventory_levels il ON il.event_id = n.event_id AND il.level = n.level
    WHERE n.event_id = ? AND n.is_active = 1
    ORDER BY n.level, n.name
  `).all(eventId) as InventoryNode[];
}

export function getNode(db: Database.Database, nodeId: number): InventoryNode | undefined {
  return db.prepare(`
    SELECT n.*, il.name as level_name
    FROM inventory_nodes n
    LEFT JOIN inventory_levels il ON il.event_id = n.event_id AND il.level = n.level
    WHERE n.id = ?
  `).get(nodeId) as InventoryNode | undefined;
}

export function createNode(
  db: Database.Database,
  eventId: number,
  data: { parent_id?: number; name: string; code?: string; contact_name?: string; contact_phone?: string }
): InventoryNode {
  const levels = getEventLevels(db, eventId);
  if (levels.length === 0) throw new Error('Debe definir los niveles de jerarquia primero');

  let level = 1;
  if (data.parent_id) {
    const parent = getNode(db, data.parent_id);
    if (!parent) throw new Error('Nodo padre no encontrado');
    if (parent.event_id !== eventId) throw new Error('El nodo padre pertenece a otro evento');
    level = parent.level + 1;
  }

  const maxLevel = Math.max(...levels.map(l => l.level));
  if (level > maxLevel) throw new Error(`No puede crear nodos mas alla del nivel ${maxLevel}`);

  const result = db.prepare(`
    INSERT INTO inventory_nodes (event_id, parent_id, level, name, code, contact_name, contact_phone)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(eventId, data.parent_id || null, level, data.name, data.code || null, data.contact_name || null, data.contact_phone || null);

  return getNode(db, result.lastInsertRowid as number)!;
}

export function updateNode(
  db: Database.Database,
  nodeId: number,
  data: { name?: string; code?: string; contact_name?: string; contact_phone?: string; is_active?: boolean }
): InventoryNode {
  const node = getNode(db, nodeId);
  if (!node) throw new Error('Nodo no encontrado');

  if (data.is_active === false) {
    // Can't deactivate if has assigned cards
    const activeCards = db.prepare(
      "SELECT COUNT(*) as cnt FROM inventory_assignments WHERE node_id = ? AND status = 'assigned'"
    ).get(nodeId) as { cnt: number };
    if (activeCards.cnt > 0) {
      throw new Error(`No puede desactivar: tiene ${activeCards.cnt} cartones asignados`);
    }
  }

  db.prepare(`
    UPDATE inventory_nodes
    SET name = COALESCE(?, name),
        code = COALESCE(?, code),
        contact_name = COALESCE(?, contact_name),
        contact_phone = COALESCE(?, contact_phone),
        is_active = COALESCE(?, is_active),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    data.name ?? null,
    data.code ?? null,
    data.contact_name ?? null,
    data.contact_phone ?? null,
    data.is_active !== undefined ? (data.is_active ? 1 : 0) : null,
    nodeId
  );

  return getNode(db, nodeId)!;
}

// =====================================================
// CARD SELECTION RESOLVER
// =====================================================

export function resolveCardSelection(db: Database.Database, eventId: number, selection: CardSelection): number[] {
  if (selection.type === 'card_ids') {
    return selection.card_ids || [];
  }

  if (selection.type === 'series_range') {
    const fromSeries = parseInt(selection.from_series || '1', 10);
    const toSeries = parseInt(selection.to_series || '1', 10);
    const fromCard = (fromSeries - 1) * 50 + 1;
    const toCard = toSeries * 50;

    return (db.prepare(
      'SELECT id FROM cards WHERE event_id = ? AND card_number BETWEEN ? AND ? ORDER BY card_number'
    ).all(eventId, fromCard, toCard) as { id: number }[]).map(r => r.id);
  }

  if (selection.type === 'card_range') {
    return (db.prepare(
      'SELECT id FROM cards WHERE event_id = ? AND card_number BETWEEN ? AND ? ORDER BY card_number'
    ).all(eventId, selection.from_card, selection.to_card) as { id: number }[]).map(r => r.id);
  }

  return [];
}

// =====================================================
// CARD OPERATIONS (all transactional)
// =====================================================

export function initialLoadCards(
  db: Database.Database,
  eventId: number,
  rootNodeId: number,
  cardIds: number[],
  userId: number
): BatchResult {
  const node = getNode(db, rootNodeId);
  if (!node) throw new Error('Nodo no encontrado');
  if (node.level !== 1) throw new Error('La carga inicial solo se puede hacer al nodo raiz (nivel 1)');
  if (node.event_id !== eventId) throw new Error('El nodo no pertenece a este evento');

  const batchId = randomUUID();

  const doLoad = db.transaction(() => {
    const checkAssigned = db.prepare(
      "SELECT card_id FROM inventory_assignments WHERE card_id = ? AND status = 'assigned'"
    );
    const insertAssignment = db.prepare(
      'INSERT INTO inventory_assignments (card_id, node_id, event_id, status) VALUES (?, ?, ?, ?)'
    );
    const insertMovement = db.prepare(`
      INSERT INTO inventory_movements (event_id, card_id, movement_type, to_node_id, performed_by, batch_id)
      VALUES (?, ?, 'initial_load', ?, ?, ?)
    `);

    let loaded = 0;
    for (const cardId of cardIds) {
      const existing = checkAssigned.get(cardId);
      if (existing) continue; // Skip already assigned

      insertAssignment.run(cardId, rootNodeId, eventId, 'assigned');
      insertMovement.run(eventId, cardId, rootNodeId, userId, batchId);
      loaded++;
    }

    // Update counters
    db.prepare(
      'UPDATE inventory_nodes SET total_assigned = total_assigned + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(loaded, rootNodeId);

    return loaded;
  });

  const count = doLoad();
  return { batch_id: batchId, cards_affected: count, movement_type: 'initial_load' };
}

export function assignCardsDown(
  db: Database.Database,
  fromNodeId: number,
  toNodeId: number,
  cardIds: number[],
  userId: number,
  notes?: string
): BatchResult {
  const fromNode = getNode(db, fromNodeId);
  const toNode = getNode(db, toNodeId);
  if (!fromNode || !toNode) throw new Error('Nodo origen o destino no encontrado');
  if (toNode.parent_id !== fromNodeId) throw new Error('El nodo destino no es hijo directo del nodo origen');

  const batchId = randomUUID();

  const doAssign = db.transaction(() => {
    const checkCard = db.prepare(
      "SELECT id FROM inventory_assignments WHERE card_id = ? AND node_id = ? AND status = 'assigned'"
    );
    const updateAssignment = db.prepare(
      "UPDATE inventory_assignments SET node_id = ?, assigned_at = CURRENT_TIMESTAMP WHERE card_id = ? AND node_id = ? AND status = 'assigned'"
    );
    const insertMovement = db.prepare(`
      INSERT INTO inventory_movements (event_id, card_id, movement_type, from_node_id, to_node_id, performed_by, batch_id, notes)
      VALUES (?, ?, 'assign_down', ?, ?, ?, ?, ?)
    `);

    let moved = 0;
    for (const cardId of cardIds) {
      const existing = checkCard.get(cardId, fromNodeId);
      if (!existing) continue; // Card not at source node

      updateAssignment.run(toNodeId, cardId, fromNodeId);
      insertMovement.run(fromNode.event_id, cardId, fromNodeId, toNodeId, userId, batchId, notes || null);
      moved++;
    }

    if (moved === 0) throw new Error('Ninguno de los cartones seleccionados esta disponible en el nodo origen');

    // Update counters
    db.prepare(
      'UPDATE inventory_nodes SET total_distributed = total_distributed + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(moved, fromNodeId);
    db.prepare(
      'UPDATE inventory_nodes SET total_assigned = total_assigned + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(moved, toNodeId);

    return moved;
  });

  const count = doAssign();
  return { batch_id: batchId, cards_affected: count, movement_type: 'assign_down' };
}

export function returnCardsUp(
  db: Database.Database,
  fromNodeId: number,
  cardIds: number[],
  userId: number,
  notes?: string
): BatchResult {
  const fromNode = getNode(db, fromNodeId);
  if (!fromNode) throw new Error('Nodo no encontrado');
  if (!fromNode.parent_id) throw new Error('El nodo raiz no puede devolver cartones');

  const parentNode = getNode(db, fromNode.parent_id);
  if (!parentNode) throw new Error('Nodo padre no encontrado');

  const batchId = randomUUID();

  const doReturn = db.transaction(() => {
    const checkCard = db.prepare(
      "SELECT id FROM inventory_assignments WHERE card_id = ? AND node_id = ? AND status = 'assigned'"
    );
    const updateAssignment = db.prepare(
      "UPDATE inventory_assignments SET node_id = ?, assigned_at = CURRENT_TIMESTAMP WHERE card_id = ? AND node_id = ? AND status = 'assigned'"
    );
    const insertMovement = db.prepare(`
      INSERT INTO inventory_movements (event_id, card_id, movement_type, from_node_id, to_node_id, performed_by, batch_id, notes)
      VALUES (?, ?, 'return_up', ?, ?, ?, ?, ?)
    `);

    let returned = 0;
    for (const cardId of cardIds) {
      const existing = checkCard.get(cardId, fromNodeId);
      if (!existing) continue;

      updateAssignment.run(parentNode.id, cardId, fromNodeId);
      insertMovement.run(fromNode.event_id, cardId, fromNodeId, parentNode.id, userId, batchId, notes || null);
      returned++;
    }

    if (returned === 0) throw new Error('Ninguno de los cartones seleccionados esta disponible para devolucion');

    // Update counters
    db.prepare(
      'UPDATE inventory_nodes SET total_returned = total_returned + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(returned, fromNodeId);
    db.prepare(
      'UPDATE inventory_nodes SET total_distributed = total_distributed - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(returned, parentNode.id);

    return returned;
  });

  const count = doReturn();
  return { batch_id: batchId, cards_affected: count, movement_type: 'return_up' };
}

export function markCardsSold(
  db: Database.Database,
  nodeId: number,
  cardIds: number[],
  userId: number,
  buyerName?: string,
  buyerPhone?: string
): BatchResult {
  const node = getNode(db, nodeId);
  if (!node) throw new Error('Nodo no encontrado');

  const batchId = randomUUID();

  const doSell = db.transaction(() => {
    const checkCard = db.prepare(
      "SELECT id FROM inventory_assignments WHERE card_id = ? AND node_id = ? AND status = 'assigned'"
    );
    const updateAssignment = db.prepare(
      "UPDATE inventory_assignments SET status = 'sold' WHERE card_id = ? AND node_id = ? AND status = 'assigned'"
    );
    const updateCard = db.prepare(
      'UPDATE cards SET is_sold = 1, sold_at = CURRENT_TIMESTAMP, buyer_name = COALESCE(?, buyer_name), buyer_phone = COALESCE(?, buyer_phone) WHERE id = ?'
    );
    const insertMovement = db.prepare(`
      INSERT INTO inventory_movements (event_id, card_id, movement_type, from_node_id, performed_by, batch_id)
      VALUES (?, ?, 'mark_sold', ?, ?, ?)
    `);

    let sold = 0;
    for (const cardId of cardIds) {
      const existing = checkCard.get(cardId, nodeId);
      if (!existing) continue;

      updateAssignment.run(cardId, nodeId);
      updateCard.run(buyerName || null, buyerPhone || null, cardId);
      insertMovement.run(node.event_id, cardId, nodeId, userId, batchId);
      sold++;
    }

    if (sold === 0) throw new Error('Ninguno de los cartones seleccionados esta disponible para venta');

    // Update counter
    db.prepare(
      'UPDATE inventory_nodes SET total_sold = total_sold + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(sold, nodeId);

    return sold;
  });

  const count = doSell();
  return { batch_id: batchId, cards_affected: count, movement_type: 'mark_sold' };
}

// =====================================================
// INVENTORY QUERIES
// =====================================================

export function getNodeSummary(db: Database.Database, nodeId: number): InventorySummary {
  const node = getNode(db, nodeId);
  if (!node) throw new Error('Nodo no encontrado');

  return {
    total_assigned: node.total_assigned,
    distributed_to_children: node.total_distributed,
    sold: node.total_sold,
    returned: node.total_returned,
    available_in_hand: node.total_assigned - node.total_distributed - node.total_sold,
  };
}

export function getConsolidatedInventory(db: Database.Database, nodeId: number): ConsolidatedSummary {
  const descendants = db.prepare(`
    WITH RECURSIVE desc_nodes AS (
      SELECT id, name, level, total_assigned, total_distributed, total_sold, total_returned, event_id
      FROM inventory_nodes WHERE id = ?
      UNION ALL
      SELECT n.id, n.name, n.level, n.total_assigned, n.total_distributed, n.total_sold, n.total_returned, n.event_id
      FROM inventory_nodes n
      INNER JOIN desc_nodes d ON n.parent_id = d.id
      WHERE n.is_active = 1
    )
    SELECT dn.*, il.name as level_name
    FROM desc_nodes dn
    LEFT JOIN inventory_levels il ON il.event_id = dn.event_id AND il.level = dn.level
  `).all(nodeId) as (InventoryNode & { level_name: string })[];

  let totalAssigned = 0;
  let totalDistributed = 0;
  let totalSold = 0;
  let totalReturned = 0;

  const descList = descendants.map(d => {
    const summary: InventorySummary = {
      total_assigned: d.total_assigned,
      distributed_to_children: d.total_distributed,
      sold: d.total_sold,
      returned: d.total_returned,
      available_in_hand: d.total_assigned - d.total_distributed - d.total_sold,
    };
    totalAssigned += d.total_assigned;
    totalDistributed += d.total_distributed;
    totalSold += d.total_sold;
    totalReturned += d.total_returned;
    return { id: d.id, name: d.name, level: d.level, level_name: d.level_name || '', summary };
  });

  // Root node totals
  const rootNode = descendants[0];
  return {
    total_assigned: rootNode?.total_assigned || 0,
    distributed_to_children: rootNode?.total_distributed || 0,
    sold: totalSold,
    returned: totalReturned,
    available_in_hand: totalAssigned - totalDistributed - totalSold,
    descendants: descList,
  };
}

export function getCardsAtNode(
  db: Database.Database,
  nodeId: number,
  status: string = 'assigned',
  page: number = 1,
  limit: number = 50
): { cards: unknown[]; total: number } {
  const offset = (page - 1) * limit;

  const total = (db.prepare(
    'SELECT COUNT(*) as cnt FROM inventory_assignments WHERE node_id = ? AND status = ?'
  ).get(nodeId, status) as { cnt: number }).cnt;

  const cards = db.prepare(`
    SELECT c.id, c.card_number, c.serial, c.card_code, c.validation_code,
           c.is_sold, c.buyer_name, c.buyer_phone, ia.status as inv_status, ia.assigned_at
    FROM inventory_assignments ia
    JOIN cards c ON c.id = ia.card_id
    WHERE ia.node_id = ? AND ia.status = ?
    ORDER BY c.card_number
    LIMIT ? OFFSET ?
  `).all(nodeId, status, limit, offset);

  return { cards, total };
}

export function getEventOverview(db: Database.Database, eventId: number) {
  const levels = getEventLevels(db, eventId);
  const tree = getNodeTree(db, eventId);

  // Total cards in event
  const eventCards = (db.prepare(
    'SELECT COUNT(*) as total FROM cards WHERE event_id = ?'
  ).get(eventId) as { total: number }).total;

  // Cards in inventory system
  const inInventory = (db.prepare(
    "SELECT COUNT(*) as cnt FROM inventory_assignments WHERE event_id = ? AND status IN ('assigned', 'sold')"
  ).get(eventId) as { cnt: number }).cnt;

  return {
    levels,
    tree,
    total_event_cards: eventCards,
    cards_in_inventory: inInventory,
    cards_unassigned: eventCards - inInventory,
  };
}

export function getMovements(
  db: Database.Database,
  eventId: number,
  filters: { node_id?: number; movement_type?: string; from_date?: string; to_date?: string; page?: number; limit?: number }
): { movements: MovementRecord[]; total: number } {
  const conditions = ['m.event_id = ?'];
  const params: unknown[] = [eventId];

  if (filters.node_id) {
    conditions.push('(m.from_node_id = ? OR m.to_node_id = ?)');
    params.push(filters.node_id, filters.node_id);
  }
  if (filters.movement_type) {
    conditions.push('m.movement_type = ?');
    params.push(filters.movement_type);
  }
  if (filters.from_date) {
    conditions.push('m.created_at >= ?');
    params.push(filters.from_date);
  }
  if (filters.to_date) {
    conditions.push('m.created_at <= ?');
    params.push(filters.to_date);
  }

  const where = conditions.join(' AND ');
  const page = filters.page || 1;
  const limit = filters.limit || 50;
  const offset = (page - 1) * limit;

  const total = (db.prepare(
    `SELECT COUNT(*) as cnt FROM inventory_movements m WHERE ${where}`
  ).get(...params) as { cnt: number }).cnt;

  const movements = db.prepare(`
    SELECT m.id, m.event_id, m.card_id, c.card_number, c.serial, c.card_code,
           m.movement_type, m.from_node_id, fn.name as from_node_name,
           m.to_node_id, tn.name as to_node_name,
           u.full_name as performed_by_name, m.batch_id, m.notes, m.created_at
    FROM inventory_movements m
    JOIN cards c ON c.id = m.card_id
    LEFT JOIN inventory_nodes fn ON fn.id = m.from_node_id
    LEFT JOIN inventory_nodes tn ON tn.id = m.to_node_id
    JOIN users u ON u.id = m.performed_by
    WHERE ${where}
    ORDER BY m.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as MovementRecord[];

  return { movements, total };
}
