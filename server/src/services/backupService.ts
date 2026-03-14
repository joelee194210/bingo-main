import type { Pool } from 'pg';
import { spawn } from 'child_process';

// =====================================================
// SISTEMA DE PROGRESO DE BACKUP/RESTORE
// =====================================================

export interface BackupProgress {
  jobId: string;
  type: 'backup_full' | 'backup_event' | 'restore_event' | 'restore_full';
  status: 'running' | 'completed' | 'error';
  step: string;
  current: number;
  total: number;
  details: string;
  result?: any;
  error?: string;
  startedAt: number;
  updatedAt: number;
}

const activeJobs = new Map<string, BackupProgress>();

export function createJob(type: BackupProgress['type']): BackupProgress {
  const jobId = `${type}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const job: BackupProgress = {
    jobId,
    type,
    status: 'running',
    step: 'Iniciando...',
    current: 0,
    total: 0,
    details: '',
    startedAt: Date.now(),
    updatedAt: Date.now(),
  };
  activeJobs.set(jobId, job);
  return job;
}

function updateJob(job: BackupProgress, update: Partial<BackupProgress>) {
  Object.assign(job, update, { updatedAt: Date.now() });
}

export function getJob(jobId: string): BackupProgress | undefined {
  return activeJobs.get(jobId);
}

// Limpiar jobs viejos (>30min)
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, job] of activeJobs) {
    if (job.updatedAt < cutoff) activeJobs.delete(id);
  }
}, 60_000);

// =====================================================
// BACKUP COMPLETO (todas las tablas principales)
// =====================================================

const BACKUP_TABLES = [
  'events',
  'cards',
  'games',
  'ball_history',
  'game_winners',
  'game_reports',
  'verification_logs',
  'settings',
  'promo_config',
  'promo_prizes',
  'promo_fixed_rules',
  'almacenes',
  'almacen_usuarios',
  'cajas',
  'lotes',
  'inv_asignaciones',
  'inv_asignacion_cartones',
  'inv_documentos',
  'inv_movimientos',
  'centros',
  'envios',
  'envio_items',
  'inventory_audit',
];

export async function exportFullBackup(pool: Pool, job?: BackupProgress) {
  const backup: Record<string, unknown[]> = {};

  for (let i = 0; i < BACKUP_TABLES.length; i++) {
    const table = BACKUP_TABLES[i];
    if (job) updateJob(job, { step: `Exportando ${table}`, current: i + 1, total: BACKUP_TABLES.length, details: `Tabla ${i + 1} de ${BACKUP_TABLES.length}` });
    const { rows } = await pool.query(`SELECT * FROM ${table}`);
    backup[table] = rows;
    if (job) updateJob(job, { details: `${table}: ${rows.length} registros` });
  }

  return {
    version: '2.0',
    type: 'full',
    created_at: new Date().toISOString(),
    tables: backup,
  };
}

// =====================================================
// BACKUP POR EVENTO (cartones, juegos, inventario)
// =====================================================

export async function exportEventBackup(pool: Pool, eventId: number, job?: BackupProgress) {
  if (job) updateJob(job, { step: 'Buscando evento...', current: 0, total: 16 });
  const { rows: events } = await pool.query('SELECT * FROM events WHERE id = $1', [eventId]);
  if (events.length === 0) throw new Error('Evento no encontrado');

  const event = events[0];
  if (job) updateJob(job, { step: `Exportando datos de "${event.name}"`, current: 1, total: 16, details: 'Consultando tablas...' });

  const [
    cards,
    games,
    ballHistory,
    gameWinners,
    gameReports,
    verificationLogs,
    promoConfig,
    promoPrizes,
    promoFixedRules,
    almacenes,
    cajas,
    lotes,
    asignaciones,
    asignacionCartones,
    documentos,
    movimientos,
    centros,
  ] = await Promise.all([
    pool.query('SELECT * FROM cards WHERE event_id = $1', [eventId]),
    pool.query('SELECT * FROM games WHERE event_id = $1', [eventId]),
    pool.query('SELECT bh.* FROM ball_history bh JOIN games g ON bh.game_id = g.id WHERE g.event_id = $1', [eventId]),
    pool.query('SELECT gw.* FROM game_winners gw JOIN games g ON gw.game_id = g.id WHERE g.event_id = $1', [eventId]),
    pool.query('SELECT gr.* FROM game_reports gr JOIN games g ON gr.game_id = g.id WHERE g.event_id = $1', [eventId]),
    pool.query('SELECT * FROM verification_logs WHERE event_id = $1', [eventId]),
    pool.query('SELECT * FROM promo_config WHERE event_id = $1', [eventId]),
    pool.query('SELECT * FROM promo_prizes WHERE event_id = $1', [eventId]),
    pool.query('SELECT * FROM promo_fixed_rules WHERE event_id = $1', [eventId]),
    pool.query('SELECT * FROM almacenes WHERE event_id = $1', [eventId]),
    pool.query('SELECT * FROM cajas WHERE event_id = $1', [eventId]),
    pool.query('SELECT * FROM lotes WHERE event_id = $1', [eventId]),
    pool.query('SELECT * FROM inv_asignaciones WHERE event_id = $1', [eventId]),
    pool.query(`SELECT iac.* FROM inv_asignacion_cartones iac
                JOIN inv_asignaciones ia ON iac.asignacion_id = ia.id
                WHERE ia.event_id = $1`, [eventId]),
    pool.query('SELECT * FROM inv_documentos WHERE event_id = $1', [eventId]),
    pool.query('SELECT * FROM inv_movimientos WHERE event_id = $1', [eventId]),
    pool.query('SELECT * FROM centros WHERE event_id = $1', [eventId]),
  ]);

  return {
    version: '2.0',
    type: 'event',
    created_at: new Date().toISOString(),
    event,
    tables: {
      cards: cards.rows,
      games: games.rows,
      ball_history: ballHistory.rows,
      game_winners: gameWinners.rows,
      game_reports: gameReports.rows,
      verification_logs: verificationLogs.rows,
      promo_config: promoConfig.rows,
      promo_prizes: promoPrizes.rows,
      promo_fixed_rules: promoFixedRules.rows,
      almacenes: almacenes.rows,
      cajas: cajas.rows,
      lotes: lotes.rows,
      inv_asignaciones: asignaciones.rows,
      inv_asignacion_cartones: asignacionCartones.rows,
      inv_documentos: documentos.rows,
      inv_movimientos: movimientos.rows,
      centros: centros.rows,
    },
  };
}

// =====================================================
// RESTAURAR EVENTO
// =====================================================

export async function restoreEventBackup(pool: Pool, data: any, job?: BackupProgress) {
  if (!data || typeof data !== 'object') {
    throw new Error('Datos de backup inválidos');
  }
  if (data.type !== 'event' || !data.event || !data.tables) {
    throw new Error('Formato de backup de evento inválido');
  }
  if (typeof data.event.name !== 'string' || !data.event.name) {
    throw new Error('El backup debe contener un evento con nombre válido');
  }

  // Calcular totales para barra de progreso
  const totalItems =
    (data.tables.centros?.length || 0) + (data.tables.almacenes?.length || 0) +
    (data.tables.cajas?.length || 0) + (data.tables.lotes?.length || 0) +
    (data.tables.cards?.length || 0) + (data.tables.games?.length || 0) +
    (data.tables.ball_history?.length || 0) + (data.tables.game_winners?.length || 0) +
    (data.tables.game_reports?.length || 0) + (data.tables.promo_config?.length || 0) +
    (data.tables.promo_prizes?.length || 0) + (data.tables.inv_asignaciones?.length || 0) +
    (data.tables.inv_asignacion_cartones?.length || 0) + (data.tables.inv_documentos?.length || 0) +
    (data.tables.inv_movimientos?.length || 0);
  let processedItems = 0;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (job) updateJob(job, { step: 'Creando evento...', total: totalItems, details: `Evento: ${data.event.name}` });

    // Insertar evento
    const ev = data.event;
    const { rows: inserted } = await client.query(
      `INSERT INTO events (name, description, total_cards, cards_sold, use_free_center, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [ev.name + ' (restaurado)', ev.description, 0, 0, ev.use_free_center, ev.status, ev.created_at, ev.updated_at]
    );
    const newEventId = inserted[0].id;

    // Mapas de IDs viejos a nuevos
    const cardIdMap = new Map<number, number>();
    const gameIdMap = new Map<number, number>();
    const almacenIdMap = new Map<number, number>();
    const cajaIdMap = new Map<number, number>();
    const loteIdMap = new Map<number, number>();
    const centroIdMap = new Map<number, number>();
    const asignacionIdMap = new Map<number, number>();
    const documentoIdMap = new Map<number, number>();

    // Restaurar centros
    if (job) updateJob(job, { step: 'Restaurando centros...', details: `${data.tables.centros?.length || 0} centros` });
    for (const c of data.tables.centros || []) {
      const { rows } = await client.query(
        `INSERT INTO centros (event_id, parent_id, name, code, address, contact_name, contact_phone, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [newEventId, null, c.name, c.code, c.address, c.contact_name, c.contact_phone, c.is_active, c.created_at, c.updated_at]
      );
      centroIdMap.set(c.id, rows[0].id);
      processedItems++;
    }
    // Actualizar parent_id de centros
    for (const c of data.tables.centros || []) {
      if (c.parent_id && centroIdMap.has(c.parent_id)) {
        await client.query('UPDATE centros SET parent_id = $1 WHERE id = $2', [centroIdMap.get(c.parent_id), centroIdMap.get(c.id)]);
      }
    }

    // Restaurar almacenes (sin parent_id primero)
    if (job) updateJob(job, { step: 'Restaurando almacenes...', current: processedItems, details: `${data.tables.almacenes?.length || 0} almacenes` });
    for (const a of data.tables.almacenes || []) {
      const { rows } = await client.query(
        `INSERT INTO almacenes (event_id, parent_id, name, code, address, contact_name, contact_phone, is_active, es_agencia_loteria, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
        [newEventId, null, a.name, a.code, a.address, a.contact_name, a.contact_phone, a.is_active, a.es_agencia_loteria || false, a.created_at, a.updated_at]
      );
      almacenIdMap.set(a.id, rows[0].id);
      processedItems++;
    }
    // Actualizar parent_id de almacenes
    for (const a of data.tables.almacenes || []) {
      if (a.parent_id && almacenIdMap.has(a.parent_id)) {
        await client.query('UPDATE almacenes SET parent_id = $1 WHERE id = $2', [almacenIdMap.get(a.parent_id), almacenIdMap.get(a.id)]);
      }
    }

    // Generar sufijo único para códigos de caja/lote/card (evitar conflicto con UNIQUE constraint)
    // Usar timestamp corto además del eventId para garantizar unicidad incluso si se restaura múltiples veces
    const suffix = `_R${newEventId}_${Date.now().toString(36)}`;

    // Restaurar cajas
    if (job) updateJob(job, { step: 'Restaurando cajas...', current: processedItems, details: `${data.tables.cajas?.length || 0} cajas` });
    for (const c of data.tables.cajas || []) {
      try {
        const { rows } = await client.query(
          `INSERT INTO cajas (event_id, caja_code, centro_id, almacen_id, total_lotes, status, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [newEventId, c.caja_code + suffix, centroIdMap.get(c.centro_id) || null, almacenIdMap.get(c.almacen_id) || null, c.total_lotes, c.status, c.created_at, c.updated_at]
        );
        cajaIdMap.set(c.id, rows[0].id);
        processedItems++;
      } catch (cajaErr: any) {
        if (cajaErr.code === '23505') {
          console.warn(`Caja duplicada saltada: ${c.caja_code} (constraint: ${cajaErr.constraint})`);
          continue;
        }
        throw cajaErr;
      }
    }

    // Restaurar lotes
    if (job) updateJob(job, { step: 'Restaurando lotes...', current: processedItems, details: `${data.tables.lotes?.length || 0} lotes` });
    for (const l of data.tables.lotes || []) {
      try {
        const { rows } = await client.query(
          `INSERT INTO lotes (event_id, caja_id, lote_code, series_number, centro_id, almacen_id, status, cards_sold, total_cards, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
          [newEventId, cajaIdMap.get(l.caja_id) || null, l.lote_code + suffix, l.series_number, centroIdMap.get(l.centro_id) || null, almacenIdMap.get(l.almacen_id) || null, l.status, l.cards_sold, l.total_cards, l.created_at, l.updated_at]
        );
        loteIdMap.set(l.id, rows[0].id);
        processedItems++;
      } catch (loteErr: any) {
        if (loteErr.code === '23505') {
          console.warn(`Lote duplicado saltado: ${l.lote_code} (constraint: ${loteErr.constraint})`);
          continue;
        }
        throw loteErr;
      }
    }

    // Restaurar cartones (los contadores se actualizan por trigger)
    const totalCards = data.tables.cards?.length || 0;
    if (job) updateJob(job, { step: `Restaurando cartones (0/${totalCards.toLocaleString()})...`, current: processedItems, details: `${totalCards.toLocaleString()} cartones por insertar` });
    let cardCount = 0;
    for (const card of data.tables.cards || []) {
      try {
        const { rows } = await client.query(
          `INSERT INTO cards (event_id, card_number, serial, card_code, validation_code, numbers, numbers_hash, promo_text, is_sold, sold_at, buyer_name, buyer_phone, buyer_cedula, buyer_libreta, almacen_id, lote_id, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING id`,
          [newEventId, card.card_number, card.serial, card.card_code + suffix, card.validation_code + suffix, card.numbers, card.numbers_hash,
           card.promo_text, card.is_sold, card.sold_at, card.buyer_name, card.buyer_phone, card.buyer_cedula, card.buyer_libreta,
           almacenIdMap.get(card.almacen_id) || null, loteIdMap.get(card.lote_id) || null, card.created_at]
        );
        cardIdMap.set(card.id, rows[0].id);
        processedItems++;
        cardCount++;
        if (job && cardCount % 500 === 0) updateJob(job, { step: `Restaurando cartones (${cardCount.toLocaleString()}/${totalCards.toLocaleString()})...`, current: processedItems, details: `${Math.round(cardCount / totalCards * 100)}% completado` });
      } catch (cardErr: any) {
        // Si es un duplicado de hash, saltar el cartón
        if (cardErr.code === '23505') {
          console.warn(`Cartón duplicado saltado: ${card.card_code} (constraint: ${cardErr.constraint})`);
          continue;
        }
        throw cardErr;
      }
    }

    // Restaurar juegos
    if (job) updateJob(job, { step: 'Restaurando juegos...', current: processedItems, details: `${data.tables.games?.length || 0} juegos` });
    for (const g of data.tables.games || []) {
      const { rows } = await client.query(
        `INSERT INTO games (event_id, name, game_type, custom_pattern, status, is_practice_mode, called_balls, winner_cards, prize_description, started_at, finished_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
        [newEventId, g.name, g.game_type, g.custom_pattern, g.status, g.is_practice_mode, g.called_balls, g.winner_cards, g.prize_description, g.started_at, g.finished_at, g.created_at]
      );
      gameIdMap.set(g.id, rows[0].id);
      processedItems++;
    }

    // Restaurar ball_history
    if (job) updateJob(job, { step: 'Restaurando historial de balotas...', current: processedItems, details: `${data.tables.ball_history?.length || 0} registros` });
    for (const bh of data.tables.ball_history || []) {
      const newGameId = gameIdMap.get(bh.game_id);
      if (newGameId) {
        await client.query(
          `INSERT INTO ball_history (game_id, ball_number, ball_column, call_order, called_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [newGameId, bh.ball_number, bh.ball_column, bh.call_order, bh.called_at]
        );
      }
    }

    // Restaurar game_winners
    if (job) updateJob(job, { step: 'Restaurando ganadores...', current: processedItems, details: `${data.tables.game_winners?.length || 0} ganadores` });
    for (const gw of data.tables.game_winners || []) {
      const newGameId = gameIdMap.get(gw.game_id);
      const newCardId = cardIdMap.get(gw.card_id);
      if (newGameId && newCardId) {
        await client.query(
          `INSERT INTO game_winners (game_id, card_id, card_number, card_code, validation_code, buyer_name, buyer_phone, winning_pattern, balls_to_win, won_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [newGameId, newCardId, gw.card_number, gw.card_code, gw.validation_code, gw.buyer_name, gw.buyer_phone, gw.winning_pattern, gw.balls_to_win, gw.won_at]
        );
      }
    }

    // Restaurar game_reports
    for (const gr of data.tables.game_reports || []) {
      const newGameId = gameIdMap.get(gr.game_id);
      if (newGameId) {
        await client.query(
          `INSERT INTO game_reports (game_id, event_name, game_name, game_type, is_practice_mode, total_balls_called, total_winners, started_at, finished_at, report_data)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [newGameId, gr.event_name, gr.game_name, gr.game_type, gr.is_practice_mode, gr.total_balls_called, gr.total_winners, gr.started_at, gr.finished_at, gr.report_data]
        );
      }
    }

    // Restaurar promo
    for (const pc of data.tables.promo_config || []) {
      await client.query(
        `INSERT INTO promo_config (event_id, is_enabled, no_prize_text, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [newEventId, pc.is_enabled, pc.no_prize_text, pc.created_at, pc.updated_at]
      );
    }
    for (const pp of data.tables.promo_prizes || []) {
      await client.query(
        `INSERT INTO promo_prizes (event_id, name, quantity, distributed, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [newEventId, pp.name, pp.quantity, pp.distributed, pp.created_at]
      );
    }
    for (const pfr of data.tables.promo_fixed_rules || []) {
      await client.query(
        `INSERT INTO promo_fixed_rules (event_id, prize_name, quantity, series_from, series_to, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [newEventId, pfr.prize_name, pfr.quantity, pfr.series_from, pfr.series_to, pfr.created_at]
      );
    }

    // Restaurar asignaciones
    if (job) updateJob(job, { step: 'Restaurando asignaciones...', current: processedItems, details: `${data.tables.inv_asignaciones?.length || 0} asignaciones` });
    for (const a of data.tables.inv_asignaciones || []) {
      const { rows } = await client.query(
        `INSERT INTO inv_asignaciones (event_id, almacen_id, tipo_entidad, referencia, cantidad_cartones, persona_nombre, persona_telefono, persona_user_id, proposito, estado, cartones_vendidos, asignado_por, created_at, updated_at, devuelto_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING id`,
        [newEventId, almacenIdMap.get(a.almacen_id) || a.almacen_id, a.tipo_entidad, a.referencia, a.cantidad_cartones, a.persona_nombre, a.persona_telefono, a.persona_user_id, a.proposito, a.estado, a.cartones_vendidos, a.asignado_por, a.created_at, a.updated_at, a.devuelto_at]
      );
      asignacionIdMap.set(a.id, rows[0].id);
    }

    // Restaurar asignacion_cartones
    if (job) updateJob(job, { step: 'Restaurando cartones de asignacion...', current: processedItems, details: `${data.tables.inv_asignacion_cartones?.length || 0} registros` });
    for (const ac of data.tables.inv_asignacion_cartones || []) {
      const newAsigId = asignacionIdMap.get(ac.asignacion_id);
      const newCardId = cardIdMap.get(ac.card_id);
      if (newAsigId && newCardId) {
        await client.query(
          `INSERT INTO inv_asignacion_cartones (asignacion_id, card_id, card_code, serial, vendido, vendido_at, comprador_nombre, comprador_telefono)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [newAsigId, newCardId, ac.card_code, ac.serial, ac.vendido, ac.vendido_at, ac.comprador_nombre, ac.comprador_telefono]
        );
      }
    }

    // Restaurar documentos
    if (job) updateJob(job, { step: 'Restaurando documentos...', current: processedItems, details: `${data.tables.inv_documentos?.length || 0} documentos` });
    for (const d of data.tables.inv_documentos || []) {
      const { rows } = await client.query(
        `INSERT INTO inv_documentos (event_id, accion, de_almacen_id, a_almacen_id, de_nombre, a_nombre, a_cedula, a_libreta, total_items, total_cartones, firma_entrega, firma_recibe, nombre_entrega, nombre_recibe, realizado_por, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING id`,
        [newEventId, d.accion, almacenIdMap.get(d.de_almacen_id) || null, almacenIdMap.get(d.a_almacen_id) || null, d.de_nombre, d.a_nombre, d.a_cedula, d.a_libreta, d.total_items, d.total_cartones, d.firma_entrega, d.firma_recibe, d.nombre_entrega, d.nombre_recibe, d.realizado_por, d.created_at]
      );
      documentoIdMap.set(d.id, rows[0].id);
    }

    // Restaurar movimientos
    if (job) updateJob(job, { step: 'Restaurando movimientos...', current: processedItems, details: `${data.tables.inv_movimientos?.length || 0} movimientos` });
    for (const m of data.tables.inv_movimientos || []) {
      await client.query(
        `INSERT INTO inv_movimientos (event_id, almacen_id, asignacion_id, tipo_entidad, referencia, accion, de_persona, a_persona, cantidad_cartones, detalles, realizado_por, created_at, documento_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [newEventId, almacenIdMap.get(m.almacen_id) || null, asignacionIdMap.get(m.asignacion_id) || null, m.tipo_entidad, m.referencia, m.accion, m.de_persona, m.a_persona, m.cantidad_cartones, m.detalles, m.realizado_por, m.created_at, documentoIdMap.get(m.documento_id) || null]
      );
    }

    if (job) updateJob(job, { step: 'Guardando cambios (COMMIT)...', current: processedItems, details: 'Aplicando transaccion...' });
    await client.query('COMMIT');

    const result = {
      event_id: newEventId,
      event_name: ev.name + ' (restaurado)',
      cards_restored: data.tables.cards?.length || 0,
      games_restored: data.tables.games?.length || 0,
    };
    if (job) updateJob(job, { status: 'completed', step: 'Completado', current: totalItems, details: `Evento restaurado: ${result.event_name}`, result });
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// =====================================================
// RESTAURAR BACKUP COMPLETO
// =====================================================

// Regex para validar nombres de columna seguros (solo alfanumérico y underscore)
const SAFE_COLUMN_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function validateColumnNames(columns: string[]): void {
  for (const col of columns) {
    if (!SAFE_COLUMN_NAME.test(col)) {
      throw new Error(`Nombre de columna inválido en backup: "${col}"`);
    }
  }
}

export async function restoreFullBackup(pool: Pool, data: any, job?: BackupProgress) {
  if (!data || typeof data !== 'object') {
    throw new Error('Datos de backup inválidos');
  }
  if (data.type !== 'full' || !data.tables || typeof data.tables !== 'object') {
    throw new Error('Formato de backup completo inválido');
  }

  // Validar que el backup contenga tablas esenciales antes de borrar
  const requiredTables = ['events', 'cards'];
  const missingTables = requiredTables.filter(t => !data.tables[t] || !Array.isArray(data.tables[t]) || data.tables[t].length === 0);
  if (missingTables.length > 0) {
    throw new Error(`Backup incompleto: faltan tablas esenciales (${missingTables.join(', ')}). Restauración cancelada.`);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Orden de limpieza (respetando FKs)
    const cleanOrder = [
      'inv_movimientos', 'inv_documentos', 'inv_asignacion_cartones', 'inv_asignaciones',
      'envio_items', 'envios', 'inventory_audit',
      'game_winners', 'game_reports', 'ball_history',
      'lotes', 'cajas', 'almacen_usuarios', 'almacenes', 'centros',
      'promo_prizes', 'promo_config', 'verification_logs',
      'cards', 'games', 'events',
    ];

    // Orden de inserción (respetando FKs)
    const insertOrder = [
      'events', 'cards', 'games', 'ball_history', 'game_winners', 'game_reports',
      'verification_logs', 'promo_config', 'promo_prizes',
      'centros', 'almacenes', 'almacen_usuarios', 'cajas', 'lotes',
      'inv_asignaciones', 'inv_asignacion_cartones', 'inv_documentos', 'inv_movimientos',
      'envios', 'envio_items', 'inventory_audit',
    ];

    if (job) updateJob(job, { step: 'Limpiando tablas...', total: cleanOrder.length + insertOrder.length, current: 0 });
    for (let i = 0; i < cleanOrder.length; i++) {
      const table = cleanOrder[i];
      if (job) updateJob(job, { step: `Limpiando ${table}...`, current: i + 1, details: `Tabla ${i + 1} de ${cleanOrder.length}` });
      await client.query(`DELETE FROM ${table}`);
    }

    let totalRows = 0;

    for (let i = 0; i < insertOrder.length; i++) {
      const table = insertOrder[i];
      const rows = data.tables[table];
      if (!rows || rows.length === 0) continue;

      if (job) updateJob(job, { step: `Insertando ${table} (${rows.length} registros)...`, current: cleanOrder.length + i + 1, details: `Tabla ${i + 1} de ${insertOrder.length}` });
      for (const row of rows) {
        const columns = Object.keys(row);
        validateColumnNames(columns);
        const values = columns.map((_, i) => `$${i + 1}`);
        await client.query(
          `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${values.join(', ')}) ON CONFLICT DO NOTHING`,
          columns.map(col => row[col])
        );
      }
      totalRows += rows.length;
    }

    // Resetear secuencias para que el auto-increment funcione correctamente
    for (const table of insertOrder) {
      const rows = data.tables[table];
      if (!rows || rows.length === 0) continue;
      try {
        await client.query(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 1))`);
      } catch {
        // Tabla sin secuencia serial, ignorar
      }
    }

    // Resetear secuencia settings si existe
    await client.query(`DELETE FROM settings`);
    if (data.tables.settings) {
      for (const s of data.tables.settings) {
        await client.query(
          `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, $3) ON CONFLICT (key) DO UPDATE SET value = $2`,
          [s.key, s.value, s.updated_at]
        );
      }
    }

    if (job) updateJob(job, { step: 'Guardando cambios (COMMIT)...', details: 'Aplicando transaccion...' });
    await client.query('COMMIT');
    const result = { total_rows_restored: totalRows };
    if (job) updateJob(job, { status: 'completed', step: 'Completado', details: `${totalRows} registros restaurados`, result });
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// =====================================================
// LISTAR EVENTOS PARA BACKUP
// =====================================================

export async function getEventsForBackup(pool: Pool) {
  const { rows } = await pool.query(
    `SELECT id, name, status, total_cards, cards_sold, created_at,
            (SELECT COUNT(*) FROM games WHERE event_id = events.id) as total_games
     FROM events ORDER BY created_at DESC`
  );
  return rows;
}

// =====================================================
// DUMP POSTGRESQL - BACKUP/RESTORE COMPLETO
// =====================================================

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://slacker@localhost:5432/bingo';

export function exportFullDump(job?: BackupProgress): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (job) updateJob(job, { step: 'Ejecutando pg_dump...', current: 0, total: 1, details: 'Generando dump PostgreSQL...' });

    const proc = spawn('pg_dump', [
      DATABASE_URL,
      '--no-owner',
      '--no-privileges',
      '--clean',
      '--if-exists',
    ]);

    const chunks: Buffer[] = [];
    proc.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));

    let stderr = '';
    proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      if (code === 0) {
        const result = Buffer.concat(chunks);
        if (job) updateJob(job, { status: 'completed', step: 'Dump completado', current: 1, total: 1, details: `${(result.length / 1024 / 1024).toFixed(2)} MB`, result: { size_mb: (result.length / 1024 / 1024).toFixed(2) } });
        resolve(result);
      } else {
        const errMsg = `pg_dump finalizo con codigo ${code}: ${stderr}`;
        if (job) updateJob(job, { status: 'error', error: errMsg });
        reject(new Error(errMsg));
      }
    });

    proc.on('error', (err) => {
      const errMsg = `No se pudo ejecutar pg_dump: ${err.message}. Verifique que PostgreSQL client tools esten instalados.`;
      if (job) updateJob(job, { status: 'error', error: errMsg });
      reject(new Error(errMsg));
    });
  });
}

export function restoreFullDump(sqlBuffer: Buffer, job?: BackupProgress): Promise<{ message: string }> {
  return new Promise((resolve, reject) => {
    if (job) updateJob(job, { step: 'Restaurando dump PostgreSQL...', current: 0, total: 1, details: `Procesando ${(sqlBuffer.length / 1024 / 1024).toFixed(2)} MB...` });

    const proc = spawn('psql', [DATABASE_URL, '-v', 'ON_ERROR_STOP=1']);

    let stderr = '';
    proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      if (code === 0) {
        const result = { message: 'Dump PostgreSQL restaurado exitosamente' };
        if (job) updateJob(job, { status: 'completed', step: 'Restauracion completada', current: 1, total: 1, details: 'Dump restaurado', result });
        resolve(result);
      } else {
        const errMsg = `psql finalizo con codigo ${code}: ${stderr.slice(0, 500)}`;
        if (job) updateJob(job, { status: 'error', error: errMsg });
        reject(new Error(errMsg));
      }
    });

    proc.on('error', (err) => {
      const errMsg = `No se pudo ejecutar psql: ${err.message}. Verifique que PostgreSQL client tools esten instalados.`;
      if (job) updateJob(job, { status: 'error', error: errMsg });
      reject(new Error(errMsg));
    });

    proc.stdin.write(sqlBuffer);
    proc.stdin.end();
  });
}

// =====================================================
// DUMP SQL POR EVENTO
// =====================================================

function pgEscape(val: unknown): string {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number' || typeof val === 'bigint') return String(val);
  if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
  if (val instanceof Date) return `'${val.toISOString()}'`;
  const str = String(val).replace(/'/g, "''");
  return `'${str}'`;
}

const BATCH_SIZE = 1000;

/** Escape value for COPY FROM stdin format (tab-separated) */
function copyEscape(val: unknown): string {
  if (val === null || val === undefined) return '\\N';
  if (typeof val === 'number' || typeof val === 'bigint') return String(val);
  if (typeof val === 'boolean') return val ? 't' : 'f';
  if (val instanceof Date) return val.toISOString();
  return String(val).replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

/**
 * Genera COPY FROM stdin para tablas grandes, INSERT para tablas pequeñas.
 * COPY es ~100x más rápido que INSERT para carga masiva.
 */
function generateTableData(tableName: string, rows: Record<string, unknown>[]): string {
  if (!rows || rows.length === 0) return `-- ${tableName}: 0 registros\n`;
  const columns = Object.keys(rows[0]);
  const colList = columns.join(', ');
  const lines: string[] = [`-- ${tableName}: ${rows.length} registros`];

  if (rows.length > 100) {
    // COPY FROM stdin — carga masiva ultra-rápida
    lines.push(`COPY ${tableName} (${colList}) FROM stdin;`);
    for (const row of rows) {
      lines.push(columns.map(col => copyEscape(row[col])).join('\t'));
    }
    lines.push('\\.');
  } else {
    // Multi-value INSERTs para tablas pequeñas
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const valueRows = batch.map(row => `(${columns.map(col => pgEscape(row[col])).join(', ')})`);
      lines.push(`INSERT INTO ${tableName} (${colList}) VALUES\n${valueRows.join(',\n')}\nON CONFLICT DO NOTHING;`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

export async function exportEventDump(pool: Pool, eventId: number, job?: BackupProgress): Promise<string> {
  if (job) updateJob(job, { step: 'Consultando datos del evento...', current: 0, total: 18 });

  const { rows: events } = await pool.query('SELECT * FROM events WHERE id = $1', [eventId]);
  if (events.length === 0) throw new Error('Evento no encontrado');
  const event = events[0];

  if (job) updateJob(job, { step: `Exportando datos de "${event.name}"`, current: 1, total: 18, details: 'Consultando tablas...' });

  const [
    cards, games, ballHistory, gameWinners, gameReports, verificationLogs,
    promoConfig, promoPrizes, promoFixedRules, almacenes, cajas, lotes,
    asignaciones, asignacionCartones, documentos, movimientos, centros,
  ] = await Promise.all([
    pool.query('SELECT * FROM cards WHERE event_id = $1', [eventId]),
    pool.query('SELECT * FROM games WHERE event_id = $1', [eventId]),
    pool.query('SELECT bh.* FROM ball_history bh JOIN games g ON bh.game_id = g.id WHERE g.event_id = $1', [eventId]),
    pool.query('SELECT gw.* FROM game_winners gw JOIN games g ON gw.game_id = g.id WHERE g.event_id = $1', [eventId]),
    pool.query('SELECT gr.* FROM game_reports gr JOIN games g ON gr.game_id = g.id WHERE g.event_id = $1', [eventId]),
    pool.query('SELECT * FROM verification_logs WHERE event_id = $1', [eventId]),
    pool.query('SELECT * FROM promo_config WHERE event_id = $1', [eventId]),
    pool.query('SELECT * FROM promo_prizes WHERE event_id = $1', [eventId]),
    pool.query('SELECT * FROM promo_fixed_rules WHERE event_id = $1', [eventId]),
    pool.query('SELECT * FROM almacenes WHERE event_id = $1', [eventId]),
    pool.query('SELECT * FROM cajas WHERE event_id = $1', [eventId]),
    pool.query('SELECT * FROM lotes WHERE event_id = $1', [eventId]),
    pool.query('SELECT * FROM inv_asignaciones WHERE event_id = $1', [eventId]),
    pool.query(`SELECT iac.* FROM inv_asignacion_cartones iac JOIN inv_asignaciones ia ON iac.asignacion_id = ia.id WHERE ia.event_id = $1`, [eventId]),
    pool.query('SELECT * FROM inv_documentos WHERE event_id = $1', [eventId]),
    pool.query('SELECT * FROM inv_movimientos WHERE event_id = $1', [eventId]),
    pool.query('SELECT * FROM centros WHERE event_id = $1', [eventId]),
  ]);

  if (job) updateJob(job, { step: 'Generando SQL...', current: 18, total: 18 });

  const parts: string[] = [];
  parts.push(`-- =========================================================`);
  parts.push(`-- Dump SQL del evento: ${event.name}`);
  parts.push(`-- Event ID: ${eventId}`);
  parts.push(`-- Generado: ${new Date().toISOString()}`);
  parts.push(`-- Total cartones: ${cards.rows.length}`);
  parts.push(`-- Total juegos: ${games.rows.length}`);
  parts.push(`-- =========================================================`);
  parts.push('');
  parts.push('BEGIN;');
  parts.push('');
  parts.push(generateTableData('events', [event]));
  parts.push(generateTableData('centros', centros.rows));
  parts.push(generateTableData('almacenes', almacenes.rows));
  parts.push(generateTableData('cajas', cajas.rows));
  parts.push(generateTableData('lotes', lotes.rows));
  parts.push(generateTableData('cards', cards.rows));
  parts.push(generateTableData('games', games.rows));
  parts.push(generateTableData('ball_history', ballHistory.rows));
  parts.push(generateTableData('game_winners', gameWinners.rows));
  parts.push(generateTableData('game_reports', gameReports.rows));
  parts.push(generateTableData('verification_logs', verificationLogs.rows));
  parts.push(generateTableData('promo_config', promoConfig.rows));
  parts.push(generateTableData('promo_prizes', promoPrizes.rows));
  parts.push(generateTableData('promo_fixed_rules', promoFixedRules.rows));
  parts.push(generateTableData('inv_asignaciones', asignaciones.rows));
  parts.push(generateTableData('inv_asignacion_cartones', asignacionCartones.rows));
  parts.push(generateTableData('inv_documentos', documentos.rows));
  parts.push(generateTableData('inv_movimientos', movimientos.rows));
  parts.push('');
  parts.push('COMMIT;');

  if (job) updateJob(job, { status: 'completed', step: 'Dump SQL generado', current: 18, total: 18 });

  return parts.join('\n');
}



export function restoreEventDump(pool: Pool, sql: string, job?: BackupProgress): Promise<Record<string, unknown>> {
  const eventNameMatch = sql.match(/-- Dump SQL del evento: (.+)/);
  const eventIdMatch = sql.match(/-- Event ID: (\d+)/);
  const cardsMatch = sql.match(/-- Total cartones: (\d+)/);
  const gamesMatch = sql.match(/-- Total juegos: (\d+)/);
  const hintName = eventNameMatch?.[1] || 'Evento SQL';
  const hintEventId = eventIdMatch ? parseInt(eventIdMatch[1], 10) : null;
  const sizeMB = (Buffer.byteLength(sql) / 1024 / 1024).toFixed(1);

  if (job) updateJob(job, { step: `Restaurando "${hintName}"...`, current: 0, total: 1, details: `Ejecutando ${sizeMB} MB via psql...` });

  const sqlBuffer = Buffer.from(sql, 'utf-8');

  return new Promise((resolve, reject) => {
    const proc = spawn('psql', [DATABASE_URL, '-v', 'ON_ERROR_STOP=1']);

    let stderr = '';
    proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

    proc.on('close', async (code) => {
      if (code !== 0) {
        const errMsg = `psql finalizo con codigo ${code}: ${stderr.slice(0, 500)}`;
        if (job) updateJob(job, { status: 'error', error: errMsg });
        return reject(new Error(errMsg));
      }

      // Verificar qué se restauró
      let event_name = hintName;
      let event_id = hintEventId;
      let cards_restored = parseInt(cardsMatch?.[1] || '0', 10);
      let games_restored = parseInt(gamesMatch?.[1] || '0', 10);

      try {
        if (hintEventId) {
          const { rows } = await pool.query('SELECT id, name FROM events WHERE id = $1', [hintEventId]);
          if (rows.length > 0) {
            event_name = rows[0].name;
            event_id = rows[0].id;
            const cc = await pool.query('SELECT COUNT(*)::int AS n FROM cards WHERE event_id = $1', [hintEventId]);
            cards_restored = cc.rows[0].n;
            const gc = await pool.query('SELECT COUNT(*)::int AS n FROM games WHERE event_id = $1', [hintEventId]);
            games_restored = gc.rows[0].n;
          }
        }
      } catch { /* usar hints del header */ }

      const result = { message: 'Evento restaurado desde dump SQL exitosamente', event_name, event_id, cards_restored, games_restored };
      if (job) updateJob(job, { status: 'completed', step: 'Restauracion completada', current: 1, total: 1, result });
      resolve(result);
    });

    proc.on('error', (err) => {
      const errMsg = `No se pudo ejecutar psql: ${err.message}`;
      if (job) updateJob(job, { status: 'error', error: errMsg });
      reject(new Error(errMsg));
    });

    proc.stdin.write(sqlBuffer);
    proc.stdin.end();
  });
}
