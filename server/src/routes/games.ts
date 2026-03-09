import { Router } from 'express';
import type { Request, Response } from 'express';
import { getDatabase } from '../database/init.js';
import {
  createGame,
  getGameState,
  startGame,
  pauseGame,
  resumeGame,
  callBall,
  callRandomBall,
  finishGame,
  cancelGame,
  resetGame,
  getGameStats,
  getEventGames,
} from '../services/gameEngine.js';
import { findWinners } from '../services/cardVerifier.js';
import { requirePermission } from '../middleware/auth.js';
import type { GameType, StartGameRequest } from '../types/index.js';

const router = Router();

// GET /api/games - Listar juegos (opcionalmente por evento)
router.get('/', (req: Request, res: Response) => {
  try {
    const { event_id, status } = req.query;
    const db = getDatabase();

    let query = 'SELECT * FROM games';
    const params: unknown[] = [];
    const conditions: string[] = [];

    if (event_id) {
      conditions.push('event_id = ?');
      params.push(event_id);
    }
    if (status) {
      conditions.push('status = ?');
      params.push(status);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ' ORDER BY created_at DESC';

    const games = db.prepare(query).all(...params);
    db.close();

    res.json({ success: true, data: games });
  } catch (error) {
    console.error('Error listando juegos:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// GET /api/games/event/:eventId - Todos los juegos de un evento (DEBE ir antes de /:id)
router.get('/event/:eventId', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const games = getEventGames(db, parseInt(req.params.eventId as string, 10));
    db.close();

    res.json({ success: true, data: games });
  } catch (error) {
    console.error('Error listando juegos del evento:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// GET /api/games/:id - Obtener estado del juego
router.get('/:id', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const state = getGameState(db, parseInt(req.params.id as string, 10));
    db.close();

    if (!state) {
      return res.status(404).json({ success: false, error: 'Juego no encontrado' });
    }

    res.json({ success: true, data: state });
  } catch (error) {
    console.error('Error obteniendo juego:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// POST /api/games - Crear nuevo juego (admin y moderador)
router.post('/', requirePermission('games:create'), (req: Request, res: Response) => {
  try {
    const { event_id, game_type, name, is_practice_mode, custom_pattern, prize_description } = req.body as StartGameRequest;

    if (!event_id || !game_type) {
      return res.status(400).json({ success: false, error: 'event_id y game_type son requeridos' });
    }

    const validTypes: GameType[] = ['horizontal_line', 'vertical_line', 'diagonal', 'blackout', 'four_corners', 'x_pattern', 'custom'];
    if (!validTypes.includes(game_type)) {
      return res.status(400).json({ success: false, error: 'Tipo de juego inválido' });
    }

    const db = getDatabase();

    // Verificar evento existe
    const event = db.prepare('SELECT * FROM events WHERE id = ?').get(event_id);
    if (!event) {
      db.close();
      return res.status(404).json({ success: false, error: 'Evento no encontrado' });
    }

    const game = createGame(db, event_id, game_type, {
      name,
      isPracticeMode: is_practice_mode !== false,
      customPattern: custom_pattern as unknown as import('../types/index.js').Position[] | undefined,
      prizeDescription: prize_description,
    });

    const state = getGameState(db, game.id);
    db.close();

    res.status(201).json({ success: true, data: state });
  } catch (error) {
    console.error('Error creando juego:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// POST /api/games/:id/start - Iniciar juego (admin y moderador)
router.post('/:id/start', requirePermission('games:play'), (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const state = startGame(db, parseInt(req.params.id as string, 10));
    db.close();

    res.json({ success: true, data: state });
  } catch (error) {
    console.error('Error iniciando juego:', error);
    const msg = (error as Error).message;
    const isKnown = ['no encontrado', 'no se puede', 'no está', 'ya fue', 'ya ha', 'no quedan', 'no hay'].some(k => msg.toLowerCase().includes(k));
    res.status(isKnown ? 400 : 500).json({ success: false, error: isKnown ? msg : 'Error interno del servidor' });
  }
});

// POST /api/games/:id/pause - Pausar juego (admin y moderador)
router.post('/:id/pause', requirePermission('games:play'), (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const state = pauseGame(db, parseInt(req.params.id as string, 10));
    db.close();

    res.json({ success: true, data: state });
  } catch (error) {
    console.error('Error pausando juego:', error);
    const msg = (error as Error).message;
    const isKnown = ['no encontrado', 'no se puede', 'no está', 'ya fue', 'ya ha', 'no quedan', 'no hay'].some(k => msg.toLowerCase().includes(k));
    res.status(isKnown ? 400 : 500).json({ success: false, error: isKnown ? msg : 'Error interno del servidor' });
  }
});

// POST /api/games/:id/resume - Reanudar juego (admin y moderador)
router.post('/:id/resume', requirePermission('games:play'), (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const state = resumeGame(db, parseInt(req.params.id as string, 10));
    db.close();

    res.json({ success: true, data: state });
  } catch (error) {
    console.error('Error reanudando juego:', error);
    const msg = (error as Error).message;
    const isKnown = ['no encontrado', 'no se puede', 'no está', 'ya fue', 'ya ha', 'no quedan', 'no hay'].some(k => msg.toLowerCase().includes(k));
    res.status(isKnown ? 400 : 500).json({ success: false, error: isKnown ? msg : 'Error interno del servidor' });
  }
});

// POST /api/games/:id/call - Llamar balota específica (admin y moderador)
router.post('/:id/call', requirePermission('games:play'), (req: Request, res: Response) => {
  try {
    const { ball } = req.body;

    if (ball === undefined || typeof ball !== 'number' || !Number.isInteger(ball) || ball < 1 || ball > 75) {
      return res.status(400).json({ success: false, error: 'Balota inválida (1-75, entero)' });
    }

    const db = getDatabase();
    const result = callBall(db, parseInt(req.params.id as string, 10), ball);
    db.close();

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error llamando balota:', error);
    const msg = (error as Error).message;
    const isKnown = ['no encontrado', 'no se puede', 'no está', 'ya fue', 'ya ha', 'no quedan', 'no hay'].some(k => msg.toLowerCase().includes(k));
    res.status(isKnown ? 400 : 500).json({ success: false, error: isKnown ? msg : 'Error interno del servidor' });
  }
});

// POST /api/games/:id/call-random - Llamar balota aleatoria (admin y moderador)
router.post('/:id/call-random', requirePermission('games:play'), (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const result = callRandomBall(db, parseInt(req.params.id as string, 10));
    db.close();

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error llamando balota aleatoria:', error);
    const msg = (error as Error).message;
    const isKnown = ['no encontrado', 'no se puede', 'no está', 'ya fue', 'ya ha', 'no quedan', 'no hay'].some(k => msg.toLowerCase().includes(k));
    res.status(isKnown ? 400 : 500).json({ success: false, error: isKnown ? msg : 'Error interno del servidor' });
  }
});

// POST /api/games/:id/finish - Finalizar juego y generar reporte (admin y moderador)
router.post('/:id/finish', requirePermission('games:finish'), (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { gameState, report } = finishGame(db, parseInt(req.params.id as string, 10));
    db.close();

    res.json({
      success: true,
      data: {
        gameState,
        report,
      },
    });
  } catch (error) {
    console.error('Error finalizando juego:', error);
    const msg = (error as Error).message;
    const isKnown = ['no encontrado', 'no se puede', 'no está', 'ya fue', 'ya ha', 'no quedan', 'no hay'].some(k => msg.toLowerCase().includes(k));
    res.status(isKnown ? 400 : 500).json({ success: false, error: isKnown ? msg : 'Error interno del servidor' });
  }
});

// POST /api/games/:id/cancel - Cancelar juego (admin y moderador)
router.post('/:id/cancel', requirePermission('games:finish'), (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const state = cancelGame(db, parseInt(req.params.id as string, 10));
    db.close();

    res.json({ success: true, data: state });
  } catch (error) {
    console.error('Error cancelando juego:', error);
    const msg = (error as Error).message;
    const isKnown = ['no encontrado', 'no se puede', 'no está', 'ya fue', 'ya ha', 'no quedan', 'no hay'].some(k => msg.toLowerCase().includes(k));
    res.status(isKnown ? 400 : 500).json({ success: false, error: isKnown ? msg : 'Error interno del servidor' });
  }
});

// POST /api/games/:id/reset - Reiniciar juego (admin y moderador)
router.post('/:id/reset', requirePermission('games:play'), (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const state = resetGame(db, parseInt(req.params.id as string, 10));
    db.close();

    res.json({ success: true, data: state });
  } catch (error) {
    console.error('Error reiniciando juego:', error);
    const msg = (error as Error).message;
    const isKnown = ['no encontrado', 'no se puede', 'no está', 'ya fue', 'ya ha', 'no quedan', 'no hay'].some(k => msg.toLowerCase().includes(k));
    res.status(isKnown ? 400 : 500).json({ success: false, error: isKnown ? msg : 'Error interno del servidor' });
  }
});

// GET /api/games/:id/stats - Estadísticas del juego
router.get('/:id/stats', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const stats = getGameStats(db, parseInt(req.params.id as string, 10));
    db.close();

    if (!stats) {
      return res.status(404).json({ success: false, error: 'Juego no encontrado' });
    }

    res.json({ success: true, data: stats });
  } catch (error) {
    console.error('Error obteniendo stats:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// GET /api/games/:id/winners - Obtener ganadores actuales
router.get('/:id/winners', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const state = getGameState(db, parseInt(req.params.id as string, 10));

    if (!state) {
      db.close();
      return res.status(404).json({ success: false, error: 'Juego no encontrado' });
    }

    const game = db.prepare('SELECT * FROM games WHERE id = ?').get(req.params.id as string) as { custom_pattern: string | null };
    const customPattern = game.custom_pattern ? JSON.parse(game.custom_pattern) : undefined;

    const winners = findWinners(
      db,
      state.eventId,
      state.id,
      state.calledBalls,
      state.gameType,
      state.isPracticeMode,
      customPattern
    );

    db.close();
    res.json({ success: true, data: winners });
  } catch (error) {
    console.error('Error obteniendo ganadores:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

export default router;
