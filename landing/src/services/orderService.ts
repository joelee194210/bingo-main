import { randomBytes } from 'crypto';
import { getPool } from '../database.js';
import { generateUniqueCode } from './utils.js';
import { generateCardsPDF } from './pdfService.js';

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
  ref_source: string | null;
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

interface CardNumbers {
  B: number[];
  I: number[];
  N: number[];
  G: number[];
  O: number[];
}

const DEFAULT_PRICE = 5.00;
const VENTA_DIGITAL_USER_ID = parseInt(process.env.VENTA_DIGITAL_USER_ID || '57', 10);

export async function getSalesConfig(eventId: number): Promise<OnlineSalesConfig | null> {
  const pool = getPool();
  const { rows } = await pool.query<OnlineSalesConfig>(
    'SELECT * FROM online_sales_config WHERE event_id = $1',
    [eventId]
  );
  return rows[0] || null;
}

export async function createOrder(
  eventId: number,
  quantity: number,
  buyer: { buyer_name: string; buyer_email: string; buyer_phone: string; buyer_cedula?: string },
  refSource?: string | null
): Promise<OnlineOrder> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

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

    const almacenFilter = config.almacen_id ? 'AND c.almacen_id = $3' : '';
    const queryParams: unknown[] = [eventId, quantity];
    if (config.almacen_id) queryParams.push(config.almacen_id);

    // DB-C3: operador @> para permitir uso de índice GIN sobre card_ids.
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
    const unitPrice = Number(config.price_per_card) || DEFAULT_PRICE;
    const totalAmount = quantity * unitPrice;
    const expiryMinutes = config.order_expiry_minutes || 30;

    const { rows: orderRows } = await client.query<OnlineOrder>(
      `INSERT INTO online_orders (event_id, order_code, quantity, unit_price, total_amount,
        buyer_name, buyer_email, buyer_phone, buyer_cedula, card_ids, expires_at, ref_source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW() + INTERVAL '1 minute' * $11, $12)
       RETURNING *`,
      [
        eventId, orderCode, quantity, unitPrice, totalAmount,
        buyer.buyer_name, buyer.buyer_email, buyer.buyer_phone,
        buyer.buyer_cedula || null, cardIds, expiryMinutes,
        refSource?.trim()?.slice(0, 120) || null,
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
    'SELECT * FROM online_orders WHERE order_code = $1', [orderCode]
  );
  return rows[0] || null;
}

export async function getOrderByDownloadToken(token: string): Promise<OnlineOrder | null> {
  const pool = getPool();
  const { rows } = await pool.query<OnlineOrder>(
    'SELECT * FROM online_orders WHERE download_token = $1', [token]
  );
  return rows[0] || null;
}

interface CardRow {
  id: number;
  card_number: number;
  card_code: string;
  validation_code: string;
  serial: string;
  numbers: CardNumbers;
  use_free_center?: boolean;
  series_number?: string;
}

export async function confirmPayment(
  orderId: number,
  confirmedBy: string,
  yappyTxnId?: string,
  yappyTxnData?: Record<string, unknown>
): Promise<OnlineOrder> {
  const pool = getPool();
  const client = await pool.connect();

  let order: OnlineOrder;
  let cardDataForPdf: Array<{ cardNumber: number; cardCode: string; validationCode: string; serial: string; numbers: CardNumbers; useFreeCenter: boolean; prizeName?: string }> = [];

  try {
    await client.query('BEGIN');

    const { rows: orderRows } = await client.query<OnlineOrder>(
      'SELECT * FROM online_orders WHERE id = $1 FOR UPDATE', [orderId]
    );
    if (orderRows.length === 0) throw new Error('Orden no encontrada');
    order = orderRows[0];

    // Idempotente: si ya está completada, retornar sin error (con flag)
    if (order.status === 'completed') {
      await client.query('ROLLBACK');
      (order as any)._alreadyConfirmed = true;
      return order;
    }

    if (order.status !== 'pending_payment') {
      await client.query('ROLLBACK');
      return order;
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
        await client.query('ROLLBACK');
        throw new Error(
          `Transaccion Yappy ${yappyTxnId} ya fue utilizada en la orden ${dupRows[0].order_code}`
        );
      }
    }

    // Obtener almacen y evento info
    const { rows: configRows } = await client.query<OnlineSalesConfig>(
      'SELECT * FROM online_sales_config WHERE event_id = $1', [order.event_id]
    );
    const almacenId = configRows[0]?.almacen_id;
    const { rows: almRows } = await client.query<{ name: string }>(
      'SELECT name FROM almacenes WHERE id = $1', [almacenId]
    );
    const almacenName = almRows[0]?.name || 'silver_sol';

    // Marcar cartones como vendidos (igual que POS)
    if (order.card_ids.length > 0) {
      await client.query(
        `UPDATE cards SET is_sold = true, sold_at = CURRENT_TIMESTAMP,
         buyer_name = $1, buyer_phone = $2, buyer_cedula = $3
         WHERE id = ANY($4)`,
        [order.buyer_name, order.buyer_phone, order.buyer_cedula, order.card_ids]
      );

      await client.query(
        `UPDATE lotes SET cards_sold = (SELECT COUNT(*) FROM cards WHERE lote_id = lotes.id AND is_sold = true)
         WHERE id IN (SELECT DISTINCT lote_id FROM cards WHERE id = ANY($1) AND lote_id IS NOT NULL)`,
        [order.card_ids]
      );

      await client.query(
        `UPDATE lotes SET status = 'vendido_completo'
         WHERE id IN (SELECT DISTINCT lote_id FROM cards WHERE id = ANY($1) AND lote_id IS NOT NULL)
           AND cards_sold >= total_cards AND status != 'vendido_completo'`,
        [order.card_ids]
      );

      // Obtener seriales y códigos de los cartones
      const { rows: cardInfoRows } = await client.query<{ id: number; card_code: string; serial: string; lote_id: number | null }>(
        'SELECT id, card_code, serial, lote_id FROM cards WHERE id = ANY($1) ORDER BY card_number',
        [order.card_ids]
      );
      const seriales = cardInfoRows.map(c => c.serial).filter(Boolean);

      // Detalles completos de la venta digital
      const ventaDetalles = {
        source: 'venta_digital',
        order_code: order.order_code,
        buyer_name: order.buyer_name,
        buyer_phone: order.buyer_phone,
        buyer_email: order.buyer_email,
        buyer_cedula: order.buyer_cedula || null,
        cantidad: order.quantity,
        precio_unitario: Number(order.unit_price),
        monto_total: Number(order.total_amount),
        yappy_transaction_id: yappyTxnId || null,
        yappy_confirmed_by: confirmedBy,
        yappy_data: yappyTxnData || null,
        seriales,
      };

      // Crear documento de venta (inv_documentos)
      const docResult = await client.query(
        `INSERT INTO inv_documentos (event_id, accion, de_almacen_id, de_nombre, a_nombre, a_cedula, total_items, total_cartones, realizado_por)
         VALUES ($1, 'venta', $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [order.event_id, almacenId, almacenName, order.buyer_name, order.buyer_cedula || null,
         order.card_ids.length, order.card_ids.length, VENTA_DIGITAL_USER_ID]
      );
      const documentoId = docResult.rows[0].id;

      for (const cardRow of cardInfoRows) {
        await client.query(
          `INSERT INTO inv_movimientos (event_id, almacen_id, tipo_entidad, referencia, accion, de_persona, a_persona, cantidad_cartones, detalles, realizado_por, documento_id)
           VALUES ($1, $2, 'carton', $3, 'venta', $4, $5, 1, $6, $7, $8)`,
          [order.event_id, almacenId, cardRow.card_code, almacenName, order.buyer_name,
           JSON.stringify(ventaDetalles),
           VENTA_DIGITAL_USER_ID, documentoId]
        );
      }
    }

    // Obtener datos de cartones para PDF. El raspadito viene de c.promo_text,
    // que el sistema asigna individualmente a cada cartón al crear el lote
    // (distribuyendo los premios según promo_fixed_rules). NO recalcular
    // desde promo_fixed_rules por series_number: cartones distintos dentro
    // de la misma serie pueden tener premios distintos.
    const { rows: cards } = await client.query<CardRow & { serial: string; promo_text: string | null }>(
      `SELECT c.id, c.card_number, c.card_code, c.validation_code, c.numbers, c.serial,
              c.promo_text, e.use_free_center
       FROM cards c
       JOIN events e ON e.id = c.event_id
       WHERE c.id = ANY($1) ORDER BY c.card_number`,
      [order.card_ids]
    );

    cardDataForPdf = cards.map(c => ({
      cardNumber: c.card_number,
      cardCode: c.card_code,
      validationCode: c.validation_code,
      serial: c.serial || '',
      numbers: c.numbers,
      useFreeCenter: c.use_free_center ?? true,
      prizeName: c.promo_text || undefined,
    }));

    // Marcar como completada (sin PDF aún)
    await client.query(
      `UPDATE online_orders SET
        status = 'completed',
        payment_confirmed_at = NOW(),
        payment_confirmed_by = $1,
        yappy_transaction_id = $2,
        yappy_transaction_data = $3,
        updated_at = NOW()
       WHERE id = $4`,
      [confirmedBy, yappyTxnId || null, yappyTxnData ? JSON.stringify(yappyTxnData) : null, orderId]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // Generar PDF FUERA de la transacción (no bloquea la BD)
  try {
    const pdfPath = await generateCardsPDF(cardDataForPdf, { cardsPerPage: 4 });
    const downloadToken = randomBytes(32).toString('hex');

    await pool.query(
      `UPDATE online_orders SET pdf_path = $1, download_token = $2, updated_at = NOW() WHERE id = $3`,
      [pdfPath, downloadToken, orderId]
    );
  } catch (err) {
    console.error(`Error generando PDF para orden ${orderId}:`, err);
  }

  // Retornar orden actualizada
  const { rows } = await pool.query<OnlineOrder>('SELECT * FROM online_orders WHERE id = $1', [orderId]);
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
