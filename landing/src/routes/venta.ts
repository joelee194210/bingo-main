import { Router, Request, Response } from 'express';
import { getPool } from '../database.js';
import { createOrder, getOrderByCode, getOrderByDownloadToken, getSalesConfig, confirmPayment } from '../services/orderService.js';
import { getYappyButtonClient } from '../services/yappyButtonService.js';
import { sendPurchaseEmail } from '../services/emailService.js';
import { createReadStream, existsSync } from 'fs';

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

    const { rows: availRows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM cards
       WHERE event_id = $1 AND is_sold = FALSE
         ${almacenFilter}
         AND id NOT IN (
           SELECT unnest(card_ids) FROM online_orders
           WHERE status IN ('pending_payment','payment_confirmed','cards_assigned')
             AND event_id = $1
         )`,
      availParams
    );
    const available = parseInt(availRows[0].count, 10);

    res.send(renderLanding(event, config, available));
  } catch (err) {
    console.error('Error en landing:', err);
    res.status(500).send(renderError('Error del servidor'));
  }
});

// POST /venta/api/orders - Crear orden
router.post('/api/orders', async (req: Request, res: Response) => {
  try {
    const { event_id, quantity, buyer_name, buyer_email, buyer_phone, buyer_cedula } = req.body;

    // Validaciones
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

    const order = await createOrder(parseInt(event_id, 10), qty, {
      buyer_name: buyer_name.trim(),
      buyer_email: buyer_email.trim().toLowerCase(),
      buyer_phone: buyer_phone.trim(),
      buyer_cedula: buyer_cedula?.trim() || undefined,
    });

    // Intentar generar URL de pago Yappy (Botón de Pago)
    let yappyPaymentUrl: string | null = null;
    const yappyBtn = getYappyButtonClient();
    if (yappyBtn.isConfigured()) {
      try {
        const totalNum = Number(order.total_amount);
        const result = await yappyBtn.getPaymentUrl({
          orderId: order.order_code,
          total: totalNum,
          subtotal: totalNum,
          taxes: 0,
        });
        if (result.success) {
          yappyPaymentUrl = result.redirectUrl;
        }
      } catch (err) {
        console.error('Error generando URL Yappy, fallback a QR:', err);
      }
    }

    res.json({
      success: true,
      data: {
        order_code: order.order_code,
        total_amount: order.total_amount,
        status: order.status,
        expires_at: order.expires_at,
        redirect_url: yappyPaymentUrl || `/venta/estado/${order.order_code}`,
        payment_method: yappyPaymentUrl ? 'yappy_button' : 'qr',
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error creando orden';
    console.error('Error creando orden:', msg);
    res.status(400).json({ success: false, error: msg });
  }
});

// GET /venta/api/orders/:orderCode/status - Status JSON (para polling)
router.get('/api/orders/:orderCode/status', async (req: Request, res: Response) => {
  try {
    const order = await getOrderByCode((req.params.orderCode as string).toUpperCase());
    if (!order) return res.status(404).json({ success: false, error: 'Orden no encontrada' });

    res.json({
      success: true,
      data: {
        status: order.status,
        payment_confirmed_at: order.payment_confirmed_at,
        download_url: order.download_token ? `/venta/descargar/${order.download_token}` : null,
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

// GET /venta/descargar/:downloadToken - Descarga PDF
router.get('/descargar/:downloadToken', async (req: Request, res: Response) => {
  try {
    const order = await getOrderByDownloadToken((req.params.downloadToken as string));
    if (!order || !order.pdf_path) {
      return res.status(404).send(renderError('Descarga no encontrada o aún no disponible'));
    }

    if (!existsSync(order.pdf_path)) {
      return res.status(404).send(renderError('Archivo PDF no encontrado'));
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="cartones_${order.order_code}.pdf"`);
    createReadStream(order.pdf_path).pipe(res);
  } catch (err) {
    console.error('Error en descarga:', err);
    res.status(500).send(renderError('Error del servidor'));
  }
});

// GET /venta/yappy/callback - Captura hash/query params o auto-confirma con order_code
router.get('/yappy/callback', (req: Request, res: Response) => {
  // Si vienen query params de Yappy, confirmar directamente
  if (req.query.orderId && req.query.status) {
    return handleYappyConfirm(req, res);
  }

  // Yappy puede enviar params como hash fragment o no enviar nada
  // El JS captura hash fragments y/o usa el order_code guardado para auto-confirmar
  res.send(renderLayout('Procesando pago...', `
    <div class="card" style="text-align:center;">
      <h1>Confirmando tu pago...</h1>
      <p id="msg" style="color:#64748b;margin-top:12px;">Espera un momento mientras procesamos tu compra.</p>
      <div id="spinner" style="margin:20px auto;width:40px;height:40px;border:4px solid #e2e8f0;border-top:4px solid #1e40af;border-radius:50%;animation:spin 1s linear infinite;"></div>
      <style>@keyframes spin{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}</style>
      <div id="errorBox" style="display:none;margin-top:20px;">
        <p id="errorMsg" style="color:#dc2626;"></p>
        <a href="/" class="btn btn-primary" style="text-decoration:none;text-align:center;margin-top:16px;">Volver al inicio</a>
      </div>
    </div>
    <script>
      (function() {
        var hash = window.location.hash.substring(1);
        var search = window.location.search.substring(1);
        var paramStr = hash || search;

        if (paramStr) {
          localStorage.removeItem('yappy_order_code');
          window.location.href = '/venta/yappy/confirm?' + paramStr;
          return;
        }

        // Auto-confirmar con order_code guardado
        var orderCode = localStorage.getItem('yappy_order_code');
        localStorage.removeItem('yappy_order_code');

        if (!orderCode) {
          document.getElementById('spinner').style.display = 'none';
          document.getElementById('errorMsg').textContent = 'No se encontro informacion de la orden.';
          document.getElementById('errorBox').style.display = 'block';
          return;
        }

        // Llamar al endpoint de auto-confirmacion
        fetch('/venta/api/yappy/auto-confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ order_code: orderCode })
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (data.success) {
            window.location.href = '/venta/estado/' + orderCode;
          } else {
            document.getElementById('spinner').style.display = 'none';
            document.getElementById('errorMsg').textContent = data.error || 'Error confirmando pago.';
            document.getElementById('errorBox').style.display = 'block';
          }
        })
        .catch(function() {
          window.location.href = '/venta/estado/' + orderCode;
        });
      })();
    </script>`));
});

// POST /venta/api/yappy/auto-confirm - Auto-confirma orden al regresar de Yappy
router.post('/api/yappy/auto-confirm', async (req: Request, res: Response) => {
  try {
    const { order_code } = req.body;
    if (!order_code) {
      return res.status(400).json({ success: false, error: 'Falta order_code' });
    }

    const order = await getOrderByCode(order_code.toUpperCase());
    if (!order) {
      return res.status(404).json({ success: false, error: 'Orden no encontrada' });
    }

    // Si ya está completada, solo devolver éxito
    if (order.status === 'completed') {
      return res.json({ success: true, already_confirmed: true });
    }

    if (order.status !== 'pending_payment') {
      return res.status(400).json({ success: false, error: `Orden en status: ${order.status}` });
    }

    // Auto-confirmar: el usuario pasó por el flujo de Yappy y fue redirigido de vuelta
    const confirmed = await confirmPayment(
      order.id,
      'yappy_auto',
      undefined,
      { source: 'yappy_button_auto_confirm', confirmed_at: new Date().toISOString() }
    );

    // Enviar email en background
    if (confirmed.pdf_path && confirmed.download_token) {
      const pool = getPool();
      const { rows: cards } = await pool.query<{ card_code: string }>(
        'SELECT card_code FROM cards WHERE id = ANY($1) ORDER BY card_number',
        [confirmed.card_ids]
      );

      sendPurchaseEmail({
        order_code: confirmed.order_code,
        buyer_name: confirmed.buyer_name,
        buyer_email: confirmed.buyer_email,
        quantity: confirmed.quantity,
        total_amount: Number(confirmed.total_amount),
        download_token: confirmed.download_token,
        card_codes: cards.map(c => c.card_code),
      }, confirmed.pdf_path).then(sent => {
        if (sent) {
          pool.query('UPDATE online_orders SET email_sent_at = NOW() WHERE id = $1', [confirmed.id]);
        }
      }).catch(err => console.error('Error enviando email post-Yappy:', err));
    }

    console.log(`✅ Auto-confirmada orden ${confirmed.order_code}`);
    res.json({ success: true, order_code: confirmed.order_code });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error confirmando';
    console.error('Error auto-confirm:', msg);
    res.status(500).json({ success: false, error: msg });
  }
});

// GET /venta/yappy/confirm - Procesa confirmación con params de Yappy
router.get('/yappy/confirm', handleYappyConfirm as never);
router.post('/yappy/callback', handleYappyConfirm as never);

async function handleYappyConfirm(req: Request, res: Response) {
  try {
    const params = { ...req.query, ...req.body } as Record<string, string>;
    console.log('Yappy confirm params:', JSON.stringify(params));

    const yappyBtn = getYappyButtonClient();
    const result = yappyBtn.validateCallback(params);

    if (!result.valid || !result.orderId) {
      return res.status(400).send(renderError('Respuesta de pago no válida'));
    }

    const order = await getOrderByCode(result.orderId.toUpperCase());
    if (!order) {
      return res.status(404).send(renderError('Orden no encontrada'));
    }

    if (result.status === 'completed' && order.status === 'pending_payment') {
      const confirmed = await confirmPayment(
        order.id,
        'yappy_button',
        result.confirmationNumber,
        { status: result.status, confirmationNumber: result.confirmationNumber, source: 'yappy_button' }
      );

      if (confirmed.pdf_path && confirmed.download_token) {
        const pool = getPool();
        const { rows: cards } = await pool.query<{ card_code: string }>(
          'SELECT card_code FROM cards WHERE id = ANY($1) ORDER BY card_number',
          [confirmed.card_ids]
        );

        sendPurchaseEmail({
          order_code: confirmed.order_code,
          buyer_name: confirmed.buyer_name,
          buyer_email: confirmed.buyer_email,
          quantity: confirmed.quantity,
          total_amount: Number(confirmed.total_amount),
          download_token: confirmed.download_token,
          card_codes: cards.map(c => c.card_code),
        }, confirmed.pdf_path).then(sent => {
          if (sent) {
            pool.query('UPDATE online_orders SET email_sent_at = NOW() WHERE id = $1', [confirmed.id]);
          }
        }).catch(err => console.error('Error enviando email post-Yappy:', err));
      }
    }

    res.redirect(`/venta/estado/${order.order_code}`);
  } catch (err) {
    console.error('Error en Yappy confirm:', err);
    res.status(500).send(renderError('Error procesando pago'));
  }
}

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
    body { font-family: 'Inter', -apple-system, sans-serif; background: linear-gradient(135deg, #0f172a 0%, #1e3a5f 50%, #0f172a 100%); color: #1e293b; min-height: 100vh; }
    .container { max-width: 520px; margin: 0 auto; padding: 20px; }
    .logo { text-align: center; padding: 24px 0 8px; }
    .logo img { max-width: 240px; height: auto; filter: drop-shadow(0 4px 12px rgba(0,0,0,0.3)); }
    .card { background: white; border-radius: 20px; box-shadow: 0 8px 40px rgba(0,0,0,0.15); padding: 32px; margin-top: 12px; position: relative; overflow: hidden; }
    .card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 5px; background: linear-gradient(90deg, #ef4444, #f97316, #eab308, #22c55e, #3b82f6, #8b5cf6); }
    .rainbow { display: none; }
    h1 { font-size: 22px; font-weight: 800; color: #1e293b; text-align: center; letter-spacing: -0.5px; }
    h2 { font-size: 16px; font-weight: 600; color: #334155; margin-bottom: 16px; }
    .subtitle { text-align: center; color: #64748b; margin-top: 8px; font-size: 14px; line-height: 1.5; }
    label { display: block; font-size: 13px; font-weight: 600; color: #475569; margin-bottom: 6px; margin-top: 16px; text-transform: uppercase; letter-spacing: 0.5px; }
    input, select { width: 100%; padding: 12px 14px; border: 2px solid #e2e8f0; border-radius: 10px; font-size: 15px; font-family: 'Inter', sans-serif; transition: all 0.2s; background: #f8fafc; }
    input:focus, select:focus { outline: none; border-color: #3b82f6; box-shadow: 0 0 0 4px rgba(59,130,246,0.12); background: white; }
    .btn { display: block; width: 100%; padding: 15px; border: none; border-radius: 12px; font-size: 16px; font-weight: 700; cursor: pointer; transition: all 0.2s; margin-top: 24px; letter-spacing: 0.3px; }
    .btn-primary { background: linear-gradient(135deg, #1e40af, #3b82f6); color: white; box-shadow: 0 4px 14px rgba(30,64,175,0.4); }
    .btn-primary:hover { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(30,64,175,0.5); }
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
    .footer { text-align: center; margin-top: 20px; padding: 16px; font-size: 11px; color: rgba(255,255,255,0.4); }
    .footer span { display: block; margin-bottom: 8px; }
    .footer img { max-width: 80px; height: auto; opacity: 0.5; }
    .avail-tag { text-align: center; font-size: 13px; color: #64748b; margin-bottom: 8px; background: #f1f5f9; display: inline-block; padding: 4px 14px; border-radius: 20px; }
    .avail-wrap { text-align: center; margin-bottom: 4px; }
    @media (max-width: 480px) { .card { padding: 24px 20px; } h1 { font-size: 20px; } .price-display .amount { font-size: 30px; } }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">
      <img src="/assets/logo.png" alt="Mega Bingo Digital" onerror="this.style.display='none'">
    </div>
    ${body}
    <div class="footer">
      <span>Powered by</span>
      <img src="/assets/yotumi_logo.png" alt="Yotumi">
    </div>
  </div>
</body>
</html>`;
}

function renderLanding(
  event: { id: number; name: string },
  config: { price_per_card: number; min_cards_per_order: number; max_cards_per_order: number; landing_title: string | null; landing_description: string | null },
  available: number
): string {
  const title = config.landing_title || event.name;
  const price = Number(config.price_per_card);
  const maxOrder = Math.min(config.max_cards_per_order, available);

  if (available <= 0) {
    const body = `
    <div class="card" style="text-align:center;">
      <h1>${escapeHtml(title)}</h1>
      <div style="margin:30px 0;">
        <div style="font-size:48px;">🔄</div>
        <h2 style="margin-top:16px;">Estamos actualizando nuestro inventario</h2>
        <p style="color:#64748b;margin-top:12px;line-height:1.6;">En este momento no hay cartones disponibles.<br>Vuelve a intentarlo en unos minutos.</p>
      </div>
      <button onclick="location.reload()" class="btn btn-primary">Reintentar</button>
    </div>`;
    return renderLayout(`${title} - No disponible`, body);
  }

  const body = `
    <div class="card">
      <h1>${escapeHtml(title)}</h1>
      ${config.landing_description ? `<p class="subtitle">${escapeHtml(config.landing_description)}</p>` : ''}
      <div class="avail-wrap"><span class="avail-tag">${available} cartones disponibles</span></div>

      <form id="orderForm">
        <label for="quantity">Cantidad de cartones</label>
        <select id="quantity" name="quantity">
          ${Array.from({ length: maxOrder - config.min_cards_per_order + 1 }, (_, i) => {
            const n = i + config.min_cards_per_order;
            return `<option value="${n}">${n} carton${n > 1 ? 'es' : ''}</option>`;
          }).join('')}
        </select>

        <div class="price-display">
          <div class="amount" id="totalPrice">$${(config.min_cards_per_order * price).toFixed(2)}</div>
          <div class="detail" id="priceDetail">${config.min_cards_per_order} x $${price.toFixed(2)} c/u</div>
        </div>

        <h2>Datos del comprador</h2>

        <label for="buyer_name">Nombre completo *</label>
        <input type="text" id="buyer_name" name="buyer_name" required placeholder="Juan Perez">

        <label for="buyer_email">Email *</label>
        <input type="email" id="buyer_email" name="buyer_email" required placeholder="tu@email.com">

        <label for="buyer_phone">Telefono *</label>
        <input type="tel" id="buyer_phone" name="buyer_phone" required placeholder="+507 6123-4567">


        <div id="errorMsg" class="error-msg"></div>

        <button type="submit" class="btn btn-primary" id="submitBtn">
          Comprar Cartones
        </button>
      </form>
    </div>

    <script>
      var PRICE = ${price};
      var EVENT_ID = ${event.id};
      var MIN = ${config.min_cards_per_order};

      function updatePrice() {
        var qty = parseInt(document.getElementById('quantity').value);
        var total = qty * PRICE;
        document.getElementById('totalPrice').textContent = '$' + total.toFixed(2);
        document.getElementById('priceDetail').textContent = qty + ' x $' + PRICE.toFixed(2) + ' c/u';
      }

      document.getElementById('quantity').addEventListener('change', updatePrice);

      document.getElementById('orderForm').addEventListener('submit', function(e) {
        e.preventDefault();
        e.stopPropagation();
        var btn = document.getElementById('submitBtn');
        var errEl = document.getElementById('errorMsg');
        errEl.style.display = 'none';
        btn.disabled = true;
        btn.textContent = 'Procesando...';

        var body = JSON.stringify({
          event_id: EVENT_ID,
          quantity: parseInt(document.getElementById('quantity').value),
          buyer_name: document.getElementById('buyer_name').value,
          buyer_email: document.getElementById('buyer_email').value,
          buyer_phone: document.getElementById('buyer_phone').value,
          buyer_cedula: '',
        });

        fetch('/venta/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: body
        })
        .then(function(res) { return res.json(); })
        .then(function(data) {
          if (!data.success) {
            errEl.textContent = data.error || 'Error al crear la orden';
            errEl.style.display = 'block';
            btn.disabled = false;
            btn.textContent = 'Comprar Cartones';
            return;
          }
          if (data.data.payment_method === 'yappy_button') {
            btn.textContent = 'Redirigiendo a Yappy...';
            localStorage.setItem('yappy_order_code', data.data.order_code);
          }
          window.location.href = data.data.redirect_url;
        })
        .catch(function() {
          errEl.textContent = 'Error de conexion. Intenta de nuevo.';
          errEl.style.display = 'block';
          btn.disabled = false;
          btn.textContent = 'Comprar Cartones';
        });
      });
    </script>`;

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
          ${config?.yappy_qr_image ? '<li>Escanea el codigo QR de arriba</li>' : '<li>Busca nuestro comercio en Yappy</li>'}
          <li>Ingresa el monto: <strong>$${Number(order.total_amount).toFixed(2)}</strong></li>
          <li>En la descripcion/nota escribe: <strong>${escapeHtml(order.order_code)}</strong></li>
          <li>Confirma el pago</li>
        </ol>
        ${config?.payment_instructions ? `<p style="margin-top:10px;">${escapeHtml(config.payment_instructions)}</p>` : ''}
      </div>

      <p style="text-align:center;font-size:13px;color:#94a3b8;margin-top:16px;">
        Esta pagina se actualiza automaticamente. Tu orden expira a las ${expiresAt.toLocaleTimeString('es-PA')}.
      </p>

      <script>
        setInterval(async function() {
          try {
            var res = await fetch('/venta/api/orders/${escapeHtml(order.order_code)}/status');
            var data = await res.json();
            if (data.success && data.data.status !== 'pending_payment') {
              window.location.reload();
            }
          } catch(e) {}
        }, 10000);
      </script>`;
  } else if (order.status === 'completed') {
    statusHtml = `
      <span class="status-badge status-completed">Pago confirmado</span>

      <div class="order-code">${escapeHtml(order.order_code)}</div>

      <div class="info-row"><span class="info-label">Cartones:</span><span class="info-value">${order.quantity}</span></div>
      <div class="info-row"><span class="info-label">Total pagado:</span><span class="info-value" style="color:#059669;">$${Number(order.total_amount).toFixed(2)}</span></div>
      <div class="info-row"><span class="info-label">Comprador:</span><span class="info-value">${escapeHtml(order.buyer_name)}</span></div>

      <a href="/venta/descargar/${order.download_token}" class="btn btn-success" style="text-decoration:none;text-align:center;">
        Descargar Cartones (PDF)
      </a>

      <p style="text-align:center;font-size:14px;color:#64748b;margin-top:16px;">
        Tambien enviamos un enlace de descarga a tu email.
      </p>`;
  } else if (order.status === 'expired') {
    statusHtml = `
      <span class="status-badge status-expired">Orden expirada</span>

      <div class="order-code">${escapeHtml(order.order_code)}</div>

      <p style="text-align:center;color:#64748b;margin:20px 0;">
        Esta orden ha expirado porque no se recibio el pago a tiempo.
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
