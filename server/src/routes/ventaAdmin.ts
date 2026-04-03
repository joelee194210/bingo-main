import { Router, Request, Response } from 'express';
import { requirePermission } from '../middleware/auth.js';
import { getPool } from '../database/init.js';
import {
  getSalesConfig, upsertSalesConfig, getOrderById,
  confirmPayment, cancelOrder, listOrders,
} from '../services/onlineOrderService.js';
import { sendPurchaseEmail } from '../services/emailService.js';

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
    const { event_id, status, limit, offset } = req.query;
    const result = await listOrders({
      event_id: event_id ? parseInt(event_id as string, 10) : undefined,
      status: status as string | undefined,
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

export default router;
