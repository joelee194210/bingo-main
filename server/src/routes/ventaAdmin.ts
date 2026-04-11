import { Router, Request, Response } from 'express';
import { requirePermission } from '../middleware/auth.js';
import { getPool } from '../database/init.js';
import {
  getSalesConfig, upsertSalesConfig, getOrderById,
  confirmPayment, cancelOrder, listOrders,
} from '../services/onlineOrderService.js';
import { sendPurchaseEmail } from '../services/emailService.js';
import { generateDigitalPDF } from '../services/digitalPdfService.js';

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
    if (!Number.isInteger(eventId) || eventId <= 0) {
      return res.status(400).json({ success: false, error: 'event_id inválido' });
    }

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

    // SEC-H9/TS-H12: validar campos antes de pasar a upsertSalesConfig.
    // Antes pasábamos req.body completo; el allowlist del service filtraba
    // campos pero no validaba tipos/rangos (price_per_card negativo,
    // min_cards > max_cards, strings vacíos, etc.).
    const validation = validateSalesConfigInput(req.body);
    if (!validation.valid) {
      return res.status(400).json({ success: false, error: validation.error });
    }

    const config = await upsertSalesConfig(eventId, validation.data);
    res.json({ success: true, data: config });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error actualizando configuracion';
    res.status(500).json({ success: false, error: msg });
  }
});

// SEC-H9/TS-H12: validador tipado y con reglas de negocio para el body de
// PUT /config/:eventId. Solo deja pasar campos editables con tipos correctos.
type SalesConfigInput = {
  is_enabled?: boolean;
  price_per_card?: number;
  max_cards_per_order?: number;
  min_cards_per_order?: number;
  almacen_id?: number | null;
  yappy_qr_image?: string | null;
  yappy_collection_alias?: string | null;
  payment_instructions?: string | null;
  order_expiry_minutes?: number;
  landing_title?: string | null;
  landing_description?: string | null;
};

function validateSalesConfigInput(body: unknown):
  | { valid: true; data: SalesConfigInput }
  | { valid: false; error: string } {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Body inválido' };
  }
  const input = body as Record<string, unknown>;
  const out: SalesConfigInput = {};

  if ('is_enabled' in input) {
    if (typeof input.is_enabled !== 'boolean') {
      return { valid: false, error: 'is_enabled debe ser boolean' };
    }
    out.is_enabled = input.is_enabled;
  }

  if ('price_per_card' in input && input.price_per_card !== null && input.price_per_card !== undefined) {
    const n = Number(input.price_per_card);
    if (!Number.isFinite(n) || n <= 0 || n > 10000) {
      return { valid: false, error: 'price_per_card debe ser > 0 y <= 10000' };
    }
    out.price_per_card = n;
  }

  if ('max_cards_per_order' in input && input.max_cards_per_order !== null) {
    const n = Number(input.max_cards_per_order);
    if (!Number.isInteger(n) || n < 1 || n > 10000) {
      return { valid: false, error: 'max_cards_per_order debe ser entero entre 1 y 10000' };
    }
    out.max_cards_per_order = n;
  }

  if ('min_cards_per_order' in input && input.min_cards_per_order !== null) {
    const n = Number(input.min_cards_per_order);
    if (!Number.isInteger(n) || n < 1 || n > 10000) {
      return { valid: false, error: 'min_cards_per_order debe ser entero entre 1 y 10000' };
    }
    out.min_cards_per_order = n;
  }

  if (
    out.min_cards_per_order !== undefined &&
    out.max_cards_per_order !== undefined &&
    out.min_cards_per_order > out.max_cards_per_order
  ) {
    return { valid: false, error: 'min_cards_per_order no puede ser mayor que max_cards_per_order' };
  }

  if ('almacen_id' in input) {
    if (input.almacen_id === null || input.almacen_id === undefined) {
      out.almacen_id = null;
    } else {
      const n = Number(input.almacen_id);
      if (!Number.isInteger(n) || n <= 0) {
        return { valid: false, error: 'almacen_id inválido' };
      }
      out.almacen_id = n;
    }
  }

  if ('order_expiry_minutes' in input && input.order_expiry_minutes !== null) {
    const n = Number(input.order_expiry_minutes);
    if (!Number.isInteger(n) || n < 1 || n > 1440) {
      return { valid: false, error: 'order_expiry_minutes debe ser entero entre 1 y 1440' };
    }
    out.order_expiry_minutes = n;
  }

  // Strings opcionales — solo verificar tipo y longitud.
  const stringFields: Array<keyof SalesConfigInput> = [
    'yappy_qr_image',
    'yappy_collection_alias',
    'payment_instructions',
    'landing_title',
    'landing_description',
  ];
  for (const key of stringFields) {
    if (key in input) {
      const v = input[key];
      if (v === null) {
        (out as Record<string, unknown>)[key] = null;
      } else if (typeof v === 'string') {
        if (v.length > 2000) {
          return { valid: false, error: `${String(key)} demasiado largo` };
        }
        (out as Record<string, unknown>)[key] = v;
      } else {
        return { valid: false, error: `${String(key)} debe ser string o null` };
      }
    }
  }

  return { valid: true, data: out };
}

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

// POST /api/venta/orders/:id/resend - Reenviar email.
// El PDF vive en el volumen del servicio landing (megabingodigital), que es
// distinto del volumen de este server. Por eso delegamos por HTTP al landing:
// el landing lee el PDF de su propio disco y manda el correo.
//
// URL y secret están hardcoded porque el repo es privado y las env vars de
// Railway no se estaban propagando al runtime. Si se abre el repo a público,
// mover a env vars y rotar el secret.
const LANDING_INTERNAL_URL_FALLBACK = 'https://megabingodigital.com';
const INTERNAL_RESEND_SECRET_FALLBACK = '1706ad40b38c416e09c5009b340b87d232ae4eb4cd3360c2c0ac9e089ebf6a51';

router.post('/orders/:id/resend', requirePermission('cards:sell'), async (req: Request, res: Response) => {
  try {
    const orderId = parseInt((req.params.id as string), 10);
    if (!Number.isInteger(orderId) || orderId <= 0) {
      return res.status(400).json({ success: false, error: 'ID inválido' });
    }

    const landingUrl = process.env.LANDING_INTERNAL_URL || LANDING_INTERNAL_URL_FALLBACK;
    const secret = process.env.INTERNAL_API_SECRET || INTERNAL_RESEND_SECRET_FALLBACK;

    const url = `${landingUrl.replace(/\/$/, '')}/venta/internal/orders/${orderId}/resend`;
    const upstream = await fetch(url, {
      method: 'POST',
      headers: { 'x-internal-secret': secret, 'content-type': 'application/json' },
    });

    const body = await upstream.json().catch(() => ({ success: false, error: 'Respuesta inválida del landing' }));
    return res.status(upstream.status).json(body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error reenviando email';
    console.error('Error en /orders/:id/resend (proxy landing):', msg);
    res.status(502).json({ success: false, error: `No se pudo contactar al landing: ${msg}` });
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

    // Generar PDF con plantilla oficial (mismo formato que venta digital)
    const pdfPath = await generateDigitalPDF([{
      cardNumber: card.card_number,
      cardCode: card.card_code,
      validationCode: card.validation_code,
      serial: card.serial,
      numbers: card.numbers,
      useFreeCenter,
    }]);

    const username = (req as unknown as { user?: { username?: string } }).user?.username || 'admin';
    console.log(`📥 Descarga digital por ${username}: serial=${serial}, card_code=${card.card_code}`);

    // Servir PDF directamente
    const { createReadStream, existsSync } = await import('fs');
    if (!existsSync(pdfPath)) {
      return res.status(500).json({ success: false, error: 'PDF generado pero no encontrado en disco' });
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="carton_${card.serial}.pdf"`);
    createReadStream(pdfPath).pipe(res);
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
