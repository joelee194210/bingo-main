import { Router } from 'express';
import type { Request, Response } from 'express';
import { getPool } from '../database/init.js';
import { generateCards, cardNumbersToMatrix } from '../services/cardGenerator.js';
import { verifyEventCards, validateCard, parseNumbers } from '../services/cardVerifier.js';
import { requirePermission } from '../middleware/auth.js';
import type { BingoCard, BingoEvent, CardNumbers } from '../types/index.js';
import { logActivity, auditFromReq } from '../services/auditService.js';
import { normalizeSerial } from '../services/inventarioModule.js';
import { CARDS_PER_SERIES } from '../constants.js';
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
router.get('/', async (req: Request, res: Response) => {
  try {
    const { event_id, page = '1', limit = '50', is_sold, search, caja, lote, almacen_id } = req.query;
    const pageNum = Math.max(1, parseInt(page as string, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10)));
    const offset = (pageNum - 1) * limitNum;

    const pool = getPool();

    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (event_id) {
      conditions.push(`c.event_id = $${paramIdx++}`);
      params.push(event_id);
    }
    if (is_sold !== undefined && is_sold !== '' && is_sold !== 'all') {
      conditions.push(`c.is_sold = $${paramIdx++}`);
      params.push(is_sold === 'true');
    }
    if (almacen_id) {
      conditions.push(`c.almacen_id = $${paramIdx++}`);
      params.push(almacen_id);
    }
    if (caja && typeof caja === 'string' && caja.trim()) {
      conditions.push(`ca.caja_code = $${paramIdx++}`);
      params.push(caja.trim().toUpperCase());
    }
    if (lote && typeof lote === 'string' && lote.trim()) {
      conditions.push(`l.lote_code = $${paramIdx++}`);
      params.push(lote.trim().toUpperCase());
    }
    if (search && typeof search === 'string' && search.trim()) {
      const s = search.trim().toUpperCase();
      conditions.push(`(
        c.card_code LIKE $${paramIdx}
        OR c.serial LIKE $${paramIdx + 1}
        OR CAST(c.card_number AS TEXT) LIKE $${paramIdx + 2}
        OR COALESCE(l.lote_code, '') LIKE $${paramIdx + 3}
        OR COALESCE(ca.caja_code, '') LIKE $${paramIdx + 4}
        OR COALESCE(c.buyer_name, '') ILIKE $${paramIdx + 5}
      )`);
      params.push(`%${s}%`, `%${s}%`, `%${s}%`, `%${s}%`, `%${s}%`, `%${s}%`);
      paramIdx += 6;
    }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const countResult = (await pool.query(`
      SELECT COUNT(*) as total
      FROM cards c
      LEFT JOIN lotes l ON l.id = c.lote_id
      LEFT JOIN cajas ca ON ca.id = l.caja_id
      ${whereClause}
    `, params)).rows[0] as { total: number };

    const cards = (await pool.query(`
      SELECT c.id, c.event_id, c.card_number, c.serial, c.card_code, c.validation_code,
             c.is_sold, c.buyer_name, c.buyer_phone, c.sold_at, c.created_at, c.almacen_id,
             l.lote_code, l.id as lote_id,
             ca.caja_code, ca.id as caja_id,
             alm.name as almacen_name
      FROM cards c
      LEFT JOIN lotes l ON l.id = c.lote_id
      LEFT JOIN cajas ca ON ca.id = l.caja_id
      LEFT JOIN almacenes alm ON alm.id = c.almacen_id
      ${whereClause}
      ORDER BY c.card_number
      LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
    `, [...params, limitNum, offset])).rows;

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
    const { event_id, quantity, lotes_por_caja } = req.body;

    if (!event_id || !quantity) {
      return res.status(400).json({ success: false, error: 'event_id y quantity son requeridos' });
    }

    const qty = parseInt(quantity, 10);
    if (qty < 1 || qty > 1000000) {
      return res.status(400).json({ success: false, error: 'quantity debe estar entre 1 y 1,000,000' });
    }

    // Lotes por caja: cuántas libretas (de 50 cartones) van en cada caja
    const lotesPerCaja = Math.max(1, Math.min(500, parseInt(lotes_por_caja, 10) || 50));

    const pool = getPool();

    // Verificar evento existe y obtener configuración
    const { rows: eventRows } = await pool.query('SELECT * FROM events WHERE id = $1', [event_id]);
    const event = eventRows[0] as BingoEvent | undefined;
    if (!event) {
      return res.status(404).json({ success: false, error: 'Evento no encontrado' });
    }

    // Obtener configuración de FREE center
    const useFreeCenter = event.use_free_center !== false;

    // Obtener hashes existentes del evento (para unicidad de números del cartón).
    // Acotado por evento: el hash solo compite con los cartones del mismo evento.
    const existingHashes = new Set<string>();
    const { rows: eventCards } = await pool.query(
      'SELECT numbers_hash FROM cards WHERE event_id = $1',
      [event_id]
    );
    for (const card of eventCards) {
      existingHashes.add(card.numbers_hash);
    }

    // DB-C2: NO precargar los codes de toda la BD (OOM con 1M+ cartones globales).
    // Antes hacíamos `SELECT card_code, validation_code FROM cards` sin WHERE,
    // lo que cargaba 2M+ strings al heap. Los UNIQUE constraints de BD protegen
    // contra colisiones cross-evento; solo dedupeamos contra el evento actual.
    const existingCodes = new Set<string>();
    const { rows: eventCodes } = await pool.query(
      'SELECT card_code, validation_code FROM cards WHERE event_id = $1',
      [event_id]
    );
    for (const row of eventCodes) {
      existingCodes.add(row.card_code);
      existingCodes.add(row.validation_code);
    }

    // Obtener el último número de cartón
    const { rows: lastCardRows } = await pool.query('SELECT MAX(card_number) as max_num FROM cards WHERE event_id = $1', [event_id]);
    let cardNumber = (lastCardRows[0].max_num || 0) + 1;
    const firstCardNumber = cardNumber;

    // Obtener el último número de caja existente para este evento
    const { rows: lastCajaRows } = await pool.query(
      `SELECT caja_code FROM cajas WHERE event_id = $1 ORDER BY id DESC LIMIT 1`, [event_id]
    );
    let cajaSeq = 0;
    if (lastCajaRows.length > 0) {
      const match = (lastCajaRows[0].caja_code as string).match(/C(\d+)/);
      if (match) cajaSeq = parseInt(match[1], 10);
    }

    // Guardia de concurrencia: no permitir generación simultánea para el mismo evento
    const currentProgress = generationProgress.get(event_id);
    if (currentProgress && (currentProgress.status === 'generating' || currentProgress.status === 'inserting')) {
      return res.status(409).json({ success: false, error: 'Ya hay una generación en progreso para este evento. Espere a que termine.' });
    }

    // Iniciar progreso
    generationProgress.set(event_id, { total: qty, generated: 0, inserted: 0, status: 'generating' });

    // Generar cartones (pasando useFreeCenter)
    const result = await generateCards(qty, existingHashes, existingCodes, (generated, total) => {
      generationProgress.set(event_id, { total, generated, inserted: 0, status: 'generating' });
    }, useFreeCenter);

    // Insertar cartones
    generationProgress.set(event_id, { total: qty, generated: qty, inserted: 0, status: 'inserting' });

    // Valores que se calculan dentro de la transacción pero se usan en la response.
    let totalLotes = 0;
    let totalCajas = 0;

    // DB-C1: envolver TODO el flujo de persistencia en una única transacción.
    // Antes: INSERT cards (múltiples batches) + INSERT cajas + INSERT lotes
    // + UPDATE cards.lote_id iban como queries independientes. Si una fallaba
    // quedaban cartones huérfanos con lote_id NULL y contadores desfasados.
    // Ahora todo comparte client + BEGIN/COMMIT; cualquier fallo → ROLLBACK total.
    const txClient = await pool.connect();
    try {
      await txClient.query('BEGIN');

      const batchSize = 1000;
      let totalInserted = 0;
      for (let i = 0; i < result.cards.length; i += batchSize) {
        const batch = result.cards.slice(i, i + batchSize);

        const valuesParts: string[] = [];
        const batchParams: unknown[] = [];
        let pIdx = 1;
        for (const card of batch) {
          const cn = cardNumber++;
          const series = Math.ceil(cn / CARDS_PER_SERIES).toString().padStart(5, '0');
          const seq = (((cn - 1) % CARDS_PER_SERIES) + 1).toString().padStart(2, '0');
          valuesParts.push(`($${pIdx}, $${pIdx + 1}, $${pIdx + 2}, $${pIdx + 3}, $${pIdx + 4}, $${pIdx + 5}, $${pIdx + 6})`);
          batchParams.push(
            event_id,
            cn,
            `${series}-${seq}`,
            card.card_code,
            card.validation_code,
            JSON.stringify(card.numbers),
            card.numbers_hash
          );
          pIdx += 7;
        }

        await txClient.query(`
          INSERT INTO cards (event_id, card_number, serial, card_code, validation_code, numbers, numbers_hash)
          VALUES ${valuesParts.join(', ')}
        `, batchParams);

        totalInserted += batch.length;
        generationProgress.set(event_id, { total: qty, generated: qty, inserted: totalInserted, status: 'inserting' });
      }

      // =====================================================
      // CREAR LOTES Y CAJAS (dentro de la misma transacción)
      // =====================================================
      const totalCards = result.cards.length;
      const firstSeries = Math.ceil(firstCardNumber / CARDS_PER_SERIES);
      const lastSeries = Math.ceil((firstCardNumber + totalCards - 1) / CARDS_PER_SERIES);
      totalLotes = lastSeries - firstSeries + 1;
      totalCajas = Math.ceil(totalLotes / lotesPerCaja);

      // Buscar almacen raiz del evento (primer almacen sin parent)
      const almacenRaiz = await txClient.query(
        `SELECT id FROM almacenes WHERE event_id = $1 AND parent_id IS NULL ORDER BY id LIMIT 1`,
        [event_id]
      );
      const almacenRaizId = almacenRaiz.rows[0]?.id || null;

      // Crear cajas (asignadas al almacen raiz si existe)
      const cajaIds: number[] = [];
      for (let c = 0; c < totalCajas; c++) {
        cajaSeq++;
        const cajaCode = `C${cajaSeq.toString().padStart(3, '0')}`;
        const lotesEnEstaCaja = Math.min(lotesPerCaja, totalLotes - c * lotesPerCaja);
        const { rows } = await txClient.query(
          `INSERT INTO cajas (event_id, caja_code, total_lotes, status, almacen_id) VALUES ($1, $2, $3, 'sellada', $4) RETURNING id`,
          [event_id, cajaCode, lotesEnEstaCaja, almacenRaizId]
        );
        cajaIds.push(rows[0].id);
      }

      // Crear lotes y asignar a cajas
      let loteIndex = 0;
      for (let s = firstSeries; s <= lastSeries; s++) {
        const seriesStr = s.toString().padStart(5, '0');
        const loteCode = `L${seriesStr}`;
        const cajaIndex = Math.floor(loteIndex / lotesPerCaja);
        const cajaId = cajaIds[cajaIndex];

        // Contar cartones reales en esta serie
        const seriesFirstCard = (s - 1) * CARDS_PER_SERIES + 1;
        const seriesLastCard = s * CARDS_PER_SERIES;
        const actualCards = Math.min(seriesLastCard, firstCardNumber + totalCards - 1) - Math.max(seriesFirstCard, firstCardNumber) + 1;

        const { rows: loteRows } = await txClient.query(
          `INSERT INTO lotes (event_id, caja_id, lote_code, series_number, status, total_cards, almacen_id)
           VALUES ($1, $2, $3, $4, 'en_caja', $5, $6) RETURNING id`,
          [event_id, cajaId, loteCode, seriesStr, actualCards, almacenRaizId]
        );
        const loteId = loteRows[0].id;

        // Actualizar los cartones de esta serie con su lote_id y almacen_id
        await txClient.query(
          `UPDATE cards SET lote_id = $1, almacen_id = $2
           WHERE event_id = $3 AND card_number >= $4 AND card_number <= $5`,
          [loteId, almacenRaizId, event_id, Math.max(seriesFirstCard, firstCardNumber), Math.min(seriesLastCard, firstCardNumber + totalCards - 1)]
        );

        loteIndex++;
      }

      await txClient.query('COMMIT');
    } catch (txErr) {
      await txClient.query('ROLLBACK').catch(() => {});
      throw txErr;
    } finally {
      txClient.release();
    }

    generationProgress.set(event_id, { total: qty, generated: qty, inserted: qty, status: 'completed' });

    logActivity(pool, auditFromReq(req, 'cards_generated', 'cards', { event_id, quantity: result.cards.length }));

    // Limpiar progreso después de 5 minutos
    setTimeout(() => generationProgress.delete(event_id), 5 * 60 * 1000);

    res.json({
      success: true,
      data: {
        generated: result.cards.length,
        duplicatesAvoided: result.duplicatesAvoided,
        generationTime: result.generationTime,
        lotes_creados: totalLotes,
        cajas_creadas: totalCajas,
        lotes_por_caja: lotesPerCaja,
        cartones_por_caja: lotesPerCaja * CARDS_PER_SERIES,
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
router.post('/validate', async (req: Request, res: Response) => {
  try {
    const { card_code, validation_code } = req.body;

    if (!card_code || !validation_code) {
      return res.status(400).json({ success: false, error: 'card_code y validation_code son requeridos' });
    }

    const pool = getPool();
    const result = await validateCard(pool, card_code.toUpperCase(), validation_code.toUpperCase());

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
    const pool = getPool();

    const { rows } = await pool.query('SELECT * FROM events WHERE id = $1', [eventId]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Evento no encontrado' });
    }

    const result = await verifyEventCards(pool, eventId);

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error verificando cartones:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// PUT /api/cards/:id/sell - Marcar cartón como vendido (admin, moderador, vendedor)
router.put('/:id/sell', requirePermission('cards:sell'), async (req: Request, res: Response) => {
  const pool = getPool();
  const client = await pool.connect();
  try {
    const { buyer_name, buyer_phone } = req.body;
    const cardId = parseInt(String(req.params.id), 10);
    if (!Number.isInteger(cardId) || cardId <= 0) {
      return res.status(400).json({ success: false, error: 'ID de cartón inválido' });
    }

    // DB-C4: SELECT ... FOR UPDATE bloquea la fila hasta el COMMIT.
    // Sin esto, dos vendedores pueden leer is_sold = false simultáneamente
    // y ambos ejecutar el UPDATE, vendiendo el mismo cartón dos veces
    // (con el trigger de contadores quedando desfasado).
    await client.query('BEGIN');

    const { rows: cardRows } = await client.query(
      'SELECT * FROM cards WHERE id = $1 FOR UPDATE',
      [cardId]
    );
    const card = cardRows[0] as BingoCard | undefined;
    if (!card) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Cartón no encontrado' });
    }

    if (card.is_sold) {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, error: 'El cartón ya fue vendido' });
    }

    await client.query(
      `UPDATE cards SET is_sold = true, sold_at = CURRENT_TIMESTAMP, buyer_name = $1, buyer_phone = $2
       WHERE id = $3`,
      [buyer_name || null, buyer_phone || null, cardId]
    );

    const { rows: updatedRows } = await client.query(
      'SELECT * FROM cards WHERE id = $1',
      [cardId]
    );
    const updated = updatedRows[0] as BingoCard;

    await client.query('COMMIT');

    logActivity(pool, auditFromReq(req, 'card_sold', 'cards', { card_id: card.id, card_code: card.card_code, buyer_name }));

    res.json({ success: true, data: updated });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error vendiendo cartón:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  } finally {
    client.release();
  }
});

// PUT /api/cards/:id/unsell - Desmarcar cartón como vendido
router.put('/:id/unsell', requirePermission('cards:sell'), async (req: Request, res: Response) => {
  try {
    const pool = getPool();

    const { rows: cardRows } = await pool.query('SELECT * FROM cards WHERE id = $1', [req.params.id]);
    const card = cardRows[0] as BingoCard | undefined;
    if (!card) {
      return res.status(404).json({ success: false, error: 'Cartón no encontrado' });
    }

    if (!card.is_sold) {
      return res.status(409).json({ success: false, error: 'El cartón no está marcado como vendido' });
    }

    await pool.query(`
      UPDATE cards SET is_sold = false, sold_at = NULL, buyer_name = NULL, buyer_phone = NULL
      WHERE id = $1
    `, [req.params.id]);

    const { rows: updatedRows } = await pool.query('SELECT * FROM cards WHERE id = $1', [req.params.id]);
    const updated = updatedRows[0] as BingoCard;

    logActivity(pool, auditFromReq(req, 'card_unsold', 'cards', { card_id: card.id, card_code: card.card_code }));

    res.json({ success: true, data: updated });
  } catch (error) {
    console.error('Error desactivando cartón:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// GET /api/cards/search/:code - Buscar cartón por código
router.get('/search/:code', async (req: Request, res: Response) => {
  try {
    const code = (req.params.code as string).toUpperCase();
    const normalizedCode = normalizeSerial(code);
    const pool = getPool();

    const { rows: cardRows } = await pool.query(`
      SELECT * FROM cards WHERE card_code = $1
      UNION SELECT * FROM cards WHERE validation_code = $1
      UNION SELECT * FROM cards WHERE serial = $1 OR serial = $2
      LIMIT 1
    `, [code, normalizedCode]);
    const card = cardRows[0] as BingoCard | undefined;

    if (!card) {
      return res.status(404).json({ success: false, error: 'Cartón no encontrado' });
    }

    // Obtener configuración del evento
    const { rows: eventRows } = await pool.query('SELECT use_free_center FROM events WHERE id = $1', [card.event_id]);
    const eventConfig = eventRows[0] as { use_free_center: boolean } | undefined;
    const useFreeCenter = eventConfig?.use_free_center !== false;

    const numbers: CardNumbers = parseNumbers(card.numbers);
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
// SEC-H4: devuelve PII del comprador solo a roles con permiso;
// otros roles reciben los datos de juego sin buyer_name/phone/cedula.
router.get('/:id', async (req: Request, res: Response) => {
  try {
    // TS-H5 (parcial): validar que el id sea un entero positivo antes de usarlo.
    const cardId = parseInt(String(req.params.id), 10);
    if (!Number.isInteger(cardId) || cardId <= 0) {
      return res.status(400).json({ success: false, error: 'ID de cartón inválido' });
    }

    const pool = getPool();
    const { rows: cardRows } = await pool.query('SELECT * FROM cards WHERE id = $1', [cardId]);
    const card = cardRows[0] as BingoCard | undefined;

    if (!card) {
      return res.status(404).json({ success: false, error: 'Cartón no encontrado' });
    }

    // Obtener configuración del evento
    const { rows: eventRows } = await pool.query('SELECT use_free_center FROM events WHERE id = $1', [card.event_id]);
    const eventConfig = eventRows[0] as { use_free_center: boolean } | undefined;
    const useFreeCenter = eventConfig?.use_free_center !== false;

    const numbers: CardNumbers = parseNumbers(card.numbers);
    const matrix = cardNumbersToMatrix(numbers, useFreeCenter);

    // SEC-H4: solo admin y moderator pueden ver PII del comprador.
    // Para seller/viewer/loteria devolvemos el cartón sin datos personales.
    const role = req.user?.role;
    const canSeeBuyerPii = role === 'admin' || role === 'moderator';

    const sanitizedCard = canSeeBuyerPii
      ? card
      : ({
          ...card,
          buyer_name: null,
          buyer_phone: null,
          buyer_cedula: null,
        } as BingoCard);

    res.json({
      success: true,
      data: {
        ...sanitizedCard,
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
