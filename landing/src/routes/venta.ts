import { Router, Request, Response } from 'express';
import { createHmac } from 'crypto';
import { getPool } from '../database.js';
import { createOrder, getOrderByCode, getOrderByDownloadToken, getSalesConfig, confirmPayment } from '../services/orderService.js';
import { getYappyButtonClient } from '../services/yappyButtonService.js';
import { sendPurchaseEmail } from '../services/emailService.js';
import { createReadStream, existsSync } from 'fs';
import { resolve as resolvePath, sep as pathSep } from 'path';

// SEC-H5: whitelist de directorios desde donde es seguro servir PDFs generados.
// Todo pdf_path debe resolver a un archivo dentro de una de estas raíces.
const PDF_SAFE_ROOTS = [
  resolvePath(process.cwd(), 'exports'),
  resolvePath(process.cwd(), 'landing', 'exports'),
  resolvePath(process.cwd(), 'server', 'exports'),
].map((p) => (p.endsWith(pathSep) ? p : p + pathSep));

// Token de confirmación firmado — previene confirmaciones sin pago real
const CONFIRM_SECRET: string = process.env.CONFIRM_SECRET ?? (() => { console.error('❌ CONFIRM_SECRET env var es requerida'); process.exit(1); })();
function generateConfirmToken(orderCode: string, transactionId: string): string {
  return createHmac('sha256', CONFIRM_SECRET).update(orderCode + ':' + transactionId).digest('hex');
}
function validateConfirmToken(orderCode: string, transactionId: string, token: string): boolean {
  const expected = generateConfirmToken(orderCode, transactionId);
  return token === expected;
}

const router = Router();

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// GET /venta/:eventId - Landing page
router.get('/:eventId', async (req: Request, res: Response) => {
  try {
    const eventId = parseInt(req.params.eventId as string, 10);
    if (isNaN(eventId)) return res.status(400).send(renderError('Evento no válido'));

    const pool = getPool();
    const { rows: eventRows } = await pool.query(
      'SELECT id, name, total_cards, cards_sold FROM events WHERE id = $1',
      [eventId]
    );
    if (eventRows.length === 0) return res.status(404).send(renderError('Evento no encontrado'));

    const event = eventRows[0] as { id: number; name: string; total_cards: number; cards_sold: number };

    const config = await getSalesConfig(eventId);
    if (!config || !config.is_enabled) {
      return res.status(403).send(renderError('La venta online no está disponible para este evento'));
    }

    // Contar cartones realmente disponibles (no vendidos, no reservados, del almacen configurado)
    const almacenFilter = config.almacen_id ? 'AND almacen_id = $2' : '';
    const availParams: unknown[] = [eventId];
    if (config.almacen_id) availParams.push(config.almacen_id);

    // DB-C3: operador @> para permitir uso de índice GIN sobre card_ids.
    const { rows: availRows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM cards c
       WHERE c.event_id = $1 AND c.is_sold = FALSE
         ${almacenFilter}
         AND NOT EXISTS (
           SELECT 1 FROM online_orders o
           WHERE o.event_id = $1
             AND o.status IN ('pending_payment','payment_confirmed','cards_assigned')
             AND o.card_ids @> ARRAY[c.id]
         )`,
      availParams
    );
    const available = parseInt(availRows[0].count, 10);

    const yappy = getYappyButtonClient();
    const refRaw = req.query.ref;
    const ref = typeof refRaw === 'string' ? refRaw.slice(0, 120) : null;
    res.send(renderLanding(event, config, available, yappy.cdnUrl, ref));
  } catch (err) {
    console.error('Error en landing:', err);
    res.status(500).send(renderError('Error del servidor'));
  }
});

// POST /venta/api/orders - Crear orden
router.post('/api/orders', async (req: Request, res: Response) => {
  try {
    const { event_id, quantity, buyer_name, buyer_email, buyer_phone, buyer_cedula, ref_source } = req.body;

    if (!event_id || !quantity || !buyer_name || !buyer_email || !buyer_phone) {
      return res.status(400).json({ success: false, error: 'Faltan campos requeridos' });
    }
    const qty = parseInt(quantity, 10);
    if (isNaN(qty) || qty < 1) {
      return res.status(400).json({ success: false, error: 'Cantidad no válida' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyer_email)) {
      return res.status(400).json({ success: false, error: 'Email no válido' });
    }

    const order = await createOrder(
      parseInt(event_id, 10),
      qty,
      {
        buyer_name: buyer_name.trim(),
        buyer_email: buyer_email.trim().toLowerCase(),
        buyer_phone: buyer_phone.trim(),
        buyer_cedula: buyer_cedula?.trim() || undefined,
      },
      typeof ref_source === 'string' ? ref_source : null
    );

    res.json({
      success: true,
      data: {
        order_code: order.order_code,
        total_amount: order.total_amount,
        status: order.status,
        expires_at: order.expires_at,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error creando orden';
    console.error('Error creando orden:', msg);
    res.status(400).json({ success: false, error: msg });
  }
});

// POST /venta/api/yappy/initiate - Backend orquesta validate/merchant + payment-wc
router.post('/api/yappy/initiate', async (req: Request, res: Response) => {
  try {
    const { order_code } = req.body;
    if (!order_code) return res.status(400).json({ success: false, error: 'Falta order_code' });

    const order = await getOrderByCode(order_code.toUpperCase());
    if (!order) return res.status(404).json({ success: false, error: 'Orden no encontrada' });
    if (order.status !== 'pending_payment') {
      return res.status(400).json({ success: false, error: 'Orden no está pendiente de pago' });
    }

    const yappy = getYappyButtonClient();
    const totalNum = Number(order.total_amount);
    // Limpiar teléfono: quitar +507, espacios, guiones — dejar solo dígitos
    const tel = order.buyer_phone.replace(/[\s\-\+]/g, '').replace(/^507/, '');
    const params = await yappy.initiatePayment({
      orderId: order.order_code,
      total: totalNum,
      subtotal: totalNum,
      taxes: 0,
      tel,
    });

    // Generar token firmado para confirm-success
    const confirmToken = generateConfirmToken(order.order_code, params.transactionId);

    console.log(`✅ Yappy orden iniciada: ${order.order_code} → txn ${params.transactionId}`);
    res.json({ success: true, body: params, confirmToken });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error iniciando pago';
    console.error('Error Yappy initiate:', msg);
    res.status(500).json({ success: false, error: msg });
  }
});

// POST /venta/api/yappy/confirm-success - Confirmación desde eventSuccess del web component
// Requiere confirmToken firmado generado en /initiate (previene confirmaciones sin pago)
router.post('/api/yappy/confirm-success', async (req: Request, res: Response) => {
  try {
    const { order_code, confirmToken, transactionId } = req.body;
    if (!order_code) return res.status(400).json({ success: false, error: 'Falta order_code' });
    if (!confirmToken || !transactionId) {
      return res.status(400).json({ success: false, error: 'Token de confirmación inválido' });
    }

    // Validar token firmado
    if (!validateConfirmToken(order_code.toUpperCase(), transactionId, confirmToken)) {
      console.error(`⚠️ confirm-success token inválido para ${order_code}`);
      return res.status(403).json({ success: false, error: 'Token de confirmación inválido' });
    }

    const order = await getOrderByCode(order_code.toUpperCase());
    if (!order) return res.status(404).json({ success: false, error: 'Orden no encontrada' });

    if (order.status === 'completed') {
      return res.json({ success: true, already_confirmed: true });
    }
    if (order.status !== 'pending_payment') {
      return res.json({ success: true });
    }

    const confirmed = await confirmPayment(
      order.id,
      'yappy_event_success',
      transactionId,
      { source: 'web_component_eventSuccess', transactionId, confirmed_at: new Date().toISOString() }
    );

    // Email en background (solo si fue una confirmación nueva, no duplicada)
    if (confirmed.pdf_path && confirmed.download_token && !(confirmed as any)._alreadyConfirmed) {
      const pool = getPool();
      const { rows: cards } = await pool.query<{ card_code: string; serial: string }>(
        'SELECT card_code, serial FROM cards WHERE id = ANY($1) ORDER BY card_number',
        [confirmed.card_ids]
      );

      sendPurchaseEmail({
        order_code: confirmed.order_code,
        buyer_name: confirmed.buyer_name,
        buyer_email: confirmed.buyer_email,
        quantity: confirmed.quantity,
        total_amount: Number(confirmed.total_amount),
        download_token: confirmed.download_token,
        card_codes: cards.map(c => c.serial || c.card_code),
      }, confirmed.pdf_path).then(sent => {
        if (sent) {
          pool.query('UPDATE online_orders SET email_sent_at = NOW() WHERE id = $1', [confirmed.id]);
        }
      }).catch(err => console.error('Error enviando email:', err));
    }

    console.log(`✅ Orden ${confirmed.order_code} confirmada via eventSuccess`);
    res.json({ success: true, order_code: confirmed.order_code });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error confirmando';
    console.error('Error confirm-success:', msg);
    res.status(500).json({ success: false, error: msg });
  }
});

// GET /venta/api/orders/:orderCode/status - Status JSON (para polling)
router.get('/api/orders/:orderCode/status', async (req: Request, res: Response) => {
  try {
    const order = await getOrderByCode((req.params.orderCode as string).toUpperCase());
    if (!order) return res.status(404).json({ success: false, error: 'Orden no encontrada' });

    // SEC-H7: NO devolver download_url en el JSON público. El cliente
    // legítimo recarga la página al ver status completed y el render HTML
    // muestra el botón de descarga en contexto.
    res.json({
      success: true,
      data: {
        status: order.status,
        payment_confirmed_at: order.payment_confirmed_at,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error del servidor' });
  }
});

// GET /venta/estado/:orderCode - Página de estado
router.get('/estado/:orderCode', async (req: Request, res: Response) => {
  try {
    const order = await getOrderByCode((req.params.orderCode as string).toUpperCase());
    if (!order) return res.status(404).send(renderError('Orden no encontrada'));

    const config = await getSalesConfig(order.event_id);
    res.send(renderStatus(order, config));
  } catch (err) {
    console.error('Error en estado:', err);
    res.status(500).send(renderError('Error del servidor'));
  }
});

// GET /venta/preview-pdf/:eventId - Preview PDF (solo dev/test)
// ?card_code=XXXXX para un cartón específico, sin param = random
router.get('/preview-pdf/:eventId', async (req: Request, res: Response) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).send('Not found');
  }
  try {
    const eventId = parseInt(req.params.eventId as string, 10);
    const cardCode = req.query.card_code as string | undefined;
    const pool = getPool();

    const whereCard = cardCode ? 'AND c.card_code = $2' : '';
    const orderBy = cardCode ? '' : 'ORDER BY RANDOM()';
    const params: unknown[] = [eventId];
    if (cardCode) params.push(cardCode.toUpperCase());

    const { rows: cards } = await pool.query<{ card_number: number; card_code: string; validation_code: string; serial: string; numbers: any; use_free_center: boolean; series_number: string }>(
      `SELECT c.card_number, c.card_code, c.validation_code, c.serial, c.numbers,
              e.use_free_center, l.series_number
       FROM cards c JOIN events e ON e.id = c.event_id LEFT JOIN lotes l ON l.id = c.lote_id
       WHERE c.event_id = $1 ${whereCard} ${orderBy} LIMIT 1`, params
    );
    if (cards.length === 0) return res.status(404).send('No hay cartones disponibles');
    const c = cards[0];

    // Buscar premio raspadito
    let prizeName = 'Gracias por participar';
    if (c.series_number) {
      const { rows: prizes } = await pool.query<{ prize_name: string }>(
        `SELECT prize_name FROM promo_fixed_rules WHERE event_id = $1 AND $2 BETWEEN series_from AND series_to LIMIT 1`,
        [eventId, parseInt(c.series_number, 10)]
      );
      if (prizes.length > 0) prizeName = prizes[0].prize_name;
    }

    const { generateCardsPDF } = await import('../services/pdfService.js');
    const pdfPath = await generateCardsPDF([{
      cardNumber: c.card_number, cardCode: c.card_code, validationCode: c.validation_code,
      serial: c.serial || '', numbers: c.numbers, useFreeCenter: c.use_free_center ?? true, prizeName,
    }]);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="preview.pdf"');
    createReadStream(pdfPath).pipe(res);
  } catch (err) {
    console.error('Error preview PDF:', err);
    res.status(500).send('Error generando preview');
  }
});

// GET /venta/descargar/:downloadToken - Descarga PDF
router.get('/descargar/:downloadToken', async (req: Request, res: Response) => {
  try {
    const order = await getOrderByDownloadToken((req.params.downloadToken as string));
    if (!order || !order.pdf_path) {
      return res.status(404).send(renderError('Descarga no encontrada o aún no disponible'));
    }

    // SEC-H5: validar que pdf_path resuelva dentro de un directorio whitelistado.
    // Sin esto, cualquier bug que permita modificar pdf_path en BD podría servir
    // archivos arbitrarios del filesystem (/etc/passwd, secrets, etc.).
    const resolvedPath = resolvePath(order.pdf_path);
    const isSafe = PDF_SAFE_ROOTS.some((root) => resolvedPath.startsWith(root));
    if (!isSafe) {
      console.error(`[SEC-H5] pdf_path fuera de whitelist rechazado order=${order.order_code}`);
      return res.status(403).send(renderError('Archivo no disponible'));
    }

    if (!existsSync(resolvedPath)) {
      return res.status(404).send(renderError('Archivo PDF no encontrado'));
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="cartones_${order.order_code}.pdf"`);
    createReadStream(resolvedPath).pipe(res);
  } catch (err) {
    console.error('Error en descarga:', err);
    res.status(500).send(renderError('Error del servidor'));
  }
});

// GET /venta/api/yappy/ipn - IPN (Instant Payment Notification) de Yappy
// Yappy llama este endpoint con orderId, Hash, status, domain
router.get('/api/yappy/ipn', async (req: Request, res: Response) => {
  try {
    const params = req.query as Record<string, string>;
    // SEC-H8: no loguear params (incluyen Hash del IPN que no debe persistirse en logs).
    console.log(`[Yappy IPN] recibido orderId=${params.orderId} status=${params.status}`);

    const yappy = getYappyButtonClient();
    const result = yappy.validateIPN(params);

    if (!result.valid) {
      console.error('IPN inválido — hash no coincide o faltan params');
      return res.json({ success: false });
    }

    const order = await getOrderByCode(result.orderId.toUpperCase());
    if (!order) {
      console.error(`IPN: orden ${result.orderId} no encontrada`);
      return res.json({ success: false });
    }

    if (result.status === 'completed' && order.status === 'pending_payment') {
      const confirmed = await confirmPayment(
        order.id,
        'yappy_ipn',
        params.Hash || undefined,
        { source: 'yappy_ipn', status: params.status, hash: params.Hash, domain: params.domain, orderId: params.orderId }
      );

      // Enviar email en background (solo si no fue ya confirmada por eventSuccess)
      if (confirmed.pdf_path && confirmed.download_token && !(confirmed as any)._alreadyConfirmed) {
        const pool = getPool();
        const { rows: cards } = await pool.query<{ card_code: string; serial: string }>(
          'SELECT card_code, serial FROM cards WHERE id = ANY($1) ORDER BY card_number',
          [confirmed.card_ids]
        );

        sendPurchaseEmail({
          order_code: confirmed.order_code,
          buyer_name: confirmed.buyer_name,
          buyer_email: confirmed.buyer_email,
          quantity: confirmed.quantity,
          total_amount: Number(confirmed.total_amount),
          download_token: confirmed.download_token,
          card_codes: cards.map(c => c.serial || c.card_code),
        }, confirmed.pdf_path).then(sent => {
          if (sent) {
            pool.query('UPDATE online_orders SET email_sent_at = NOW() WHERE id = $1', [confirmed.id]);
          }
        }).catch(err => console.error('Error enviando email post-IPN:', err));
      }

      console.log(`✅ IPN: orden ${confirmed.order_code} confirmada`);
    } else if (result.status !== 'completed') {
      console.log(`⚠️ IPN: orden ${result.orderId} status=${result.status}`);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Error en IPN:', err);
    res.json({ success: false });
  }
});

// ─── HTML Renderers ──────────────────────────────────────────

function renderLayout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html { height: 100%; }
    body { font-family: 'Inter', -apple-system, sans-serif; background: url('/assets/fondo.jpg') no-repeat center center / cover; background-color: #c0272d; color: #1e293b; min-height: 100%; overflow-x: hidden; position: relative; }
    .container { max-width: 520px; margin: 0 auto; padding: 20px; }
    .logo { text-align: center; padding: 24px 0 8px; }
    .logo img { max-width: 240px; height: auto; filter: drop-shadow(0 4px 12px rgba(0,0,0,0.3)); }
    .card { background: white; border-radius: 20px; box-shadow: 0 8px 40px rgba(0,0,0,0.15); padding: 32px; margin-top: 12px; position: relative; overflow: hidden; }
    .card::before { display: none; }
    .rainbow { display: none; }
    h1 { font-size: 22px; font-weight: 800; color: #dc2626; text-align: center; letter-spacing: -0.5px; }
    h2 { font-size: 16px; font-weight: 600; color: #334155; margin-bottom: 16px; }
    .subtitle { text-align: center; color: #64748b; margin-top: 8px; font-size: 14px; line-height: 1.5; }
    label { display: block; font-size: 13px; font-weight: 600; color: #475569; margin-bottom: 6px; margin-top: 16px; text-transform: uppercase; letter-spacing: 0.5px; }
    input, select { width: 100%; padding: 12px 14px; border: 2px solid #e2e8f0; border-radius: 10px; font-size: 15px; font-family: 'Inter', sans-serif; transition: all 0.2s; background: #f8fafc; }
    input:focus, select:focus { outline: none; border-color: #3b82f6; box-shadow: 0 0 0 4px rgba(59,130,246,0.12); background: white; }
    .btn { display: block; width: 100%; padding: 15px; border: none; border-radius: 12px; font-size: 16px; font-weight: 700; cursor: pointer; transition: all 0.2s; margin-top: 24px; letter-spacing: 0.3px; }
    .btn-primary { background: linear-gradient(135deg, #b91c1c, #dc2626); color: white; box-shadow: 0 4px 14px rgba(185,28,28,0.4); }
    .btn-primary:hover { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(185,28,28,0.5); }
    .btn-primary:active { transform: translateY(0); }
    .btn-primary:disabled { background: #94a3b8; box-shadow: none; cursor: not-allowed; transform: none; }
    .btn-success { background: linear-gradient(135deg, #059669, #10b981); color: white; box-shadow: 0 4px 14px rgba(5,150,105,0.4); }
    .btn-success:hover { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(5,150,105,0.5); }
    .price-display { text-align: center; background: linear-gradient(135deg, #f0fdf4, #ecfdf5); border: 2px solid #86efac; border-radius: 14px; padding: 20px; margin: 20px 0; }
    .price-display .amount { font-size: 36px; font-weight: 800; color: #059669; letter-spacing: -1px; }
    .price-display .detail { font-size: 13px; color: #64748b; margin-top: 4px; }
    .status-badge { display: inline-block; padding: 8px 16px; border-radius: 24px; font-size: 13px; font-weight: 700; letter-spacing: 0.3px; }
    .status-pending { background: #fef3c7; color: #92400e; }
    .status-completed { background: #d1fae5; color: #065f46; }
    .status-expired { background: #fee2e2; color: #991b1b; }
    .order-code { font-family: 'Courier New', monospace; font-size: 28px; font-weight: 700; text-align: center; color: #1e40af; background: linear-gradient(135deg, #eff6ff, #dbeafe); padding: 18px; border-radius: 14px; margin: 16px 0; letter-spacing: 3px; border: 2px solid #bfdbfe; }
    .instructions { background: linear-gradient(135deg, #fffbeb, #fef3c7); border: 1px solid #fde68a; border-radius: 12px; padding: 18px; margin: 16px 0; font-size: 14px; color: #92400e; }
    .instructions ol { padding-left: 20px; }
    .instructions li { margin: 8px 0; line-height: 1.5; }
    .qr-container { text-align: center; margin: 20px 0; }
    .qr-container img { max-width: 250px; border-radius: 14px; border: 2px solid #e2e8f0; box-shadow: 0 4px 12px rgba(0,0,0,0.08); }
    .error-msg { color: #dc2626; font-size: 14px; margin-top: 8px; display: none; background: #fef2f2; padding: 10px 14px; border-radius: 8px; border: 1px solid #fecaca; }
    .info-row { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #f1f5f9; font-size: 14px; }
    .info-row:last-child { border-bottom: none; }
    .info-label { color: #64748b; }
    .info-value { font-weight: 600; color: #1e293b; }
    .footer { text-align: center; margin-top: 20px; padding: 16px; font-size: 11px; color: #94a3b8; }
    .footer span { display: block; margin-bottom: 8px; }
    .footer img { max-width: 80px; height: auto; opacity: 0.6; }
    .bingo-ball { position: fixed; pointer-events: none; z-index: 0; border-radius: 50%; }
    .bingo-ball .inner { position: absolute; border-radius: 50%; background: white; display: flex; flex-direction: column; align-items: center; justify-content: center; }
    .bingo-ball .letter { font-weight: 800; color: #94a3b8; line-height: 1; }
    .bingo-ball .number { font-weight: 800; color: #334155; line-height: 1; }
    .container { position: relative; z-index: 1; }
    @keyframes ball-float { 0% { transform: translateY(0px) rotate(0deg); } 100% { transform: translateY(-20px) rotate(5deg); } }
    btn-yappy { display: block; }
    btn-yappy::part(modal), btn-yappy div[class*="modal"], btn-yappy div[class*="overlay"] { position: fixed !important; top: 0 !important; left: 0 !important; width: 100vw !important; height: 100vh !important; display: flex !important; align-items: center !important; justify-content: center !important; z-index: 9999 !important; }
    .avail-tag { text-align: center; font-size: 13px; color: #64748b; margin-bottom: 8px; background: #f1f5f9; display: inline-block; padding: 4px 14px; border-radius: 20px; }
    .avail-wrap { text-align: center; margin-bottom: 4px; }
    @media (max-width: 480px) { .card { padding: 24px 20px; } h1 { font-size: 20px; } .price-display .amount { font-size: 30px; } }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">
      <img src="/assets/logo.png" alt="Mega Bingo TV Mundial" id="siteLogo">
    </div>
    ${body}
    <div class="footer">
      <span>Mega Bingo TV Mundial</span>
      <span style="font-weight:600;color:#64748b;margin-bottom:10px;">Yotumi S.A.</span>
      <img src="/assets/yotumi_logo.png" alt="Yotumi">
    </div>
  </div>
  <script src="/assets/checkout.js"></script>
</body>
</html>`;
}

function renderLanding(
  event: { id: number; name: string },
  config: { price_per_card: number; min_cards_per_order: number; max_cards_per_order: number; landing_title: string | null; landing_description: string | null },
  available: number,
  yappyCdnUrl: string,
  ref: string | null
): string {
  const title = 'Mega Bingo TV Mundial';
  const price = Number(config.price_per_card);
  const maxOrder = Math.min(config.max_cards_per_order, available);

  if (available <= 0) {
    const body = `
    <div class="card" style="text-align:center;">
      <h1 style="color:#475569;font-size:20px;font-weight:700;">¡Compra tus cartones digitales<br>por Yappy!</h1>
      <div style="margin:30px 0;">
        <div style="font-size:48px;">🔄</div>
        <h2 style="margin-top:16px;">Estamos actualizando nuestro inventario</h2>
        <p style="color:#64748b;margin-top:12px;line-height:1.6;">En este momento no hay cartones disponibles.<br>Vuelve a intentarlo en unos minutos.</p>
      </div>
      <button id="retryBtn" class="btn btn-primary">Reintentar</button>
    </div>`;
    return renderLayout(`${title} - No disponible`, body);
  }

  const body = `
    <div class="card">
      <h1 style="color:#475569;font-size:20px;font-weight:700;">¡Compra tus cartones digitales<br>por Yappy!</h1>
      <!-- Cartones disponibles oculto — no mostrar al público -->

      <form id="orderForm">
        <label for="quantity">Selecciona la cantidad de cartones que quieres comprar</label>
        <select id="quantity" name="quantity">
          ${Array.from({ length: maxOrder - config.min_cards_per_order + 1 }, (_, i) => {
            const n = i + config.min_cards_per_order;
            return `<option value="${n}">${n} cartón${n > 1 ? 'es' : ''}</option>`;
          }).join('')}
        </select>

        <div class="price-display">
          <div class="amount" id="totalPrice">$${(config.min_cards_per_order * price).toFixed(2)}</div>
          <div class="detail" id="priceDetail">${config.min_cards_per_order} ${config.min_cards_per_order > 1 ? 'cartones' : 'cartón'} x $${price.toFixed(2)} c/u</div>
        </div>

        <h2>Datos del comprador</h2>
        <p style="color:#64748b;font-size:13px;margin-bottom:8px;line-height:1.5;">Para enviarte tus cartones en formato digital, por favor ingresa la siguiente información.</p>

        <label for="buyer_name">Nombre completo *</label>
        <input type="text" id="buyer_name" name="buyer_name" required placeholder="Juan Perez">

        <label for="buyer_email">Email *</label>
        <input type="email" id="buyer_email" name="buyer_email" required placeholder="tu@email.com">

        <label for="buyer_phone">Teléfono asociado a tu cuenta Yappy *</label>
        <input type="tel" id="buyer_phone" name="buyer_phone" required placeholder="6123-4567">

        <div id="errorMsg" class="error-msg"></div>

        <button type="submit" class="btn btn-primary" id="submitBtn">
          Continuar
        </button>
      </form>

      <!-- Sección de pago Yappy (oculta hasta que se cree la orden) -->
      <div id="paymentSection" style="display:none;margin-top:24px;text-align:center;">
        <p style="color:#64748b;font-size:14px;margin-bottom:8px;">Tu orden ha sido creada:</p>
        <div id="orderCodeDisplay" class="order-code" style="margin-bottom:16px;"></div>
        <p style="color:#64748b;font-size:14px;margin-bottom:16px;">Haz clic en el botón de Yappy para pagar:</p>
        <div style="display:flex;justify-content:center;">
          <btn-yappy theme="darkBlue"></btn-yappy>
        </div>
        <p id="payStatus" style="color:#64748b;font-size:13px;margin-top:12px;"></p>
      </div>
    </div>

    <div id="appConfig" data-price="${escapeHtml(String(price))}" data-event-id="${escapeHtml(String(event.id))}" data-ref="${ref ? escapeHtml(ref) : ''}"></div>
    <script type="module" src="${yappyCdnUrl}"></script>`;

  return renderLayout(`Comprar Cartones - ${title}`, body);
}

function renderStatus(
  order: {
    order_code: string;
    status: string;
    quantity: number;
    total_amount: number;
    buyer_name: string;
    download_token: string | null;
    expires_at: string;
    event_id: number;
  },
  config: { yappy_qr_image: string | null; payment_instructions: string | null } | null
): string {
  let statusHtml = '';

  if (order.status === 'pending_payment') {
    const expiresAt = new Date(order.expires_at);
    statusHtml = `
      <span class="status-badge status-pending">Pendiente de pago</span>

      <div class="order-code">${escapeHtml(order.order_code)}</div>

      <div class="info-row"><span class="info-label">Cartones:</span><span class="info-value">${order.quantity}</span></div>
      <div class="info-row"><span class="info-label">Total a pagar:</span><span class="info-value" style="color:#059669;font-size:18px;">$${Number(order.total_amount).toFixed(2)}</span></div>
      <div class="info-row"><span class="info-label">Comprador:</span><span class="info-value">${escapeHtml(order.buyer_name)}</span></div>

      ${config?.yappy_qr_image ? `
        <div class="qr-container">
          <p style="font-weight:600;margin-bottom:10px;">Escanea con Yappy para pagar:</p>
          <img src="${escapeHtml(config.yappy_qr_image)}" alt="QR Yappy">
        </div>
      ` : ''}

      <div class="instructions">
        <strong>Instrucciones de pago:</strong>
        <ol>
          <li>Abre tu app de Yappy</li>
          ${config?.yappy_qr_image ? '<li>Escanea el código QR de arriba</li>' : '<li>Busca nuestro comercio en Yappy</li>'}
          <li>Ingresa el monto: <strong>$${Number(order.total_amount).toFixed(2)}</strong></li>
          <li>En la descripción/nota escribe: <strong>${escapeHtml(order.order_code)}</strong></li>
          <li>Confirma el pago</li>
        </ol>
        ${config?.payment_instructions ? `<p style="margin-top:10px;">${escapeHtml(config.payment_instructions)}</p>` : ''}
      </div>

      <p style="text-align:center;font-size:13px;color:#94a3b8;margin-top:16px;">
        Esta página se actualiza automáticamente. Tu orden expira a las ${expiresAt.toLocaleTimeString('es-PA')}.
      </p>

      <div id="appConfig" data-order-code="${escapeHtml(order.order_code)}"></div>
      <script src="/assets/order-status.js"></script>`;
  } else if (order.status === 'completed') {
    statusHtml = `
      <span class="status-badge status-completed">Pago confirmado</span>

      <div class="order-code">${escapeHtml(order.order_code)}</div>

      <div class="info-row"><span class="info-label">Cartones:</span><span class="info-value">${order.quantity}</span></div>
      <div class="info-row"><span class="info-label">Total pagado:</span><span class="info-value" style="color:#059669;">$${Number(order.total_amount).toFixed(2)}</span></div>
      <div class="info-row"><span class="info-label">Comprador:</span><span class="info-value">${escapeHtml(order.buyer_name)}</span></div>

      <a href="/venta/descargar/${escapeHtml(order.download_token || '')}" class="btn btn-success" style="text-decoration:none;text-align:center;">
        Descargar Cartones (PDF)
      </a>

      <a href="/venta/${order.event_id}" class="btn btn-primary" style="text-decoration:none;text-align:center;margin-top:12px;">
        Comprar más cartones
      </a>

      <p style="text-align:center;font-size:14px;color:#64748b;margin-top:16px;">
        También enviamos un enlace de descarga a tu email.
      </p>`;
  } else if (order.status === 'expired') {
    statusHtml = `
      <span class="status-badge status-expired">Orden expirada</span>

      <div class="order-code">${escapeHtml(order.order_code)}</div>

      <p style="text-align:center;color:#64748b;margin:20px 0;">
        Esta orden ha expirado porque no se recibió el pago a tiempo.
      </p>

      <a href="/venta/${order.event_id}" class="btn btn-primary" style="text-decoration:none;text-align:center;">
        Intentar de nuevo
      </a>`;
  } else {
    statusHtml = `
      <span class="status-badge" style="background:#e2e8f0;color:#475569;">${escapeHtml(order.status)}</span>
      <div class="order-code">${escapeHtml(order.order_code)}</div>
      <p style="text-align:center;color:#64748b;">Estado: ${escapeHtml(order.status)}</p>`;
  }

  const body = `
    <div class="card">
      <h1>Estado de tu Orden</h1>
      <div class="rainbow"></div>
      ${statusHtml}
    </div>`;

  return renderLayout(`Orden ${order.order_code}`, body);
}

function renderError(message: string): string {
  const body = `
    <div class="card">
      <h1>Error</h1>
      <div class="rainbow"></div>
      <p style="text-align:center;color:#dc2626;margin:20px 0;font-size:16px;">${escapeHtml(message)}</p>
    </div>`;
  return renderLayout('Error', body);
}

export default router;
