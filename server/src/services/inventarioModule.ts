import type { Pool } from 'pg';
import type {
  Almacen,
  AlmacenUsuario,
  InvAsignacion,
  InvAsignacionCarton,
  InvMovimiento,
  BingoCard,
} from '../types/index.js';
import { generateMovimientoPdf, generateDocumentoPdf, type DocumentoItemDetalle, type LoteDetalle } from './movimientoPdfService.js';

export interface FirmaData {
  firma_entrega?: string;
  firma_recibe?: string;
  nombre_entrega?: string;
  nombre_recibe?: string;
}

// =====================================================
// ALMACENES
// =====================================================

export async function createAlmacen(
  pool: Pool,
  eventId: number,
  data: { name: string; code?: string; parent_id?: number; address?: string; contact_name?: string; contact_phone?: string }
): Promise<Almacen> {
  const code = data.code || `ALM-${Date.now().toString(36).toUpperCase()}`;

  // Verify event exists
  const eventResult = await pool.query('SELECT id FROM events WHERE id = $1', [eventId]);
  if (eventResult.rows.length === 0) throw new Error('Evento no encontrado');

  // Verify parent exists if provided
  if (data.parent_id) {
    const parentResult = await pool.query('SELECT id FROM almacenes WHERE id = $1 AND event_id = $2', [data.parent_id, eventId]);
    if (parentResult.rows.length === 0) throw new Error('Almacen padre no encontrado');
  }

  const result = await pool.query(`
    INSERT INTO almacenes (event_id, parent_id, name, code, address, contact_name, contact_phone)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id
  `, [eventId, data.parent_id || null, data.name, code, data.address || null, data.contact_name || null, data.contact_phone || null]);

  const almacenResult = await pool.query('SELECT * FROM almacenes WHERE id = $1', [result.rows[0].id]);
  return almacenResult.rows[0] as Almacen;
}

export async function updateAlmacen(
  pool: Pool,
  id: number,
  data: { name?: string; parent_id?: number | null; address?: string; contact_name?: string; contact_phone?: string; is_active?: boolean; es_agencia_loteria?: boolean }
): Promise<Almacen> {
  const almacenResult = await pool.query('SELECT * FROM almacenes WHERE id = $1', [id]);
  const almacen = almacenResult.rows[0] as Almacen | undefined;
  if (!almacen) throw new Error('Almacen no encontrado');

  if (data.parent_id !== undefined && data.parent_id !== null) {
    if (data.parent_id === id) throw new Error('Un almacen no puede ser su propio padre');
    const parentResult = await pool.query('SELECT id, event_id FROM almacenes WHERE id = $1', [data.parent_id]);
    const parent = parentResult.rows[0] as { id: number; event_id: number } | undefined;
    if (!parent) throw new Error('Almacen padre no encontrado');
    if (parent.event_id !== almacen.event_id) throw new Error('El almacen padre debe pertenecer al mismo evento');
  }

  const fields: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (data.name !== undefined) { fields.push(`name = $${paramIndex++}`); values.push(data.name); }
  if (data.parent_id !== undefined) { fields.push(`parent_id = $${paramIndex++}`); values.push(data.parent_id); }
  if (data.address !== undefined) { fields.push(`address = $${paramIndex++}`); values.push(data.address); }
  if (data.contact_name !== undefined) { fields.push(`contact_name = $${paramIndex++}`); values.push(data.contact_name); }
  if (data.contact_phone !== undefined) { fields.push(`contact_phone = $${paramIndex++}`); values.push(data.contact_phone); }
  if (data.is_active !== undefined) { fields.push(`is_active = $${paramIndex++}`); values.push(data.is_active); }
  if (data.es_agencia_loteria !== undefined) { fields.push(`es_agencia_loteria = $${paramIndex++}`); values.push(data.es_agencia_loteria); }

  fields.push('updated_at = CURRENT_TIMESTAMP');
  values.push(id);

  await pool.query(`UPDATE almacenes SET ${fields.join(', ')} WHERE id = $${paramIndex}`, values);
  const updatedResult = await pool.query('SELECT * FROM almacenes WHERE id = $1', [id]);
  return updatedResult.rows[0] as Almacen;
}

export async function getAlmacen(pool: Pool, id: number): Promise<Almacen | undefined> {
  const result = await pool.query('SELECT * FROM almacenes WHERE id = $1', [id]);
  return result.rows[0] as Almacen | undefined;
}

export async function getAlmacenes(pool: Pool, eventId: number): Promise<Almacen[]> {
  const result = await pool.query('SELECT * FROM almacenes WHERE event_id = $1 ORDER BY name', [eventId]);
  return result.rows as Almacen[];
}

export async function getLoteriaDashboard(pool: Pool, eventId: number) {
  // Resumen SOLO de cartones asignados a agencias (no todos los del evento)
  const globalResult = await pool.query(`
    SELECT
      COUNT(*) AS total_cartones,
      COUNT(*) FILTER (WHERE c.is_sold = true) AS cartones_vendidos,
      COUNT(*) FILTER (WHERE c.is_sold = false) AS cartones_disponibles
    FROM cards c
    JOIN almacenes a ON c.almacen_id = a.id AND a.es_agencia_loteria = true
    WHERE c.event_id = $1
  `, [eventId]);
  const global = globalResult.rows[0];

  const cajasResult = await pool.query(`
    SELECT COUNT(*) AS total_cajas FROM cajas c
    JOIN almacenes a ON c.almacen_id = a.id AND a.es_agencia_loteria = true
    WHERE c.event_id = $1
  `, [eventId]);
  const lotesResult = await pool.query(`
    SELECT COUNT(*) AS total_lotes FROM lotes l
    JOIN almacenes a ON l.almacen_id = a.id AND a.es_agencia_loteria = true
    WHERE l.event_id = $1
  `, [eventId]);

  // Stats por agencia (solo almacenes marcados como agencia de lotería)
  const agenciasResult = await pool.query(`
    SELECT
      a.id, a.name, a.code,
      COALESCE(cajas_stock.total_cajas, 0) AS total_cajas,
      COALESCE(lotes_stock.total_lotes, 0) AS total_lotes,
      COALESCE(cards_stock.total_cartones, 0) AS total_cartones,
      COALESCE(sold.vendidos, 0) AS cartones_vendidos
    FROM almacenes a
    LEFT JOIN (
      SELECT almacen_id, COUNT(*) AS total_cajas
      FROM cajas WHERE event_id = $1 AND almacen_id IS NOT NULL
      GROUP BY almacen_id
    ) cajas_stock ON cajas_stock.almacen_id = a.id
    LEFT JOIN (
      SELECT almacen_id, COUNT(*) AS total_lotes
      FROM lotes WHERE event_id = $1 AND almacen_id IS NOT NULL
      GROUP BY almacen_id
    ) lotes_stock ON lotes_stock.almacen_id = a.id
    LEFT JOIN (
      SELECT almacen_id, COUNT(*) AS total_cartones
      FROM cards WHERE event_id = $1 AND almacen_id IS NOT NULL
      GROUP BY almacen_id
    ) cards_stock ON cards_stock.almacen_id = a.id
    LEFT JOIN (
      SELECT almacen_id, COUNT(*) AS vendidos
      FROM cards WHERE event_id = $1 AND is_sold = true AND almacen_id IS NOT NULL
      GROUP BY almacen_id
    ) sold ON sold.almacen_id = a.id
    WHERE a.event_id = $1 AND a.es_agencia_loteria = true AND a.is_active = true
    ORDER BY a.name
  `, [eventId]);

  // Ventas por día (últimos 30 días)
  const ventasPorDiaResult = await pool.query(`
    SELECT
      DATE(sold_at) AS fecha,
      COUNT(*) AS vendidos
    FROM cards
    WHERE event_id = $1 AND is_sold = true AND sold_at >= NOW() - INTERVAL '30 days'
    GROUP BY DATE(sold_at)
    ORDER BY fecha
  `, [eventId]);

  // Ventas por agencia por día (últimos 7 días, top agencias)
  const ventasAgenciaDiaResult = await pool.query(`
    SELECT
      a.name AS agencia,
      DATE(c.sold_at) AS fecha,
      COUNT(*) AS vendidos
    FROM cards c
    JOIN almacenes a ON a.id = c.almacen_id AND a.es_agencia_loteria = true
    WHERE c.event_id = $1 AND c.is_sold = true AND c.sold_at >= NOW() - INTERVAL '7 days'
    GROUP BY a.name, DATE(c.sold_at)
    ORDER BY fecha, a.name
  `, [eventId]);

  return {
    resumen: {
      total_cartones: parseInt(global.total_cartones),
      cartones_vendidos: parseInt(global.cartones_vendidos),
      cartones_disponibles: parseInt(global.cartones_disponibles),
      total_cajas: parseInt(cajasResult.rows[0].total_cajas),
      total_lotes: parseInt(lotesResult.rows[0].total_lotes),
      porcentaje_vendido: parseInt(global.total_cartones) > 0
        ? Math.round((parseInt(global.cartones_vendidos) / parseInt(global.total_cartones)) * 100)
        : 0,
    },
    agencias: agenciasResult.rows.map((a: any) => ({
      id: a.id,
      name: a.name,
      code: a.code,
      total_cajas: parseInt(a.total_cajas),
      total_lotes: parseInt(a.total_lotes),
      total_cartones: parseInt(a.total_cartones),
      cartones_vendidos: parseInt(a.cartones_vendidos),
      cartones_disponibles: parseInt(a.total_cartones) - parseInt(a.cartones_vendidos),
      porcentaje: parseInt(a.total_cartones) > 0
        ? Math.round((parseInt(a.cartones_vendidos) / parseInt(a.total_cartones)) * 100)
        : 0,
    })),
    ventas_por_dia: ventasPorDiaResult.rows.map((r: any) => ({
      fecha: r.fecha,
      vendidos: parseInt(r.vendidos),
    })),
    ventas_agencia_dia: ventasAgenciaDiaResult.rows.map((r: any) => ({
      agencia: r.agencia,
      fecha: r.fecha,
      vendidos: parseInt(r.vendidos),
    })),
  };
}

export async function getDashboardGeneral(pool: Pool, eventId: number) {
  // Resumen global de TODOS los cartones del evento
  const globalResult = await pool.query(`
    SELECT
      COUNT(*) AS total_cartones,
      COUNT(*) FILTER (WHERE c.is_sold = true) AS cartones_vendidos,
      COUNT(*) FILTER (WHERE c.is_sold = false) AS cartones_disponibles
    FROM cards c
    WHERE c.event_id = $1
  `, [eventId]);
  const global = globalResult.rows[0];

  const cajasResult = await pool.query(`
    SELECT COUNT(*) AS total_cajas FROM cajas WHERE event_id = $1
  `, [eventId]);
  const lotesResult = await pool.query(`
    SELECT COUNT(*) AS total_lotes FROM lotes WHERE event_id = $1
  `, [eventId]);

  // Stats por almacen (TODOS los almacenes activos)
  const almacenesResult = await pool.query(`
    SELECT
      a.id, a.name, a.code, a.es_agencia_loteria,
      COALESCE(cajas_stock.total_cajas, 0) AS total_cajas,
      COALESCE(lotes_stock.total_lotes, 0) AS total_lotes,
      COALESCE(cards_stock.total_cartones, 0) AS total_cartones,
      COALESCE(sold.vendidos, 0) AS cartones_vendidos
    FROM almacenes a
    LEFT JOIN (
      SELECT almacen_id, COUNT(*) AS total_cajas
      FROM cajas WHERE event_id = $1 AND almacen_id IS NOT NULL
      GROUP BY almacen_id
    ) cajas_stock ON cajas_stock.almacen_id = a.id
    LEFT JOIN (
      SELECT almacen_id, COUNT(*) AS total_lotes
      FROM lotes WHERE event_id = $1 AND almacen_id IS NOT NULL
      GROUP BY almacen_id
    ) lotes_stock ON lotes_stock.almacen_id = a.id
    LEFT JOIN (
      SELECT almacen_id, COUNT(*) AS total_cartones
      FROM cards WHERE event_id = $1 AND almacen_id IS NOT NULL
      GROUP BY almacen_id
    ) cards_stock ON cards_stock.almacen_id = a.id
    LEFT JOIN (
      SELECT almacen_id, COUNT(*) AS vendidos
      FROM cards WHERE event_id = $1 AND is_sold = true AND almacen_id IS NOT NULL
      GROUP BY almacen_id
    ) sold ON sold.almacen_id = a.id
    WHERE a.event_id = $1 AND a.is_active = true
    ORDER BY a.name
  `, [eventId]);

  // Ventas por día (últimos 30 días)
  const ventasPorDiaResult = await pool.query(`
    SELECT
      DATE(sold_at) AS fecha,
      COUNT(*) AS vendidos
    FROM cards
    WHERE event_id = $1 AND is_sold = true AND sold_at >= NOW() - INTERVAL '30 days'
    GROUP BY DATE(sold_at)
    ORDER BY fecha
  `, [eventId]);

  // Ventas por almacen por día (últimos 7 días)
  const ventasAlmacenDiaResult = await pool.query(`
    SELECT
      a.name AS almacen,
      DATE(c.sold_at) AS fecha,
      COUNT(*) AS vendidos
    FROM cards c
    JOIN almacenes a ON a.id = c.almacen_id
    WHERE c.event_id = $1 AND c.is_sold = true AND c.sold_at >= NOW() - INTERVAL '7 days'
    GROUP BY a.name, DATE(c.sold_at)
    ORDER BY fecha, a.name
  `, [eventId]);

  return {
    resumen: {
      total_cartones: parseInt(global.total_cartones),
      cartones_vendidos: parseInt(global.cartones_vendidos),
      cartones_disponibles: parseInt(global.cartones_disponibles),
      total_cajas: parseInt(cajasResult.rows[0].total_cajas),
      total_lotes: parseInt(lotesResult.rows[0].total_lotes),
      porcentaje_vendido: parseInt(global.total_cartones) > 0
        ? Math.round((parseInt(global.cartones_vendidos) / parseInt(global.total_cartones)) * 100)
        : 0,
    },
    almacenes: almacenesResult.rows.map((a: any) => ({
      id: a.id,
      name: a.name,
      code: a.code,
      es_agencia_loteria: a.es_agencia_loteria,
      total_cajas: parseInt(a.total_cajas),
      total_lotes: parseInt(a.total_lotes),
      total_cartones: parseInt(a.total_cartones),
      cartones_vendidos: parseInt(a.cartones_vendidos),
      cartones_disponibles: parseInt(a.total_cartones) - parseInt(a.cartones_vendidos),
      porcentaje: parseInt(a.total_cartones) > 0
        ? Math.round((parseInt(a.cartones_vendidos) / parseInt(a.total_cartones)) * 100)
        : 0,
    })),
    ventas_por_dia: ventasPorDiaResult.rows.map((r: any) => ({
      fecha: r.fecha,
      vendidos: parseInt(r.vendidos),
    })),
    ventas_almacen_dia: ventasAlmacenDiaResult.rows.map((r: any) => ({
      almacen: r.almacen,
      fecha: r.fecha,
      vendidos: parseInt(r.vendidos),
    })),
  };
}

export async function getAlmacenTree(pool: Pool, eventId: number): Promise<Almacen[]> {
  const result = await pool.query(`
    SELECT a.*,
      COALESCE(cajas_stock.total_cajas, 0) AS inv_cajas,
      COALESCE(lotes_stock.total_lotes, 0) AS inv_libretas,
      COALESCE(cards_stock.total_cartones, 0) AS inv_cartones,
      COALESCE(sold.vendidos, 0) AS inv_vendidos
    FROM almacenes a
    LEFT JOIN (
      SELECT almacen_id, COUNT(*) AS total_cajas
      FROM cajas WHERE event_id = $1 AND almacen_id IS NOT NULL
      GROUP BY almacen_id
    ) cajas_stock ON cajas_stock.almacen_id = a.id
    LEFT JOIN (
      SELECT almacen_id, COUNT(*) AS total_lotes
      FROM lotes WHERE event_id = $1 AND almacen_id IS NOT NULL
      GROUP BY almacen_id
    ) lotes_stock ON lotes_stock.almacen_id = a.id
    LEFT JOIN (
      SELECT almacen_id, COUNT(*) AS total_cartones
      FROM cards WHERE event_id = $1 AND almacen_id IS NOT NULL
      GROUP BY almacen_id
    ) cards_stock ON cards_stock.almacen_id = a.id
    LEFT JOIN (
      SELECT almacen_id, COUNT(*) AS vendidos
      FROM cards WHERE event_id = $1 AND is_sold = true AND almacen_id IS NOT NULL
      GROUP BY almacen_id
    ) sold ON sold.almacen_id = a.id
    WHERE a.event_id = $1
    ORDER BY a.name
  `, [eventId]);
  const all = result.rows as (Almacen & { children?: Almacen[]; inv_cajas: number; inv_libretas: number; inv_cartones: number; inv_vendidos: number })[];

  const map = new Map<number, typeof all[0]>();
  const roots: typeof all = [];

  for (const a of all) {
    a.children = [];
    map.set(a.id, a);
  }

  for (const a of all) {
    if (a.parent_id && map.has(a.parent_id)) {
      map.get(a.parent_id)!.children!.push(a);
    } else {
      roots.push(a);
    }
  }

  return roots;
}

// =====================================================
// ALMACEN USUARIOS
// =====================================================

export async function addUsuarioToAlmacen(
  pool: Pool,
  almacenId: number,
  userId: number,
  rol: string = 'operador'
): Promise<AlmacenUsuario> {
  const almacenResult = await pool.query('SELECT id FROM almacenes WHERE id = $1', [almacenId]);
  if (almacenResult.rows.length === 0) throw new Error('Almacen no encontrado');

  const userResult = await pool.query('SELECT id FROM users WHERE id = $1', [userId]);
  if (userResult.rows.length === 0) throw new Error('Usuario no encontrado');

  // Check if already assigned
  const existingResult = await pool.query('SELECT id FROM almacen_usuarios WHERE almacen_id = $1 AND user_id = $2', [almacenId, userId]);
  if (existingResult.rows.length > 0) {
    await pool.query('UPDATE almacen_usuarios SET rol = $1, is_active = TRUE WHERE almacen_id = $2 AND user_id = $3', [rol, almacenId, userId]);
  } else {
    await pool.query('INSERT INTO almacen_usuarios (almacen_id, user_id, rol) VALUES ($1, $2, $3)', [almacenId, userId, rol]);
  }

  const result = await pool.query(`
    SELECT au.*, u.full_name, u.username
    FROM almacen_usuarios au
    JOIN users u ON u.id = au.user_id
    WHERE au.almacen_id = $1 AND au.user_id = $2
  `, [almacenId, userId]);
  return result.rows[0] as AlmacenUsuario & { full_name: string; username: string };
}

export async function removeUsuarioFromAlmacen(pool: Pool, almacenId: number, userId: number): Promise<void> {
  await pool.query('UPDATE almacen_usuarios SET is_active = FALSE WHERE almacen_id = $1 AND user_id = $2', [almacenId, userId]);
}

export async function getAlmacenUsuarios(pool: Pool, almacenId: number): Promise<(AlmacenUsuario & { full_name: string; username: string })[]> {
  const result = await pool.query(`
    SELECT au.*, u.full_name, u.username
    FROM almacen_usuarios au
    JOIN users u ON u.id = au.user_id
    WHERE au.almacen_id = $1 AND au.is_active = TRUE
    ORDER BY u.full_name
  `, [almacenId]);
  return result.rows as (AlmacenUsuario & { full_name: string; username: string })[];
}

export async function getMisAlmacenes(pool: Pool, userId: number): Promise<{
  almacen_id: number; almacen_name: string; almacen_code: string; event_id: number;
  event_name: string; rol: string;
}[]> {
  const result = await pool.query(`
    SELECT au.almacen_id, a.name AS almacen_name, a.code AS almacen_code,
           a.event_id, e.name AS event_name, au.rol
    FROM almacen_usuarios au
    JOIN almacenes a ON a.id = au.almacen_id
    JOIN events e ON e.id = a.event_id
    WHERE au.user_id = $1 AND au.is_active = TRUE AND a.is_active = TRUE
    ORDER BY e.name, a.name
  `, [userId]);
  return result.rows;
}

export async function getInventarioUsuarios(pool: Pool, eventId: number): Promise<{
  id: number; almacen_id: number; user_id: number; rol: string; is_active: boolean; created_at: string;
  full_name: string; username: string; almacen_name: string; almacen_code: string;
}[]> {
  const result = await pool.query(`
    SELECT au.*, u.full_name, u.username, a.name AS almacen_name, a.code AS almacen_code
    FROM almacen_usuarios au
    JOIN users u ON u.id = au.user_id
    JOIN almacenes a ON a.id = au.almacen_id
    WHERE a.event_id = $1 AND au.is_active = TRUE
    ORDER BY a.name, u.full_name
  `, [eventId]);
  return result.rows;
}

// =====================================================
// RESUMEN DE INVENTARIO
// =====================================================

export async function getResumenInventario(pool: Pool, eventId: number, almacenId?: number): Promise<{
  totalCartones: number;
  totalLibretas: number;
  totalCajas: number;
  cartonesAsignados: number;
  cartonesDisponibles: number;
  cajasSinAlmacen: number;
}> {
  if (almacenId) {
    // Per-almacen: count cajas/lotes/cards que estan en este almacen
    const cajasRow = (await pool.query('SELECT COUNT(*) as total FROM cajas WHERE event_id = $1 AND almacen_id = $2', [eventId, almacenId])).rows[0];
    const lotesRow = (await pool.query('SELECT COUNT(*) as total FROM lotes WHERE event_id = $1 AND almacen_id = $2', [eventId, almacenId])).rows[0];
    const cartonesRow = (await pool.query(
      'SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE is_sold = true) as vendidos FROM cards WHERE event_id = $1 AND almacen_id = $2',
      [eventId, almacenId]
    )).rows[0];

    const totalCartones = Number(cartonesRow.total);
    const vendidos = Number(cartonesRow.vendidos);
    const sinAlmacenRow = (await pool.query('SELECT COUNT(*) as total FROM cajas WHERE event_id = $1 AND almacen_id IS NULL', [eventId])).rows[0];
    return {
      totalCartones,
      totalLibretas: Number(lotesRow.total),
      totalCajas: Number(cajasRow.total),
      cartonesAsignados: vendidos,
      cartonesDisponibles: totalCartones - vendidos,
      cajasSinAlmacen: Number(sinAlmacenRow.total),
    };
  }

  // Global: all event inventory
  const totalRow = (await pool.query(
    'SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE is_sold = true) as vendidos FROM cards WHERE event_id = $1',
    [eventId]
  )).rows[0];
  const lotesRow = (await pool.query('SELECT COUNT(*) as total FROM lotes WHERE event_id = $1', [eventId])).rows[0];
  const cajasRow = (await pool.query('SELECT COUNT(*) as total FROM cajas WHERE event_id = $1', [eventId])).rows[0];
  const sinAlmacenRow = (await pool.query('SELECT COUNT(*) as total FROM cajas WHERE event_id = $1 AND almacen_id IS NULL', [eventId])).rows[0];

  const totalCartones = Number(totalRow.total);
  const vendidos = Number(totalRow.vendidos);
  return {
    totalCartones,
    totalLibretas: Number(lotesRow.total),
    totalCajas: Number(cajasRow.total),
    cartonesAsignados: vendidos,
    cartonesDisponibles: totalCartones - vendidos,
    cajasSinAlmacen: Number(sinAlmacenRow.total),
  };
}

// =====================================================
// CARGAR INVENTARIO A ALMACEN
// =====================================================

export async function getCajasDisponibles(pool: Pool, eventId: number): Promise<{
  id: number; caja_code: string; total_lotes: number; total_cartones: number; almacen_id: number | null; almacen_name: string | null;
}[]> {
  const result = await pool.query(`
    SELECT c.id, c.caja_code, c.total_lotes, c.almacen_id,
      COALESCE((SELECT SUM(l.total_cards) FROM lotes l WHERE l.caja_id = c.id), 0) AS total_cartones,
      a.name AS almacen_name
    FROM cajas c
    LEFT JOIN almacenes a ON a.id = c.almacen_id
    WHERE c.event_id = $1
    ORDER BY c.caja_code
  `, [eventId]);
  return result.rows.map(r => ({
    ...r,
    total_cartones: Number(r.total_cartones),
  }));
}

export async function cargarInventarioPorReferencia(
  pool: Pool, eventId: number, almacenId: number, tipoEntidad: string, referencia: string, userId: number,
  firmas?: FirmaData
): Promise<{ tipo: string; referencia: string; cartones: number; movimientoId: number }> {
  const almResult = await pool.query('SELECT id, name FROM almacenes WHERE id = $1 AND event_id = $2', [almacenId, eventId]);
  if (almResult.rows.length === 0) throw new Error('Almacen no encontrado para este evento');

  let cartones = 0;
  let origenAlmacenName: string | null = null;

  if (tipoEntidad === 'caja') {
    const cajaResult = await pool.query(
      'SELECT id, caja_code, almacen_id, status FROM cajas WHERE caja_code = $1 AND event_id = $2',
      [referencia, eventId]
    );
    if (cajaResult.rows.length === 0) throw new Error(`Caja "${referencia}" no encontrada`);
    const caja = cajaResult.rows[0];
    if (caja.status === 'agotada') throw new Error(`Caja "${referencia}" ya esta agotada/vendida`);
    // Obtener nombre del almacen origen
    if (caja.almacen_id) {
      const origenResult = await pool.query('SELECT name FROM almacenes WHERE id = $1', [caja.almacen_id]);
      origenAlmacenName = origenResult.rows[0]?.name || null;
    }
    const soldCheck = await pool.query(
      `SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE c.is_sold = true) as vendidos
       FROM cards c JOIN lotes l ON l.id = c.lote_id WHERE l.caja_id = $1`,
      [caja.id]
    );
    const { total, vendidos } = soldCheck.rows[0];
    if (Number(total) > 0 && Number(vendidos) === Number(total)) {
      throw new Error(`Caja "${referencia}" tiene todos los cartones vendidos`);
    }
    // Mover caja + solo lotes/cartones que están en el mismo almacén que la caja
    const cajaOrigenAlmacen = caja.almacen_id;
    await pool.query('UPDATE cajas SET almacen_id = $1, updated_at = NOW() WHERE id = $2', [almacenId, caja.id]);
    await pool.query('UPDATE lotes SET almacen_id = $1, updated_at = NOW() WHERE caja_id = $2 AND almacen_id = $3', [almacenId, caja.id, cajaOrigenAlmacen]);
    await pool.query(`
      UPDATE cards SET almacen_id = $1
      FROM lotes l WHERE l.id = cards.lote_id AND l.caja_id = $2 AND cards.is_sold = false AND cards.almacen_id = $3
    `, [almacenId, caja.id, cajaOrigenAlmacen]);
    cartones = Number(total) - Number(vendidos);
  } else if (tipoEntidad === 'libreta') {
    const loteResult = await pool.query(
      'SELECT l.id, l.lote_code, l.caja_id, l.total_cards, l.status, l.almacen_id FROM lotes l WHERE l.lote_code = $1 AND l.event_id = $2',
      [referencia, eventId]
    );
    if (loteResult.rows.length === 0) throw new Error(`Libreta "${referencia}" no encontrada`);
    const lote = loteResult.rows[0];
    if (lote.status === 'vendido_completo') throw new Error(`Libreta "${referencia}" ya esta completamente vendida`);
    // Obtener nombre del almacen origen
    if (lote.almacen_id) {
      const origenResult = await pool.query('SELECT name FROM almacenes WHERE id = $1', [lote.almacen_id]);
      origenAlmacenName = origenResult.rows[0]?.name || null;
    }
    const soldCheck = await pool.query(
      `SELECT COUNT(*) FILTER (WHERE is_sold = true) as vendidos, COUNT(*) as total
       FROM cards WHERE lote_id = $1`,
      [lote.id]
    );
    if (Number(soldCheck.rows[0].total) > 0 && Number(soldCheck.rows[0].vendidos) === Number(soldCheck.rows[0].total)) {
      throw new Error(`Libreta "${referencia}" tiene todos los cartones vendidos`);
    }
    // Mover libreta + todos sus cartones (no vendidos)
    await pool.query('UPDATE lotes SET almacen_id = $1, updated_at = NOW() WHERE id = $2', [almacenId, lote.id]);
    await pool.query('UPDATE cards SET almacen_id = $1 WHERE lote_id = $2 AND is_sold = false', [almacenId, lote.id]);
    cartones = Number(soldCheck.rows[0].total) - Number(soldCheck.rows[0].vendidos);
  } else if (tipoEntidad === 'carton') {
    const cardResult = await pool.query(
      'SELECT c.id, c.card_code, c.lote_id, c.is_sold, c.almacen_id FROM cards c WHERE c.card_code = $1 AND c.event_id = $2',
      [referencia, eventId]
    );
    if (cardResult.rows.length === 0) throw new Error(`Carton "${referencia}" no encontrado`);
    const card = cardResult.rows[0];
    if (card.is_sold) throw new Error(`Carton "${referencia}" ya fue vendido`);
    // Obtener nombre del almacen origen
    if (card.almacen_id) {
      const origenResult = await pool.query('SELECT name FROM almacenes WHERE id = $1', [card.almacen_id]);
      origenAlmacenName = origenResult.rows[0]?.name || null;
    }
    // Mover solo este carton
    await pool.query('UPDATE cards SET almacen_id = $1 WHERE id = $2', [almacenId, card.id]);
    cartones = 1;
  } else {
    throw new Error('Tipo de entidad invalido');
  }

  const accion = origenAlmacenName ? 'traslado' : 'carga_inventario';
  const destinoName = almResult.rows[0].name;

  const movResult = await pool.query(`
    INSERT INTO inv_movimientos (event_id, almacen_id, tipo_entidad, referencia, accion, de_persona, a_persona, cantidad_cartones, detalles, realizado_por,
      firma_entrega, firma_recibe, nombre_entrega, nombre_recibe)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    RETURNING id, created_at
  `, [
    eventId, almacenId, tipoEntidad, referencia, accion, origenAlmacenName, destinoName, cartones,
    JSON.stringify({ tipo: tipoEntidad }), userId,
    firmas?.firma_entrega || null, firmas?.firma_recibe || null,
    firmas?.nombre_entrega || null, firmas?.nombre_recibe || null,
  ]);

  // Siempre generar PDF para movimientos
  const mov = movResult.rows[0];
  const eventResult = await pool.query('SELECT name FROM events WHERE id = $1', [eventId]);
  const userResult = await pool.query('SELECT full_name FROM users WHERE id = $1', [userId]);

  // Obtener cartones para detalle
  let cartonesDetail: { card_code: string; serial: string }[] = [];
  if (tipoEntidad === 'caja') {
    const res = await pool.query(`
      SELECT c.card_code, c.serial FROM cards c
      JOIN lotes l ON l.id = c.lote_id
      JOIN cajas ca ON ca.id = l.caja_id
      WHERE ca.caja_code = $1 AND ca.event_id = $2
      ORDER BY c.card_number
    `, [referencia, eventId]);
    cartonesDetail = res.rows;
  } else if (tipoEntidad === 'libreta') {
    const res = await pool.query(`
      SELECT c.card_code, c.serial FROM cards c
      JOIN lotes l ON l.id = c.lote_id
      WHERE l.lote_code = $1 AND l.event_id = $2
      ORDER BY c.card_number
    `, [referencia, eventId]);
    cartonesDetail = res.rows;
  }

  try {
    const pdfPath = await generateMovimientoPdf({
      movimientoId: mov.id,
      accion,
      fecha: mov.created_at,
      eventoNombre: eventResult.rows[0]?.name || '',
      almacenNombre: destinoName,
      referencia,
      tipoEntidad,
      cantidadCartones: cartones,
      personaNombre: destinoName,
      asignadoPor: userResult.rows[0]?.full_name || 'Sistema',
      cartones: cartonesDetail,
      firmaEntrega: firmas?.firma_entrega,
      firmaRecibe: firmas?.firma_recibe,
      nombreEntrega: firmas?.nombre_entrega || origenAlmacenName || 'Origen',
      nombreRecibe: firmas?.nombre_recibe || destinoName,
    });
    const pdfFilename = pdfPath.split('/').pop();
    await pool.query('UPDATE inv_movimientos SET pdf_path = $1 WHERE id = $2', [pdfFilename, mov.id]);
  } catch (err) {
    console.error('Error generando PDF de movimiento:', err);
  }

  return { tipo: tipoEntidad, referencia, cartones, movimientoId: mov.id };
}

// Ejecutar movimiento bulk: crea documento + mueve items + genera PDF
export async function ejecutarMovimientoBulk(
  pool: Pool,
  eventId: number,
  data: {
    accion: 'traslado' | 'carga_inventario' | 'consignacion' | 'devolucion';
    almacen_destino_id: number;
    almacen_origen_id?: number;
    items: { tipo: string; referencia: string }[];
    firmas?: FirmaData;
  },
  userId: number
): Promise<{ documentoId: number; exitosos: number; errores: string[] }> {
  const destinoResult = await pool.query('SELECT id, name FROM almacenes WHERE id = $1 AND event_id = $2', [data.almacen_destino_id, eventId]);
  if (destinoResult.rows.length === 0) throw new Error('Almacen destino no encontrado');
  const destinoName = destinoResult.rows[0].name;

  let origenName: string | null = null;
  if (data.almacen_origen_id) {
    const origenResult = await pool.query('SELECT name FROM almacenes WHERE id = $1', [data.almacen_origen_id]);
    origenName = origenResult.rows[0]?.name || null;
  }

  // Validar que hay items antes de crear documento
  if (!data.items || data.items.length === 0) {
    return { documentoId: 0, exitosos: 0, errores: ['No se enviaron items para procesar'] };
  }

  // Envolver todo en transacción para atomicidad
  const client = await pool.connect();
  // Usar 'db' como alias — apunta a client (transaccional) para queries dentro de la tx
  const db = client;
  try {
  await db.query('BEGIN');

  // Crear documento
  const docResult = await db.query(`
    INSERT INTO inv_documentos (event_id, accion, de_almacen_id, a_almacen_id, de_nombre, a_nombre,
      firma_entrega, firma_recibe, nombre_entrega, nombre_recibe, realizado_por)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING id, created_at
  `, [
    eventId, data.accion, data.almacen_origen_id || null, data.almacen_destino_id,
    origenName, destinoName,
    data.firmas?.firma_entrega || null, data.firmas?.firma_recibe || null,
    data.firmas?.nombre_entrega || origenName || 'Origen', data.firmas?.nombre_recibe || destinoName,
    userId,
  ]);
  const documentoId = docResult.rows[0].id;
  const docCreatedAt = docResult.rows[0].created_at;

  let exitosos = 0;
  let totalCartones = 0;
  const errores: string[] = [];
  const itemsExitosos: { tipo: string; referencia: string; cartones: number }[] = [];

  for (const item of data.items) {
    try {
      // Reutilizar lógica de mover individual (sin generar PDF individual)
      const _almResult = destinoResult;
      let cartones = 0;
      let itemOrigenName: string | null = null;

      const isDevolucion = data.accion === 'devolucion';

      if (item.tipo === 'caja') {
        const cajaResult = await db.query('SELECT id, caja_code, almacen_id, status FROM cajas WHERE caja_code = $1 AND event_id = $2', [item.referencia, eventId]);
        if (cajaResult.rows.length === 0) throw new Error(`Caja "${item.referencia}" no encontrada`);
        const caja = cajaResult.rows[0];
        // Verificar que la caja esté en el almacén origen
        if (data.almacen_origen_id && caja.almacen_id !== data.almacen_origen_id) {
          throw new Error(`Caja "${item.referencia}" no esta en el almacen origen`);
        }
        // Verificar que no se mueva al mismo almacén
        if (caja.almacen_id === data.almacen_destino_id) {
          throw new Error(`Caja "${item.referencia}" ya esta en el almacen destino`);
        }
        if (!isDevolucion && caja.status === 'agotada') throw new Error(`Caja "${item.referencia}" ya esta agotada`);
        if (caja.almacen_id) {
          const r = await db.query('SELECT name FROM almacenes WHERE id = $1', [caja.almacen_id]);
          itemOrigenName = r.rows[0]?.name || null;
        }
        const soldCheck = await db.query(`SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE c.is_sold = true) as vendidos FROM cards c JOIN lotes l ON l.id = c.lote_id WHERE l.caja_id = $1`, [caja.id]);
        const { total, vendidos } = soldCheck.rows[0];
        if (!isDevolucion && Number(total) > 0 && Number(vendidos) === Number(total)) throw new Error(`Caja "${item.referencia}" tiene todos los cartones vendidos`);

        const cajaOrigenAlmacen = caja.almacen_id;
        await db.query('UPDATE cajas SET almacen_id = $1, status = $2, updated_at = NOW() WHERE id = $3',
          [data.almacen_destino_id, isDevolucion ? 'abierta' : caja.status, caja.id]);
        // Solo mover lotes que están en el mismo almacén que la caja (no los movidos individualmente)
        await db.query('UPDATE lotes SET almacen_id = $1, updated_at = NOW() WHERE caja_id = $2 AND almacen_id = $3', [data.almacen_destino_id, caja.id, cajaOrigenAlmacen]);

        if (isDevolucion) {
          await db.query(`UPDATE cards SET almacen_id = $1, is_sold = false, buyer_name = NULL, buyer_phone = NULL, buyer_cedula = NULL, buyer_libreta = NULL, sold_by = NULL FROM lotes l WHERE l.id = cards.lote_id AND l.caja_id = $2 AND cards.almacen_id = $3`, [data.almacen_destino_id, caja.id, cajaOrigenAlmacen]);
          await db.query(`UPDATE lotes SET status = 'disponible', cards_sold = 0 WHERE caja_id = $1 AND almacen_id = $2`, [caja.id, data.almacen_destino_id]);
          cartones = Number(total);
        } else {
          // Solo mover cards que están en el almacén origen de la caja
          await db.query(`UPDATE cards SET almacen_id = $1 FROM lotes l WHERE l.id = cards.lote_id AND l.caja_id = $2 AND cards.is_sold = false AND cards.almacen_id = $3`, [data.almacen_destino_id, caja.id, cajaOrigenAlmacen]);
          cartones = Number(total) - Number(vendidos);
        }
      } else if (item.tipo === 'libreta') {
        const loteResult = await db.query('SELECT l.id, l.lote_code, l.almacen_id, l.status FROM lotes l WHERE l.lote_code = $1 AND l.event_id = $2', [item.referencia, eventId]);
        if (loteResult.rows.length === 0) throw new Error(`Libreta "${item.referencia}" no encontrada`);
        const lote = loteResult.rows[0];
        // Verificar que la libreta esté en el almacén origen
        if (data.almacen_origen_id && lote.almacen_id !== data.almacen_origen_id) {
          throw new Error(`Libreta "${item.referencia}" no esta en el almacen origen`);
        }
        // Verificar que no se mueva al mismo almacén
        if (lote.almacen_id === data.almacen_destino_id) {
          throw new Error(`Libreta "${item.referencia}" ya esta en el almacen destino`);
        }
        if (!isDevolucion && lote.status === 'vendido_completo') throw new Error(`Libreta "${item.referencia}" ya vendida`);
        if (lote.almacen_id) {
          const r = await db.query('SELECT name FROM almacenes WHERE id = $1', [lote.almacen_id]);
          itemOrigenName = r.rows[0]?.name || null;
        }
        const soldCheck = await db.query(`SELECT COUNT(*) FILTER (WHERE is_sold = true) as vendidos, COUNT(*) as total FROM cards WHERE lote_id = $1`, [lote.id]);
        if (!isDevolucion && Number(soldCheck.rows[0].total) > 0 && Number(soldCheck.rows[0].vendidos) === Number(soldCheck.rows[0].total)) throw new Error(`Libreta "${item.referencia}" toda vendida`);

        await db.query('UPDATE lotes SET almacen_id = $1, updated_at = NOW() WHERE id = $2', [data.almacen_destino_id, lote.id]);

        if (isDevolucion) {
          await db.query('UPDATE cards SET almacen_id = $1, is_sold = false, buyer_name = NULL, buyer_phone = NULL, buyer_cedula = NULL, buyer_libreta = NULL, sold_by = NULL WHERE lote_id = $2', [data.almacen_destino_id, lote.id]);
          await db.query(`UPDATE lotes SET status = 'disponible', cards_sold = 0 WHERE id = $1`, [lote.id]);
          cartones = Number(soldCheck.rows[0].total);
        } else {
          await db.query('UPDATE cards SET almacen_id = $1 WHERE lote_id = $2 AND is_sold = false', [data.almacen_destino_id, lote.id]);
          cartones = Number(soldCheck.rows[0].total) - Number(soldCheck.rows[0].vendidos);
        }
      } else if (item.tipo === 'carton') {
        const cardResult = await db.query('SELECT c.id, c.card_code, c.is_sold, c.almacen_id FROM cards c WHERE c.card_code = $1 AND c.event_id = $2', [item.referencia, eventId]);
        if (cardResult.rows.length === 0) throw new Error(`Carton "${item.referencia}" no encontrado`);
        const card = cardResult.rows[0];
        // Verificar que el cartón esté en el almacén origen
        if (data.almacen_origen_id && card.almacen_id !== data.almacen_origen_id) {
          throw new Error(`Carton "${item.referencia}" no esta en el almacen origen`);
        }
        // Verificar que no se mueva al mismo almacén
        if (card.almacen_id === data.almacen_destino_id) {
          throw new Error(`Carton "${item.referencia}" ya esta en el almacen destino`);
        }
        if (!isDevolucion && card.is_sold) throw new Error(`Carton "${item.referencia}" ya vendido`);
        if (card.almacen_id) {
          const r = await db.query('SELECT name FROM almacenes WHERE id = $1', [card.almacen_id]);
          itemOrigenName = r.rows[0]?.name || null;
        }
        if (isDevolucion) {
          await db.query('UPDATE cards SET almacen_id = $1, is_sold = false, buyer_name = NULL, buyer_phone = NULL, buyer_cedula = NULL, buyer_libreta = NULL, sold_by = NULL WHERE id = $2', [data.almacen_destino_id, card.id]);
        } else {
          await db.query('UPDATE cards SET almacen_id = $1 WHERE id = $2', [data.almacen_destino_id, card.id]);
        }
        cartones = 1;
      } else {
        throw new Error('Tipo de entidad invalido');
      }

      // Crear movimiento individual vinculado al documento
      await db.query(`
        INSERT INTO inv_movimientos (event_id, documento_id, almacen_id, tipo_entidad, referencia, accion, de_persona, a_persona, cantidad_cartones, detalles, realizado_por)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `, [
        eventId, documentoId, data.almacen_destino_id, item.tipo, item.referencia,
        itemOrigenName ? 'traslado' : 'carga_inventario',
        itemOrigenName || origenName, destinoName, cartones,
        JSON.stringify({ tipo: item.tipo }), userId,
      ]);

      exitosos++;
      totalCartones += cartones;
      itemsExitosos.push({ tipo: item.tipo, referencia: item.referencia, cartones });
    } catch (err) {
      errores.push(`${item.referencia}: ${(err as Error).message}`);
    }
  }

  // Si no hubo items exitosos, rollback
  if (exitosos === 0) {
    await client.query('ROLLBACK');
    return { documentoId: 0, exitosos: 0, errores };
  }

  // Actualizar totales del documento
  await client.query('UPDATE inv_documentos SET total_items = $1, total_cartones = $2 WHERE id = $3', [exitosos, totalCartones, documentoId]);

  // COMMIT la transacción antes de generar PDF (PDF es no-transaccional)
  await client.query('COMMIT');

  // Generar PDF del documento con detalle jerarquico completo
  if (exitosos > 0) {
    const eventResult = await pool.query('SELECT name FROM events WHERE id = $1', [eventId]);
    const userResult = await pool.query('SELECT full_name FROM users WHERE id = $1', [userId]);

    // Construir detalle jerarquico por item
    const pdfItems: DocumentoItemDetalle[] = [];
    for (const item of itemsExitosos) {
      const detalle: DocumentoItemDetalle = {
        tipo: item.tipo,
        referencia: item.referencia,
        cartones: item.cartones,
      };

      if (item.tipo === 'caja') {
        // Lotes de la caja con rangos de seriales
        const lotesRes = await pool.query(
          `SELECT l.lote_code, l.total_cards, l.cards_sold, MIN(c.serial) as serial_desde, MAX(c.serial) as serial_hasta
           FROM lotes l LEFT JOIN cards c ON c.lote_id = l.id
           WHERE l.caja_id = (SELECT id FROM cajas WHERE caja_code = $1 AND event_id = $2)
           GROUP BY l.id, l.lote_code, l.total_cards, l.cards_sold
           ORDER BY l.lote_code`,
          [item.referencia, eventId]
        );
        detalle.lotes = lotesRes.rows;
        // Rango general de la caja
        const cajaRange = await pool.query(
          `SELECT MIN(c.serial) as serial_desde, MAX(c.serial) as serial_hasta
           FROM cards c JOIN lotes l ON c.lote_id = l.id
           JOIN cajas ca ON ca.id = l.caja_id
           WHERE ca.caja_code = $1 AND ca.event_id = $2`,
          [item.referencia, eventId]
        );
        if (cajaRange.rows[0]) {
          detalle.serial_desde = cajaRange.rows[0].serial_desde;
          detalle.serial_hasta = cajaRange.rows[0].serial_hasta;
        }
      } else if (item.tipo === 'libreta') {
        // Rango de seriales de la libreta
        const loteRange = await pool.query(
          `SELECT l.total_cards, l.cards_sold, MIN(c.serial) as serial_desde, MAX(c.serial) as serial_hasta
           FROM lotes l LEFT JOIN cards c ON c.lote_id = l.id
           WHERE l.lote_code = $1 AND l.event_id = $2
           GROUP BY l.id, l.total_cards, l.cards_sold`,
          [item.referencia, eventId]
        );
        const lr = loteRange.rows[0];
        if (lr) {
          detalle.serial_desde = lr.serial_desde;
          detalle.serial_hasta = lr.serial_hasta;
          detalle.cartonesDetalle = [{
            card_code: '', serial: item.referencia, is_sold: false,
            total_cards: lr.total_cards, cards_sold: lr.cards_sold,
          }];
        }
      } else if (item.tipo === 'carton') {
        const cardRes = await pool.query(
          `SELECT card_code, serial, is_sold FROM cards WHERE card_code = $1 AND event_id = $2`,
          [item.referencia, eventId]
        );
        detalle.cartonesDetalle = cardRes.rows;
        if (cardRes.rows[0]) {
          detalle.serial_desde = cardRes.rows[0].serial;
          detalle.serial_hasta = cardRes.rows[0].serial;
        }
      }

      pdfItems.push(detalle);
    }

    try {
      const pdfPath = await generateDocumentoPdf({
        documentoId,
        accion: data.accion || 'traslado',
        fecha: docCreatedAt,
        eventoNombre: eventResult.rows[0]?.name || '',
        deNombre: origenName || '',
        aNombre: destinoName,
        totalItems: exitosos,
        totalCartones,
        asignadoPor: userResult.rows[0]?.full_name || 'Sistema',
        items: pdfItems,
        firmaEntrega: data.firmas?.firma_entrega,
        firmaRecibe: data.firmas?.firma_recibe,
        nombreEntrega: data.firmas?.nombre_entrega || origenName || 'Origen',
        nombreRecibe: data.firmas?.nombre_recibe || destinoName,
      });
      const pdfFilename = pdfPath.split('/').pop();
      await pool.query('UPDATE inv_documentos SET pdf_path = $1 WHERE id = $2', [pdfFilename, documentoId]);
    } catch (err) {
      console.error('Error generando PDF de documento:', err);
    }
  }

  return { documentoId, exitosos, errores };

  } catch (txError) {
    await client.query('ROLLBACK').catch(() => {});
    throw txError;
  } finally {
    client.release();
  }
}

// =====================================================
// VENTA DE INVENTARIO
// =====================================================

export async function ejecutarVenta(
  pool: Pool,
  eventId: number,
  data: {
    almacen_id: number;
    items: { tipo: string; referencia: string }[];
    buyer_name?: string;
    buyer_cedula?: string;
    buyer_libreta?: string;
    buyer_phone?: string;
    firmas?: FirmaData;
  },
  userId: number
): Promise<{ documentoId: number; exitosos: number; totalCartones: number; errores: string[] }> {
  const errores: string[] = [];
  let exitosos = 0;
  let totalCartones = 0;

  // Validar almacen
  const almResult = await pool.query('SELECT name, code FROM almacenes WHERE id = $1 AND event_id = $2', [data.almacen_id, eventId]);
  if (almResult.rows.length === 0) throw new Error('Almacen no encontrado');
  const almacenName = almResult.rows[0].name;

  // Obtener evento
  const eventResult = await pool.query('SELECT name FROM events WHERE id = $1', [eventId]);
  const userResult = await pool.query('SELECT full_name FROM users WHERE id = $1', [userId]);

  // Usar transacción para garantizar integridad
  const client = await pool.connect();
  try {
  await client.query('BEGIN');

  // Crear documento
  const docResult = await client.query(
    `INSERT INTO inv_documentos (event_id, accion, de_almacen_id, de_nombre, a_nombre, a_cedula, a_libreta, total_items, total_cartones, realizado_por)
     VALUES ($1, 'venta', $2, $3, $4, $5, $6, $7, 0, $8) RETURNING id, created_at`,
    [eventId, data.almacen_id, almacenName, data.buyer_name || 'Comprador', data.buyer_cedula || null, data.buyer_libreta || null, data.items.length, userId]
  );
  const documentoId = docResult.rows[0].id;
  const docCreatedAt = docResult.rows[0].created_at;

  const pdfItems: DocumentoItemDetalle[] = [];

  for (const item of data.items) {
    try {
      const detalle: DocumentoItemDetalle = {
        tipo: item.tipo,
        referencia: item.referencia,
        cartones: 0,
      };

      if (item.tipo === 'caja') {
        const cajaRes = await client.query(
          'SELECT id, almacen_id FROM cajas WHERE caja_code = $1 AND event_id = $2',
          [item.referencia, eventId]
        );
        if (cajaRes.rows.length === 0) throw new Error(`Caja "${item.referencia}" no encontrada`);
        const caja = cajaRes.rows[0];
        if (caja.almacen_id !== data.almacen_id) throw new Error(`Caja "${item.referencia}" no esta en tu almacen`);

        const updateResult = await client.query(
          `UPDATE cards SET is_sold = true, sold_at = CURRENT_TIMESTAMP, buyer_name = $1, buyer_phone = $2, buyer_cedula = $3, buyer_libreta = $4, sold_by = $5
           FROM lotes l WHERE l.id = cards.lote_id AND l.caja_id = $6 AND cards.is_sold = false
           RETURNING cards.id`,
          [data.buyer_name || null, data.buyer_phone || null, data.buyer_cedula || null, data.buyer_libreta || null, userId, caja.id]
        );
        const vendidos = updateResult.rowCount || 0;
        totalCartones += vendidos;
        detalle.cartones = vendidos;

        await client.query(
          `UPDATE lotes SET cards_sold = (SELECT COUNT(*) FROM cards WHERE lote_id = lotes.id AND is_sold = true) WHERE caja_id = $1`,
          [caja.id]
        );

        // Obtener libretas con rangos de seriales (desde-hasta)
        const lotesInfo = await client.query(
          `SELECT l.lote_code, l.total_cards, l.cards_sold,
            MIN(c.serial) as serial_desde, MAX(c.serial) as serial_hasta
           FROM lotes l
           LEFT JOIN cards c ON c.lote_id = l.id
           WHERE l.caja_id = $1
           GROUP BY l.id, l.lote_code, l.total_cards, l.cards_sold
           ORDER BY l.lote_code`,
          [caja.id]
        );
        detalle.lotes = lotesInfo.rows.map((l: any): LoteDetalle => ({
          lote_code: l.lote_code, total_cards: l.total_cards, cards_sold: l.cards_sold,
          serial_desde: l.serial_desde, serial_hasta: l.serial_hasta,
        }));

        // Rango general de toda la caja
        const cajaRange = await client.query(
          `SELECT MIN(c.serial) as serial_desde, MAX(c.serial) as serial_hasta
           FROM cards c JOIN lotes l ON c.lote_id = l.id WHERE l.caja_id = $1`,
          [caja.id]
        );
        if (cajaRange.rows[0]) {
          detalle.serial_desde = cajaRange.rows[0].serial_desde;
          detalle.serial_hasta = cajaRange.rows[0].serial_hasta;
        }

      } else if (item.tipo === 'libreta') {
        const loteRes = await client.query(
          'SELECT id, almacen_id, caja_id FROM lotes WHERE lote_code = $1 AND event_id = $2',
          [item.referencia, eventId]
        );
        if (loteRes.rows.length === 0) throw new Error(`Libreta "${item.referencia}" no encontrada`);
        const lote = loteRes.rows[0];
        if (lote.almacen_id !== data.almacen_id) throw new Error(`Libreta "${item.referencia}" no esta en tu almacen`);

        const updateResult = await client.query(
          `UPDATE cards SET is_sold = true, sold_at = CURRENT_TIMESTAMP, buyer_name = $1, buyer_phone = $2, buyer_cedula = $3, buyer_libreta = $4, sold_by = $5
           WHERE lote_id = $6 AND is_sold = false RETURNING id`,
          [data.buyer_name || null, data.buyer_phone || null, data.buyer_cedula || null, data.buyer_libreta || null, userId, lote.id]
        );
        const vendidos = updateResult.rowCount || 0;
        totalCartones += vendidos;
        detalle.cartones = vendidos;

        await client.query(
          `UPDATE lotes SET cards_sold = (SELECT COUNT(*) FROM cards WHERE lote_id = $1 AND is_sold = true) WHERE id = $1`,
          [lote.id]
        );

        // Obtener rango de seriales de la libreta
        const loteRange = await client.query(
          `SELECT l.total_cards, l.cards_sold, MIN(c.serial) as serial_desde, MAX(c.serial) as serial_hasta
           FROM lotes l LEFT JOIN cards c ON c.lote_id = l.id
           WHERE l.id = $1 GROUP BY l.id, l.total_cards, l.cards_sold`,
          [lote.id]
        );
        const lr = loteRange.rows[0];
        detalle.serial_desde = lr?.serial_desde;
        detalle.serial_hasta = lr?.serial_hasta;
        detalle.cartonesDetalle = [{
          card_code: '', serial: item.referencia, is_sold: true,
          total_cards: lr?.total_cards || 0, cards_sold: lr?.cards_sold || 0,
        }];

      } else if (item.tipo === 'carton') {
        let serialSearch = item.referencia;
        const serialMatch = item.referencia.match(/^(\d+)-(\d+)$/);
        if (serialMatch) {
          serialSearch = serialMatch[1].padStart(5, '0') + '-' + serialMatch[2].padStart(2, '0');
        }
        const cardRes = await client.query(
          'SELECT id, lote_id, is_sold, almacen_id, serial, card_code FROM cards WHERE (card_code = $1 OR serial = $3) AND event_id = $2',
          [item.referencia, eventId, serialSearch]
        );
        if (cardRes.rows.length === 0) throw new Error(`Carton "${item.referencia}" no encontrado`);
        const card = cardRes.rows[0];
        if (card.almacen_id !== data.almacen_id) throw new Error(`Carton "${item.referencia}" no esta en tu almacen`);
        if (card.is_sold) throw new Error(`Carton "${item.referencia}" ya fue vendido`);

        await client.query(
          `UPDATE cards SET is_sold = true, sold_at = CURRENT_TIMESTAMP, buyer_name = $1, buyer_phone = $2, buyer_cedula = $3, buyer_libreta = $4, sold_by = $5 WHERE id = $6`,
          [data.buyer_name || null, data.buyer_phone || null, data.buyer_cedula || null, data.buyer_libreta || null, userId, card.id]
        );
        totalCartones += 1;
        detalle.cartones = 1;
        detalle.serial_desde = card.serial;
        detalle.serial_hasta = card.serial;
        detalle.cartonesDetalle = [{
          card_code: card.card_code, serial: card.serial, is_sold: true,
        }];

        if (card.lote_id) {
          await client.query(
            `UPDATE lotes SET cards_sold = (SELECT COUNT(*) FROM cards WHERE lote_id = $1 AND is_sold = true) WHERE id = $1`,
            [card.lote_id]
          );
        }
      }

      // Registrar movimiento
      await client.query(
        `INSERT INTO inv_movimientos (event_id, almacen_id, tipo_entidad, referencia, accion, de_persona, a_persona, cantidad_cartones, detalles, realizado_por, documento_id)
         VALUES ($1, $2, $3, $4, 'venta', $5, $6, $7, $8, $9, $10)`,
        [eventId, data.almacen_id, item.tipo, item.referencia, almacenName, data.buyer_name || 'Comprador',
         detalle.cartones, JSON.stringify({ buyer_phone: data.buyer_phone, buyer_cedula: data.buyer_cedula, buyer_libreta: data.buyer_libreta }), userId, documentoId]
      );

      pdfItems.push(detalle);
      exitosos++;
    } catch (err: any) {
      errores.push(err.message);
    }
  }

  // Actualizar documento
  await client.query(
    'UPDATE inv_documentos SET total_items = $1, total_cartones = $2 WHERE id = $3',
    [exitosos, totalCartones, documentoId]
  );

  await client.query('COMMIT');

  // Generar PDF (fuera de la transacción — no es crítico)
  if (exitosos > 0) {
    try {
      const pdfPath = await generateDocumentoPdf({
        documentoId,
        accion: 'venta',
        fecha: docCreatedAt,
        eventoNombre: eventResult.rows[0]?.name || '',
        deNombre: almacenName,
        aNombre: data.buyer_name || 'Comprador',
        totalItems: exitosos,
        totalCartones,
        asignadoPor: userResult.rows[0]?.full_name || 'Sistema',
        items: pdfItems,
        firmaEntrega: data.firmas?.firma_entrega,
        firmaRecibe: data.firmas?.firma_recibe,
        nombreEntrega: data.firmas?.nombre_entrega || almacenName,
        nombreRecibe: data.firmas?.nombre_recibe || data.buyer_name || 'Comprador',
      });
      const pdfFilename = pdfPath.split('/').pop();
      await pool.query('UPDATE inv_documentos SET pdf_path = $1 WHERE id = $2', [pdfFilename, documentoId]);
    } catch (err) {
      console.error('Error generando PDF de venta:', err);
    }
  }

  return { documentoId, exitosos, totalCartones, errores };

  } catch (txError) {
    await client.query('ROLLBACK');
    throw txError;
  } finally {
    client.release();
  }
}

// Obtener documento con sus movimientos
export async function getDocumento(pool: Pool, documentoId: number): Promise<{
  documento: any;
  movimientos: (InvMovimiento & { realizado_por_nombre: string })[];
}> {
  const docResult = await pool.query(`
    SELECT d.*, u.full_name as realizado_por_nombre
    FROM inv_documentos d
    LEFT JOIN users u ON u.id = d.realizado_por
    WHERE d.id = $1
  `, [documentoId]);
  if (docResult.rows.length === 0) throw new Error('Documento no encontrado');

  const movResult = await pool.query(`
    SELECT im.*, u.full_name as realizado_por_nombre
    FROM inv_movimientos im
    LEFT JOIN users u ON u.id = im.realizado_por
    WHERE im.documento_id = $1
    ORDER BY im.id
  `, [documentoId]);

  return { documento: docResult.rows[0], movimientos: movResult.rows as (InvMovimiento & { realizado_por_nombre: string })[] };
}

// Obtener documentos de un evento
export async function getDocumentos(
  pool: Pool,
  eventId: number,
  params?: { almacen_id?: number; accion?: string; page?: number; limit?: number }
): Promise<{ data: any[]; total: number }> {
  let where = 'd.event_id = $1';
  const values: unknown[] = [eventId];
  let paramIndex = 2;

  if (params?.almacen_id) { where += ` AND (d.de_almacen_id = $${paramIndex} OR d.a_almacen_id = $${paramIndex})`; paramIndex++; values.push(params.almacen_id); }
  if (params?.accion) { where += ` AND d.accion = $${paramIndex++}`; values.push(params.accion); }

  const totalResult = await pool.query(`SELECT COUNT(*) as total FROM inv_documentos d WHERE ${where}`, values);
  const total = Number((totalResult.rows[0] as { total: number }).total);

  const limit = params?.limit || 50;
  const page = params?.page || 1;
  const offset = (page - 1) * limit;

  const dataResult = await pool.query(`
    SELECT d.*, u.full_name as realizado_por_nombre
    FROM inv_documentos d
    LEFT JOIN users u ON u.id = d.realizado_por
    WHERE ${where}
    ORDER BY d.created_at DESC
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
  `, [...values, limit, offset]);

  return { data: dataResult.rows, total };
}

export async function cargarInventario(pool: Pool, eventId: number, almacenId: number, cajaIds: number[], userId: number): Promise<{ cargadas: number }> {
  // Verify almacen belongs to event
  const almResult = await pool.query('SELECT id, name FROM almacenes WHERE id = $1 AND event_id = $2', [almacenId, eventId]);
  if (almResult.rows.length === 0) throw new Error('Almacen no encontrado para este evento');

  // Verify cajas belong to event and are not already in another almacen
  const cajasResult = await pool.query(
    `SELECT id, caja_code, almacen_id FROM cajas WHERE event_id = $1 AND id = ANY($2::int[])`,
    [eventId, cajaIds]
  );
  if (cajasResult.rows.length === 0) throw new Error('No se encontraron cajas validas');

  const alreadyAssigned = cajasResult.rows.filter(c => c.almacen_id && c.almacen_id !== almacenId);
  if (alreadyAssigned.length > 0) {
    throw new Error(`Las cajas ${alreadyAssigned.map(c => c.caja_code).join(', ')} ya estan asignadas a otro almacen`);
  }

  // Assign cajas, lotes y cards to almacen
  await pool.query(
    `UPDATE cajas SET almacen_id = $1, updated_at = NOW() WHERE id = ANY($2::int[]) AND event_id = $3`,
    [almacenId, cajaIds, eventId]
  );
  await pool.query(
    `UPDATE lotes SET almacen_id = $1, updated_at = NOW() WHERE caja_id = ANY($2::int[]) AND (almacen_id IS NULL OR almacen_id = $1)`,
    [almacenId, cajaIds]
  );
  await pool.query(
    `UPDATE cards SET almacen_id = $1 FROM lotes l WHERE l.id = cards.lote_id AND l.caja_id = ANY($2::int[]) AND cards.is_sold = false AND (cards.almacen_id IS NULL OR cards.almacen_id = $1)`,
    [almacenId, cajaIds]
  );

  // Log movement
  for (const caja of cajasResult.rows) {
    await pool.query(`
      INSERT INTO inv_movimientos (event_id, almacen_id, tipo_entidad, referencia, accion, a_persona, cantidad_cartones, detalles, realizado_por)
      VALUES ($1, $2, 'caja', $3, 'carga_inventario', $4, 0, $5, $6)
    `, [
      eventId, almacenId, caja.caja_code,
      almResult.rows[0].name,
      JSON.stringify({ caja_id: caja.id }),
      userId,
    ]);
  }

  return { cargadas: cajasResult.rows.length };
}

// =====================================================
// CAJAS Y LOTES (TABLAS REALES)
// =====================================================

export async function getCajas(pool: Pool, eventId: number, almacenId?: number): Promise<{
  id: number;
  caja_code: string;
  total_lotes: number;
  status: string;
  total_cartones: number;
  asignados: number;
  almacen_id: number | null;
  almacen_name: string | null;
  lotes: { id: number; lote_code: string; series_number: string; total_cards: number; cards_sold: number; status: string }[];
}[]> {
  const where = almacenId ? 'c.event_id = $1 AND c.almacen_id = $2' : 'c.event_id = $1';
  const params = almacenId ? [eventId, almacenId] : [eventId];
  const cajasResult = await pool.query(`
    SELECT c.*,
      COALESCE((SELECT SUM(l.total_cards) FROM lotes l WHERE l.caja_id = c.id), 0) as total_cartones,
      COALESCE((SELECT COUNT(*) FROM cards ca JOIN lotes l ON l.id = ca.lote_id WHERE l.caja_id = c.id AND ca.is_sold = true), 0) as asignados,
      a.name as almacen_name
    FROM cajas c
    LEFT JOIN almacenes a ON a.id = c.almacen_id
    WHERE ${where}
    ORDER BY c.caja_code
  `, params);

  // Obtener todos los lotes en una sola query (evita N+1)
  const cajaIds = cajasResult.rows.map((c: any) => c.id);
  const lotesMap: Record<number, any[]> = {};
  if (cajaIds.length > 0) {
    const lotesResult = await pool.query(`
      SELECT id, caja_id, lote_code, series_number, total_cards, cards_sold, status
      FROM lotes WHERE caja_id = ANY($1::int[]) ORDER BY lote_code
    `, [cajaIds]);
    for (const l of lotesResult.rows) {
      if (!lotesMap[l.caja_id]) lotesMap[l.caja_id] = [];
      lotesMap[l.caja_id].push({ id: l.id, lote_code: l.lote_code, series_number: l.series_number, total_cards: l.total_cards, cards_sold: l.cards_sold, status: l.status });
    }
  }

  return cajasResult.rows.map((caja: any) => ({
    id: caja.id as number,
    caja_code: caja.caja_code as string,
    total_lotes: caja.total_lotes as number,
    status: caja.status as string,
    total_cartones: Number(caja.total_cartones),
    asignados: Number(caja.asignados),
    almacen_id: caja.almacen_id as number | null,
    almacen_name: caja.almacen_name as string | null,
    lotes: lotesMap[caja.id] || [],
  }));
}

// Libretas sueltas en un almacén (su caja no está en el mismo almacén o no tiene caja)
export async function getLibretasSueltas(pool: Pool, eventId: number, almacenId: number): Promise<{
  id: number; lote_code: string; series_number: string; total_cards: number; cards_sold: number; status: string;
  caja_code: string | null;
}[]> {
  const result = await pool.query(`
    SELECT l.id, l.lote_code, l.series_number, l.total_cards, l.cards_sold, l.status,
      c.caja_code
    FROM lotes l
    LEFT JOIN cajas c ON c.id = l.caja_id
    WHERE l.event_id = $1 AND l.almacen_id = $2
      AND (l.caja_id IS NULL OR c.almacen_id IS DISTINCT FROM $2)
    ORDER BY l.lote_code
  `, [eventId, almacenId]);
  return result.rows;
}

// Cartones sueltos en un almacén (su lote no está en el mismo almacén o no tiene lote)
export async function getCartonesSueltos(pool: Pool, eventId: number, almacenId: number): Promise<{
  id: number; card_code: string; serial: string; card_number: number; is_sold: boolean;
  buyer_name: string | null; lote_code: string | null;
}[]> {
  const result = await pool.query(`
    SELECT ca.id, ca.card_code, ca.serial, ca.card_number, ca.is_sold, ca.buyer_name,
      l.lote_code
    FROM cards ca
    LEFT JOIN lotes l ON l.id = ca.lote_id
    WHERE ca.event_id = $1 AND ca.almacen_id = $2
      AND (ca.lote_id IS NULL OR l.almacen_id IS DISTINCT FROM $2)
    ORDER BY ca.serial
  `, [eventId, almacenId]);
  return result.rows;
}

export async function getLotes(pool: Pool, eventId: number): Promise<{
  id: number;
  lote_code: string;
  series_number: string;
  caja_id: number | null;
  caja_code: string | null;
  total_cards: number;
  cards_sold: number;
  status: string;
}[]> {
  const result = await pool.query(`
    SELECT l.*, c.caja_code
    FROM lotes l
    LEFT JOIN cajas c ON c.id = l.caja_id
    WHERE l.event_id = $1
    ORDER BY l.lote_code
  `, [eventId]);
  return result.rows as { id: number; lote_code: string; series_number: string; caja_id: number | null; caja_code: string | null; total_cards: number; cards_sold: number; status: string }[];
}

// =====================================================
// ASIGNACIONES
// =====================================================

export async function createAsignacion(
  pool: Pool,
  data: {
    event_id: number;
    almacen_id: number;
    tipo_entidad: string;
    referencia: string;
    persona_nombre: string;
    persona_telefono?: string;
    persona_user_id?: number;
    proposito: string;
    asignado_por: number;
  },
  firmas?: FirmaData
): Promise<InvAsignacion & { cartones?: InvAsignacionCarton[] }> {
  const almacenResult = await pool.query('SELECT * FROM almacenes WHERE id = $1 AND event_id = $2', [data.almacen_id, data.event_id]);
  const almacen = almacenResult.rows[0] as Almacen | undefined;
  if (!almacen) throw new Error('Almacen no encontrado para este evento');

  // Find cards based on tipo_entidad and referencia
  let cards: BingoCard[] = [];

  if (data.tipo_entidad === 'carton') {
    // Single card by card_code
    const cardResult = await pool.query('SELECT * FROM cards WHERE event_id = $1 AND card_code = $2', [data.event_id, data.referencia]);
    const card = cardResult.rows[0] as BingoCard | undefined;
    if (!card) throw new Error(`Carton ${data.referencia} no encontrado`);
    cards = [card];
  } else if (data.tipo_entidad === 'libreta') {
    // Look up lote by lote_code in lotes table
    const loteResult = await pool.query('SELECT * FROM lotes WHERE event_id = $1 AND lote_code = $2', [data.event_id, data.referencia]);
    const lote = loteResult.rows[0] as { id: number } | undefined;
    if (!lote) throw new Error(`Lote/Libreta ${data.referencia} no encontrado`);
    const cardsResult = await pool.query('SELECT * FROM cards WHERE lote_id = $1 ORDER BY card_number', [lote.id]);
    cards = cardsResult.rows as BingoCard[];
    if (cards.length === 0) throw new Error(`Lote ${data.referencia} no tiene cartones`);
  } else if (data.tipo_entidad === 'caja') {
    // Look up caja by caja_code in cajas table
    const cajaResult = await pool.query('SELECT * FROM cajas WHERE event_id = $1 AND caja_code = $2', [data.event_id, data.referencia]);
    const caja = cajaResult.rows[0] as { id: number } | undefined;
    if (!caja) throw new Error(`Caja ${data.referencia} no encontrada`);
    // Get all cards in all lotes of this caja
    const cardsResult = await pool.query(`
      SELECT c.* FROM cards c
      JOIN lotes l ON l.id = c.lote_id
      WHERE l.caja_id = $1
      ORDER BY c.card_number
    `, [caja.id]);
    cards = cardsResult.rows as BingoCard[];
    if (cards.length === 0) throw new Error(`Caja ${data.referencia} no tiene cartones`);
  }

  // Create assignment in transaction (duplicate check inside to avoid TOCTOU race)
  const cardIds = cards.map(c => c.id);
  let asignacionId: number;
  let movimientoId: number;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Check none of these cards are already assigned (in active assignment)
    if (cardIds.length > 0) {
      const placeholders = cardIds.map((_, idx) => `$${idx + 1}`).join(',');
      const alreadyAssignedResult = await client.query(`
        SELECT iac.card_id, ia.persona_nombre, ia.referencia
        FROM inv_asignacion_cartones iac
        JOIN inv_asignaciones ia ON ia.id = iac.asignacion_id
        WHERE iac.card_id IN (${placeholders})
        AND ia.estado NOT IN ('cancelado', 'devuelto')
      `, cardIds);
      const alreadyAssigned = alreadyAssignedResult.rows as { card_id: number; persona_nombre: string; referencia: string }[];

      if (alreadyAssigned.length > 0) {
        throw new Error(`${alreadyAssigned.length} carton(es) ya estan asignados a ${alreadyAssigned[0].persona_nombre} (ref: ${alreadyAssigned[0].referencia})`);
      }
    }

    const insertResult = await client.query(`
      INSERT INTO inv_asignaciones (event_id, almacen_id, tipo_entidad, referencia, cantidad_cartones, persona_nombre, persona_telefono, persona_user_id, proposito, asignado_por)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id
    `, [
      data.event_id, data.almacen_id, data.tipo_entidad, data.referencia,
      cards.length, data.persona_nombre, data.persona_telefono || null,
      data.persona_user_id || null, data.proposito, data.asignado_por
    ]);

    asignacionId = insertResult.rows[0].id;

    // Insert card details
    for (const card of cards) {
      await client.query(`
        INSERT INTO inv_asignacion_cartones (asignacion_id, card_id, card_code, serial)
        VALUES ($1, $2, $3, $4)
      `, [asignacionId, card.id, card.card_code, card.serial]);
    }

    // Log movement
    const movResult = await client.query(`
      INSERT INTO inv_movimientos (event_id, almacen_id, asignacion_id, tipo_entidad, referencia, accion, a_persona, cantidad_cartones, detalles, realizado_por, firma_entrega, firma_recibe, nombre_entrega, nombre_recibe)
      VALUES ($1, $2, $3, $4, $5, 'asignar', $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING id
    `, [
      data.event_id, data.almacen_id, asignacionId, data.tipo_entidad, data.referencia,
      data.persona_nombre, cards.length,
      JSON.stringify({ proposito: data.proposito, almacen: almacen.name }),
      data.asignado_por,
      firmas?.firma_entrega || null, firmas?.firma_recibe || null,
      firmas?.nombre_entrega || null, firmas?.nombre_recibe || null
    ]);

    movimientoId = movResult.rows[0].id;

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  const asignacionResult = await pool.query(`
    SELECT ia.*, a.name as almacen_name, u.full_name as asignado_por_nombre
    FROM inv_asignaciones ia
    LEFT JOIN almacenes a ON a.id = ia.almacen_id
    LEFT JOIN users u ON u.id = ia.asignado_por
    WHERE ia.id = $1
  `, [asignacionId]);
  const asignacion = asignacionResult.rows[0] as InvAsignacion & { almacen_name: string; asignado_por_nombre: string };

  const cartonesResult = await pool.query('SELECT * FROM inv_asignacion_cartones WHERE asignacion_id = $1', [asignacionId]);
  const cartones = cartonesResult.rows as InvAsignacionCarton[];

  // Generate PDF asynchronously (don't block response)
  if (firmas?.firma_entrega || firmas?.firma_recibe) {
    const eventoResult = await pool.query('SELECT name FROM events WHERE id = $1', [data.event_id]);
    const evento = eventoResult.rows[0] as { name: string } | undefined;
    generateMovimientoPdf({
      movimientoId,
      accion: 'asignar',
      fecha: new Date().toISOString(),
      eventoNombre: evento?.name || '',
      almacenNombre: almacen.name,
      referencia: data.referencia,
      tipoEntidad: data.tipo_entidad,
      cantidadCartones: cards.length,
      personaNombre: data.persona_nombre,
      personaTelefono: data.persona_telefono,
      asignadoPor: asignacion.asignado_por_nombre,
      proposito: data.proposito,
      cartones: cartones.map(c => ({ card_code: c.card_code, serial: c.serial })),
      firmaEntrega: firmas.firma_entrega,
      firmaRecibe: firmas.firma_recibe,
      nombreEntrega: firmas.nombre_entrega || asignacion.asignado_por_nombre,
      nombreRecibe: firmas.nombre_recibe || data.persona_nombre,
    }).then(filepath => {
      const filename = filepath.split('/').pop()!;
      pool.query('UPDATE inv_movimientos SET pdf_path = $1 WHERE id = $2', [filename, movimientoId])
        .catch(err => console.error('Error updating PDF path:', err));
    }).catch(err => console.error('Error generando PDF de movimiento:', err));
  }

  return { ...asignacion, cartones };
}

export async function getAsignaciones(
  pool: Pool,
  eventId: number,
  params?: { almacen_id?: number; estado?: string; proposito?: string; persona?: string; page?: number; limit?: number }
): Promise<{ data: (InvAsignacion & { almacen_name: string; asignado_por_nombre: string })[]; total: number }> {
  let where = 'ia.event_id = $1';
  const values: unknown[] = [eventId];
  let paramIndex = 2;

  if (params?.almacen_id) { where += ` AND ia.almacen_id = $${paramIndex++}`; values.push(params.almacen_id); }
  if (params?.estado) { where += ` AND ia.estado = $${paramIndex++}`; values.push(params.estado); }
  if (params?.proposito) { where += ` AND ia.proposito = $${paramIndex++}`; values.push(params.proposito); }
  if (params?.persona) { where += ` AND ia.persona_nombre LIKE $${paramIndex++}`; values.push(`%${params.persona}%`); }

  const totalResult = await pool.query(`
    SELECT COUNT(*) as total FROM inv_asignaciones ia WHERE ${where}
  `, values);
  const total = Number((totalResult.rows[0] as { total: number }).total);

  const limit = params?.limit || 50;
  const page = params?.page || 1;
  const offset = (page - 1) * limit;

  const dataResult = await pool.query(`
    SELECT ia.*, a.name as almacen_name, u.full_name as asignado_por_nombre
    FROM inv_asignaciones ia
    LEFT JOIN almacenes a ON a.id = ia.almacen_id
    LEFT JOIN users u ON u.id = ia.asignado_por
    WHERE ${where}
    ORDER BY ia.created_at DESC
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
  `, [...values, limit, offset]);
  const data = dataResult.rows as (InvAsignacion & { almacen_name: string; asignado_por_nombre: string })[];

  return { data, total };
}

export async function getAsignacion(pool: Pool, id: number): Promise<(InvAsignacion & { almacen_name: string; asignado_por_nombre: string; cartones: InvAsignacionCarton[] }) | undefined> {
  const asignacionResult = await pool.query(`
    SELECT ia.*, a.name as almacen_name, u.full_name as asignado_por_nombre
    FROM inv_asignaciones ia
    LEFT JOIN almacenes a ON a.id = ia.almacen_id
    LEFT JOIN users u ON u.id = ia.asignado_por
    WHERE ia.id = $1
  `, [id]);
  const asignacion = asignacionResult.rows[0] as (InvAsignacion & { almacen_name: string; asignado_por_nombre: string }) | undefined;

  if (!asignacion) return undefined;

  const cartonesResult = await pool.query('SELECT * FROM inv_asignacion_cartones WHERE asignacion_id = $1 ORDER BY serial', [id]);
  const cartones = cartonesResult.rows as InvAsignacionCarton[];
  return { ...asignacion, cartones };
}

export async function devolverAsignacion(pool: Pool, id: number, userId: number, firmas?: FirmaData): Promise<InvAsignacion> {
  const asignacionResult = await pool.query('SELECT * FROM inv_asignaciones WHERE id = $1', [id]);
  const asignacion = asignacionResult.rows[0] as InvAsignacion | undefined;
  if (!asignacion) throw new Error('Asignacion no encontrada');
  if (asignacion.estado === 'devuelto' || asignacion.estado === 'cancelado') {
    throw new Error('Esta asignacion ya fue devuelta o cancelada');
  }

  let movimientoId: number;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      UPDATE inv_asignaciones SET estado = 'devuelto', devuelto_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1
    `, [id]);

    const movResult = await client.query(`
      INSERT INTO inv_movimientos (event_id, almacen_id, asignacion_id, tipo_entidad, referencia, accion, de_persona, cantidad_cartones, realizado_por, firma_entrega, firma_recibe, nombre_entrega, nombre_recibe)
      VALUES ($1, $2, $3, $4, $5, 'devolver', $6, $7, $8, $9, $10, $11, $12)
      RETURNING id
    `, [
      asignacion.event_id, asignacion.almacen_id, id, asignacion.tipo_entidad, asignacion.referencia,
      asignacion.persona_nombre, asignacion.cantidad_cartones, userId,
      firmas?.firma_entrega || null, firmas?.firma_recibe || null,
      firmas?.nombre_entrega || null, firmas?.nombre_recibe || null
    ]);
    movimientoId = movResult.rows[0].id;

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  // Generate PDF
  if (firmas?.firma_entrega || firmas?.firma_recibe) {
    const eventoResult = await pool.query('SELECT name FROM events WHERE id = $1', [asignacion.event_id]);
    const evento = eventoResult.rows[0] as { name: string } | undefined;
    const almacenResult = await pool.query('SELECT name FROM almacenes WHERE id = $1', [asignacion.almacen_id]);
    const almacenRow = almacenResult.rows[0] as { name: string } | undefined;
    const userResult = await pool.query('SELECT full_name FROM users WHERE id = $1', [userId]);
    const user = userResult.rows[0] as { full_name: string } | undefined;
    const cartonesResult = await pool.query('SELECT card_code, serial FROM inv_asignacion_cartones WHERE asignacion_id = $1 ORDER BY serial', [id]);
    const cartones = cartonesResult.rows as { card_code: string; serial: string }[];

    generateMovimientoPdf({
      movimientoId,
      accion: 'devolver',
      fecha: new Date().toISOString(),
      eventoNombre: evento?.name || '',
      almacenNombre: almacenRow?.name || '',
      referencia: asignacion.referencia,
      tipoEntidad: asignacion.tipo_entidad,
      cantidadCartones: asignacion.cantidad_cartones,
      personaNombre: asignacion.persona_nombre,
      asignadoPor: user?.full_name || '',
      cartones,
      firmaEntrega: firmas.firma_entrega,
      firmaRecibe: firmas.firma_recibe,
      nombreEntrega: firmas.nombre_entrega || asignacion.persona_nombre,
      nombreRecibe: firmas.nombre_recibe || user?.full_name || '',
    }).then(filepath => {
      const filename = filepath.split('/').pop()!;
      pool.query('UPDATE inv_movimientos SET pdf_path = $1 WHERE id = $2', [filename, movimientoId])
        .catch(err => console.error('Error updating PDF path:', err));
    }).catch(err => console.error('Error generando PDF de movimiento:', err));
  }

  const result = await pool.query('SELECT * FROM inv_asignaciones WHERE id = $1', [id]);
  return result.rows[0] as InvAsignacion;
}

export async function cancelarAsignacion(pool: Pool, id: number, userId: number, firmas?: FirmaData): Promise<InvAsignacion> {
  const asignacionResult = await pool.query('SELECT * FROM inv_asignaciones WHERE id = $1', [id]);
  const asignacion = asignacionResult.rows[0] as InvAsignacion | undefined;
  if (!asignacion) throw new Error('Asignacion no encontrada');
  if (asignacion.estado === 'cancelado') throw new Error('Ya esta cancelada');
  if (asignacion.cartones_vendidos > 0) throw new Error('No se puede cancelar, hay cartones vendidos');

  let movimientoId: number;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`UPDATE inv_asignaciones SET estado = 'cancelado', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [id]);

    const movResult = await client.query(`
      INSERT INTO inv_movimientos (event_id, almacen_id, asignacion_id, tipo_entidad, referencia, accion, de_persona, cantidad_cartones, realizado_por, firma_entrega, nombre_entrega)
      VALUES ($1, $2, $3, $4, $5, 'cancelar', $6, $7, $8, $9, $10)
      RETURNING id
    `, [
      asignacion.event_id, asignacion.almacen_id, id, asignacion.tipo_entidad, asignacion.referencia,
      asignacion.persona_nombre, asignacion.cantidad_cartones, userId,
      firmas?.firma_entrega || null, firmas?.nombre_entrega || null
    ]);
    movimientoId = movResult.rows[0].id;

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  // Generate PDF
  if (firmas?.firma_entrega) {
    const eventoResult = await pool.query('SELECT name FROM events WHERE id = $1', [asignacion.event_id]);
    const evento = eventoResult.rows[0] as { name: string } | undefined;
    const almacenResult = await pool.query('SELECT name FROM almacenes WHERE id = $1', [asignacion.almacen_id]);
    const almacenRow = almacenResult.rows[0] as { name: string } | undefined;
    const userResult = await pool.query('SELECT full_name FROM users WHERE id = $1', [userId]);
    const user = userResult.rows[0] as { full_name: string } | undefined;
    const cartonesResult = await pool.query('SELECT card_code, serial FROM inv_asignacion_cartones WHERE asignacion_id = $1 ORDER BY serial', [id]);
    const cartones = cartonesResult.rows as { card_code: string; serial: string }[];

    generateMovimientoPdf({
      movimientoId,
      accion: 'cancelar',
      fecha: new Date().toISOString(),
      eventoNombre: evento?.name || '',
      almacenNombre: almacenRow?.name || '',
      referencia: asignacion.referencia,
      tipoEntidad: asignacion.tipo_entidad,
      cantidadCartones: asignacion.cantidad_cartones,
      personaNombre: asignacion.persona_nombre,
      asignadoPor: user?.full_name || '',
      cartones,
      firmaEntrega: firmas.firma_entrega,
      nombreEntrega: firmas.nombre_entrega || user?.full_name || '',
      nombreRecibe: asignacion.persona_nombre,
    }).then(filepath => {
      const filename = filepath.split('/').pop()!;
      pool.query('UPDATE inv_movimientos SET pdf_path = $1 WHERE id = $2', [filename, movimientoId])
        .catch(err => console.error('Error updating PDF path:', err));
    }).catch(err => console.error('Error generando PDF de movimiento:', err));
  }

  const result = await pool.query('SELECT * FROM inv_asignaciones WHERE id = $1', [id]);
  return result.rows[0] as InvAsignacion;
}

// =====================================================
// VENTAS
// =====================================================

export async function venderCarton(
  pool: Pool,
  asignacionCartonId: number,
  userId: number,
  data?: { comprador_nombre?: string; comprador_telefono?: string }
): Promise<InvAsignacionCarton> {
  const cartonResult = await pool.query('SELECT * FROM inv_asignacion_cartones WHERE id = $1', [asignacionCartonId]);
  const carton = cartonResult.rows[0] as InvAsignacionCarton | undefined;
  if (!carton) throw new Error('Carton no encontrado en la asignacion');
  if (carton.vendido) throw new Error('Este carton ya fue vendido');

  const asignacionResult = await pool.query('SELECT * FROM inv_asignaciones WHERE id = $1', [carton.asignacion_id]);
  const asignacion = asignacionResult.rows[0] as InvAsignacion;
  if (asignacion.estado === 'devuelto' || asignacion.estado === 'cancelado') {
    throw new Error('No se puede vender: la asignacion esta devuelta o cancelada');
  }
  if (asignacion.proposito !== 'venta') {
    throw new Error('Esta asignacion es de custodia, no se pueden vender cartones directamente');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Mark card as sold in assignment
    await client.query(`
      UPDATE inv_asignacion_cartones SET vendido = TRUE, vendido_at = CURRENT_TIMESTAMP, comprador_nombre = $1, comprador_telefono = $2 WHERE id = $3
    `, [data?.comprador_nombre || null, data?.comprador_telefono || null, asignacionCartonId]);

    // Mark card as sold in bingo cards table
    await client.query(`UPDATE cards SET is_sold = TRUE, sold_at = CURRENT_TIMESTAMP, buyer_name = $1, buyer_phone = $2 WHERE id = $3`,
      [data?.comprador_nombre || null, data?.comprador_telefono || null, carton.card_id]);

    // Update assignment counters
    await client.query(`
      UPDATE inv_asignaciones SET
        cartones_vendidos = cartones_vendidos + 1,
        estado = CASE
          WHEN cartones_vendidos + 1 >= cantidad_cartones THEN 'completado'
          ELSE 'parcial'
        END,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `, [carton.asignacion_id]);

    // Log movement
    await client.query(`
      INSERT INTO inv_movimientos (event_id, almacen_id, asignacion_id, tipo_entidad, referencia, accion, de_persona, a_persona, cantidad_cartones, detalles, realizado_por)
      VALUES ($1, $2, $3, 'carton', $4, 'vender', $5, $6, 1, $7, $8)
    `, [
      asignacion.event_id, asignacion.almacen_id, asignacion.id,
      carton.card_code, asignacion.persona_nombre, data?.comprador_nombre || null,
      JSON.stringify({ serial: carton.serial }),
      userId
    ]);

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  const result = await pool.query('SELECT * FROM inv_asignacion_cartones WHERE id = $1', [asignacionCartonId]);
  return result.rows[0] as InvAsignacionCarton;
}

export async function venderTodos(
  pool: Pool,
  asignacionId: number,
  userId: number,
  data?: { comprador_nombre?: string; comprador_telefono?: string }
): Promise<{ vendidos: number }> {
  const asignacionResult = await pool.query('SELECT * FROM inv_asignaciones WHERE id = $1', [asignacionId]);
  const asignacion = asignacionResult.rows[0] as InvAsignacion | undefined;
  if (!asignacion) throw new Error('Asignacion no encontrada');
  if (asignacion.estado === 'devuelto' || asignacion.estado === 'cancelado') {
    throw new Error('No se puede vender: la asignacion esta devuelta o cancelada');
  }
  if (asignacion.proposito !== 'venta') {
    throw new Error('Esta asignacion es de custodia, no se pueden vender cartones directamente');
  }

  const pendientesResult = await pool.query('SELECT * FROM inv_asignacion_cartones WHERE asignacion_id = $1 AND vendido = FALSE', [asignacionId]);
  const pendientes = pendientesResult.rows as InvAsignacionCarton[];
  if (pendientes.length === 0) throw new Error('No hay cartones pendientes de venta');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const carton of pendientes) {
      await client.query(`
        UPDATE inv_asignacion_cartones SET vendido = TRUE, vendido_at = CURRENT_TIMESTAMP, comprador_nombre = $1, comprador_telefono = $2 WHERE id = $3
      `, [data?.comprador_nombre || null, data?.comprador_telefono || null, carton.id]);

      await client.query(`UPDATE cards SET is_sold = TRUE, sold_at = CURRENT_TIMESTAMP, buyer_name = $1, buyer_phone = $2 WHERE id = $3`,
        [data?.comprador_nombre || null, data?.comprador_telefono || null, carton.card_id]);
    }

    await client.query(`
      UPDATE inv_asignaciones SET cartones_vendidos = cantidad_cartones, estado = 'completado', updated_at = CURRENT_TIMESTAMP WHERE id = $1
    `, [asignacionId]);

    await client.query(`
      INSERT INTO inv_movimientos (event_id, almacen_id, asignacion_id, tipo_entidad, referencia, accion, de_persona, a_persona, cantidad_cartones, realizado_por)
      VALUES ($1, $2, $3, $4, $5, 'vender', $6, $7, $8, $9)
    `, [
      asignacion.event_id, asignacion.almacen_id, asignacionId,
      asignacion.tipo_entidad, asignacion.referencia,
      asignacion.persona_nombre, data?.comprador_nombre || null,
      pendientes.length, userId
    ]);

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  return { vendidos: pendientes.length };
}

// =====================================================
// MOVIMIENTOS / AUDITORIA
// =====================================================

export async function getMovimientos(
  pool: Pool,
  eventId: number,
  params?: { almacen_id?: number; tipo_entidad?: string; accion?: string; referencia?: string; page?: number; limit?: number }
): Promise<{ data: (InvMovimiento & { realizado_por_nombre: string })[]; total: number }> {
  let where = 'im.event_id = $1';
  const values: unknown[] = [eventId];
  let paramIndex = 2;

  if (params?.almacen_id) { where += ` AND im.almacen_id = $${paramIndex++}`; values.push(params.almacen_id); }
  if (params?.tipo_entidad) { where += ` AND im.tipo_entidad = $${paramIndex++}`; values.push(params.tipo_entidad); }
  if (params?.accion) { where += ` AND im.accion = $${paramIndex++}`; values.push(params.accion); }
  if (params?.referencia) { where += ` AND im.referencia LIKE $${paramIndex++}`; values.push(`%${params.referencia}%`); }

  const totalResult = await pool.query(`SELECT COUNT(*) as total FROM inv_movimientos im WHERE ${where}`, values);
  const total = Number((totalResult.rows[0] as { total: number }).total);

  const limit = params?.limit || 50;
  const page = params?.page || 1;
  const offset = (page - 1) * limit;

  const dataResult = await pool.query(`
    SELECT im.*, u.full_name as realizado_por_nombre
    FROM inv_movimientos im
    LEFT JOIN users u ON u.id = im.realizado_por
    WHERE ${where}
    ORDER BY im.created_at DESC
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
  `, [...values, limit, offset]);
  const data = dataResult.rows as (InvMovimiento & { realizado_por_nombre: string })[];

  return { data, total };
}

// =====================================================
// TRAZABILIDAD
// =====================================================

export async function getTrazabilidad(
  pool: Pool,
  eventId: number,
  referencia: string
): Promise<(InvMovimiento & { realizado_por_nombre: string })[]> {
  const result = await pool.query(`
    SELECT im.*, u.full_name as realizado_por_nombre
    FROM inv_movimientos im
    LEFT JOIN users u ON u.id = im.realizado_por
    WHERE im.event_id = $1 AND im.referencia = $2
    ORDER BY im.created_at ASC
  `, [eventId, referencia]);
  return result.rows as (InvMovimiento & { realizado_por_nombre: string })[];
}

// =====================================================
// ESCANEO DE CODIGO
// =====================================================

export async function escanearCodigo(pool: Pool, eventId: number, codigo: string): Promise<{
  tipo: string;
  entidad: unknown;
  asignacion: unknown;
} | null> {
  // Try as caja code (C001, C002...)
  const cajaResult = await pool.query(`
    SELECT c.*, COALESCE((SELECT SUM(l.total_cards) FROM lotes l WHERE l.caja_id = c.id), 0) as total_cartones
    FROM cajas c WHERE c.event_id = $1 AND c.caja_code = $2
  `, [eventId, codigo.toUpperCase()]);
  if (cajaResult.rows.length > 0) {
    const caja = cajaResult.rows[0];
    const asignacionResult = await pool.query(`
      SELECT ia.id, ia.persona_nombre, ia.proposito, ia.estado
      FROM inv_asignaciones ia
      WHERE ia.event_id = $1 AND ia.referencia = $2 AND ia.tipo_entidad = 'caja' AND ia.estado NOT IN ('cancelado', 'devuelto')
    `, [eventId, codigo.toUpperCase()]);
    return { tipo: 'caja', entidad: caja, asignacion: asignacionResult.rows[0] || null };
  }

  // Try as lote code (L00001, L00002...)
  const loteResult = await pool.query(`
    SELECT l.*, c.caja_code
    FROM lotes l LEFT JOIN cajas c ON c.id = l.caja_id
    WHERE l.event_id = $1 AND l.lote_code = $2
  `, [eventId, codigo.toUpperCase()]);
  if (loteResult.rows.length > 0) {
    const lote = loteResult.rows[0];
    const asignacionResult = await pool.query(`
      SELECT ia.id, ia.persona_nombre, ia.proposito, ia.estado
      FROM inv_asignaciones ia
      WHERE ia.event_id = $1 AND ia.referencia = $2 AND ia.tipo_entidad = 'libreta' AND ia.estado NOT IN ('cancelado', 'devuelto')
    `, [eventId, codigo.toUpperCase()]);
    return { tipo: 'libreta', entidad: lote, asignacion: asignacionResult.rows[0] || null };
  }

  // Try as card_code
  const cardResult = await pool.query('SELECT id, card_code, serial, card_number, is_sold, buyer_name FROM cards WHERE event_id = $1 AND card_code = $2', [eventId, codigo.toUpperCase()]);
  const card = cardResult.rows[0];
  if (card) {
    const asignacionResult = await pool.query(`
      SELECT ia.id, ia.persona_nombre, ia.proposito, ia.estado
      FROM inv_asignacion_cartones iac
      JOIN inv_asignaciones ia ON ia.id = iac.asignacion_id
      WHERE iac.card_id = $1 AND ia.estado NOT IN ('cancelado', 'devuelto')
    `, [(card as { id: number }).id]);
    return { tipo: 'carton', entidad: card, asignacion: asignacionResult.rows[0] || null };
  }

  return null;
}
