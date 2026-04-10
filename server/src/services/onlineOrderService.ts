import { getPool } from '../database/init.js';
import { generateUniqueCode } from './cardGenerator.js';
import { generateCardsPDF } from './exportService.js';
import type { CardNumbers } from '../types/index.js';

export interface OnlineOrder {
  id: number;
  event_id: number;
  order_code: string;
  quantity: number;
  unit_price: number;
  total_amount: number;
  buyer_name: string;
  buyer_email: string;
  buyer_phone: string;
  buyer_cedula: string | null;
  status: string;
  card_ids: number[];
  yappy_transaction_id: string | null;
  yappy_transaction_data: Record<string, unknown> | null;
  payment_confirmed_at: string | null;
  payment_confirmed_by: string | null;
  pdf_path: string | null;
  download_token: string | null;
  email_sent_at: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export interface OnlineSalesConfig {
  id: number;
  event_id: number;
  is_enabled: boolean;
  price_per_card: number;
  max_cards_per_order: number;
  min_cards_per_order: number;
  almacen_id: number | null;
  yappy_qr_image: string | null;
  yappy_collection_alias: string | null;
  payment_instructions: string | null;
  order_expiry_minutes: number;
  landing_title: string | null;
  landing_description: string | null;
}

const UNIT_PRICE = 5.00;

export async function getSalesConfig(eventId: number): Promise<OnlineSalesConfig | null> {
  const pool = getPool();
  const { rows } = await pool.query<OnlineSalesConfig>(
    'SELECT * FROM online_sales_config WHERE event_id = $1',
    [eventId]
  );
  return rows[0] || null;
}

export async function upsertSalesConfig(eventId: number, config: Partial<OnlineSalesConfig>): Promise<OnlineSalesConfig> {
  const pool = getPool();
  const existing = await getSalesConfig(eventId);

  if (existing) {
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    const allowed = ['is_enabled', 'price_per_card', 'max_cards_per_order', 'min_cards_per_order',
      'almacen_id', 'yappy_qr_image', 'yappy_collection_alias', 'payment_instructions',
      'order_expiry_minutes', 'landing_title', 'landing_description'] as const;

    for (const key of allowed) {
      if (key in config) {
        fields.push(`${key} = $${idx++}`);
        values.push(config[key as keyof typeof config]);
      }
    }

    if (fields.length === 0) return existing;

    values.push(eventId);
    const { rows } = await pool.query<OnlineSalesConfig>(
      `UPDATE online_sales_config SET ${fields.join(', ')} WHERE event_id = $${idx} RETURNING *`,
      values
    );
    return rows[0];
  } else {
    const { rows } = await pool.query<OnlineSalesConfig>(
      `INSERT INTO online_sales_config (event_id, is_enabled, price_per_card, max_cards_per_order,
        min_cards_per_order, almacen_id, yappy_qr_image, yappy_collection_alias, payment_instructions,
        order_expiry_minutes, landing_title, landing_description)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        eventId,
        config.is_enabled ?? false,
        config.price_per_card ?? UNIT_PRICE,
        config.max_cards_per_order ?? 20,
        config.min_cards_per_order ?? 1,
        config.almacen_id ?? null,
        config.yappy_qr_image ?? null,
        config.yappy_collection_alias ?? null,
        config.payment_instructions ?? 'Abre tu app de Yappy, escanea el QR y en la descripcion coloca tu codigo de orden.',
        config.order_expiry_minutes ?? 30,
        config.landing_title ?? null,
        config.landing_description ?? null,
      ]
    );
    return rows[0];
  }
}

interface BuyerInfo {
  buyer_name: string;
  buyer_email: string;
  buyer_phone: string;
  buyer_cedula?: string;
}

export async function createOrder(
  eventId: number,
  quantity: number,
  buyer: BuyerInfo
): Promise<OnlineOrder> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Verificar config activa
    const { rows: configRows } = await client.query<OnlineSalesConfig>(
      'SELECT * FROM online_sales_config WHERE event_id = $1 AND is_enabled = TRUE',
      [eventId]
    );
    if (configRows.length === 0) {
      throw new Error('La venta online no está habilitada para este evento');
    }
    const config = configRows[0];

    if (quantity < config.min_cards_per_order || quantity > config.max_cards_per_order) {
      throw new Error(`La cantidad debe ser entre ${config.min_cards_per_order} y ${config.max_cards_per_order}`);
    }

    // Reservar cartones disponibles del almacen configurado (excluyendo los de órdenes activas)
    const almacenFilter = config.almacen_id ? 'AND c.almacen_id = $3' : '';
    const queryParams: unknown[] = [eventId, quantity];
    if (config.almacen_id) queryParams.push(config.almacen_id);

    // DB-C3: operador @> en lugar de unnest() para permitir uso de índice GIN.
    const { rows: cardRows } = await client.query<{ id: number }>(
      `SELECT c.id FROM cards c
       WHERE c.event_id = $1 AND c.is_sold = FALSE
         ${almacenFilter}
         AND NOT EXISTS (
           SELECT 1 FROM online_orders o
           WHERE o.event_id = $1
             AND o.status IN ('pending_payment','payment_confirmed','cards_assigned')
             AND o.card_ids @> ARRAY[c.id]
         )
       ORDER BY c.card_number
       LIMIT $2
       FOR UPDATE SKIP LOCKED`,
      queryParams
    );

    if (cardRows.length < quantity) {
      throw new Error(`Solo hay ${cardRows.length} cartones disponibles. Solicitaste ${quantity}.`);
    }

    const cardIds = cardRows.map(r => r.id);
    const orderCode = 'ORD-' + generateUniqueCode(5);
    const unitPrice = Number(config.price_per_card) || UNIT_PRICE;
    const totalAmount = quantity * unitPrice;
    const expiryMinutes = config.order_expiry_minutes || 30;

    const { rows: orderRows } = await client.query<OnlineOrder>(
      `INSERT INTO online_orders (event_id, order_code, quantity, unit_price, total_amount,
        buyer_name, buyer_email, buyer_phone, buyer_cedula, card_ids, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW() + INTERVAL '1 minute' * $11)
       RETURNING *`,
      [
        eventId, orderCode, quantity, unitPrice, totalAmount,
        buyer.buyer_name, buyer.buyer_email, buyer.buyer_phone,
        buyer.buyer_cedula || null, cardIds, expiryMinutes,
      ]
    );

    await client.query('COMMIT');
    return orderRows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function getOrderByCode(orderCode: string): Promise<OnlineOrder | null> {
  const pool = getPool();
  const { rows } = await pool.query<OnlineOrder>(
    'SELECT * FROM online_orders WHERE order_code = $1',
    [orderCode]
  );
  return rows[0] || null;
}

export async function getOrderByDownloadToken(token: string): Promise<OnlineOrder | null> {
  const pool = getPool();
  const { rows } = await pool.query<OnlineOrder>(
    'SELECT * FROM online_orders WHERE download_token = $1',
    [token]
  );
  return rows[0] || null;
}

export async function getOrderById(id: number): Promise<OnlineOrder | null> {
  const pool = getPool();
  const { rows } = await pool.query<OnlineOrder>(
    'SELECT * FROM online_orders WHERE id = $1',
    [id]
  );
  return rows[0] || null;
}

interface CardRow {
  id: number;
  card_number: number;
  card_code: string;
  validation_code: string;
  numbers: CardNumbers;
  event_id: number;
  serial: string;
  use_free_center?: boolean;
}

export async function confirmPayment(
  orderId: number,
  confirmedBy: string,
  yappyTxnId?: string,
  yappyTxnData?: Record<string, unknown>
): Promise<OnlineOrder> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows: orderRows } = await client.query<OnlineOrder>(
      'SELECT * FROM online_orders WHERE id = $1 FOR UPDATE',
      [orderId]
    );
    if (orderRows.length === 0) throw new Error('Orden no encontrada');
    const order = orderRows[0];

    if (order.status !== 'pending_payment') {
      throw new Error(`La orden tiene status "${order.status}", no se puede confirmar`);
    }

    // SEC-C2: replay protection. Un yappyTxnId solo puede confirmar una orden.
    // Sin esto, un confirmationNumber/hash legítimo podría reutilizarse en
    // otra orden pendiente con el mismo monto. El UNIQUE INDEX de BD es la
    // segunda capa (ver migration_security_hardening.sql).
    if (yappyTxnId) {
      const { rows: dupRows } = await client.query<{ id: number; order_code: string }>(
        `SELECT id, order_code FROM online_orders
         WHERE yappy_transaction_id = $1 AND id != $2
         LIMIT 1`,
        [yappyTxnId, orderId]
      );
      if (dupRows.length > 0) {
        throw new Error(
          `Transaccion Yappy ${yappyTxnId} ya fue utilizada en la orden ${dupRows[0].order_code}`
        );
      }
    }

    // Marcar cartones como vendidos
    if (order.card_ids.length > 0) {
      await client.query(
        `UPDATE cards SET is_sold = true, sold_at = CURRENT_TIMESTAMP,
         buyer_name = $1, buyer_phone = $2, buyer_cedula = $3
         WHERE id = ANY($4)`,
        [order.buyer_name, order.buyer_phone, order.buyer_cedula, order.card_ids]
      );
    }

    // Obtener datos de cartones para generar PDF
    const { rows: cards } = await client.query<CardRow>(
      `SELECT c.id, c.card_number, c.card_code, c.validation_code, c.numbers,
              e.use_free_center
       FROM cards c JOIN events e ON e.id = c.event_id
       WHERE c.id = ANY($1) ORDER BY c.card_number`,
      [order.card_ids]
    );

    // Generar PDF
    const cardData = cards.map(c => ({
      cardNumber: c.card_number,
      cardCode: c.card_code,
      validationCode: c.validation_code,
      numbers: c.numbers,
      useFreeCenter: c.use_free_center ?? true,
    }));

    const pdfPath = await generateCardsPDF(cardData, { cardsPerPage: 4 });
    const downloadToken = generateUniqueCode(20);

    // Actualizar orden
    const { rows: updated } = await client.query<OnlineOrder>(
      `UPDATE online_orders SET
        status = 'completed',
        payment_confirmed_at = NOW(),
        payment_confirmed_by = $1,
        yappy_transaction_id = $2,
        yappy_transaction_data = $3,
        pdf_path = $4,
        download_token = $5,
        updated_at = NOW()
       WHERE id = $6
       RETURNING *`,
      [confirmedBy, yappyTxnId || null, yappyTxnData ? JSON.stringify(yappyTxnData) : null,
       pdfPath, downloadToken, orderId]
    );

    await client.query('COMMIT');
    return updated[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function cancelOrder(orderId: number): Promise<OnlineOrder> {
  const pool = getPool();
  const { rows } = await pool.query<OnlineOrder>(
    `UPDATE online_orders SET status = 'cancelled', updated_at = NOW()
     WHERE id = $1 AND status IN ('pending_payment','payment_confirmed')
     RETURNING *`,
    [orderId]
  );
  if (rows.length === 0) throw new Error('Orden no encontrada o no se puede cancelar');
  return rows[0];
}

export async function expireStaleOrders(): Promise<number> {
  const pool = getPool();
  const { rowCount } = await pool.query(
    `UPDATE online_orders SET status = 'expired', updated_at = NOW()
     WHERE status = 'pending_payment' AND expires_at < NOW()`
  );
  if (rowCount && rowCount > 0) {
    console.log(`⏰ ${rowCount} órdenes expiradas`);
  }
  return rowCount || 0;
}

export async function listOrders(filters: {
  event_id?: number;
  status?: string;
  search?: string;
  date_from?: string;
  date_to?: string;
  limit?: number;
  offset?: number;
}): Promise<{ orders: OnlineOrder[]; total: number; summary: { total_orders: number; total_completed: number; total_amount: number; total_cards: number } }> {
  const pool = getPool();
  const conditions: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (filters.event_id) {
    conditions.push(`o.event_id = $${idx++}`);
    values.push(filters.event_id);
  }
  if (filters.status) {
    conditions.push(`o.status = $${idx++}`);
    values.push(filters.status);
  }
  if (filters.search) {
    conditions.push(`(o.order_code ILIKE $${idx} OR o.buyer_name ILIKE $${idx} OR o.buyer_email ILIKE $${idx} OR o.buyer_phone ILIKE $${idx} OR o.yappy_transaction_id ILIKE $${idx})`);
    values.push(`%${filters.search}%`);
    idx++;
  }
  if (filters.date_from) {
    conditions.push(`o.created_at >= $${idx++}::date`);
    values.push(filters.date_from);
  }
  if (filters.date_to) {
    conditions.push(`o.created_at < ($${idx++}::date + INTERVAL '1 day')`);
    values.push(filters.date_to);
  }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
  const limit = Math.min(filters.limit || 50, 200);
  const offset = Math.max(0, filters.offset || 0);

  // Summary stats (incluye total count)
  const summaryResult = await pool.query(
    `SELECT
       COUNT(*) as total_orders,
       COUNT(*) FILTER (WHERE o.status = 'completed') as total_completed,
       COALESCE(SUM(o.total_amount) FILTER (WHERE o.status = 'completed'), 0) as total_amount,
       COALESCE(SUM(o.quantity) FILTER (WHERE o.status = 'completed'), 0) as total_cards
     FROM online_orders o ${where}`,
    values
  );
  const summary = {
    total_orders: parseInt(summaryResult.rows[0].total_orders, 10),
    total_completed: parseInt(summaryResult.rows[0].total_completed, 10),
    total_amount: parseFloat(summaryResult.rows[0].total_amount),
    total_cards: parseInt(summaryResult.rows[0].total_cards, 10),
  };

  const total = summary.total_orders;

  const { rows } = await pool.query<OnlineOrder & { event_name: string; card_serials: string[] }>(
    `SELECT o.*, e.name as event_name,
       COALESCE((SELECT array_agg(c.serial ORDER BY c.card_number) FROM cards c WHERE c.id = ANY(o.card_ids)), '{}') as card_serials
     FROM online_orders o
     LEFT JOIN events e ON e.id = o.event_id
     ${where} ORDER BY o.created_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
    [...values, limit, offset]
  );

  return { orders: rows, total, summary };
}
