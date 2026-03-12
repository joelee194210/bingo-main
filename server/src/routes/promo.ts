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

// POST /api/promo/events/:eventId/distribute - Distribuir premios aleatoriamente en los cartones
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

    // Obtener premios
    const prizes = (await pool.query(
      'SELECT * FROM promo_prizes WHERE event_id = $1 ORDER BY id',
      [eventId]
    )).rows as PromoPrize[];

    if (prizes.length === 0) {
      return res.status(400).json({ success: false, error: 'No hay premios configurados' });
    }

    // Obtener todos los cartones del evento (IDs)
    const cards = (await pool.query(
      'SELECT id FROM cards WHERE event_id = $1 ORDER BY card_number',
      [eventId]
    )).rows as { id: number }[];

    if (cards.length === 0) {
      return res.status(400).json({ success: false, error: 'No hay cartones en este evento' });
    }

    // Verificar que la cantidad de premios no exceda la cantidad de cartones
    const totalPrizes = prizes.reduce((sum, p) => sum + p.quantity, 0);
    if (totalPrizes > cards.length) {
      return res.status(400).json({
        success: false,
        error: `Hay ${totalPrizes} premios pero solo ${cards.length} cartones. Reduzca la cantidad de premios.`,
      });
    }

    // Construir pool de textos: premios + no-premio para el resto
    const textPool: string[] = [];
    for (const prize of prizes) {
      for (let i = 0; i < prize.quantity; i++) {
        textPool.push(prize.name);
      }
    }
    // Rellenar con texto de no-premio
    const noPrizeText = config.no_prize_text || 'Gracias por participar';
    while (textPool.length < cards.length) {
      textPool.push(noPrizeText);
    }

    // Fisher-Yates shuffle con CSPRNG
    for (let i = textPool.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [textPool[i], textPool[j]] = [textPool[j], textPool[i]];
    }

    // Asignar a cada carton using transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Contar distribuciones por premio
      const prizeCount = new Map<string, number>();

      for (let i = 0; i < cards.length; i++) {
        await client.query('UPDATE cards SET promo_text = $1 WHERE id = $2', [textPool[i], cards[i].id]);
        if (textPool[i] !== noPrizeText) {
          prizeCount.set(textPool[i], (prizeCount.get(textPool[i]) || 0) + 1);
        }
      }

      // Actualizar contadores de distribucion
      for (const prize of prizes) {
        const count = prizeCount.get(prize.name) || 0;
        await client.query('UPDATE promo_prizes SET distributed = $1 WHERE id = $2', [count, prize.id]);
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // Stats
    const stats = (await pool.query(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN promo_text != $1 THEN 1 ELSE 0 END) as winners,
        SUM(CASE WHEN promo_text = $1 THEN 1 ELSE 0 END) as no_prize
      FROM cards WHERE event_id = $2 AND promo_text IS NOT NULL
    `, [noPrizeText, eventId])).rows[0] as { total: number; winners: number; no_prize: number };

    res.json({
      success: true,
      data: {
        total_cards: stats.total,
        winners: stats.winners,
        no_prize: stats.no_prize,
        message: `Promocion distribuida: ${stats.winners} ganadores en ${stats.total} cartones`,
      },
    });
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
    const limitNum = Math.min(200, Math.max(1, parseInt(limit as string, 10)));
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
