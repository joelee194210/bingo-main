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

function renderNumbers(numbersJson: string, useFreeCenter: boolean): string {
  try {
    const numbers: number[][] = JSON.parse(numbersJson);
    const cols = ['B', 'I', 'N', 'G', 'O'];
    let html = '<table class="bingo-table"><thead><tr>';
    for (const col of cols) {
      html += `<th>${col}</th>`;
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
  const statusColor = card?.is_sold ? '#22c55e' : '#64748b';
  const statusText = card?.is_sold ? 'ACTIVO' : 'INACTIVO';
  const statusIcon = card?.is_sold ? '✅' : '⏳';

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verificar Cartón — Bingo</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      color: #e2e8f0;
    }
    .card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 16px;
      padding: 32px 24px;
      max-width: 400px;
      width: 100%;
      box-shadow: 0 25px 50px rgba(0,0,0,0.5);
    }
    .logo {
      text-align: center;
      margin-bottom: 24px;
    }
    .logo h1 {
      font-size: 24px;
      font-weight: 700;
      background: linear-gradient(90deg, #3b82f6, #8b5cf6);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .logo p {
      color: #94a3b8;
      font-size: 13px;
      margin-top: 4px;
    }
    .status-badge {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 12px 20px;
      border-radius: 12px;
      font-size: 18px;
      font-weight: 700;
      letter-spacing: 1px;
      margin-bottom: 24px;
      background: ${statusColor}15;
      border: 2px solid ${statusColor};
      color: ${statusColor};
    }
    .info-grid {
      display: grid;
      gap: 12px;
      margin-bottom: 24px;
    }
    .info-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 14px;
      background: #0f172a;
      border-radius: 8px;
      border: 1px solid #334155;
    }
    .info-label {
      color: #94a3b8;
      font-size: 13px;
    }
    .info-value {
      color: #f1f5f9;
      font-weight: 600;
      font-size: 14px;
    }
    .bingo-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 20px;
    }
    .bingo-table th {
      background: linear-gradient(180deg, #3b82f6, #2563eb);
      color: white;
      padding: 10px 0;
      font-size: 16px;
      font-weight: 700;
    }
    .bingo-table th:first-child { border-radius: 8px 0 0 0; }
    .bingo-table th:last-child { border-radius: 0 8px 0 0; }
    .bingo-table td {
      text-align: center;
      padding: 10px 0;
      font-size: 15px;
      font-weight: 600;
      color: #e2e8f0;
      background: #0f172a;
      border: 1px solid #1e293b;
    }
    .bingo-table td.free {
      color: #fbbf24;
      font-size: 18px;
    }
    .promo {
      text-align: center;
      padding: 10px 14px;
      background: linear-gradient(90deg, #7c3aed20, #ec489920);
      border: 1px solid #7c3aed40;
      border-radius: 8px;
      color: #c084fc;
      font-weight: 600;
      font-size: 13px;
      margin-bottom: 20px;
    }
    .footer {
      text-align: center;
      color: #475569;
      font-size: 11px;
      margin-top: 16px;
    }
    .error-box {
      text-align: center;
      padding: 40px 20px;
    }
    .error-box .icon { font-size: 48px; margin-bottom: 16px; }
    .error-box h2 { color: #f87171; margin-bottom: 8px; }
    .error-box p { color: #94a3b8; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">
      <h1>🎱 Bingo Manager</h1>
      <p>Verificación de Cartón</p>
    </div>
    ${error ? `
    <div class="error-box">
      <div class="icon">🔍</div>
      <h2>${escapeHtml(error)}</h2>
      <p>El código escaneado no corresponde a ningún cartón registrado.</p>
    </div>` : `
    <div class="status-badge">
      ${statusIcon} ${statusText}
    </div>

    <div class="info-grid">
      <div class="info-row">
        <span class="info-label">Código</span>
        <span class="info-value">${escapeHtml(card!.card_code)}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Serial</span>
        <span class="info-value">${escapeHtml(card!.serial)}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Evento</span>
        <span class="info-value">${escapeHtml(card!.event_name)}</span>
      </div>
      ${card!.buyer_name ? `
      <div class="info-row">
        <span class="info-label">Comprador</span>
        <span class="info-value">${escapeHtml(card!.buyer_name)}</span>
      </div>` : ''}
    </div>

    ${card!.numbers ? renderNumbers(card!.numbers, card!.use_free_center) : ''}

    ${card!.promo_text ? `<div class="promo">🎁 ${escapeHtml(card!.promo_text)}</div>` : ''}
    `}
    <div class="footer">
      Bingo Manager &copy; ${new Date().getFullYear()}
    </div>
  </div>
</body>
</html>`;
}

export default router;
