import { Router } from 'express';
import type { Request, Response } from 'express';
import { getPool } from '../database/init.js';
import { requirePermission } from '../middleware/auth.js';
import { randomInt } from 'crypto';

const router = Router();

interface PromoConfig {
  id: number;
  event_id: number;
  is_enabled: boolean;
  no_prize_text: string;
}

interface PromoPrize {
  id: number;
  event_id: number;
  name: string;
  quantity: number;
  distributed: number;
}

interface PromoFixedRule {
  id: number;
  event_id: number;
  prize_name: string;
  quantity: number;
  series_from: number;
  series_to: number;
}

// GET /api/promo/events/:eventId - Obtener config de promo de un evento
router.get('/events/:eventId', async (req: Request, res: Response) => {
  try {
    const eventId = parseInt(String(req.params.eventId), 10);
    const pool = getPool();

    const config = (await pool.query(
      'SELECT * FROM promo_config WHERE event_id = $1',
      [eventId]
    )).rows[0] as PromoConfig | undefined;

    const prizes = (await pool.query(
      'SELECT * FROM promo_prizes WHERE event_id = $1 ORDER BY id',
      [eventId]
    )).rows as PromoPrize[];

    // Contar cartones con promo asignado
    const stats = (await pool.query(`
      SELECT
        COUNT(*) as total_cards,
        SUM(CASE WHEN promo_text IS NOT NULL THEN 1 ELSE 0 END) as cards_with_promo,
        SUM(CASE WHEN promo_text IS NOT NULL AND promo_text != $1 THEN 1 ELSE 0 END) as cards_with_prize
      FROM cards WHERE event_id = $2
    `, [config?.no_prize_text || 'Gracias por participar', eventId])).rows[0] as {
      total_cards: number;
      cards_with_promo: number;
      cards_with_prize: number;
    };

    res.json({
      success: true,
      data: {
        config: config || { event_id: eventId, is_enabled: false, no_prize_text: 'Gracias por participar' },
        prizes,
        stats,
      },
    });
  } catch (error) {
    console.error('Error obteniendo promo config:', error);
    res.status(500).json({ success: false, error: 'Error interno' });
  }
});

// POST /api/promo/events/:eventId/config - Guardar config de promo
router.post('/events/:eventId/config', requirePermission('cards:create'), async (req: Request, res: Response) => {
  try {
    const eventId = parseInt(String(req.params.eventId), 10);
    const { is_enabled, no_prize_text } = req.body;
    const pool = getPool();

    await pool.query(`
      INSERT INTO promo_config (event_id, is_enabled, no_prize_text)
      VALUES ($1, $2, $3)
      ON CONFLICT(event_id) DO UPDATE SET
        is_enabled = EXCLUDED.is_enabled,
        no_prize_text = EXCLUDED.no_prize_text,
        updated_at = CURRENT_TIMESTAMP
    `, [eventId, is_enabled ? true : false, no_prize_text || 'Gracias por participar']);

    const config = (await pool.query('SELECT * FROM promo_config WHERE event_id = $1', [eventId])).rows[0];

    res.json({ success: true, data: config });
  } catch (error) {
    console.error('Error guardando promo config:', error);
    res.status(500).json({ success: false, error: 'Error interno' });
  }
});

// POST /api/promo/events/:eventId/prizes - Guardar premios (reemplaza todos)
router.post('/events/:eventId/prizes', requirePermission('cards:create'), async (req: Request, res: Response) => {
  try {
    const eventId = parseInt(String(req.params.eventId), 10);
    const { prizes } = req.body as { prizes: { name: string; quantity: number }[] };

    if (!prizes || !Array.isArray(prizes)) {
      return res.status(400).json({ success: false, error: 'prizes es requerido como array' });
    }

    const pool = getPool();

    // Verificar que no haya promos ya distribuidos
    const existing = (await pool.query(
      'SELECT SUM(distributed) as total_dist FROM promo_prizes WHERE event_id = $1',
      [eventId]
    )).rows[0] as { total_dist: number | null };

    if (existing.total_dist && existing.total_dist > 0) {
      return res.status(400).json({
        success: false,
        error: 'Ya se distribuyeron premios. Debe limpiar la promo antes de cambiar premios.',
      });
    }

    // Use a client for transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM promo_prizes WHERE event_id = $1', [eventId]);
      for (const prize of prizes) {
        if (prize.name && prize.quantity > 0) {
          await client.query(
            'INSERT INTO promo_prizes (event_id, name, quantity) VALUES ($1, $2, $3)',
            [eventId, prize.name.trim(), prize.quantity]
          );
        }
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    const savedPrizes = (await pool.query(
      'SELECT * FROM promo_prizes WHERE event_id = $1 ORDER BY id',
      [eventId]
    )).rows;

    res.json({ success: true, data: savedPrizes });
  } catch (error) {
    console.error('Error guardando premios:', error);
    res.status(500).json({ success: false, error: 'Error interno' });
  }
});

// GET /api/promo/events/:eventId/fixed-rules - Listar reglas fijas del evento
router.get('/events/:eventId/fixed-rules', async (req: Request, res: Response) => {
  try {
    const eventId = parseInt(String(req.params.eventId), 10);
    const pool = getPool();
    const rules = (await pool.query(
      'SELECT * FROM promo_fixed_rules WHERE event_id = $1 ORDER BY id',
      [eventId]
    )).rows as PromoFixedRule[];
    res.json({ success: true, data: rules });
  } catch (error) {
    console.error('Error obteniendo fixed rules:', error);
    res.status(500).json({ success: false, error: 'Error interno' });
  }
});

// POST /api/promo/events/:eventId/fixed-rules - Guardar reglas fijas (reemplaza todas)
router.post('/events/:eventId/fixed-rules', requirePermission('cards:create'), async (req: Request, res: Response) => {
  try {
    const eventId = parseInt(String(req.params.eventId), 10);
    const { rules } = req.body as { rules: { prize_name: string; quantity: number; series_from: number; series_to: number }[] };

    if (!rules || !Array.isArray(rules)) {
      return res.status(400).json({ success: false, error: 'rules es requerido como array' });
    }

    const pool = getPool();

    // Verificar que no haya promos ya distribuidos
    const existing = (await pool.query(
      'SELECT SUM(distributed) as total_dist FROM promo_prizes WHERE event_id = $1',
      [eventId]
    )).rows[0] as { total_dist: number | null };

    if (existing.total_dist && Number(existing.total_dist) > 0) {
      return res.status(400).json({
        success: false,
        error: 'Ya se distribuyeron premios. Debe limpiar la promo antes de cambiar reglas fijas.',
      });
    }

    // Obtener premios del evento para validar
    const prizes = (await pool.query(
      'SELECT * FROM promo_prizes WHERE event_id = $1',
      [eventId]
    )).rows as PromoPrize[];
    const prizeMap = new Map(prizes.map(p => [p.name, p.quantity]));

    // Validar cada regla
    const fixedSums = new Map<string, number>();
    for (const rule of rules) {
      if (!rule.prize_name || !rule.quantity || rule.quantity <= 0) {
        return res.status(400).json({ success: false, error: 'Cada regla debe tener prize_name y quantity > 0' });
      }
      if (!rule.series_from || !rule.series_to || rule.series_from <= 0 || rule.series_to < rule.series_from) {
        return res.status(400).json({ success: false, error: `Rango de series invalido: ${rule.series_from}-${rule.series_to}` });
      }
      if (!prizeMap.has(rule.prize_name)) {
        return res.status(400).json({ success: false, error: `Premio "${rule.prize_name}" no existe en los premios del evento` });
      }
      fixedSums.set(rule.prize_name, (fixedSums.get(rule.prize_name) || 0) + rule.quantity);
    }

    // Verificar que la suma de fijas no exceda el total de cada premio
    for (const [name, fixedQty] of fixedSums) {
      const totalQty = prizeMap.get(name)!;
      if (fixedQty > totalQty) {
        return res.status(400).json({
          success: false,
          error: `Reglas fijas para "${name}" suman ${fixedQty} pero solo hay ${totalQty} en total`,
        });
      }
    }

    // Verificar que las series existan (hay cartones en ese rango)
    for (const rule of rules) {
      const seriesNumbers = [];
      for (let s = rule.series_from; s <= rule.series_to; s++) {
        seriesNumbers.push(String(s).padStart(5, '0'));
      }
      const cardsInSeries = (await pool.query(
        `SELECT COUNT(*) as cnt FROM cards c
         JOIN lotes l ON l.id = c.lote_id
         WHERE c.event_id = $1 AND l.series_number = ANY($2)`,
        [eventId, seriesNumbers]
      )).rows[0] as { cnt: string };
      if (Number(cardsInSeries.cnt) === 0) {
        return res.status(400).json({
          success: false,
          error: `No hay cartones en las series ${rule.series_from}-${rule.series_to}`,
        });
      }
      if (Number(cardsInSeries.cnt) < rule.quantity) {
        return res.status(400).json({
          success: false,
          error: `Series ${rule.series_from}-${rule.series_to} tienen ${cardsInSeries.cnt} cartones pero la regla requiere ${rule.quantity} premios`,
        });
      }
    }

    // Guardar reglas en transaccion
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM promo_fixed_rules WHERE event_id = $1', [eventId]);
      for (const rule of rules) {
        await client.query(
          'INSERT INTO promo_fixed_rules (event_id, prize_name, quantity, series_from, series_to) VALUES ($1, $2, $3, $4, $5)',
          [eventId, rule.prize_name.trim(), rule.quantity, rule.series_from, rule.series_to]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    const savedRules = (await pool.query(
      'SELECT * FROM promo_fixed_rules WHERE event_id = $1 ORDER BY id',
      [eventId]
    )).rows;

    res.json({ success: true, data: savedRules });
  } catch (error) {
    console.error('Error guardando fixed rules:', error);
    res.status(500).json({ success: false, error: 'Error interno' });
  }
});

// DELETE /api/promo/events/:eventId/fixed-rules - Eliminar todas las reglas fijas
router.delete('/events/:eventId/fixed-rules', requirePermission('cards:create'), async (req: Request, res: Response) => {
  try {
    const eventId = parseInt(String(req.params.eventId), 10);
    const pool = getPool();
    await pool.query('DELETE FROM promo_fixed_rules WHERE event_id = $1', [eventId]);
    res.json({ success: true, data: { message: 'Reglas fijas eliminadas' } });
  } catch (error) {
    console.error('Error eliminando fixed rules:', error);
    res.status(500).json({ success: false, error: 'Error interno' });
  }
});

// POST /api/promo/events/:eventId/distribute - Distribuir premios en los cartones (fijos + aleatorio)
router.post('/events/:eventId/distribute', requirePermission('cards:create'), async (req: Request, res: Response) => {
  try {
    const eventId = parseInt(String(req.params.eventId), 10);
    const pool = getPool();

    // Obtener config
    const config = (await pool.query(
      'SELECT * FROM promo_config WHERE event_id = $1',
      [eventId]
    )).rows[0] as PromoConfig | undefined;

    if (!config || !config.is_enabled) {
      return res.status(400).json({ success: false, error: 'La promocion no esta habilitada para este evento' });
    }

    // Check if already distributed
    const alreadyDistributed = (await pool.query(
      'SELECT COUNT(*)::int as cnt FROM cards WHERE event_id = $1 AND promo_text IS NOT NULL',
      [eventId]
    )).rows[0].cnt;
    if (alreadyDistributed > 0) {
      return res.status(409).json({ success: false, error: 'Ya hay premios distribuidos. Limpie la promo antes de redistribuir.' });
    }

    // Obtener premios
    const prizes = (await pool.query(
      'SELECT * FROM promo_prizes WHERE event_id = $1 ORDER BY id',
      [eventId]
    )).rows as PromoPrize[];

    if (prizes.length === 0) {
      return res.status(400).json({ success: false, error: 'No hay premios configurados' });
    }

    // Obtener reglas fijas
    const fixedRules = (await pool.query(
      'SELECT * FROM promo_fixed_rules WHERE event_id = $1 ORDER BY id',
      [eventId]
    )).rows as PromoFixedRule[];

    // Obtener todos los cartones del evento (IDs)
    const cards = (await pool.query(
      'SELECT c.id, l.series_number FROM cards c LEFT JOIN lotes l ON l.id = c.lote_id WHERE c.event_id = $1 ORDER BY c.card_number',
      [eventId]
    )).rows as { id: number; series_number: string | null }[];

    if (cards.length === 0) {
      return res.status(400).json({ success: false, error: 'No hay cartones en este evento' });
    }

    const totalPrizes = prizes.reduce((sum, p) => sum + p.quantity, 0);
    if (totalPrizes > cards.length) {
      return res.status(400).json({
        success: false,
        error: `Hay ${totalPrizes} premios pero solo ${cards.length} cartones. Reduzca la cantidad de premios.`,
      });
    }

    // VALIDACIONES de reglas fijas
    const prizeMap = new Map(prizes.map(p => [p.name, p.quantity]));
    const fixedSums = new Map<string, number>();
    for (const rule of fixedRules) {
      if (!prizeMap.has(rule.prize_name)) {
        return res.status(400).json({
          success: false,
          error: `Regla fija referencia premio "${rule.prize_name}" que no existe`,
        });
      }
      const seriesCount = rule.series_to - rule.series_from + 1;
      fixedSums.set(rule.prize_name, (fixedSums.get(rule.prize_name) || 0) + rule.quantity * seriesCount);
    }
    for (const [name, fixedQty] of fixedSums) {
      if (fixedQty > prizeMap.get(name)!) {
        return res.status(400).json({
          success: false,
          error: `Reglas fijas para "${name}" suman ${fixedQty} pero solo hay ${prizeMap.get(name)} en total`,
        });
      }
    }

    const noPrizeText = config.no_prize_text || 'Gracias por participar';
    const fixedAssignedIds = new Set<number>();
    const fixedRulesApplied: { prize: string; series: string; placed: number }[] = [];

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // FASE 1: Distribuir premios fijos (quantity POR SERIE)
      for (const rule of fixedRules) {
        let totalPlaced = 0;

        for (let s = rule.series_from; s <= rule.series_to; s++) {
          const sn = String(s).padStart(5, '0');

          // Cartones disponibles en esta serie
          const cardsInSeries = cards.filter(
            c => c.series_number === sn && !fixedAssignedIds.has(c.id)
          );

          if (cardsInSeries.length < rule.quantity) {
            await client.query('ROLLBACK');
            return res.status(400).json({
              success: false,
              error: `Serie ${sn}: solo ${cardsInSeries.length} cartones disponibles pero la regla requiere ${rule.quantity} para "${rule.prize_name}"`,
            });
          }

          // Fisher-Yates parcial: seleccionar rule.quantity cartones al azar en ESTA serie
          const selected = [...cardsInSeries];
          for (let i = selected.length - 1; i > 0; i--) {
            const j = randomInt(i + 1);
            [selected[i], selected[j]] = [selected[j], selected[i]];
          }
          const chosen = selected.slice(0, rule.quantity);

          const chosenIds = chosen.map(c => c.id);
          await client.query('UPDATE cards SET promo_text = $1 WHERE id = ANY($2::int[])', [rule.prize_name, chosenIds]);
          for (const card of chosen) {
            fixedAssignedIds.add(card.id);
          }
          totalPlaced += chosen.length;
        }

        fixedRulesApplied.push({
          prize: rule.prize_name,
          series: `${rule.series_from}-${rule.series_to}`,
          placed: totalPlaced,
        });
      }

      // FASE 2: Distribuir premios restantes — concentrados en series bajas (fuera de reglas fijas)
      const remainingCards = cards.filter(c => !fixedAssignedIds.has(c.id));

      // Determinar series cubiertas por reglas fijas
      const coveredSeries = new Set<string>();
      for (const rule of fixedRules) {
        for (let s = rule.series_from; s <= rule.series_to; s++) {
          coveredSeries.add(String(s).padStart(5, '0'));
        }
      }

      // Separar: cartones en series cubiertas → no_prize, cartones en series libres → reciben premios random
      const coveredRemainingIds: number[] = [];
      const freeCards: typeof remainingCards = [];
      for (const card of remainingCards) {
        const sn = card.series_number || '99999';
        if (coveredSeries.has(sn)) {
          coveredRemainingIds.push(card.id);
        } else {
          freeCards.push(card);
        }
      }

      // Crear pool de premios (solo premios, sin no_prize)
      const prizePool: string[] = [];
      for (const prize of prizes) {
        const fixedUsed = fixedSums.get(prize.name) || 0;
        const remaining = prize.quantity - fixedUsed;
        for (let i = 0; i < remaining; i++) {
          prizePool.push(prize.name);
        }
      }
      // Shuffle para mezclar tipos de premios
      for (let i = prizePool.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [prizePool[i], prizePool[j]] = [prizePool[j], prizePool[i]];
      }

      // Agrupar cartones libres por serie
      const cardsBySeries = new Map<string, typeof freeCards>();
      for (const card of freeCards) {
        const sn = card.series_number || '99999';
        if (!cardsBySeries.has(sn)) cardsBySeries.set(sn, []);
        cardsBySeries.get(sn)!.push(card);
      }

      // Ordenar series numéricamente de menor a mayor
      const sortedSeries = [...cardsBySeries.keys()].sort((a, b) => parseInt(a) - parseInt(b));

      // Distribuir premios de menor a mayor serie (solo series libres)
      const batchMap = new Map<string, number[]>();
      let prizeIdx = 0;

      for (let s = 0; s < sortedSeries.length; s++) {
        const seriesCards = cardsBySeries.get(sortedSeries[s])!;

        // Shuffle cartones de esta serie para posiciones random
        for (let i = seriesCards.length - 1; i > 0; i--) {
          const j = randomInt(i + 1);
          [seriesCards[i], seriesCards[j]] = [seriesCards[j], seriesCards[i]];
        }

        // Calcular cuántos premios van en esta serie
        let prizesForSeries = 0;
        if (prizeIdx < prizePool.length) {
          const seriesLeft = sortedSeries.length - s;
          const prizesLeft = prizePool.length - prizeIdx;
          prizesForSeries = Math.min(seriesCards.length, Math.ceil(prizesLeft / seriesLeft));
        }

        // Asignar premios y no_prize
        for (let i = 0; i < seriesCards.length; i++) {
          const text = (i < prizesForSeries && prizeIdx < prizePool.length)
            ? prizePool[prizeIdx++]
            : noPrizeText;
          if (!batchMap.has(text)) batchMap.set(text, []);
          batchMap.get(text)!.push(seriesCards[i].id);
        }
      }

      // Series cubiertas: cartones restantes → no_prize
      if (coveredRemainingIds.length > 0) {
        if (!batchMap.has(noPrizeText)) batchMap.set(noPrizeText, []);
        const noPrizeIds = batchMap.get(noPrizeText)!;
        for (const id of coveredRemainingIds) noPrizeIds.push(id);
      }

      // Batch update: un UPDATE por cada texto distinto (en chunks de 50K)
      const CHUNK_SIZE = 50000;
      for (const [text, ids] of batchMap) {
        for (let start = 0; start < ids.length; start += CHUNK_SIZE) {
          const chunk = ids.slice(start, start + CHUNK_SIZE);
          await client.query('UPDATE cards SET promo_text = $1 WHERE id = ANY($2::int[])', [text, chunk]);
        }
      }

      // Actualizar contadores de distribucion
      const prizeCount = new Map<string, number>();
      // Contar fijos
      for (const rule of fixedRulesApplied) {
        prizeCount.set(rule.prize, (prizeCount.get(rule.prize) || 0) + rule.placed);
      }
      // Contar random
      for (const text of prizePool) {
        prizeCount.set(text, (prizeCount.get(text) || 0) + 1);
      }
      for (const prize of prizes) {
        const count = prizeCount.get(prize.name) || 0;
        await client.query('UPDATE promo_prizes SET distributed = $1 WHERE id = $2', [count, prize.id]);
      }

      // FASE 3: Verificacion
      const verification = (await client.query(`
        SELECT promo_text, COUNT(*)::int as cnt
        FROM cards WHERE event_id = $1 AND promo_text IS NOT NULL AND promo_text != $2
        GROUP BY promo_text
      `, [eventId, noPrizeText])).rows as { promo_text: string; cnt: number }[];

      const verificationDetails: { prize: string; expected: number; actual: number; ok: boolean }[] = [];
      let verificationPassed = true;
      for (const prize of prizes) {
        const actual = verification.find(v => v.promo_text === prize.name)?.cnt || 0;
        const ok = actual === prize.quantity;
        if (!ok) verificationPassed = false;
        verificationDetails.push({ prize: prize.name, expected: prize.quantity, actual, ok });
      }

      if (!verificationPassed) {
        await client.query('ROLLBACK');
        return res.status(500).json({
          success: false,
          error: 'Verificacion fallida: discrepancia en conteos de premios',
          data: { verification: { passed: false, details: verificationDetails } },
        });
      }

      await client.query('COMMIT');

      // Stats
      const totalWinners = prizes.reduce((sum, p) => sum + p.quantity, 0);

      res.json({
        success: true,
        data: {
          total_cards: cards.length,
          winners: totalWinners,
          no_prize: cards.length - totalWinners,
          message: `Promocion distribuida: ${totalWinners} ganadores en ${cards.length} cartones`,
          verification: { passed: true, details: verificationDetails },
          fixed_rules_applied: fixedRulesApplied.length > 0 ? fixedRulesApplied : undefined,
        },
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error distribuyendo premios:', error);
    res.status(500).json({ success: false, error: 'Error distribuyendo premios' });
  }
});

// POST /api/promo/events/:eventId/clear - Limpiar promo de todos los cartones
router.post('/events/:eventId/clear', requirePermission('cards:create'), async (req: Request, res: Response) => {
  try {
    const eventId = parseInt(String(req.params.eventId), 10);
    const pool = getPool();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE cards SET promo_text = NULL WHERE event_id = $1', [eventId]);
      await client.query('UPDATE promo_prizes SET distributed = 0 WHERE event_id = $1', [eventId]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    res.json({ success: true, data: { message: 'Promocion limpiada' } });
  } catch (error) {
    console.error('Error limpiando promo:', error);
    res.status(500).json({ success: false, error: 'Error interno' });
  }
});

// GET /api/promo/events/:eventId/winners - Listar cartones ganadores de promo
router.get('/events/:eventId/winners', async (req: Request, res: Response) => {
  try {
    const eventId = parseInt(String(req.params.eventId), 10);
    const { page = '1', limit = '50', prize } = req.query;
    const pageNum = Math.max(1, parseInt(page as string, 10));
    const requestedLimit = Math.max(1, parseInt(limit as string, 10));
    const limitNum = requestedLimit > 200 ? Math.min(100000, requestedLimit) : requestedLimit;
    const offset = (pageNum - 1) * limitNum;

    const pool = getPool();

    const configRow = (await pool.query(
      'SELECT no_prize_text FROM promo_config WHERE event_id = $1',
      [eventId]
    )).rows[0] as { no_prize_text: string } | undefined;
    const noPrizeText = configRow?.no_prize_text || 'Gracias por participar';

    let whereExtra = '';
    const params: unknown[] = [eventId, noPrizeText];
    let paramIdx = 3;

    if (prize) {
      whereExtra = ` AND c.promo_text = $${paramIdx}`;
      params.push(prize);
      paramIdx++;
    }

    const totalResult = (await pool.query(
      `SELECT COUNT(*) as cnt FROM cards c WHERE c.event_id = $1 AND c.promo_text IS NOT NULL AND c.promo_text != $2${whereExtra}`,
      params
    )).rows[0] as { cnt: number };
    const total = totalResult.cnt;

    const winners = (await pool.query(`
      SELECT c.id, c.card_number, c.serial, c.card_code, c.promo_text, c.is_sold, c.buyer_name
      FROM cards c
      WHERE c.event_id = $1 AND c.promo_text IS NOT NULL AND c.promo_text != $2${whereExtra}
      ORDER BY c.card_number
      LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
    `, [...params, limitNum, offset])).rows;

    res.json({
      success: true,
      data: winners,
      pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (error) {
    console.error('Error listando ganadores promo:', error);
    res.status(500).json({ success: false, error: 'Error interno' });
  }
});

export default router;
