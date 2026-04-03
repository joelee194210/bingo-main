import { readFileSync } from 'fs';

interface OrderEmailData {
  order_code: string;
  buyer_name: string;
  buyer_email: string;
  quantity: number;
  total_amount: number;
  download_token: string;
  card_codes: string[];
}

const BASE_URL = process.env.PUBLIC_URL || 'http://localhost:3001';

export async function sendPurchaseEmail(data: OrderEmailData, pdfPath: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('⚠️ RESEND_API_KEY no configurado, email no enviado');
    return false;
  }

  const from = process.env.EMAIL_FROM || 'ventas@megabingodigital.com';
  const downloadUrl = `${BASE_URL}/venta/descargar/${data.download_token}`;
  const qtyText = data.quantity === 1 ? '1 carton' : `${data.quantity} cartones`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
  <div style="text-align: center; margin-bottom: 30px;">
    <h1 style="color: #1e40af; margin-bottom: 5px;">Mega Bingo TV Mundial</h1>
    <div style="height: 4px; background: linear-gradient(90deg, #ef4444, #f97316, #eab308, #22c55e, #3b82f6); border-radius: 2px;"></div>
  </div>

  <p>Hola <strong>${escapeHtml(data.buyer_name)}</strong>,</p>
  <p>Tu compra ha sido confirmada exitosamente. Ya eres parte del <strong>Mega Bingo TV Mundial</strong>. Tus cartones digitales estan listos para descargar.</p>

  <div style="background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 20px; margin: 20px 0;">
    <h3 style="margin-top: 0; color: #0369a1;">Detalle de tu compra</h3>
    <table style="width: 100%; border-collapse: collapse;">
      <tr><td style="padding: 5px 0; color: #666;">Orden:</td><td style="padding: 5px 0; font-weight: bold;">${escapeHtml(data.order_code)}</td></tr>
      <tr><td style="padding: 5px 0; color: #666;">Cantidad:</td><td style="padding: 5px 0;">${qtyText}</td></tr>
      <tr><td style="padding: 5px 0; color: #666;">Total pagado:</td><td style="padding: 5px 0; font-weight: bold; font-size: 1.2em; color: #059669;">$${data.total_amount.toFixed(2)}</td></tr>
    </table>
  </div>

  <div style="text-align: center; margin: 30px 0;">
    <a href="${downloadUrl}" style="display: inline-block; background: linear-gradient(135deg, #1e40af, #3b82f6); color: white; text-decoration: none; padding: 16px 36px; border-radius: 10px; font-size: 16px; font-weight: bold;">
      Descargar mis cartones
    </a>
  </div>

  <p style="text-align: center; color: #64748b; font-size: 13px;">
    Tambien encontraras tus cartones adjuntos en este correo como archivo PDF.
  </p>

  <div style="background: #f8fafc; border-radius: 8px; padding: 15px; margin: 20px 0;">
    <p style="margin: 0 0 10px 0; font-weight: bold; color: #475569;">Codigos de tus cartones:</p>
    <p style="margin: 0; font-family: monospace; font-size: 14px; word-break: break-all; color: #64748b;">
      ${data.card_codes.join(' &bull; ')}
    </p>
  </div>

  <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 15px; margin: 20px 0;">
    <p style="margin: 0; font-size: 13px; color: #92400e;">
      <strong>Importante:</strong> Guarda este correo como comprobante de tu compra. El enlace de descarga es personal y seguro.
    </p>
  </div>

  <p style="color: #94a3b8; font-size: 11px; margin-top: 30px; text-align: center;">
    Mega Bingo TV Mundial &copy; ${new Date().getFullYear()} | Vendedor autorizado: Yotumi S.A.
  </p>
</body>
</html>`;

  // Leer PDF como attachment
  let attachments: Array<{ filename: string; content: string }> | undefined;
  try {
    const pdfBuffer = readFileSync(pdfPath);
    attachments = [{
      filename: `cartones_megabingo_${data.order_code}.pdf`,
      content: pdfBuffer.toString('base64'),
    }];
  } catch {
    console.warn('⚠️ No se pudo adjuntar el PDF al email');
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [data.buyer_email],
        subject: `Mega Bingo TV Mundial - Tus cartones estan listos (${data.order_code})`,
        html,
        attachments,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('Error enviando email via Resend:', err);
      return false;
    }

    console.log(`✉️ Email enviado a ${data.buyer_email} para orden ${data.order_code}`);
    return true;
  } catch (err) {
    console.error('Error enviando email:', err);
    return false;
  }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
