import { Router } from 'express';
import type { Request, Response } from 'express';
import { getPool } from '../database/init.js';
import { generateCardsPDF, exportCardsAsImages, generateCardImage } from '../services/exportService.js';
import { requirePermission } from '../middleware/auth.js';
import type { BingoCard, BingoEvent, CardNumbers } from '../types/index.js';
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';
import archiver from 'archiver';

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
      numbers: JSON.parse(card.numbers as unknown as string) as CardNumbers,
      useFreeCenter,
    }));

    const filepath = await generateCardsPDF(cardData, {
      cardsPerPage: cards_per_page,
      includeValidationCode: include_validation_code,
    });

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
      numbers: JSON.parse(card.numbers as unknown as string) as CardNumbers,
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
      numbers: JSON.parse(card.numbers as unknown as string) as CardNumbers,
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
      const nums: CardNumbers = JSON.parse(card.numbers);

      // Expandir N a 5 valores: si FREE center, insertar FREE en posición 3 (índice 2)
      const nValues: (number | string)[] = useFreeCenter
        ? [nums.N[0], nums.N[1], 'FREE', nums.N[2], nums.N[3]]
        : nums.N;

      // Escapar promo_text si contiene comas
      const promoText = card.promo_text
        ? (card.promo_text.includes(',') ? `"${card.promo_text}"` : card.promo_text)
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
const qrExpected = new Map<number, { total: number; status: 'generating' | 'zipping' | 'completed' | 'error'; folder: string }>();

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

    if (cards.length > 50000) {
      return res.status(400).json({ success: false, error: `Demasiados cartones (${cards.length}). Maximo 50,000 por solicitud. Use rangos mas pequenos.` });
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

    // Registrar total esperado y carpeta
    qrExpected.set(event_id, { total: cards.length, status: 'generating', folder: outputDir });

    // Generar QR codes - nombre del archivo = serial (ej: 00001-01.png)
    for (const card of cards) {
      const url = buildUrl(card);
      const filePath = path.join(outputDir, `${card.serial}.png`);

      await QRCode.toFile(filePath, url, {
        width: qrSize,
        margin: 1,
        color: { dark: '#000000', light: '#ffffff' },
        errorCorrectionLevel: 'M',
      });
    }

    // Crear ZIP para descarga
    qrExpected.set(event_id, { total: cards.length, status: 'zipping', folder: outputDir });
    const zipPath = path.join(__dirname, '..', '..', 'data', 'qr', `${safeName}_${event_id}.zip`);
    await new Promise<void>((resolve, reject) => {
      const output = fs.createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 6 } });

      output.on('close', resolve);
      archive.on('error', reject);

      archive.pipe(output);
      archive.directory(outputDir, `QR_${safeName}`);
      archive.finalize();
    });

    const zipSizeMB = (fs.statSync(zipPath).size / (1024 * 1024)).toFixed(2);
    const sampleUrl = buildUrl(cards[0]);

    qrExpected.set(event_id, { total: cards.length, status: 'completed', folder: outputDir });
    // Limpiar despues de 5 minutos
    setTimeout(() => qrExpected.delete(event_id), 5 * 60 * 1000);

    res.json({
      success: true,
      data: {
        event_name: event.name,
        cards_processed: cards.length,
        qr_size: `${qrSize}x${qrSize}px`,
        url_template,
        output_folder: outputDir,
        zip_file: zipPath,
        zip_size_mb: zipSizeMB,
        sample_url: sampleUrl,
      },
    });
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
    const pool = getPool();
    const { rows } = await pool.query('SELECT name FROM events WHERE id = $1', [eventId]);
    const event = rows[0] as { name: string } | undefined;

    if (!event) {
      return res.status(404).json({ success: false, error: 'Evento no encontrado' });
    }

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
router.get('/qr/single/:cardCode', async (req: Request, res: Response) => {
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

export default router;
