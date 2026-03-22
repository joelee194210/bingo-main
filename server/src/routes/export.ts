import { Router } from 'express';
import type { Request, Response } from 'express';
import { getPool } from '../database/init.js';
import { generateCardsPDF, exportCardsAsImages, generateCardImage } from '../services/exportService.js';
import { requirePermission } from '../middleware/auth.js';
import { parseNumbers } from '../services/cardVerifier.js';
import type { BingoCard, BingoEvent, CardNumbers } from '../types/index.js';
import { logActivity, auditFromReq } from '../services/auditService.js';
import QRCode from 'qrcode';
import bwipjs from 'bwip-js';
import { createCanvas, loadImage } from 'canvas';
import fs from 'fs';
import path from 'path';
import archiver from 'archiver';

// Genera etiqueta: texto grande arriba + barcode Code128 abajo
// Tamaño real: 1.9cm x 0.9cm a 300 DPI = 224 x 106 px
async function generateBarcodeLabel(serial: string): Promise<Buffer> {
  const W = 224;
  const H = 106;
  const textH = 42;  // mitad superior para texto
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Fondo blanco
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // Texto grande bold arriba, centrado
  ctx.fillStyle = '#000000';
  ctx.font = 'bold 32px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(serial, W / 2, textH / 2);

  // Barcode Code 128 (solo barras, sin texto)
  const barcodePng = await bwipjs.toBuffer({
    bcid: 'code128',
    text: serial,
    scale: 2,
    height: 5,
    includetext: false,
  });

  const barcodeImg = await loadImage(barcodePng);
  // Dibujar barcode ocupando todo el ancho, desde textH hasta el final
  const barcodeH = H - textH - 2;
  ctx.drawImage(barcodeImg, 2, textH, W - 4, barcodeH);

  return canvas.toBuffer('image/png');
}

const router = Router();

// POST /api/export/pdf - Exportar cartones a PDF
router.post('/pdf', requirePermission('cards:export'), async (req: Request, res: Response) => {
  try {
    const { event_id, card_ids, cards_per_page = 4, include_validation_code = true } = req.body;

    if (!event_id && !card_ids) {
      return res.status(400).json({ success: false, error: 'Se requiere event_id o card_ids' });
    }

    const pool = getPool();

    let cards: BingoCard[];
    if (card_ids && Array.isArray(card_ids)) {
      if (card_ids.length > 1000) {
        return res.status(400).json({ success: false, error: 'Máximo 1000 cartones por solicitud' });
      }
      const placeholders = card_ids.map((_: unknown, i: number) => `$${i + 1}`).join(',');
      cards = (await pool.query(`
        SELECT * FROM cards WHERE id IN (${placeholders})
      `, card_ids)).rows as BingoCard[];
    } else {
      cards = (await pool.query(`
        SELECT * FROM cards WHERE event_id = $1 ORDER BY card_number LIMIT 1000
      `, [event_id])).rows as BingoCard[];
    }

    if (cards.length === 0) {
      return res.status(404).json({ success: false, error: 'No se encontraron cartones' });
    }

    // Obtener configuración de FREE center del evento
    const eventForConfig = (await pool.query('SELECT use_free_center FROM events WHERE id = $1', [cards[0].event_id])).rows[0] as { use_free_center: boolean } | undefined;
    const useFreeCenter = eventForConfig?.use_free_center !== false;

    const cardData = cards.map(card => ({
      cardNumber: card.card_number,
      cardCode: card.card_code,
      validationCode: card.validation_code,
      numbers: parseNumbers(card.numbers) as CardNumbers,
      useFreeCenter,
    }));

    const filepath = await generateCardsPDF(cardData, {
      cardsPerPage: cards_per_page,
      includeValidationCode: include_validation_code,
    });

    logActivity(pool, auditFromReq(req, 'export_pdf', 'export', { count: cards.length }));

    res.json({
      success: true,
      data: {
        filepath,
        count: cards.length,
      },
    });
  } catch (error) {
    console.error('Error exportando PDF:', error);
    res.status(500).json({ success: false, error: 'Error generando PDF' });
  }
});

// GET /api/export/card/:id/image - Obtener imagen de un cartón
router.get('/card/:id/image', async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const { rows: cardRows } = await pool.query('SELECT * FROM cards WHERE id = $1', [req.params.id]);
    const card = cardRows[0] as BingoCard | undefined;

    if (!card) {
      return res.status(404).json({ success: false, error: 'Cartón no encontrado' });
    }

    const eventForConfig = (await pool.query('SELECT use_free_center FROM events WHERE id = $1', [card.event_id])).rows[0] as { use_free_center: boolean } | undefined;
    const useFreeCenter = eventForConfig?.use_free_center !== false;

    const buffer = await generateCardImage({
      cardNumber: card.card_number,
      cardCode: card.card_code,
      validationCode: card.validation_code,
      numbers: parseNumbers(card.numbers) as CardNumbers,
      useFreeCenter,
    });

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `inline; filename="carton_${card.card_number}.png"`);
    res.send(buffer);
  } catch (error) {
    console.error('Error generando imagen:', error);
    res.status(500).json({ success: false, error: 'Error generando imagen' });
  }
});

// POST /api/export/images - Exportar múltiples cartones como imágenes
router.post('/images', requirePermission('cards:export'), async (req: Request, res: Response) => {
  try {
    const { event_id, card_ids, limit = 100 } = req.body;

    if (!event_id && !card_ids) {
      return res.status(400).json({ success: false, error: 'Se requiere event_id o card_ids' });
    }

    const pool = getPool();

    let cards: BingoCard[];
    if (card_ids && Array.isArray(card_ids)) {
      if (card_ids.length > 500) {
        return res.status(400).json({ success: false, error: 'Máximo 500 cartones por solicitud' });
      }
      const placeholders = card_ids.map((_: unknown, i: number) => `$${i + 1}`).join(',');
      cards = (await pool.query(`
        SELECT * FROM cards WHERE id IN (${placeholders})
      `, card_ids)).rows as BingoCard[];
    } else {
      cards = (await pool.query(`
        SELECT * FROM cards WHERE event_id = $1 ORDER BY card_number LIMIT $2
      `, [event_id, Math.min(limit, 500)])).rows as BingoCard[];
    }

    if (cards.length === 0) {
      return res.status(404).json({ success: false, error: 'No se encontraron cartones' });
    }

    const eventForConfig = (await pool.query('SELECT use_free_center FROM events WHERE id = $1', [cards[0].event_id])).rows[0] as { use_free_center: boolean } | undefined;
    const useFreeCenter = eventForConfig?.use_free_center !== false;

    const cardData = cards.map(card => ({
      cardNumber: card.card_number,
      cardCode: card.card_code,
      validationCode: card.validation_code,
      numbers: parseNumbers(card.numbers) as CardNumbers,
      useFreeCenter,
    }));

    const files = await exportCardsAsImages(cardData);

    res.json({
      success: true,
      data: {
        files,
        count: files.length,
      },
    });
  } catch (error) {
    console.error('Error exportando imágenes:', error);
    res.status(500).json({ success: false, error: 'Error generando imágenes' });
  }
});

// GET /api/export/csv/:eventId - Exportar cartones en CSV para imprenta
router.get('/csv/:eventId', requirePermission('cards:export'), async (req: Request, res: Response) => {
  try {
    const eventId = parseInt(req.params.eventId as string, 10);
    const pool = getPool();

    const { rows: eventRows } = await pool.query('SELECT * FROM events WHERE id = $1', [eventId]);
    const event = eventRows[0] as { name: string; use_free_center: boolean } | undefined;
    if (!event) {
      return res.status(404).json({ success: false, error: 'Evento no encontrado' });
    }

    const useFreeCenter = event.use_free_center !== false;
    const { rows: cards } = await pool.query('SELECT * FROM cards WHERE event_id = $1 ORDER BY card_number', [eventId]);

    if (cards.length === 0) {
      return res.status(404).json({ success: false, error: 'No hay cartones para exportar' });
    }

    // Construir CSV - siempre 5 valores por columna (N3=FREE si use_free_center)
    const header = 'card_number,serial,card_code,validation_code,promo_text,B1,B2,B3,B4,B5,I1,I2,I3,I4,I5,N1,N2,N3,N4,N5,G1,G2,G3,G4,G5,O1,O2,O3,O4,O5';

    const rows = cards.map((card: any) => {
      const nums: CardNumbers = parseNumbers(card.numbers);

      // Expandir N a 5 valores: si FREE center, insertar FREE en posición 3 (índice 2)
      const nValues: (number | string)[] = useFreeCenter
        ? [nums.N[0], nums.N[1], 'FREE', nums.N[2], nums.N[3]]
        : nums.N;

      // Escapar promo_text (RFC 4180)
      const promoText = card.promo_text
        ? (card.promo_text.includes(',') || card.promo_text.includes('"') || card.promo_text.includes('\n')
          ? `"${card.promo_text.replace(/"/g, '""')}"`
          : card.promo_text)
        : '';

      const values = [
        card.card_number,
        card.serial,
        card.card_code,
        card.validation_code,
        promoText,
        ...nums.B,
        ...nums.I,
        ...nValues,
        ...nums.G,
        ...nums.O,
      ];
      return values.join(',');
    });

    const csv = header + '\n' + rows.join('\n');

    const safeName = event.name.replace(/[^a-zA-Z0-9_-]/g, '_');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="cartones_${safeName}_${eventId}.csv"`);
    res.send(csv);
  } catch (error) {
    console.error('Error exportando CSV:', error);
    res.status(500).json({ success: false, error: 'Error generando CSV' });
  }
});

// Total esperado de QRs por evento (para calcular progreso)
const qrExpected = new Map<number, { total: number; status: 'generating' | 'zipping' | 'completed' | 'error'; folder: string; zipPath?: string }>();

// POST /api/export/qr - Generar QR codes como PNG para cartones de un evento
router.post('/qr', requirePermission('cards:export'), async (req: Request, res: Response) => {
  try {
    const {
      event_id,
      base_url,
      size = 300,
      from_card,
      to_card,
      from_series,
      to_series,
    } = req.body;

    // url_template soporta variables: {card_code}, {validation_code}, {serial}, {card_number}
    const url_template = base_url as string;

    if (!event_id || !url_template) {
      return res.status(400).json({ success: false, error: 'event_id y base_url son requeridos' });
    }

    const qrSize = Math.min(2000, Math.max(50, parseInt(size, 10) || 300));

    const pool = getPool();

    const { rows: eventRows } = await pool.query('SELECT * FROM events WHERE id = $1', [event_id]);
    const event = eventRows[0] as BingoEvent | undefined;
    if (!event) {
      return res.status(404).json({ success: false, error: 'Evento no encontrado' });
    }

    // Construir query de seleccion de cartones
    let whereClause = 'WHERE event_id = $1';
    const params: unknown[] = [event_id];
    let paramIdx = 2;

    if (from_card && to_card) {
      whereClause += ` AND card_number BETWEEN $${paramIdx} AND $${paramIdx + 1}`;
      params.push(from_card, to_card);
      paramIdx += 2;
    } else if (from_series && to_series) {
      const fromNum = (parseInt(from_series, 10) - 1) * 50 + 1;
      const toNum = parseInt(to_series, 10) * 50;
      whereClause += ` AND card_number BETWEEN $${paramIdx} AND $${paramIdx + 1}`;
      params.push(fromNum, toNum);
      paramIdx += 2;
    }

    const { rows: cards } = await pool.query(
      `SELECT id, card_number, serial, card_code, validation_code FROM cards ${whereClause} ORDER BY card_number`,
      params
    );

    if (cards.length === 0) {
      return res.status(404).json({ success: false, error: 'No se encontraron cartones con esos criterios' });
    }

    // Crear carpeta con nombre del evento (limpiar si ya existe para evitar duplicados)
    const safeName = event.name.replace(/[^a-zA-Z0-9_\- ]/g, '').replace(/\s+/g, '_');
    const outputDir = path.join(__dirname, '..', '..', 'data', 'qr', `${safeName}_${event_id}`);
    if (fs.existsSync(outputDir)) {
      fs.rmSync(outputDir, { recursive: true });
    }
    fs.mkdirSync(outputDir, { recursive: true });

    // Funcion para reemplazar variables en el template
    const buildUrl = (card: typeof cards[0]) => {
      return url_template
        .replace(/\{card_code\}/g, card.card_code)
        .replace(/\{validation_code\}/g, card.validation_code)
        .replace(/\{serial\}/g, card.serial)
        .replace(/\{card_number\}/g, String(card.card_number));
    };

    // Verificar unicidad de seriales y códigos antes de generar (Sets separados para evitar falsos positivos)
    const serialSet = new Set<string>();
    const cardCodeSet = new Set<string>();
    const validationCodeSet = new Set<string>();
    const duplicates: string[] = [];
    for (const card of cards) {
      if (serialSet.has(card.serial)) {
        duplicates.push(`Serial duplicado: ${card.serial} (cartón #${card.card_number})`);
      }
      serialSet.add(card.serial);
      if (cardCodeSet.has(card.card_code)) {
        duplicates.push(`card_code duplicado: ${card.card_code} (cartón #${card.card_number})`);
      }
      cardCodeSet.add(card.card_code);
      if (validationCodeSet.has(card.validation_code)) {
        duplicates.push(`validation_code duplicado: ${card.validation_code} (cartón #${card.card_number})`);
      }
      validationCodeSet.add(card.validation_code);
    }
    if (duplicates.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Se encontraron ${duplicates.length} duplicados. No se pueden generar QR codes con datos duplicados.`,
        duplicates: duplicates.slice(0, 20),
      });
    }

    // Registrar total esperado y carpeta
    qrExpected.set(event_id, { total: cards.length, status: 'generating', folder: outputDir });

    // Responder inmediatamente — la generación corre en background
    const sampleUrl = buildUrl(cards[0]);
    res.json({
      success: true,
      data: {
        event_name: event.name,
        cards_total: cards.length,
        qr_size: `${qrSize}x${qrSize}px`,
        url_template,
        sample_url: sampleUrl,
        message: `Generando ${cards.length.toLocaleString()} QR codes en background. Consulte progreso en /api/export/qr/progress/${event_id}`,
      },
    });

    // Generar QR codes en background por batches para no reventar memoria
    const BATCH_SIZE = 500;
    (async () => {
      try {
        for (let i = 0; i < cards.length; i += BATCH_SIZE) {
          const batch = cards.slice(i, i + BATCH_SIZE);
          await Promise.all(batch.map(async (card) => {
            const url = buildUrl(card);
            const filePath = path.join(outputDir, `${card.serial}.png`);
            await QRCode.toFile(filePath, url, {
              width: qrSize,
              margin: 1,
              color: { dark: '#000000', light: '#ffffff' },
              errorCorrectionLevel: 'M',
            });
          }));
        }

        // Crear ZIP para descarga — nivel 0 (store) porque PNGs ya están comprimidos
        // archiver con level 6 para 600k+ archivos tarda horas; level 0 tarda minutos
        qrExpected.set(event_id, { total: cards.length, status: 'zipping', folder: outputDir });
        const zipPath = path.join(__dirname, '..', '..', 'data', 'qr', `${safeName}_${event_id}.zip`);
        if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
        await new Promise<void>((resolve, reject) => {
          const output = fs.createWriteStream(zipPath);
          const archive = archiver('zip', { store: true });
          output.on('close', resolve);
          archive.on('error', reject);
          archive.pipe(output);
          archive.directory(outputDir, `QR_${safeName}`);
          archive.finalize();
        });

        const zipSizeMB = (fs.statSync(zipPath).size / (1024 * 1024)).toFixed(2);
        qrExpected.set(event_id, { total: cards.length, status: 'completed', folder: outputDir, zipPath });
        console.log(`QR generados: ${cards.length} cartones, ZIP: ${zipSizeMB} MB`);
        // Limpiar después de 30 minutos (más tiempo para archivos grandes)
        setTimeout(() => qrExpected.delete(event_id), 30 * 60 * 1000);
      } catch (err) {
        console.error('Error en generación background de QR:', err);
        qrExpected.set(event_id, { total: cards.length, status: 'error', folder: outputDir });
      }
    })();
  } catch (error) {
    console.error('Error generando QR codes:', error);
    const eventIdKey = req.body?.event_id;
    if (eventIdKey) {
      qrExpected.set(eventIdKey, { total: 0, status: 'error', folder: '' });
    }
    res.status(500).json({ success: false, error: 'Error generando QR codes' });
  }
});

// GET /api/export/qr/progress/:eventId - Consultar progreso contando PNGs en carpeta
router.get('/qr/progress/:eventId', (req: Request, res: Response) => {
  const eventId = parseInt(String(req.params.eventId), 10);
  const info = qrExpected.get(eventId);

  if (!info) {
    return res.json({ success: true, data: null });
  }

  // Contar archivos .png reales en la carpeta
  let generated = 0;
  if (info.folder && fs.existsSync(info.folder)) {
    try {
      const files = fs.readdirSync(info.folder);
      generated = files.filter(f => f.endsWith('.png')).length;
    } catch {
      generated = 0;
    }
  }

  res.json({
    success: true,
    data: {
      total: info.total,
      generated,
      status: info.status,
    },
  });
});

// GET /api/export/qr/download/:eventId - Descargar ZIP de QR codes
router.get('/qr/download/:eventId', requirePermission('cards:export'), async (req: Request, res: Response) => {
  try {
    const eventId = parseInt(String(req.params.eventId), 10);
    const info = qrExpected.get(eventId);

    if (info?.zipPath && fs.existsSync(info.zipPath)) {
      const fileName = path.basename(info.zipPath, '.zip');
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}.zip"`);
      return fs.createReadStream(info.zipPath).pipe(res);
    }

    // Fallback: buscar por nombre del evento en BD
    const pool = getPool();
    const { rows } = await pool.query('SELECT name FROM events WHERE id = $1', [eventId]);
    const event = rows[0] as { name: string } | undefined;
    if (!event) return res.status(404).json({ success: false, error: 'Evento no encontrado' });

    const safeName = event.name.replace(/[^a-zA-Z0-9_\- ]/g, '').replace(/\s+/g, '_');
    const zipPath = path.join(__dirname, '..', '..', 'data', 'qr', `${safeName}_${eventId}.zip`);

    if (!fs.existsSync(zipPath)) {
      return res.status(404).json({ success: false, error: 'No se ha generado el ZIP de QR codes. Ejecute POST /api/export/qr primero.' });
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="QR_${safeName}.zip"`);
    fs.createReadStream(zipPath).pipe(res);
  } catch (error) {
    console.error('Error descargando QR:', error);
    res.status(500).json({ success: false, error: 'Error descargando archivo' });
  }
});

// GET /api/export/qr/single/:cardCode - Generar QR individual de un carton
router.get('/qr/single/:cardCode', requirePermission('cards:export'), async (req: Request, res: Response) => {
  try {
    const { base_url, size = '300' } = req.query;

    if (!base_url) {
      return res.status(400).json({ success: false, error: 'base_url es requerido como query param' });
    }

    const cardCode = (req.params.cardCode as string).toUpperCase();
    const qrSize = Math.min(2000, Math.max(50, parseInt(String(size), 10) || 300));
    const baseUrlStr = String(base_url);
    const urlBase = baseUrlStr.endsWith('/') ? baseUrlStr : baseUrlStr + '/';
    const url = `${urlBase}${cardCode}`;

    const buffer = await QRCode.toBuffer(url, {
      width: qrSize,
      margin: 1,
      color: { dark: '#000000', light: '#ffffff' },
      errorCorrectionLevel: 'M',
    });

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `inline; filename="QR_${cardCode}.png"`);
    res.send(buffer);
  } catch (error) {
    console.error('Error generando QR individual:', error);
    res.status(500).json({ success: false, error: 'Error generando QR' });
  }
});

// =====================================================
// BARCODE (Code 128) - Etiquetas de codigo de barras
// =====================================================

// Estado de generacion de barcodes por evento
const barcodeExpected = new Map<number, { total: number; status: 'generating' | 'zipping' | 'completed' | 'error'; folder: string; zipPath?: string }>();

// POST /api/export/barcode - Generar etiquetas de codigo de barras para cartones
router.post('/barcode', requirePermission('cards:export'), async (req: Request, res: Response) => {
  try {
    const {
      event_id,
      from_card,
      to_card,
      from_series,
      to_series,
    } = req.body;

    if (!event_id) {
      return res.status(400).json({ success: false, error: 'event_id es requerido' });
    }

    const pool = getPool();

    const { rows: eventRows } = await pool.query('SELECT * FROM events WHERE id = $1', [event_id]);
    const event = eventRows[0] as BingoEvent | undefined;
    if (!event) {
      return res.status(404).json({ success: false, error: 'Evento no encontrado' });
    }

    // Construir query de seleccion
    let whereClause = 'WHERE event_id = $1';
    const params: unknown[] = [event_id];
    let paramIdx = 2;

    if (from_card && to_card) {
      whereClause += ` AND card_number BETWEEN $${paramIdx} AND $${paramIdx + 1}`;
      params.push(from_card, to_card);
      paramIdx += 2;
    } else if (from_series && to_series) {
      const fromNum = (parseInt(from_series, 10) - 1) * 50 + 1;
      const toNum = parseInt(to_series, 10) * 50;
      whereClause += ` AND card_number BETWEEN $${paramIdx} AND $${paramIdx + 1}`;
      params.push(fromNum, toNum);
      paramIdx += 2;
    }

    const { rows: cards } = await pool.query(
      `SELECT id, card_number, serial, card_code, validation_code FROM cards ${whereClause} ORDER BY card_number`,
      params
    );

    if (cards.length === 0) {
      return res.status(404).json({ success: false, error: 'No se encontraron cartones con esos criterios' });
    }

    // Crear carpeta
    const safeName = event.name.replace(/[^a-zA-Z0-9_\- ]/g, '').replace(/\s+/g, '_');
    const outputDir = path.join(__dirname, '..', '..', 'data', 'barcode', `${safeName}_${event_id}`);
    if (fs.existsSync(outputDir)) {
      fs.rmSync(outputDir, { recursive: true });
    }
    fs.mkdirSync(outputDir, { recursive: true });

    // Verificar unicidad de seriales antes de generar
    const serialSet = new Set<string>();
    const duplicates: string[] = [];
    for (const card of cards) {
      if (serialSet.has(card.serial as string)) {
        duplicates.push(`Serial duplicado: ${card.serial} (cartón #${card.card_number})`);
      }
      serialSet.add(card.serial as string);
    }
    if (duplicates.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Se encontraron ${duplicates.length} seriales duplicados. No se pueden generar barcodes con seriales duplicados.`,
        duplicates: duplicates.slice(0, 20),
      });
    }

    barcodeExpected.set(event_id, { total: cards.length, status: 'generating', folder: outputDir });

    // Responder inmediatamente — generación en background
    res.json({
      success: true,
      data: {
        event_name: event.name,
        cards_total: cards.length,
        sample_serial: (cards[0] as { serial: string }).serial,
        message: `Generando ${cards.length.toLocaleString()} barcodes en background.`,
      },
    });

    // Generar en background por batches
    // bwip-js + canvas usan mucha memoria, batches pequeños para no reventar heap
    const BATCH_SIZE = 50;
    (async () => {
      try {
        for (let i = 0; i < cards.length; i += BATCH_SIZE) {
          const batch = cards.slice(i, i + BATCH_SIZE);
          await Promise.all(batch.map(async (card) => {
            const serial = card.serial as string;
            const png = await generateBarcodeLabel(serial);
            const filePath = path.join(outputDir, `${serial}.png`);
            fs.writeFileSync(filePath, png);
          }));
          // Liberar memoria cada 5000 cartones
          if (i % 5000 === 0 && global.gc) global.gc();
        }

        // Crear ZIP — store sin compresión (PNGs ya están comprimidos)
        barcodeExpected.set(event_id, { total: cards.length, status: 'zipping', folder: outputDir });
        const zipPath = path.join(__dirname, '..', '..', 'data', 'barcode', `${safeName}_${event_id}.zip`);
        if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
        await new Promise<void>((resolve, reject) => {
          const output = fs.createWriteStream(zipPath);
          const archive = archiver('zip', { store: true });
          output.on('close', resolve);
          archive.on('error', reject);
          archive.pipe(output);
          archive.directory(outputDir, `Barcode_${safeName}`);
          archive.finalize();
        });

        const zipSizeMB = (fs.statSync(zipPath).size / (1024 * 1024)).toFixed(2);
        barcodeExpected.set(event_id, { total: cards.length, status: 'completed', folder: outputDir, zipPath });
        console.log(`Barcodes generados: ${cards.length} cartones, ZIP: ${zipSizeMB} MB`);
        setTimeout(() => barcodeExpected.delete(event_id), 30 * 60 * 1000);
      } catch (err) {
        console.error('Error en generación background de barcodes:', err);
        barcodeExpected.set(event_id, { total: cards.length, status: 'error', folder: outputDir });
      }
    })();
  } catch (error) {
    console.error('Error generando barcodes:', error);
    const eventIdKey = req.body?.event_id;
    if (eventIdKey) {
      barcodeExpected.set(eventIdKey, { total: 0, status: 'error', folder: '' });
    }
    res.status(500).json({ success: false, error: 'Error generando codigos de barra' });
  }
});

// GET /api/export/barcode/progress/:eventId
router.get('/barcode/progress/:eventId', (req: Request, res: Response) => {
  const eventId = parseInt(String(req.params.eventId), 10);
  const info = barcodeExpected.get(eventId);

  if (!info) {
    return res.json({ success: true, data: null });
  }

  let generated = 0;
  if (info.folder && fs.existsSync(info.folder)) {
    try {
      const files = fs.readdirSync(info.folder);
      generated = files.filter(f => f.endsWith('.png')).length;
    } catch {
      generated = 0;
    }
  }

  res.json({
    success: true,
    data: {
      total: info.total,
      generated,
      status: info.status,
    },
  });
});

// GET /api/export/barcode/download/:eventId
router.get('/barcode/download/:eventId', requirePermission('cards:export'), async (req: Request, res: Response) => {
  try {
    const eventId = parseInt(String(req.params.eventId), 10);
    const info = barcodeExpected.get(eventId);

    if (info?.zipPath && fs.existsSync(info.zipPath)) {
      const fileName = path.basename(info.zipPath, '.zip');
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}.zip"`);
      return fs.createReadStream(info.zipPath).pipe(res);
    }

    // Fallback: buscar por nombre del evento en BD
    const pool = getPool();
    const { rows } = await pool.query('SELECT name FROM events WHERE id = $1', [eventId]);
    const event = rows[0] as { name: string } | undefined;
    if (!event) return res.status(404).json({ success: false, error: 'Evento no encontrado' });

    const safeName = event.name.replace(/[^a-zA-Z0-9_\- ]/g, '').replace(/\s+/g, '_');
    const zipPath = path.join(__dirname, '..', '..', 'data', 'barcode', `${safeName}_${eventId}.zip`);

    if (!fs.existsSync(zipPath)) {
      return res.status(404).json({ success: false, error: 'No se ha generado el ZIP. Ejecute POST /api/export/barcode primero.' });
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="Barcode_${safeName}.zip"`);
    fs.createReadStream(zipPath).pipe(res);
  } catch (error) {
    console.error('Error descargando barcode:', error);
    res.status(500).json({ success: false, error: 'Error descargando archivo' });
  }
});

// GET /api/export/barcode/single/:serial - Generar barcode individual
router.get('/barcode/single/:serial', requirePermission('cards:export'), async (req: Request, res: Response) => {
  try {
    const serial = req.params.serial as string;
    const png = await generateBarcodeLabel(serial);

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `inline; filename="${serial}.png"`);
    res.send(png);
  } catch (error) {
    console.error('Error generando barcode individual:', error);
    res.status(500).json({ success: false, error: 'Error generando codigo de barras' });
  }
});

// =====================================================
// QR CAJAS — Etiquetas QR para cajas con info de lotes
// =====================================================

const qrCajasExpected = new Map<number, { total: number; status: 'generating' | 'zipping' | 'completed' | 'error'; folder: string; zipPath?: string }>();

/** Genera etiqueta PNG: QR arriba + código caja + rango lotes */
async function generateCajaLabel(
  qrContent: string,
  cajaCode: string,
  loteDesde: string,
  loteHasta: string,
  qrSize: number,
): Promise<Buffer> {
  const padding = Math.round(qrSize * 0.06);
  const cajaFontSize = Math.max(24, Math.round(qrSize / 5));
  const loteFontSize = Math.max(16, Math.round(qrSize / 8));
  const lineGap = Math.round(loteFontSize * 0.4);
  const textHeight = cajaFontSize + loteFontSize * 2 + lineGap * 3 + padding;
  const W = qrSize + padding * 2;
  const H = qrSize + textHeight + padding * 2;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Fondo blanco
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // QR code
  const qrBuffer = await QRCode.toBuffer(qrContent, {
    width: qrSize,
    margin: 1,
    color: { dark: '#000000', light: '#ffffff' },
    errorCorrectionLevel: 'M',
  });
  const qrImg = await loadImage(qrBuffer);
  ctx.drawImage(qrImg, padding, padding, qrSize, qrSize);

  // Código de caja (grande, bold, centrado)
  ctx.fillStyle = '#000000';
  ctx.font = `bold ${cajaFontSize}px Arial`;
  ctx.textAlign = 'center';
  const textY = padding + qrSize + cajaFontSize + lineGap;
  ctx.fillText(cajaCode, W / 2, textY);

  // Rango de lotes (más grande)
  ctx.font = `bold ${loteFontSize}px Arial`;
  ctx.fillText(`Desde: ${loteDesde}`, W / 2, textY + cajaFontSize * 0.3 + loteFontSize + lineGap);
  ctx.fillText(`Hasta: ${loteHasta}`, W / 2, textY + cajaFontSize * 0.3 + (loteFontSize + lineGap) * 2);

  return canvas.toBuffer('image/png');
}

// POST /api/export/qr-cajas - Generar etiquetas QR para cajas de un evento
router.post('/qr-cajas', requirePermission('cards:export'), async (req: Request, res: Response) => {
  try {
    const { event_id, size = 300 } = req.body;

    if (!event_id) {
      return res.status(400).json({ success: false, error: 'event_id es requerido' });
    }

    const qrSize = Math.min(2000, Math.max(100, parseInt(size, 10) || 300));
    const pool = getPool();

    const { rows: eventRows } = await pool.query('SELECT * FROM events WHERE id = $1', [event_id]);
    const event = eventRows[0] as BingoEvent | undefined;
    if (!event) {
      return res.status(404).json({ success: false, error: 'Evento no encontrado' });
    }

    // Obtener cajas con rango de lotes
    const { rows: cajas } = await pool.query(`
      SELECT c.id, c.caja_code,
        MIN(l.lote_code) as lote_desde,
        MAX(l.lote_code) as lote_hasta,
        COUNT(l.id)::int as total_lotes
      FROM cajas c
      LEFT JOIN lotes l ON l.caja_id = c.id
      WHERE c.event_id = $1
      GROUP BY c.id, c.caja_code
      ORDER BY c.caja_code
    `, [event_id]);

    if (cajas.length === 0) {
      return res.status(404).json({ success: false, error: 'No hay cajas para este evento' });
    }

    // Crear carpeta de salida
    const safeName = event.name.replace(/[^a-zA-Z0-9_\- ]/g, '').replace(/\s+/g, '_');
    const outputDir = path.join(__dirname, '..', '..', 'data', 'qr-cajas', `${safeName}_${event_id}`);
    if (fs.existsSync(outputDir)) {
      fs.rmSync(outputDir, { recursive: true });
    }
    fs.mkdirSync(outputDir, { recursive: true });

    qrCajasExpected.set(event_id, { total: cajas.length, status: 'generating', folder: outputDir });

    // Generar etiqueta para cada caja
    for (const caja of cajas) {
      const qrContent = caja.caja_code;

      const png = await generateCajaLabel(
        qrContent,
        caja.caja_code,
        caja.lote_desde || 'N/A',
        caja.lote_hasta || 'N/A',
        qrSize,
      );

      fs.writeFileSync(path.join(outputDir, `${caja.caja_code}.png`), png);
    }

    // Crear ZIP
    qrCajasExpected.set(event_id, { total: cajas.length, status: 'zipping', folder: outputDir });
    const zipPath = path.join(__dirname, '..', '..', 'data', 'qr-cajas', `${safeName}_${event_id}.zip`);
    await new Promise<void>((resolve, reject) => {
      const output = fs.createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 6 } });
      output.on('close', resolve);
      archive.on('error', reject);
      archive.pipe(output);
      archive.directory(outputDir, `QR_Cajas_${safeName}`);
      archive.finalize();
    });

    const zipSizeMB = (fs.statSync(zipPath).size / (1024 * 1024)).toFixed(2);

    qrCajasExpected.set(event_id, { total: cajas.length, status: 'completed', folder: outputDir, zipPath });
    setTimeout(() => qrCajasExpected.delete(event_id), 5 * 60 * 1000);

    logActivity(pool, auditFromReq(req, 'export_qr_cajas', 'export', {
      event_id, event_name: event.name, cajas_count: cajas.length, qr_size: qrSize,
    }));

    res.json({
      success: true,
      data: {
        event_name: event.name,
        cajas_processed: cajas.length,
        qr_size: `${qrSize}x${qrSize}px`,
        zip_size_mb: zipSizeMB,
      },
    });
  } catch (error) {
    console.error('Error generando QR cajas:', error);
    const eventIdKey = req.body?.event_id;
    if (eventIdKey) qrCajasExpected.set(eventIdKey, { total: 0, status: 'error', folder: '' });
    res.status(500).json({ success: false, error: 'Error generando QR de cajas' });
  }
});

// GET /api/export/qr-cajas/progress/:eventId
router.get('/qr-cajas/progress/:eventId', (req: Request, res: Response) => {
  const eventId = parseInt(String(req.params.eventId), 10);
  const info = qrCajasExpected.get(eventId);

  if (!info) return res.json({ success: true, data: null });

  let generated = 0;
  if (info.folder && fs.existsSync(info.folder)) {
    try {
      generated = fs.readdirSync(info.folder).filter(f => f.endsWith('.png')).length;
    } catch { generated = 0; }
  }

  res.json({ success: true, data: { total: info.total, generated, status: info.status } });
});

// GET /api/export/qr-cajas/download/:eventId
router.get('/qr-cajas/download/:eventId', requirePermission('cards:export'), async (req: Request, res: Response) => {
  try {
    const eventId = parseInt(String(req.params.eventId), 10);
    const info = qrCajasExpected.get(eventId);

    if (info?.zipPath && fs.existsSync(info.zipPath)) {
      const fileName = path.basename(info.zipPath, '.zip');
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}.zip"`);
      return fs.createReadStream(info.zipPath).pipe(res);
    }

    // Fallback: buscar por nombre del evento en BD
    const pool = getPool();
    const { rows } = await pool.query('SELECT name FROM events WHERE id = $1', [eventId]);
    const event = rows[0] as { name: string } | undefined;
    if (!event) return res.status(404).json({ success: false, error: 'Evento no encontrado' });

    const safeName = event.name.replace(/[^a-zA-Z0-9_\- ]/g, '').replace(/\s+/g, '_');
    const zipPath = path.join(__dirname, '..', '..', 'data', 'qr-cajas', `${safeName}_${eventId}.zip`);

    if (!fs.existsSync(zipPath)) {
      return res.status(404).json({ success: false, error: 'Genere los QR de cajas primero' });
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="QR_Cajas_${safeName}.zip"`);
    fs.createReadStream(zipPath).pipe(res);
  } catch (error) {
    console.error('Error descargando QR cajas:', error);
    res.status(500).json({ success: false, error: 'Error descargando archivo' });
  }
});

// =====================================================
// QR LIBRETAS — Etiquetas QR para libretas/lotes
// =====================================================

const qrLibretasExpected = new Map<number, { total: number; status: 'generating' | 'zipping' | 'completed' | 'error'; folder: string; zipPath?: string }>();

/** Genera etiqueta PNG: QR arriba + numero de libreta abajo */
async function generateLibretaLabel(
  qrContent: string,
  libretaNumber: string,
  qrSize: number,
): Promise<Buffer> {
  const padding = Math.round(qrSize * 0.06);
  const codeFontSize = Math.max(24, Math.round(qrSize / 5));
  const lineGap = Math.round(codeFontSize * 0.4);
  const textHeight = codeFontSize + lineGap * 2 + padding;
  const W = qrSize + padding * 2;
  const H = qrSize + textHeight + padding * 2;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Fondo blanco
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // QR code
  const qrBuffer = await QRCode.toBuffer(qrContent, {
    width: qrSize,
    margin: 1,
    color: { dark: '#000000', light: '#ffffff' },
    errorCorrectionLevel: 'M',
  });
  const qrImg = await loadImage(qrBuffer);
  ctx.drawImage(qrImg, padding, padding, qrSize, qrSize);

  // Numero de libreta (grande, bold, centrado)
  ctx.fillStyle = '#000000';
  ctx.font = `bold ${codeFontSize}px Arial`;
  ctx.textAlign = 'center';
  ctx.fillText(libretaNumber, W / 2, padding + qrSize + codeFontSize + lineGap);

  return canvas.toBuffer('image/png');
}

// POST /api/export/qr-libretas - Generar etiquetas QR para libretas de un evento
router.post('/qr-libretas', requirePermission('cards:export'), async (req: Request, res: Response) => {
  try {
    const { event_id, size = 300 } = req.body;

    if (!event_id) {
      return res.status(400).json({ success: false, error: 'event_id es requerido' });
    }

    const qrSize = Math.min(2000, Math.max(100, parseInt(size, 10) || 300));
    const pool = getPool();

    const { rows: eventRows } = await pool.query('SELECT * FROM events WHERE id = $1', [event_id]);
    const event = eventRows[0] as BingoEvent | undefined;
    if (!event) {
      return res.status(404).json({ success: false, error: 'Evento no encontrado' });
    }

    // Obtener libretas (lotes) del evento
    const { rows: libretas } = await pool.query(`
      SELECT id, lote_code, series_number, total_cards, status
      FROM lotes
      WHERE event_id = $1
      ORDER BY series_number
    `, [event_id]);

    if (libretas.length === 0) {
      return res.status(404).json({ success: false, error: 'No hay libretas/lotes para este evento. Genere el inventario primero.' });
    }

    // Crear carpeta de salida
    const safeName = event.name.replace(/[^a-zA-Z0-9_\- ]/g, '').replace(/\s+/g, '_');
    const outputDir = path.join(__dirname, '..', '..', 'data', 'qr-libretas', `${safeName}_${event_id}`);
    if (fs.existsSync(outputDir)) {
      fs.rmSync(outputDir, { recursive: true });
    }
    fs.mkdirSync(outputDir, { recursive: true });

    qrLibretasExpected.set(event_id, { total: libretas.length, status: 'generating', folder: outputDir });

    // Responder inmediatamente — generación corre en background
    res.json({
      success: true,
      data: {
        event_name: event.name,
        libretas_total: libretas.length,
        qr_size: `${qrSize}x${qrSize}px`,
        message: `Generando ${libretas.length} QR de libretas en background. Consulte progreso en /api/export/qr-libretas/progress/${event_id}`,
      },
    });

    // Generar en background
    (async () => {
      try {
        const BATCH_SIZE = 500;
        for (let i = 0; i < libretas.length; i += BATCH_SIZE) {
          const batch = libretas.slice(i, i + BATCH_SIZE);
          await Promise.all(batch.map(async (libreta) => {
            const qrContent = libreta.lote_code;
            const png = await generateLibretaLabel(qrContent, libreta.lote_code, qrSize);
            fs.writeFileSync(path.join(outputDir, `${libreta.lote_code}.png`), png);
          }));
        }

        // Crear ZIP
        qrLibretasExpected.set(event_id, { total: libretas.length, status: 'zipping', folder: outputDir });
        const zipPath = path.join(__dirname, '..', '..', 'data', 'qr-libretas', `${safeName}_${event_id}.zip`);
        if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
        await new Promise<void>((resolve, reject) => {
          const output = fs.createWriteStream(zipPath);
          const archive = archiver('zip', { store: true });
          output.on('close', resolve);
          archive.on('error', reject);
          archive.pipe(output);
          archive.directory(outputDir, `QR_Libretas_${safeName}`);
          archive.finalize();
        });

        const zipSizeMB = (fs.statSync(zipPath).size / (1024 * 1024)).toFixed(2);
        qrLibretasExpected.set(event_id, { total: libretas.length, status: 'completed', folder: outputDir, zipPath });
        console.log(`QR libretas generados: ${libretas.length} libretas, ZIP: ${zipSizeMB} MB`);
        setTimeout(() => qrLibretasExpected.delete(event_id), 30 * 60 * 1000);

        logActivity(pool, auditFromReq(req, 'export_qr_libretas', 'export', {
          event_id, event_name: event.name, libretas_count: libretas.length, qr_size: qrSize,
        }));
      } catch (err) {
        console.error('Error en generación background de QR libretas:', err);
        qrLibretasExpected.set(event_id, { total: libretas.length, status: 'error', folder: outputDir });
      }
    })();
  } catch (error) {
    console.error('Error generando QR libretas:', error);
    const eventIdKey = req.body?.event_id;
    if (eventIdKey) qrLibretasExpected.set(eventIdKey, { total: 0, status: 'error', folder: '' });
    res.status(500).json({ success: false, error: 'Error generando QR de libretas' });
  }
});

// GET /api/export/qr-libretas/progress/:eventId
router.get('/qr-libretas/progress/:eventId', (req: Request, res: Response) => {
  const eventId = parseInt(String(req.params.eventId), 10);
  const info = qrLibretasExpected.get(eventId);

  if (!info) return res.json({ success: true, data: null });

  let generated = 0;
  if (info.folder && fs.existsSync(info.folder)) {
    try {
      generated = fs.readdirSync(info.folder).filter(f => f.endsWith('.png')).length;
    } catch { generated = 0; }
  }

  res.json({ success: true, data: { total: info.total, generated, status: info.status } });
});

// GET /api/export/qr-libretas/download/:eventId
router.get('/qr-libretas/download/:eventId', requirePermission('cards:export'), async (req: Request, res: Response) => {
  try {
    const eventId = parseInt(String(req.params.eventId), 10);
    const info = qrLibretasExpected.get(eventId);

    if (info?.zipPath && fs.existsSync(info.zipPath)) {
      const fileName = path.basename(info.zipPath, '.zip');
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}.zip"`);
      return fs.createReadStream(info.zipPath).pipe(res);
    }

    // Fallback: buscar por nombre del evento en BD
    const pool = getPool();
    const { rows } = await pool.query('SELECT name FROM events WHERE id = $1', [eventId]);
    const event = rows[0] as { name: string } | undefined;
    if (!event) return res.status(404).json({ success: false, error: 'Evento no encontrado' });

    const safeName = event.name.replace(/[^a-zA-Z0-9_\- ]/g, '').replace(/\s+/g, '_');
    const zipPath = path.join(__dirname, '..', '..', 'data', 'qr-libretas', `${safeName}_${eventId}.zip`);

    if (!fs.existsSync(zipPath)) {
      return res.status(404).json({ success: false, error: 'Genere los QR de libretas primero' });
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="QR_Libretas_${safeName}.zip"`);
    fs.createReadStream(zipPath).pipe(res);
  } catch (error) {
    console.error('Error descargando QR libretas:', error);
    res.status(500).json({ success: false, error: 'Error descargando archivo' });
  }
});

export default router;
