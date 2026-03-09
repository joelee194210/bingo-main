import { Router } from 'express';
import type { Request, Response } from 'express';
import { getDatabase } from '../database/init.js';
import { generateCards, cardNumbersToMatrix, type GeneratedCard } from '../services/cardGenerator.js';
import { verifyEventCards, validateCard } from '../services/cardVerifier.js';
import { requirePermission } from '../middleware/auth.js';
import type { BingoCard, BingoEvent, CardNumbers } from '../types/index.js';

const router = Router();

// Almacenar progreso de generación en memoria
const generationProgress = new Map<number, {
  total: number;
  generated: number;
  inserted: number;
  status: 'generating' | 'inserting' | 'completed' | 'error';
  error?: string;
}>();

// GET /api/cards - Listar cartones con paginación
router.get('/', (req: Request, res: Response) => {
  try {
    const { event_id, page = '1', limit = '50', is_sold } = req.query;
    const pageNum = Math.max(1, parseInt(page as string, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10)));
    const offset = (pageNum - 1) * limitNum;

    const db = getDatabase();

    let whereClause = '';
    const params: unknown[] = [];

    if (event_id) {
      whereClause = 'WHERE event_id = ?';
      params.push(event_id);
      if (is_sold !== undefined) {
        whereClause += ' AND is_sold = ?';
        params.push(is_sold === 'true' ? 1 : 0);
      }
    } else if (is_sold !== undefined) {
      whereClause = 'WHERE is_sold = ?';
      params.push(is_sold === 'true' ? 1 : 0);
    }

    const countResult = db.prepare(`SELECT COUNT(*) as total FROM cards ${whereClause}`).get(...params) as { total: number };

    const cards = db.prepare(`
      SELECT id, event_id, card_number, serial, card_code, validation_code, is_sold, buyer_name, created_at
      FROM cards ${whereClause}
      ORDER BY card_number
      LIMIT ? OFFSET ?
    `).all(...params, limitNum, offset) as Omit<BingoCard, 'numbers' | 'numbers_hash'>[];

    db.close();

    res.json({
      success: true,
      data: cards,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: countResult.total,
        totalPages: Math.ceil(countResult.total / limitNum),
      },
    });
  } catch (error) {
    console.error('Error listando cartones:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// POST /api/cards/generate - Generar cartones para un evento (solo admin)
router.post('/generate', requirePermission('cards:create'), async (req: Request, res: Response) => {
  try {
    const { event_id, quantity } = req.body;

    if (!event_id || !quantity) {
      return res.status(400).json({ success: false, error: 'event_id y quantity son requeridos' });
    }

    const qty = parseInt(quantity, 10);
    if (qty < 1 || qty > 1000000) {
      return res.status(400).json({ success: false, error: 'quantity debe estar entre 1 y 1,000,000' });
    }

    const db = getDatabase();

    // Verificar evento existe y obtener configuración
    const event = db.prepare('SELECT * FROM events WHERE id = ?').get(event_id) as BingoEvent | undefined;
    if (!event) {
      db.close();
      return res.status(404).json({ success: false, error: 'Evento no encontrado' });
    }

    // Obtener configuración de FREE center
    const useFreeCenter = event.use_free_center !== 0;

    // Obtener hashes y códigos existentes
    const existingHashes = new Set<string>();
    const existingCodes = new Set<string>();

    const existing = db.prepare('SELECT numbers_hash, card_code, validation_code FROM cards WHERE event_id = ?').all(event_id) as Array<{
      numbers_hash: string;
      card_code: string;
      validation_code: string;
    }>;

    for (const card of existing) {
      existingHashes.add(card.numbers_hash);
      existingCodes.add(card.card_code);
      existingCodes.add(card.validation_code);
    }

    // Obtener el último número de cartón
    const lastCard = db.prepare('SELECT MAX(card_number) as max_num FROM cards WHERE event_id = ?').get(event_id) as { max_num: number | null };
    let cardNumber = (lastCard.max_num || 0) + 1;

    // Iniciar progreso
    generationProgress.set(event_id, { total: qty, generated: 0, inserted: 0, status: 'generating' });

    // Generar cartones (pasando useFreeCenter)
    const result = await generateCards(qty, existingHashes, existingCodes, (generated, total) => {
      generationProgress.set(event_id, { total, generated, inserted: 0, status: 'generating' });
    }, useFreeCenter);

    // Insertar en lotes
    generationProgress.set(event_id, { total: qty, generated: qty, inserted: 0, status: 'inserting' });

    const insertStmt = db.prepare(`
      INSERT INTO cards (event_id, card_number, serial, card_code, validation_code, numbers, numbers_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((cards: GeneratedCard[]) => {
      for (const card of cards) {
        const cn = cardNumber++;
        const series = Math.ceil(cn / 50).toString().padStart(5, '0');
        const seq = (((cn - 1) % 50) + 1).toString().padStart(2, '0');
        insertStmt.run(
          event_id,
          cn,
          `${series}-${seq}`,
          card.card_code,
          card.validation_code,
          JSON.stringify(card.numbers),
          card.numbers_hash
        );
      }
    });

    // Insertar en lotes de 1000 con progreso
    const batchSize = 1000;
    let totalInserted = 0;
    for (let i = 0; i < result.cards.length; i += batchSize) {
      const batch = result.cards.slice(i, i + batchSize);
      insertMany(batch);
      totalInserted += batch.length;
      generationProgress.set(event_id, { total: qty, generated: qty, inserted: totalInserted, status: 'inserting' });
    }

    generationProgress.set(event_id, { total: qty, generated: qty, inserted: qty, status: 'completed' });

    // Limpiar progreso después de 5 minutos
    setTimeout(() => generationProgress.delete(event_id), 5 * 60 * 1000);

    db.close();

    res.json({
      success: true,
      data: {
        generated: result.cards.length,
        duplicatesAvoided: result.duplicatesAvoided,
        generationTime: result.generationTime,
      },
    });
  } catch (error) {
    console.error('Error generando cartones:', error);
    const event_id_key = req.body?.event_id;
    if (event_id_key) {
      generationProgress.set(event_id_key, { total: 0, generated: 0, inserted: 0, status: 'error', error: 'Error en generación' });
    }
    res.status(500).json({ success: false, error: 'Error generando cartones' });
  }
});

// GET /api/cards/generate/progress/:eventId
router.get('/generate/progress/:eventId', (req: Request, res: Response) => {
  const eventId = parseInt(req.params.eventId as string, 10);
  const progress = generationProgress.get(eventId);

  if (!progress) {
    return res.json({ success: true, data: null });
  }

  res.json({ success: true, data: progress });
});

// POST /api/cards/validate - Validar cartón por códigos
router.post('/validate', (req: Request, res: Response) => {
  try {
    const { card_code, validation_code } = req.body;

    if (!card_code || !validation_code) {
      return res.status(400).json({ success: false, error: 'card_code y validation_code son requeridos' });
    }

    const db = getDatabase();
    const result = validateCard(db, card_code.toUpperCase(), validation_code.toUpperCase());
    db.close();

    if (!result.valid) {
      return res.status(404).json({ success: false, error: result.error });
    }

    res.json({ success: true, data: result.card });
  } catch (error) {
    console.error('Error validando cartón:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// POST /api/cards/verify/:eventId - Verificar unicidad de cartones
router.post('/verify/:eventId', async (req: Request, res: Response) => {
  try {
    const eventId = parseInt(req.params.eventId as string, 10);
    const db = getDatabase();

    const event = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
    if (!event) {
      db.close();
      return res.status(404).json({ success: false, error: 'Evento no encontrado' });
    }

    const result = await verifyEventCards(db, eventId);
    db.close();

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error verificando cartones:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// PUT /api/cards/:id/sell - Marcar cartón como vendido (admin, moderador, vendedor)
router.put('/:id/sell', requirePermission('cards:sell'), (req: Request, res: Response) => {
  try {
    const { buyer_name, buyer_phone } = req.body;
    const db = getDatabase();

    const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(req.params.id as string);
    if (!card) {
      db.close();
      return res.status(404).json({ success: false, error: 'Cartón no encontrado' });
    }

    db.prepare(`
      UPDATE cards SET is_sold = 1, sold_at = CURRENT_TIMESTAMP, buyer_name = ?, buyer_phone = ?
      WHERE id = ?
    `).run(buyer_name || null, buyer_phone || null, req.params.id as string);

    const updated = db.prepare('SELECT * FROM cards WHERE id = ?').get(req.params.id as string) as BingoCard;
    db.close();

    res.json({ success: true, data: updated });
  } catch (error) {
    console.error('Error vendiendo cartón:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// GET /api/cards/search/:code - Buscar cartón por código
router.get('/search/:code', (req: Request, res: Response) => {
  try {
    const code = (req.params.code as string).toUpperCase();
    const db = getDatabase();

    const card = db.prepare(`
      SELECT * FROM cards WHERE card_code = ?
      UNION SELECT * FROM cards WHERE validation_code = ?
      UNION SELECT * FROM cards WHERE serial = ?
      LIMIT 1
    `).get(code, code, code) as BingoCard | undefined;

    if (!card) {
      db.close();
      return res.status(404).json({ success: false, error: 'Cartón no encontrado' });
    }

    // Obtener configuración del evento
    const event = db.prepare('SELECT use_free_center FROM events WHERE id = ?').get(card.event_id) as { use_free_center: number } | undefined;
    const useFreeCenter = event?.use_free_center !== 0;
    db.close();

    const numbers: CardNumbers = JSON.parse(card.numbers);
    res.json({
      success: true,
      data: { ...card, numbers, matrix: cardNumbersToMatrix(numbers, useFreeCenter) },
    });
  } catch (error) {
    console.error('Error buscando cartón:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// GET /api/cards/:id - Obtener cartón con números (DEBE ir después de rutas estáticas)
router.get('/:id', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(req.params.id as string) as BingoCard | undefined;

    if (!card) {
      db.close();
      return res.status(404).json({ success: false, error: 'Cartón no encontrado' });
    }

    // Obtener configuración del evento
    const event = db.prepare('SELECT use_free_center FROM events WHERE id = ?').get(card.event_id) as { use_free_center: number } | undefined;
    const useFreeCenter = event?.use_free_center !== 0;
    db.close();

    const numbers: CardNumbers = JSON.parse(card.numbers);
    const matrix = cardNumbersToMatrix(numbers, useFreeCenter);

    res.json({
      success: true,
      data: {
        ...card,
        numbers,
        matrix,
      },
    });
  } catch (error) {
    console.error('Error obteniendo cartón:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

export default router;
