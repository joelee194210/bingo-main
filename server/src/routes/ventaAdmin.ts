import { Router, Request, Response } from 'express';
import { requirePermission } from '../middleware/auth.js';
import { getPool } from '../database/init.js';
import {
  getSalesConfig, upsertSalesConfig, getOrderById,
  confirmPayment, cancelOrder, listOrders,
} from '../services/onlineOrderService.js';
import { sendPurchaseEmail } from '../services/emailService.js';
import { generateCardsPDF } from '../services/exportService.js';

const router = Router();

// GET /api/venta/config/:eventId
router.get('/config/:eventId', requirePermission('cards:sell'), async (req: Request, res: Response) => {
  try {
    const eventId = parseInt((req.params.eventId as string), 10);
    const config = await getSalesConfig(eventId);
    res.json({ success: true, data: config });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error obteniendo configuracion' });
  }
});

// PUT /api/venta/config/:eventId
router.put('/config/:eventId', requirePermission('cards:sell'), async (req: Request, res: Response) => {
  try {
    const eventId = parseInt((req.params.eventId as string), 10);

    // Si se pasa almacen_name en vez de almacen_id, resolver
    if (req.body.almacen_name && !req.body.almacen_id) {
      const pool = getPool();
      const { rows } = await pool.query(
        'SELECT id FROM almacenes WHERE name = $1 AND event_id = $2 LIMIT 1',
        [req.body.almacen_name, eventId]
      );
      if (rows.length > 0) {
        req.body.almacen_id = rows[0].id;
      }
    }

    const config = await upsertSalesConfig(eventId, req.body);
    res.json({ success: true, data: config });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error actualizando configuracion';
    res.status(500).json({ success: false, error: msg });
  }
});

// GET /api/venta/orders
router.get('/orders', requirePermission('cards:sell'), async (req: Request, res: Response) => {
  try {
    const { event_id, status, search, date_from, date_to, limit, offset } = req.query;
    const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
    if (date_from && !ISO_DATE.test(date_from as string)) {
      return res.status(400).json({ success: false, error: 'date_from debe ser YYYY-MM-DD' });
    }
    if (date_to && !ISO_DATE.test(date_to as string)) {
      return res.status(400).json({ success: false, error: 'date_to debe ser YYYY-MM-DD' });
    }
    const VALID_STATUSES = ['pending_payment','payment_confirmed','cards_assigned','completed','expired','failed','cancelled'];
    if (status && !VALID_STATUSES.includes(status as string)) {
      return res.status(400).json({ success: false, error: 'status invalido' });
    }
    const result = await listOrders({
      event_id: event_id ? parseInt(event_id as string, 10) : undefined,
      status: status as string | undefined,
      search: search as string | undefined,
      date_from: date_from as string | undefined,
      date_to: date_to as string | undefined,
      limit: limit ? parseInt(limit as string, 10) : undefined,
      offset: offset ? parseInt(offset as string, 10) : undefined,
    });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error listando ordenes' });
  }
});

// GET /api/venta/orders/:id
router.get('/orders/:id', requirePermission('cards:sell'), async (req: Request, res: Response) => {
  try {
    const order = await getOrderById(parseInt((req.params.id as string), 10));
    if (!order) return res.status(404).json({ success: false, error: 'Orden no encontrada' });
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error obteniendo orden' });
  }
});

// POST /api/venta/orders/:id/confirm - Confirmación manual de pago
router.post('/orders/:id/confirm', requirePermission('cards:sell'), async (req: Request, res: Response) => {
  try {
    const orderId = parseInt((req.params.id as string), 10);
    const username = (req as unknown as { user?: { username?: string } }).user?.username || 'admin';

    const order = await confirmPayment(orderId, username);

    // Enviar email
    if (order.pdf_path && order.download_token) {
      const pool = getPool();
      const { rows: cards } = await pool.query<{ card_code: string }>(
        'SELECT card_code FROM cards WHERE id = ANY($1) ORDER BY card_number',
        [order.card_ids]
      );

      const emailSent = await sendPurchaseEmail({
        order_code: order.order_code,
        buyer_name: order.buyer_name,
        buyer_email: order.buyer_email,
        quantity: order.quantity,
        total_amount: Number(order.total_amount),
        download_token: order.download_token,
        card_codes: cards.map(c => c.card_code),
      }, order.pdf_path);

      if (emailSent) {
        await pool.query('UPDATE online_orders SET email_sent_at = NOW() WHERE id = $1', [orderId]);
      }
    }

    res.json({ success: true, data: order });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error confirmando pago';
    res.status(400).json({ success: false, error: msg });
  }
});

// POST /api/venta/orders/:id/cancel
router.post('/orders/:id/cancel', requirePermission('cards:sell'), async (req: Request, res: Response) => {
  try {
    const order = await cancelOrder(parseInt((req.params.id as string), 10));
    res.json({ success: true, data: order });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error cancelando orden';
    res.status(400).json({ success: false, error: msg });
  }
});

// POST /api/venta/orders/:id/resend - Reenviar email
router.post('/orders/:id/resend', requirePermission('cards:sell'), async (req: Request, res: Response) => {
  try {
    const order = await getOrderById(parseInt((req.params.id as string), 10));
    if (!order) return res.status(404).json({ success: false, error: 'Orden no encontrada' });
    if (order.status !== 'completed' || !order.pdf_path || !order.download_token) {
      return res.status(400).json({ success: false, error: 'La orden no tiene PDF para enviar' });
    }

    const pool = getPool();
    const { rows: cards } = await pool.query<{ card_code: string }>(
      'SELECT card_code FROM cards WHERE id = ANY($1) ORDER BY card_number',
      [order.card_ids]
    );

    const emailSent = await sendPurchaseEmail({
      order_code: order.order_code,
      buyer_name: order.buyer_name,
      buyer_email: order.buyer_email,
      quantity: order.quantity,
      total_amount: Number(order.total_amount),
      download_token: order.download_token,
      card_codes: cards.map(c => c.card_code),
    }, order.pdf_path);

    if (emailSent) {
      await pool.query('UPDATE online_orders SET email_sent_at = NOW() WHERE id = $1', [order.id]);
    }

    res.json({ success: true, sent: emailSent });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error reenviando email' });
  }
});

// POST /api/venta/descargar-digital - Genera y descarga PDF de un cartón por serial (admin only)
router.post('/descargar-digital', requirePermission('cards:sell'), async (req: Request, res: Response) => {
  try {
    const { serial } = req.body;
    if (!serial) {
      return res.status(400).json({ success: false, error: 'Serial es requerido' });
    }

    const pool = getPool();

    // Buscar cartón por serial
    const { rows: cards } = await pool.query<{
      id: number; card_number: number; card_code: string; validation_code: string;
      serial: string; numbers: any; event_id: number; lote_id: number | null;
    }>(
      `SELECT c.id, c.card_number, c.card_code, c.validation_code, c.serial, c.numbers, c.event_id, c.lote_id
       FROM cards c WHERE c.serial = $1 LIMIT 1`,
      [serial.trim()]
    );

    if (cards.length === 0) {
      // Intentar buscar con padding
      const padded = serial.includes('-')
        ? serial.split('-').map((p: string, i: number) => i === 0 ? p.padStart(5, '0') : p.padStart(2, '0')).join('-')
        : serial;
      const { rows: cards2 } = await pool.query(
        'SELECT id, card_number, card_code, validation_code, serial, numbers, event_id, lote_id FROM cards WHERE serial = $1 LIMIT 1',
        [padded]
      );
      if (cards2.length === 0) {
        return res.status(404).json({ success: false, error: 'Cartón no encontrado con ese serial' });
      }
      cards.push(cards2[0]);
    }

    const card = cards[0];

    // Obtener use_free_center del evento
    const { rows: eventRows } = await pool.query<{ use_free_center: boolean; name: string }>(
      'SELECT use_free_center, name FROM events WHERE id = $1', [card.event_id]
    );
    const useFreeCenter = eventRows[0]?.use_free_center ?? true;

    // Generar PDF con el formato estándar del server
    const pdfPath = await generateCardsPDF([{
      cardNumber: card.card_number,
      cardCode: card.card_code,
      validationCode: card.validation_code,
      numbers: card.numbers,
      useFreeCenter,
    }], { cardsPerPage: 1 });

    const username = (req as unknown as { user?: { username?: string } }).user?.username || 'admin';
    console.log(`📥 Descarga digital por ${username}: serial=${serial}, card_code=${card.card_code}`);

    res.json({
      success: true,
      data: {
        card_code: card.card_code,
        serial: card.serial,
        card_number: card.card_number,
        download_url: `/api/export/download/${pdfPath.split('/').pop()}`,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error generando PDF';
    console.error('Error descarga digital:', msg);
    res.status(500).json({ success: false, error: msg });
  }
});

// GET /api/venta/buscar-serial/:serial - Buscar cartón por serial (admin)
router.get('/buscar-serial/:serial', requirePermission('cards:sell'), async (req: Request, res: Response) => {
  try {
    const serial = (req.params.serial as string).trim();
    const pool = getPool();

    // Buscar con padding
    const padded = serial.includes('-')
      ? serial.split('-').map((p: string, i: number) => i === 0 ? p.padStart(5, '0') : p.padStart(2, '0')).join('-')
      : serial;

    const { rows } = await pool.query(
      `SELECT c.card_number, c.card_code, c.serial, c.is_sold, c.buyer_name,
              e.name as event_name, a.name as almacen_name
       FROM cards c
       JOIN events e ON e.id = c.event_id
       LEFT JOIN almacenes a ON a.id = c.almacen_id
       WHERE c.serial = $1 OR c.serial = $2
       LIMIT 1`,
      [serial, padded]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Cartón no encontrado' });
    }

    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error buscando cartón' });
  }
});

export default router;
