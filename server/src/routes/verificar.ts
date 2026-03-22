import { Router, Request, Response } from 'express';
import { getPool } from '../database/init.js';

const router = Router();

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

interface CardRow {
  card_code: string;
  serial: string;
  is_sold: boolean;
  event_name: string;
  event_created_at: string;
  buyer_name: string | null;
  numbers: string;
  promo_text: string | null;
  use_free_center: boolean;
}

// /verificar/ sin código → instrucciones
router.get('/', (_req: Request, res: Response) => {
  res.send(renderPage(null, 'Escanea el QR de tu cartón para verificarlo'));
});

// Preview temporal — simula cartón activo sin modificar DB
router.get('/preview/:card_code', async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const result = await pool.query<CardRow>(
      `SELECT c.card_code, c.serial, c.is_sold, c.buyer_name, c.numbers, c.promo_text,
              e.name AS event_name, e.created_at AS event_created_at, e.use_free_center
       FROM cards c
       JOIN events e ON e.id = c.event_id
       WHERE c.card_code = $1
       LIMIT 1`,
      [(req.params.card_code as string).toUpperCase()]
    );
    if (result.rows.length === 0) return res.status(404).send(renderPage(null, 'Cartón no encontrado'));
    const card = { ...result.rows[0], is_sold: true, buyer_name: result.rows[0].buyer_name || 'Juan Perez' };
    return res.send(renderPage(card, null));
  } catch (err) {
    return res.status(500).send(renderPage(null, 'Error del servidor'));
  }
});

router.get('/:card_code', async (req: Request, res: Response) => {
  const { card_code } = req.params;

  if (!card_code || card_code.length < 3 || card_code.length > 10) {
    return res.status(400).send(renderPage(null, 'Código inválido'));
  }

  try {
    const pool = getPool();
    const result = await pool.query<CardRow>(
      `SELECT c.card_code, c.serial, c.is_sold, c.buyer_name, c.numbers, c.promo_text,
              e.name AS event_name, e.created_at AS event_created_at, e.use_free_center
       FROM cards c
       JOIN events e ON e.id = c.event_id
       WHERE c.card_code = $1
       LIMIT 1`,
      [(card_code as string).toUpperCase()]
    );

    if (result.rows.length === 0) {
      return res.status(404).send(renderPage(null, 'Cartón no encontrado'));
    }

    const card = result.rows[0];
    return res.send(renderPage(card, null));
  } catch (err) {
    console.error('Error verificando cartón:', err);
    return res.status(500).send(renderPage(null, 'Error del servidor'));
  }
});

function renderNumbers(numbersJson: string | Record<string, number[]>, useFreeCenter: boolean): string {
  try {
    const numbers: number[][] = typeof numbersJson === 'string' ? JSON.parse(numbersJson) : Object.values(numbersJson);
    const cols = ['B', 'I', 'N', 'G', 'O'];
    const colColors = ['#e53e3e', '#dd6b20', '#38a169', '#3182ce', '#805ad5'];
    let html = '<table class="bingo-table"><thead><tr>';
    for (let i = 0; i < cols.length; i++) {
      html += `<th style="background:${colColors[i]}">${cols[i]}</th>`;
    }
    html += '</tr></thead><tbody>';
    for (let row = 0; row < 5; row++) {
      html += '<tr>';
      for (let col = 0; col < 5; col++) {
        const num = numbers[col][row];
        const isFree = useFreeCenter && row === 2 && col === 2;
        html += `<td${isFree ? ' class="free"' : ''}>${isFree ? '★' : num}</td>`;
      }
      html += '</tr>';
    }
    html += '</tbody></table>';
    return html;
  } catch {
    return '';
  }
}

function renderPage(card: CardRow | null, error: string | null): string {
  const logoUrl = '/logo.png';

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verificar Cart&oacute;n - Mega Bingo Mundial</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #ffffff;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 20px 16px;
      color: #1f2937;
    }
    .container {
      max-width: 420px;
      width: 100%;
    }
    .logo-section {
      text-align: center;
      margin-bottom: 20px;
      padding-top: 8px;
    }
    .logo-section img {
      max-width: 220px;
      height: auto;
    }
    .logo-section .subtitle {
      color: #6b7280;
      font-size: 13px;
      font-weight: 500;
      margin-top: 8px;
      letter-spacing: 0.5px;
    }
    .divider {
      height: 3px;
      background: linear-gradient(90deg, #e53e3e, #dd6b20, #ecc94b, #38a169, #3182ce, #805ad5);
      border-radius: 2px;
      margin-bottom: 24px;
    }
    .main-card {
      background: #ffffff;
      border: 1px solid #e5e7eb;
      border-radius: 16px;
      padding: 24px 20px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.06);
    }
    .status-badge {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 14px 20px;
      border-radius: 12px;
      font-size: 18px;
      font-weight: 800;
      letter-spacing: 1.5px;
      margin-bottom: 12px;
    }
    .status-badge.active {
      background: #dcfce7;
      border: 2px solid #16a34a;
      color: #16a34a;
    }
    .status-badge.inactive {
      background: #fef3c7;
      border: 2px solid #d97706;
      color: #b45309;
    }
    .message {
      border-radius: 12px;
      padding: 14px 18px;
      margin-bottom: 20px;
      font-size: 14px;
      line-height: 1.5;
    }
    .message p { margin: 0; }
    .message.success {
      background: #f0fdf4;
      color: #166534;
    }
    .message.warning {
      background: #fffbeb;
      color: #92400e;
    }
    .info-grid {
      display: grid;
      gap: 8px;
      margin-bottom: 20px;
    }
    .info-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 16px;
      background: #f9fafb;
      border-radius: 10px;
      border: 1px solid #f3f4f6;
    }
    .info-label {
      color: #6b7280;
      font-size: 13px;
      font-weight: 500;
    }
    .info-value {
      color: #111827;
      font-weight: 700;
      font-size: 14px;
    }
    .bingo-table {
      width: 100%;
      border-collapse: separate;
      border-spacing: 3px;
      margin-bottom: 20px;
    }
    .bingo-table th {
      color: white;
      padding: 10px 0;
      font-size: 17px;
      font-weight: 800;
      border-radius: 8px 8px 4px 4px;
      text-shadow: 0 1px 2px rgba(0,0,0,0.2);
    }
    .bingo-table td {
      text-align: center;
      padding: 10px 0;
      font-size: 15px;
      font-weight: 600;
      color: #1f2937;
      background: #f9fafb;
      border-radius: 6px;
      border: 1px solid #e5e7eb;
    }
    .bingo-table td.free {
      color: #d97706;
      font-size: 20px;
      background: #fffbeb;
      border-color: #fcd34d;
    }
    .promo {
      text-align: center;
      padding: 14px 16px;
      background: linear-gradient(135deg, #fef3c7, #fce7f3);
      border: 1px solid #fbbf24;
      border-radius: 12px;
      color: #92400e;
      font-weight: 700;
      font-size: 14px;
      margin-bottom: 16px;
    }
    .footer {
      text-align: center;
      color: #9ca3af;
      font-size: 11px;
      margin-top: 24px;
      padding-bottom: 8px;
    }
    .footer .fecha {
      color: #6b7280;
      font-size: 12px;
      font-weight: 500;
      margin-bottom: 4px;
      text-transform: capitalize;
    }
    .error-box {
      text-align: center;
      padding: 40px 20px;
    }
    .error-box .icon { font-size: 48px; margin-bottom: 16px; }
    .error-box h2 { color: #dc2626; margin-bottom: 8px; font-size: 18px; }
    .error-box p { color: #6b7280; font-size: 14px; line-height: 1.5; }
    .info-box {
      text-align: center;
      padding: 32px 20px;
    }
    .info-box .icon { font-size: 48px; margin-bottom: 12px; }
    .info-box h2 { color: #1f2937; font-size: 16px; margin-bottom: 8px; }
    .info-box p { color: #6b7280; font-size: 13px; line-height: 1.6; }
    .info-box .url {
      display: inline-block;
      margin-top: 12px;
      padding: 8px 16px;
      background: #f3f4f6;
      border-radius: 8px;
      font-weight: 600;
      color: #3182ce;
      font-size: 13px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo-section">
      <img src="${logoUrl}" alt="Mega Bingo Mundial" onerror="this.style.display='none'">
      <p class="subtitle">Verificaci&oacute;n de Cart&oacute;n</p>
    </div>
    <div class="divider"></div>

    <div class="main-card">
    ${error ? (error === 'Escanea el QR de tu cartón para verificarlo' ? `
      <div class="info-box">
        <div class="icon">🎱</div>
        <h2>Verifica Tu Cart&oacute;n</h2>
        <p>Para verificar la autenticidad de tu cart&oacute;n, escanea el <strong>c&oacute;digo QR</strong> que se encuentra en la <strong>parte inferior izquierda</strong> de tu cart&oacute;n de bingo.</p>
      </div>` : `
      <div class="error-box">
        <div class="icon">🔍</div>
        <h2>${escapeHtml(error)}</h2>
        <p>El c&oacute;digo escaneado no corresponde a ning&uacute;n cart&oacute;n registrado.</p>
      </div>`) : `
      ${card!.is_sold ? `
      <div class="status-badge active">
        ✅ CART&Oacute;N ACTIVO
      </div>
      <div class="message success">
        <p>🎉 <strong>&iexcl;Enhorabuena!</strong> Tu cart&oacute;n se encuentra activo y listo para jugar. &iexcl;Buena suerte!</p>
      </div>
      ` : `
      <div class="status-badge inactive">
        ⏳ CART&Oacute;N INACTIVO
      </div>
      <div class="message warning">
        <p>Este cart&oacute;n a&uacute;n no ha sido activado. Contacta a un <strong>punto de venta certificado</strong> para activarlo y poder participar.</p>
      </div>
      `}

      <div class="info-grid">
        <div class="info-row">
          <span class="info-label">C&oacute;digo</span>
          <span class="info-value">${escapeHtml(card!.card_code)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Serial</span>
          <span class="info-value">${escapeHtml(card!.serial)}</span>
        </div>
        ${card!.buyer_name ? `
        <div class="info-row">
          <span class="info-label">Titular</span>
          <span class="info-value">${escapeHtml(card!.buyer_name)}</span>
        </div>` : ''}
      </div>

      ${card!.numbers ? renderNumbers(card!.numbers, card!.use_free_center) : ''}

      ${card!.promo_text ? `<div class="promo">🎁 ${escapeHtml(card!.promo_text)}</div>` : ''}
    `}
    </div>

    <div class="footer">
      <p class="fecha">${new Date().toLocaleString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Panama' })}</p>
      <p>Mega Bingo Mundial &copy; ${new Date().getFullYear()}</p>
    </div>
  </div>
</body>
</html>`;
}

export default router;
