import { Router } from 'express';
import type { Request, Response } from 'express';
import { getDatabase } from '../database/init.js';
import { generateCardsPDF, exportCardsAsImages, generateCardImage } from '../services/exportService.js';
import type { BingoCard, CardNumbers } from '../types/index.js';

const router = Router();

// POST /api/export/pdf - Exportar cartones a PDF
router.post('/pdf', async (req: Request, res: Response) => {
  try {
    const { event_id, card_ids, cards_per_page = 4, include_validation_code = true } = req.body;

    if (!event_id && !card_ids) {
      return res.status(400).json({ success: false, error: 'Se requiere event_id o card_ids' });
    }

    const db = getDatabase();

    let cards: BingoCard[];
    if (card_ids && Array.isArray(card_ids)) {
      if (card_ids.length > 1000) {
        db.close();
        return res.status(400).json({ success: false, error: 'Máximo 1000 cartones por solicitud' });
      }
      cards = db.prepare(`
        SELECT * FROM cards WHERE id IN (${card_ids.map(() => '?').join(',')})
      `).all(...card_ids) as BingoCard[];
    } else {
      cards = db.prepare(`
        SELECT * FROM cards WHERE event_id = ? ORDER BY card_number LIMIT 1000
      `).all(event_id) as BingoCard[];
    }

    if (cards.length === 0) {
      db.close();
      return res.status(404).json({ success: false, error: 'No se encontraron cartones' });
    }

    // Obtener configuración de FREE center del evento
    const eventForConfig = db.prepare('SELECT use_free_center FROM events WHERE id = ?').get(cards[0].event_id) as { use_free_center: number } | undefined;
    const useFreeCenter = eventForConfig?.use_free_center !== 0;
    db.close();

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
    const db = getDatabase();
    const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(req.params.id) as BingoCard | undefined;

    if (!card) {
      db.close();
      return res.status(404).json({ success: false, error: 'Cartón no encontrado' });
    }

    const eventForConfig = db.prepare('SELECT use_free_center FROM events WHERE id = ?').get(card.event_id) as { use_free_center: number } | undefined;
    const useFreeCenter = eventForConfig?.use_free_center !== 0;
    db.close();

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
router.post('/images', async (req: Request, res: Response) => {
  try {
    const { event_id, card_ids, limit = 100 } = req.body;

    if (!event_id && !card_ids) {
      return res.status(400).json({ success: false, error: 'Se requiere event_id o card_ids' });
    }

    const db = getDatabase();

    let cards: BingoCard[];
    if (card_ids && Array.isArray(card_ids)) {
      if (card_ids.length > 500) {
        db.close();
        return res.status(400).json({ success: false, error: 'Máximo 500 cartones por solicitud' });
      }
      cards = db.prepare(`
        SELECT * FROM cards WHERE id IN (${card_ids.map(() => '?').join(',')})
      `).all(...card_ids) as BingoCard[];
    } else {
      cards = db.prepare(`
        SELECT * FROM cards WHERE event_id = ? ORDER BY card_number LIMIT ?
      `).all(event_id, Math.min(limit, 500)) as BingoCard[];
    }

    if (cards.length === 0) {
      db.close();
      return res.status(404).json({ success: false, error: 'No se encontraron cartones' });
    }

    const eventForConfig = db.prepare('SELECT use_free_center FROM events WHERE id = ?').get(cards[0].event_id) as { use_free_center: number } | undefined;
    const useFreeCenter = eventForConfig?.use_free_center !== 0;
    db.close();

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
router.get('/csv/:eventId', (req: Request, res: Response) => {
  try {
    const eventId = parseInt(req.params.eventId as string, 10);
    const db = getDatabase();

    const event = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId) as { name: string; use_free_center: number } | undefined;
    if (!event) {
      db.close();
      return res.status(404).json({ success: false, error: 'Evento no encontrado' });
    }

    const useFreeCenter = event.use_free_center !== 0;
    const cards = db.prepare('SELECT * FROM cards WHERE event_id = ? ORDER BY card_number').all(eventId) as BingoCard[];
    db.close();

    if (cards.length === 0) {
      return res.status(404).json({ success: false, error: 'No hay cartones para exportar' });
    }

    // Construir CSV - siempre 5 valores por columna (N3=FREE si use_free_center)
    const header = 'card_number,serial,card_code,validation_code,B1,B2,B3,B4,B5,I1,I2,I3,I4,I5,N1,N2,N3,N4,N5,G1,G2,G3,G4,G5,O1,O2,O3,O4,O5';

    const rows = cards.map(card => {
      const nums: CardNumbers = JSON.parse(card.numbers);

      // Expandir N a 5 valores: si FREE center, insertar FREE en posición 3 (índice 2)
      const nValues: (number | string)[] = useFreeCenter
        ? [nums.N[0], nums.N[1], 'FREE', nums.N[2], nums.N[3]]
        : nums.N;

      const values = [
        card.card_number,
        card.serial,
        card.card_code,
        card.validation_code,
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

export default router;
