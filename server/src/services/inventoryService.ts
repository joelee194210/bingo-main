import type Database from 'better-sqlite3';
import { generateCajaCode, generateLoteCode, generateEnvioCode, generateCentroCode, identifyCodeType } from './qrService.js';

// =====================================================
// HELPER: AUDITORÍA
// =====================================================

/**
 * Registra una entrada en el log de auditoría de inventario
 */
function logAudit(db: Database.Database, params: {
  eventId: number;
  action: string;
  entityType: 'caja' | 'lote' | 'card' | 'envio' | 'centro';
  entityId: number;
  centroId?: number;
  envioId?: number;
  details?: Record<string, unknown>;
  performedBy?: string;
}): void {
  db.prepare(`
    INSERT INTO inventory_audit (event_id, action, entity_type, entity_id, centro_id, envio_id, details, performed_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.eventId,
    params.action,
    params.entityType,
    params.entityId,
    params.centroId ?? null,
    params.envioId ?? null,
    params.details ? JSON.stringify(params.details) : null,
    params.performedBy ?? null
  );
}

// =====================================================
// CENTROS DE DISTRIBUCIÓN
// =====================================================

/**
 * Crea un nuevo centro de distribución
 */
export function createCentro(
  db: Database.Database,
  eventId: number,
  data: { name: string; code?: string; parentId?: number; address?: string; contactName?: string; contactPhone?: string }
): Record<string, unknown> {
  // Auto-generar código si no se proporcionó
  let code = data.code;
  if (!code) {
    const maxRow = db.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS seq FROM centros').get() as { seq: number };
    code = generateCentroCode(maxRow.seq);
  }

  const result = db.prepare(`
    INSERT INTO centros (event_id, parent_id, name, code, address, contact_name, contact_phone)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    eventId,
    data.parentId ?? null,
    data.name,
    code,
    data.address ?? null,
    data.contactName ?? null,
    data.contactPhone ?? null
  );

  const centro = db.prepare('SELECT * FROM centros WHERE id = ?').get(result.lastInsertRowid) as Record<string, unknown>;

  logAudit(db, {
    eventId,
    action: 'create_centro',
    entityType: 'centro',
    entityId: centro.id as number,
    centroId: centro.id as number,
    details: { name: data.name, code },
  });

  return centro;
}

/**
 * Actualiza un centro de distribución
 */
export function updateCentro(
  db: Database.Database,
  centroId: number,
  data: { name?: string; address?: string; contactName?: string; contactPhone?: string; isActive?: boolean }
): Record<string, unknown> {
  const sets: string[] = [];
  const values: unknown[] = [];

  if (data.name !== undefined) { sets.push('name = ?'); values.push(data.name); }
  if (data.address !== undefined) { sets.push('address = ?'); values.push(data.address); }
  if (data.contactName !== undefined) { sets.push('contact_name = ?'); values.push(data.contactName); }
  if (data.contactPhone !== undefined) { sets.push('contact_phone = ?'); values.push(data.contactPhone); }
  if (data.isActive !== undefined) { sets.push('is_active = ?'); values.push(data.isActive ? 1 : 0); }

  if (sets.length > 0) {
    sets.push('updated_at = CURRENT_TIMESTAMP');
    values.push(centroId);
    db.prepare(`UPDATE centros SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  return db.prepare('SELECT * FROM centros WHERE id = ?').get(centroId) as Record<string, unknown>;
}

/**
 * Obtiene un centro con conteo de hijos
 */
export function getCentro(db: Database.Database, centroId: number): Record<string, unknown> | null {
  const centro = db.prepare('SELECT * FROM centros WHERE id = ?').get(centroId) as Record<string, unknown> | undefined;
  if (!centro) return null;

  const childCount = db.prepare('SELECT COUNT(*) AS count FROM centros WHERE parent_id = ?').get(centroId) as { count: number };
  return { ...centro, children_count: childCount.count };
}

/**
 * Lista todos los centros de un evento
 */
export function getCentros(db: Database.Database, eventId: number): Record<string, unknown>[] {
  return db.prepare('SELECT * FROM centros WHERE event_id = ? ORDER BY name').all(eventId) as Record<string, unknown>[];
}

/**
 * Construye el árbol jerárquico de centros para un evento
 */
export function getCentroTree(db: Database.Database, eventId: number): Record<string, unknown>[] {
  const centros = db.prepare('SELECT * FROM centros WHERE event_id = ? ORDER BY name').all(eventId) as Record<string, unknown>[];

  // Mapa para acceso rápido por id
  const map = new Map<number, Record<string, unknown>>();
  for (const c of centros) {
    (c as Record<string, unknown>).children = [];
    map.set(c.id as number, c);
  }

  // Construir árbol
  const roots: Record<string, unknown>[] = [];
  for (const c of centros) {
    const parentId = c.parent_id as number | null;
    if (parentId && map.has(parentId)) {
      const parent = map.get(parentId)!;
      (parent.children as Record<string, unknown>[]).push(c);
    } else {
      roots.push(c);
    }
  }

  return roots;
}

/**
 * Obtiene el inventario de un centro: cajas, lotes y resumen
 */
export function getCentroInventory(
  db: Database.Database,
  centroId: number,
  filters?: { status?: string }
): { cajas: Record<string, unknown>[]; lotes: Record<string, unknown>[]; summary: { totalCajas: number; totalLotes: number; totalCards: number; totalSold: number } } {
  let cajasQuery = 'SELECT * FROM cajas WHERE centro_id = ?';
  const cajasParams: unknown[] = [centroId];
  if (filters?.status) {
    cajasQuery += ' AND status = ?';
    cajasParams.push(filters.status);
  }
  const cajas = db.prepare(cajasQuery).all(...cajasParams) as Record<string, unknown>[];

  let lotesQuery = 'SELECT * FROM lotes WHERE centro_id = ?';
  const lotesParams: unknown[] = [centroId];
  if (filters?.status) {
    lotesQuery += ' AND status = ?';
    lotesParams.push(filters.status);
  }
  const lotes = db.prepare(lotesQuery).all(...lotesParams) as Record<string, unknown>[];

  // Resumen general (sin filtro de status)
  const summaryRow = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM cajas WHERE centro_id = ?) AS totalCajas,
      (SELECT COUNT(*) FROM lotes WHERE centro_id = ?) AS totalLotes,
      (SELECT COALESCE(SUM(total_cards), 0) FROM lotes WHERE centro_id = ?) AS totalCards,
      (SELECT COALESCE(SUM(cards_sold), 0) FROM lotes WHERE centro_id = ?) AS totalSold
  `).get(centroId, centroId, centroId, centroId) as { totalCajas: number; totalLotes: number; totalCards: number; totalSold: number };

  return { cajas, lotes, summary: summaryRow };
}

// =====================================================
// LOTES
// =====================================================

/**
 * Crea lotes a partir de los cartones existentes agrupados por serie.
 * Cada serie (prefijo de 5 dígitos del serial) se convierte en un lote.
 */
export function createLotesForEvent(db: Database.Database, eventId: number): { created: number } {
  const createFn = db.transaction(() => {
    // Obtener series únicas de cartones que no tienen lote asignado
    const series = db.prepare(`
      SELECT SUBSTR(serial, 1, 5) AS series_number, COUNT(*) AS total
      FROM cards
      WHERE event_id = ? AND lote_id IS NULL
      GROUP BY SUBSTR(serial, 1, 5)
      ORDER BY series_number
    `).all(eventId) as { series_number: string; total: number }[];

    // Verificar que no exista ya un lote para cada serie
    const existingLotes = db.prepare(
      'SELECT series_number FROM lotes WHERE event_id = ?'
    ).all(eventId) as { series_number: string }[];
    const existingSet = new Set(existingLotes.map(l => l.series_number));

    let created = 0;
    // Secuencia para código de lote
    const maxSeqRow = db.prepare('SELECT COALESCE(MAX(id), 0) AS maxId FROM lotes').get() as { maxId: number };
    let seq = maxSeqRow.maxId + 1;

    const insertLote = db.prepare(`
      INSERT INTO lotes (event_id, lote_code, series_number, total_cards, status)
      VALUES (?, ?, ?, ?, 'disponible')
    `);
    const updateCards = db.prepare(`
      UPDATE cards SET lote_id = ? WHERE event_id = ? AND SUBSTR(serial, 1, 5) = ? AND lote_id IS NULL
    `);

    for (const s of series) {
      if (existingSet.has(s.series_number)) continue;

      const loteCode = generateLoteCode(seq);
      const result = insertLote.run(eventId, loteCode, s.series_number, s.total);
      const loteId = result.lastInsertRowid as number;

      updateCards.run(loteId, eventId, s.series_number);

      logAudit(db, {
        eventId,
        action: 'create_lote',
        entityType: 'lote',
        entityId: loteId,
        details: { series: s.series_number, totalCards: s.total, loteCode },
      });

      seq++;
      created++;
    }

    return { created };
  });

  return createFn();
}

/**
 * Obtiene un lote con sus cartones
 */
export function getLoteWithCards(db: Database.Database, loteId: number): Record<string, unknown> | null {
  const lote = db.prepare('SELECT * FROM lotes WHERE id = ?').get(loteId) as Record<string, unknown> | undefined;
  if (!lote) return null;

  const cards = db.prepare(
    'SELECT id, card_number, serial, card_code, validation_code, is_sold, sold_at, buyer_name, buyer_phone FROM cards WHERE lote_id = ? ORDER BY card_number'
  ).all(loteId) as Record<string, unknown>[];

  return { ...lote, cards };
}

/**
 * Busca un lote por su código
 */
export function getLoteByCode(db: Database.Database, code: string): Record<string, unknown> | null {
  return (db.prepare('SELECT * FROM lotes WHERE lote_code = ?').get(code) as Record<string, unknown>) ?? null;
}

/**
 * Lista lotes de un evento con filtros opcionales
 */
export function getLotes(
  db: Database.Database,
  eventId: number,
  filters?: { cajaId?: number; centroId?: number; status?: string; page?: number; limit?: number }
): { lotes: Record<string, unknown>[]; pagination: { page: number; limit: number; total: number } } {
  const conditions = ['event_id = ?'];
  const params: unknown[] = [eventId];

  if (filters?.cajaId !== undefined) { conditions.push('caja_id = ?'); params.push(filters.cajaId); }
  if (filters?.centroId !== undefined) { conditions.push('centro_id = ?'); params.push(filters.centroId); }
  if (filters?.status) { conditions.push('status = ?'); params.push(filters.status); }

  const where = conditions.join(' AND ');
  const page = filters?.page ?? 1;
  const limit = filters?.limit ?? 50;
  const offset = (page - 1) * limit;

  const total = (db.prepare(`SELECT COUNT(*) AS count FROM lotes WHERE ${where}`).get(...params) as { count: number }).count;
  const lotes = db.prepare(`SELECT * FROM lotes WHERE ${where} ORDER BY series_number LIMIT ? OFFSET ?`).all(...params, limit, offset) as Record<string, unknown>[];

  return { lotes, pagination: { page, limit, total } };
}

// =====================================================
// CAJAS
// =====================================================

/**
 * Crea cajas agrupando lotes sueltos (sin caja) del evento.
 * Cada caja recibe lotesPerCaja lotes.
 */
export function createCajas(
  db: Database.Database,
  eventId: number,
  lotesPerCaja: number,
  centroId?: number
): { created: number; totalLotes: number } {
  const createFn = db.transaction(() => {
    // Lotes sin caja asignada
    const looseLotes = db.prepare(
      'SELECT id FROM lotes WHERE event_id = ? AND caja_id IS NULL ORDER BY series_number'
    ).all(eventId) as { id: number }[];

    if (looseLotes.length === 0) return { created: 0, totalLotes: 0 };

    const seqRow = db.prepare('SELECT COALESCE(MAX(id), 0) AS maxId FROM cajas').get() as { maxId: number };
    let seq = seqRow.maxId + 1;

    const insertCaja = db.prepare(`
      INSERT INTO cajas (event_id, caja_code, centro_id, total_lotes, status)
      VALUES (?, ?, ?, ?, 'sellada')
    `);
    const updateLote = db.prepare(`
      UPDATE lotes SET caja_id = ?, centro_id = COALESCE(?, centro_id), status = 'en_caja', updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `);

    let created = 0;
    let totalLotesAssigned = 0;

    // Agrupar lotes en cajas
    for (let i = 0; i < looseLotes.length; i += lotesPerCaja) {
      const chunk = looseLotes.slice(i, i + lotesPerCaja);
      const cajaCode = generateCajaCode(seq);

      const result = insertCaja.run(eventId, cajaCode, centroId ?? null, chunk.length);
      const cajaId = result.lastInsertRowid as number;

      for (const lote of chunk) {
        updateLote.run(cajaId, centroId ?? null, lote.id);
      }

      logAudit(db, {
        eventId,
        action: 'create_caja',
        entityType: 'caja',
        entityId: cajaId,
        centroId,
        details: { cajaCode, lotesCount: chunk.length },
      });

      seq++;
      created++;
      totalLotesAssigned += chunk.length;
    }

    return { created, totalLotes: totalLotesAssigned };
  });

  return createFn();
}

/**
 * Abre una caja sellada y pone sus lotes en estado 'disponible'
 */
export function openCaja(db: Database.Database, cajaId: number, userId?: string): Record<string, unknown> {
  const openFn = db.transaction(() => {
    db.prepare(`UPDATE cajas SET status = 'abierta', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(cajaId);

    // Solo cambiar lotes que están en estado 'en_caja'
    db.prepare(`
      UPDATE lotes SET status = 'disponible', updated_at = CURRENT_TIMESTAMP
      WHERE caja_id = ? AND status = 'en_caja'
    `).run(cajaId);

    const caja = db.prepare('SELECT * FROM cajas WHERE id = ?').get(cajaId) as Record<string, unknown>;

    logAudit(db, {
      eventId: caja.event_id as number,
      action: 'open_caja',
      entityType: 'caja',
      entityId: cajaId,
      centroId: caja.centro_id as number | undefined,
      performedBy: userId,
    });

    return caja;
  });

  return openFn();
}

/**
 * Obtiene una caja con sus lotes
 */
export function getCajaWithLotes(db: Database.Database, cajaId: number): Record<string, unknown> | null {
  const caja = db.prepare('SELECT * FROM cajas WHERE id = ?').get(cajaId) as Record<string, unknown> | undefined;
  if (!caja) return null;

  const lotes = db.prepare('SELECT * FROM lotes WHERE caja_id = ? ORDER BY series_number').all(cajaId) as Record<string, unknown>[];
  return { ...caja, lotes };
}

/**
 * Busca una caja por su código
 */
export function getCajaByCode(db: Database.Database, code: string): Record<string, unknown> | null {
  return (db.prepare('SELECT * FROM cajas WHERE caja_code = ?').get(code) as Record<string, unknown>) ?? null;
}

/**
 * Lista cajas de un evento con filtros opcionales
 */
export function getCajas(
  db: Database.Database,
  eventId: number,
  filters?: { centroId?: number; status?: string }
): Record<string, unknown>[] {
  const conditions = ['event_id = ?'];
  const params: unknown[] = [eventId];

  if (filters?.centroId !== undefined) { conditions.push('centro_id = ?'); params.push(filters.centroId); }
  if (filters?.status) { conditions.push('status = ?'); params.push(filters.status); }

  const where = conditions.join(' AND ');
  return db.prepare(`SELECT * FROM cajas WHERE ${where} ORDER BY caja_code`).all(...params) as Record<string, unknown>[];
}

// =====================================================
// VENTAS
// =====================================================

/**
 * Vende un lote completo: marca todos los cartones no vendidos como vendidos
 */
export function sellWholeLote(
  db: Database.Database,
  loteId: number,
  buyerInfo: { buyerName?: string; buyerPhone?: string },
  userId?: string
): { sold: number } {
  const sellFn = db.transaction(() => {
    const lote = db.prepare('SELECT * FROM lotes WHERE id = ?').get(loteId) as Record<string, unknown>;
    if (!lote) throw new Error('Lote no encontrado');

    // Marcar cartones no vendidos como vendidos
    const result = db.prepare(`
      UPDATE cards
      SET is_sold = 1, sold_at = CURRENT_TIMESTAMP, buyer_name = ?, buyer_phone = ?
      WHERE lote_id = ? AND is_sold = 0
    `).run(buyerInfo.buyerName ?? null, buyerInfo.buyerPhone ?? null, loteId);

    const sold = result.changes;

    // Actualizar lote
    db.prepare(`
      UPDATE lotes SET cards_sold = total_cards, status = 'vendido_completo', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(loteId);

    logAudit(db, {
      eventId: lote.event_id as number,
      action: 'sell_lote',
      entityType: 'lote',
      entityId: loteId,
      centroId: lote.centro_id as number | undefined,
      details: { sold, buyerName: buyerInfo.buyerName, wholeLote: true },
      performedBy: userId,
    });

    return { sold };
  });

  return sellFn();
}

/**
 * Vende cartones específicos dentro de un lote
 */
export function sellCardsInLote(
  db: Database.Database,
  loteId: number,
  cardIds: number[],
  buyerInfo: { buyerName?: string; buyerPhone?: string },
  userId?: string
): { sold: number } {
  const sellFn = db.transaction(() => {
    const lote = db.prepare('SELECT * FROM lotes WHERE id = ?').get(loteId) as Record<string, unknown>;
    if (!lote) throw new Error('Lote no encontrado');

    // Marcar cartones seleccionados como vendidos
    const updateCard = db.prepare(`
      UPDATE cards
      SET is_sold = 1, sold_at = CURRENT_TIMESTAMP, buyer_name = ?, buyer_phone = ?
      WHERE id = ? AND lote_id = ? AND is_sold = 0
    `);

    let sold = 0;
    for (const cardId of cardIds) {
      const r = updateCard.run(buyerInfo.buyerName ?? null, buyerInfo.buyerPhone ?? null, cardId, loteId);
      sold += r.changes;
    }

    // Actualizar conteo en lote
    const newSold = (lote.cards_sold as number) + sold;
    const totalCards = lote.total_cards as number;
    const newStatus = newSold >= totalCards ? 'vendido_completo' : newSold > 0 ? 'vendido_parcial' : (lote.status as string);

    db.prepare(`
      UPDATE lotes SET cards_sold = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(newSold, newStatus, loteId);

    logAudit(db, {
      eventId: lote.event_id as number,
      action: 'sell_cards',
      entityType: 'lote',
      entityId: loteId,
      centroId: lote.centro_id as number | undefined,
      details: { sold, cardIds, buyerName: buyerInfo.buyerName },
      performedBy: userId,
    });

    return { sold };
  });

  return sellFn();
}

/**
 * Devuelve un lote a un centro
 */
export function returnLote(
  db: Database.Database,
  loteId: number,
  toCentroId: number,
  userId?: string
): Record<string, unknown> {
  const returnFn = db.transaction(() => {
    const lote = db.prepare('SELECT * FROM lotes WHERE id = ?').get(loteId) as Record<string, unknown>;
    if (!lote) throw new Error('Lote no encontrado');

    db.prepare(`
      UPDATE lotes SET status = 'devuelto', centro_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(toCentroId, loteId);

    logAudit(db, {
      eventId: lote.event_id as number,
      action: 'return_lote',
      entityType: 'lote',
      entityId: loteId,
      centroId: toCentroId,
      details: { fromCentroId: lote.centro_id },
      performedBy: userId,
    });

    return db.prepare('SELECT * FROM lotes WHERE id = ?').get(loteId) as Record<string, unknown>;
  });

  return returnFn();
}

// =====================================================
// ENVÍOS
// =====================================================

/**
 * Crea un nuevo envío entre centros
 */
export function createEnvio(
  db: Database.Database,
  eventId: number,
  fromCentroId: number,
  toCentroId: number,
  userId?: string
): Record<string, unknown> {
  const seqRow = db.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS seq FROM envios').get() as { seq: number };
  const envioCode = generateEnvioCode(seqRow.seq);

  const result = db.prepare(`
    INSERT INTO envios (event_id, envio_code, from_centro_id, to_centro_id, status, prepared_by)
    VALUES (?, ?, ?, ?, 'preparando', ?)
  `).run(eventId, envioCode, fromCentroId, toCentroId, userId ?? null);

  const envio = db.prepare('SELECT * FROM envios WHERE id = ?').get(result.lastInsertRowid) as Record<string, unknown>;

  logAudit(db, {
    eventId,
    action: 'create_envio',
    entityType: 'envio',
    entityId: envio.id as number,
    envioId: envio.id as number,
    details: { envioCode, fromCentroId, toCentroId },
    performedBy: userId,
  });

  return envio;
}

/**
 * Agrega un item (caja o lote) a un envío
 */
export function addItemToEnvio(
  db: Database.Database,
  envioId: number,
  itemType: 'caja' | 'lote',
  itemId: number
): Record<string, unknown> {
  const result = db.prepare(`
    INSERT INTO envio_items (envio_id, item_type, caja_id, lote_id)
    VALUES (?, ?, ?, ?)
  `).run(
    envioId,
    itemType,
    itemType === 'caja' ? itemId : null,
    itemType === 'lote' ? itemId : null
  );

  return db.prepare('SELECT * FROM envio_items WHERE id = ?').get(result.lastInsertRowid) as Record<string, unknown>;
}

/**
 * Elimina un item de un envío
 */
export function removeItemFromEnvio(db: Database.Database, envioItemId: number): void {
  db.prepare('DELETE FROM envio_items WHERE id = ?').run(envioItemId);
}

/**
 * Envía un envío: cambia status y marca items en tránsito
 */
export function sendEnvio(db: Database.Database, envioId: number, userId?: string): Record<string, unknown> {
  const sendFn = db.transaction(() => {
    const envio = db.prepare('SELECT * FROM envios WHERE id = ?').get(envioId) as Record<string, unknown>;
    if (!envio) throw new Error('Envío no encontrado');
    if (envio.status !== 'preparando') throw new Error('Solo se pueden enviar envíos en estado "preparando"');

    // Actualizar envío
    db.prepare(`
      UPDATE envios SET status = 'enviado', sent_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(envioId);

    // Obtener items del envío
    const items = db.prepare('SELECT * FROM envio_items WHERE envio_id = ?').all(envioId) as Record<string, unknown>[];

    // Marcar cajas y lotes como en_transito
    for (const item of items) {
      if (item.item_type === 'caja' && item.caja_id) {
        db.prepare(`UPDATE cajas SET status = 'en_transito', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(item.caja_id);
        // También marcar los lotes de la caja
        db.prepare(`UPDATE lotes SET status = 'en_transito', updated_at = CURRENT_TIMESTAMP WHERE caja_id = ?`).run(item.caja_id);
      } else if (item.item_type === 'lote' && item.lote_id) {
        db.prepare(`UPDATE lotes SET status = 'en_transito', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(item.lote_id);
      }
    }

    logAudit(db, {
      eventId: envio.event_id as number,
      action: 'send_envio',
      entityType: 'envio',
      entityId: envioId,
      envioId,
      details: { itemsCount: items.length },
      performedBy: userId,
    });

    return db.prepare('SELECT * FROM envios WHERE id = ?').get(envioId) as Record<string, unknown>;
  });

  return sendFn();
}

/**
 * Recibe un envío completo: mueve todos los items al centro destino
 */
export function receiveEnvio(db: Database.Database, envioId: number, userId?: string): Record<string, unknown> {
  const receiveFn = db.transaction(() => {
    const envio = db.prepare('SELECT * FROM envios WHERE id = ?').get(envioId) as Record<string, unknown>;
    if (!envio) throw new Error('Envío no encontrado');

    const toCentroId = envio.to_centro_id as number;

    // Actualizar envío
    db.prepare(`
      UPDATE envios SET status = 'recibido', received_at = CURRENT_TIMESTAMP, received_by = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(userId ?? null, envioId);

    // Marcar todos los items como recibidos
    db.prepare(`
      UPDATE envio_items SET received = 1, received_at = CURRENT_TIMESTAMP WHERE envio_id = ?
    `).run(envioId);

    // Mover cajas y lotes al centro destino
    const items = db.prepare('SELECT * FROM envio_items WHERE envio_id = ?').all(envioId) as Record<string, unknown>[];

    for (const item of items) {
      if (item.item_type === 'caja' && item.caja_id) {
        db.prepare(`UPDATE cajas SET centro_id = ?, status = 'sellada', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(toCentroId, item.caja_id);
        db.prepare(`UPDATE lotes SET centro_id = ?, status = 'en_caja', updated_at = CURRENT_TIMESTAMP WHERE caja_id = ?`).run(toCentroId, item.caja_id);
      } else if (item.item_type === 'lote' && item.lote_id) {
        db.prepare(`UPDATE lotes SET centro_id = ?, status = 'disponible', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(toCentroId, item.lote_id);
      }
    }

    logAudit(db, {
      eventId: envio.event_id as number,
      action: 'receive_envio',
      entityType: 'envio',
      entityId: envioId,
      envioId,
      centroId: toCentroId,
      details: { itemsCount: items.length },
      performedBy: userId,
    });

    return db.prepare('SELECT * FROM envios WHERE id = ?').get(envioId) as Record<string, unknown>;
  });

  return receiveFn();
}

/**
 * Recibe un item individual de un envío
 */
export function receiveItem(
  db: Database.Database,
  envioId: number,
  envioItemId: number,
  userId?: string
): Record<string, unknown> {
  const receiveFn = db.transaction(() => {
    const envio = db.prepare('SELECT * FROM envios WHERE id = ?').get(envioId) as Record<string, unknown>;
    if (!envio) throw new Error('Envío no encontrado');

    const item = db.prepare('SELECT * FROM envio_items WHERE id = ? AND envio_id = ?').get(envioItemId, envioId) as Record<string, unknown>;
    if (!item) throw new Error('Item de envío no encontrado');

    const toCentroId = envio.to_centro_id as number;

    // Marcar item como recibido
    db.prepare(`UPDATE envio_items SET received = 1, received_at = CURRENT_TIMESTAMP WHERE id = ?`).run(envioItemId);

    // Mover al centro destino
    if (item.item_type === 'caja' && item.caja_id) {
      db.prepare(`UPDATE cajas SET centro_id = ?, status = 'sellada', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(toCentroId, item.caja_id);
      db.prepare(`UPDATE lotes SET centro_id = ?, status = 'en_caja', updated_at = CURRENT_TIMESTAMP WHERE caja_id = ?`).run(toCentroId, item.caja_id);
    } else if (item.item_type === 'lote' && item.lote_id) {
      db.prepare(`UPDATE lotes SET centro_id = ?, status = 'disponible', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(toCentroId, item.lote_id);
    }

    // Verificar si todos los items fueron recibidos
    const pending = db.prepare(
      'SELECT COUNT(*) AS count FROM envio_items WHERE envio_id = ? AND received = 0'
    ).get(envioId) as { count: number };

    if (pending.count === 0) {
      db.prepare(`
        UPDATE envios SET status = 'recibido', received_at = CURRENT_TIMESTAMP, received_by = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(userId ?? null, envioId);
    } else {
      db.prepare(`
        UPDATE envios SET status = 'recibido_parcial', updated_at = CURRENT_TIMESTAMP WHERE id = ?
      `).run(envioId);
    }

    logAudit(db, {
      eventId: envio.event_id as number,
      action: 'receive_item',
      entityType: item.item_type === 'caja' ? 'caja' : 'lote',
      entityId: (item.caja_id ?? item.lote_id) as number,
      envioId,
      centroId: toCentroId,
      details: { envioItemId },
      performedBy: userId,
    });

    return db.prepare('SELECT * FROM envio_items WHERE id = ?').get(envioItemId) as Record<string, unknown>;
  });

  return receiveFn();
}

/**
 * Cancela un envío (solo si está en estado 'preparando')
 */
export function cancelEnvio(db: Database.Database, envioId: number, userId?: string): Record<string, unknown> {
  const cancelFn = db.transaction(() => {
    const envio = db.prepare('SELECT * FROM envios WHERE id = ?').get(envioId) as Record<string, unknown>;
    if (!envio) throw new Error('Envío no encontrado');
    if (envio.status !== 'preparando') throw new Error('Solo se pueden cancelar envíos en estado "preparando"');

    // Actualizar envío
    db.prepare(`
      UPDATE envios SET status = 'cancelado', updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(envioId);

    // No hay que revertir nada porque los items aún no fueron enviados
    // (su status no cambió al agregarlos al envío)

    logAudit(db, {
      eventId: envio.event_id as number,
      action: 'cancel_envio',
      entityType: 'envio',
      entityId: envioId,
      envioId,
      performedBy: userId,
    });

    return db.prepare('SELECT * FROM envios WHERE id = ?').get(envioId) as Record<string, unknown>;
  });

  return cancelFn();
}

/**
 * Obtiene un envío con sus items detallados
 */
export function getEnvio(db: Database.Database, envioId: number): Record<string, unknown> | null {
  const envio = db.prepare('SELECT * FROM envios WHERE id = ?').get(envioId) as Record<string, unknown> | undefined;
  if (!envio) return null;

  const items = db.prepare(`
    SELECT ei.*,
      c.caja_code, c.status AS caja_status, c.total_lotes,
      l.lote_code, l.series_number, l.status AS lote_status, l.total_cards, l.cards_sold
    FROM envio_items ei
    LEFT JOIN cajas c ON ei.caja_id = c.id
    LEFT JOIN lotes l ON ei.lote_id = l.id
    WHERE ei.envio_id = ?
  `).all(envioId) as Record<string, unknown>[];

  return { ...envio, items };
}

/**
 * Lista envíos de un evento con filtros
 */
export function getEnvios(
  db: Database.Database,
  eventId: number,
  filters?: { status?: string; centroId?: number }
): Record<string, unknown>[] {
  const conditions = ['e.event_id = ?'];
  const params: unknown[] = [eventId];

  if (filters?.status) { conditions.push('e.status = ?'); params.push(filters.status); }
  if (filters?.centroId !== undefined) {
    conditions.push('(e.from_centro_id = ? OR e.to_centro_id = ?)');
    params.push(filters.centroId, filters.centroId);
  }

  const where = conditions.join(' AND ');
  return db.prepare(`
    SELECT e.*,
      fc.name AS from_centro_name,
      tc.name AS to_centro_name,
      (SELECT COUNT(*) FROM envio_items WHERE envio_id = e.id) AS items_count,
      (SELECT COUNT(*) FROM envio_items WHERE envio_id = e.id AND received = 1) AS items_received
    FROM envios e
    LEFT JOIN centros fc ON e.from_centro_id = fc.id
    LEFT JOIN centros tc ON e.to_centro_id = tc.id
    WHERE ${where}
    ORDER BY e.created_at DESC
  `).all(...params) as Record<string, unknown>[];
}

// =====================================================
// ASIGNACIÓN DE CAJAS/LOTES A CENTROS
// =====================================================

/**
 * Asigna una caja (y todos sus lotes) a un centro
 */
export function assignCajaToCentro(
  db: Database.Database,
  cajaId: number,
  toCentroId: number,
  userId?: string
): Record<string, unknown> {
  const assignFn = db.transaction(() => {
    const caja = db.prepare('SELECT * FROM cajas WHERE id = ?').get(cajaId) as Record<string, unknown>;
    if (!caja) throw new Error('Caja no encontrada');

    const fromCentroId = caja.centro_id as number | null;

    db.prepare(`UPDATE cajas SET centro_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(toCentroId, cajaId);
    db.prepare(`UPDATE lotes SET centro_id = ?, updated_at = CURRENT_TIMESTAMP WHERE caja_id = ?`).run(toCentroId, cajaId);

    logAudit(db, {
      eventId: caja.event_id as number,
      action: 'assign_caja',
      entityType: 'caja',
      entityId: cajaId,
      centroId: toCentroId,
      details: { fromCentroId, toCentroId },
      performedBy: userId,
    });

    return db.prepare('SELECT * FROM cajas WHERE id = ?').get(cajaId) as Record<string, unknown>;
  });

  return assignFn();
}

/**
 * Asigna un lote individual a un centro
 */
export function assignLoteToCentro(
  db: Database.Database,
  loteId: number,
  toCentroId: number,
  userId?: string
): Record<string, unknown> {
  const assignFn = db.transaction(() => {
    const lote = db.prepare('SELECT * FROM lotes WHERE id = ?').get(loteId) as Record<string, unknown>;
    if (!lote) throw new Error('Lote no encontrado');

    const fromCentroId = lote.centro_id as number | null;

    db.prepare(`UPDATE lotes SET centro_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(toCentroId, loteId);

    logAudit(db, {
      eventId: lote.event_id as number,
      action: 'assign_lote',
      entityType: 'lote',
      entityId: loteId,
      centroId: toCentroId,
      details: { fromCentroId, toCentroId },
      performedBy: userId,
    });

    return db.prepare('SELECT * FROM lotes WHERE id = ?').get(loteId) as Record<string, unknown>;
  });

  return assignFn();
}

// =====================================================
// ESCANEO QR
// =====================================================

/**
 * Escanea un código y devuelve la entidad correspondiente
 */
export function scanCode(
  db: Database.Database,
  code: string
): { type: 'caja' | 'lote' | 'card'; entity: Record<string, unknown> } | null {
  const codeType = identifyCodeType(code);

  if (codeType === 'caja') {
    const caja = db.prepare('SELECT * FROM cajas WHERE caja_code = ?').get(code) as Record<string, unknown> | undefined;
    if (!caja) return null;
    // Incluir lotes de la caja
    const lotes = db.prepare('SELECT * FROM lotes WHERE caja_id = ? ORDER BY series_number').all(caja.id) as Record<string, unknown>[];
    return { type: 'caja', entity: { ...caja, lotes } };
  }

  if (codeType === 'lote') {
    const lote = db.prepare('SELECT * FROM lotes WHERE lote_code = ?').get(code) as Record<string, unknown> | undefined;
    if (!lote) return null;
    return { type: 'lote', entity: lote };
  }

  // Buscar como cartón (por card_code o validation_code)
  const card = db.prepare(
    'SELECT * FROM cards WHERE card_code = ? OR validation_code = ?'
  ).get(code, code) as Record<string, unknown> | undefined;
  if (!card) return null;
  return { type: 'card', entity: card };
}

// =====================================================
// LOG DE AUDITORÍA
// =====================================================

/**
 * Consulta el log de auditoría con filtros y paginación
 */
export function getAuditLog(
  db: Database.Database,
  eventId: number,
  filters?: { entityType?: string; action?: string; centroId?: number; page?: number; limit?: number }
): { entries: Record<string, unknown>[]; pagination: { page: number; limit: number; total: number } } {
  const conditions = ['event_id = ?'];
  const params: unknown[] = [eventId];

  if (filters?.entityType) { conditions.push('entity_type = ?'); params.push(filters.entityType); }
  if (filters?.action) { conditions.push('action = ?'); params.push(filters.action); }
  if (filters?.centroId !== undefined) { conditions.push('centro_id = ?'); params.push(filters.centroId); }

  const where = conditions.join(' AND ');
  const page = filters?.page ?? 1;
  const limit = filters?.limit ?? 50;
  const offset = (page - 1) * limit;

  const total = (db.prepare(`SELECT COUNT(*) AS count FROM inventory_audit WHERE ${where}`).get(...params) as { count: number }).count;

  const entries = db.prepare(`
    SELECT * FROM inventory_audit WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as Record<string, unknown>[];

  return { entries, pagination: { page, limit, total } };
}
