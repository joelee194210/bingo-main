import { Router } from 'express';
import type { Request, Response } from 'express';
import { getPool } from '../database/init.js';
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
  replayGame,
  getGameStats,
  getEventGames,
} from '../services/gameEngine.js';
import { findWinners } from '../services/cardVerifier.js';
import { requirePermission } from '../middleware/auth.js';
import { emitGameUpdate, emitBallCalled, emitWinnerFound } from '../app.js';
import type { GameType, StartGameRequest } from '../types/index.js';

const router = Router();

// Helper para clasificar errores conocidos
function isKnownError(msg: string): boolean {
  return ['no encontrado', 'no se puede', 'no está', 'ya fue', 'ya ha', 'no quedan', 'no hay'].some(k => msg.toLowerCase().includes(k));
}

// GET /api/games - Listar juegos (opcionalmente por evento)
router.get('/', async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const { event_id, status } = req.query;

    let query = 'SELECT * FROM games';
    const params: unknown[] = [];
    const conditions: string[] = [];
    let paramIdx = 1;

    if (event_id) {
      conditions.push(`event_id = $${paramIdx++}`);
      params.push(event_id);
    }
    if (status) {
      conditions.push(`status = $${paramIdx++}`);
      params.push(status);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ' ORDER BY created_at DESC';

    const { rows: games } = await pool.query(query, params);

    res.json({ success: true, data: games });
  } catch (error) {
    console.error('Error listando juegos:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// GET /api/games/event/:eventId - Todos los juegos de un evento (DEBE ir antes de /:id)
router.get('/event/:eventId', async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const games = await getEventGames(pool, parseInt(req.params.eventId as string, 10));

    res.json({ success: true, data: games });
  } catch (error) {
    console.error('Error listando juegos del evento:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// GET /api/games/:id - Obtener estado del juego
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const state = await getGameState(pool, parseInt(req.params.id as string, 10));

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
router.post('/', requirePermission('games:create'), async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const { event_id, game_type, name, is_practice_mode, custom_pattern, prize_description } = req.body as StartGameRequest;

    if (!event_id || !game_type) {
      return res.status(400).json({ success: false, error: 'event_id y game_type son requeridos' });
    }

    const validTypes: GameType[] = ['horizontal_line', 'vertical_line', 'diagonal', 'blackout', 'four_corners', 'x_pattern', 'custom'];
    if (!validTypes.includes(game_type)) {
      return res.status(400).json({ success: false, error: 'Tipo de juego inválido' });
    }

    // Verificar evento existe
    const { rows: eventRows } = await pool.query('SELECT * FROM events WHERE id = $1', [event_id]);
    if (eventRows.length === 0) {
      return res.status(404).json({ success: false, error: 'Evento no encontrado' });
    }

    const game = await createGame(pool, event_id, game_type, {
      name,
      isPracticeMode: is_practice_mode !== false,
      customPattern: custom_pattern as unknown as import('../types/index.js').Position[] | undefined,
      prizeDescription: prize_description,
    });

    const state = await getGameState(pool, game.id);

    res.status(201).json({ success: true, data: state });
  } catch (error) {
    console.error('Error creando juego:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// POST /api/games/:id/start - Iniciar juego (admin y moderador)
router.post('/:id/start', requirePermission('games:play'), async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const gameId = parseInt(req.params.id as string, 10);
    const state = await startGame(pool, gameId);
    emitGameUpdate(gameId, state);

    res.json({ success: true, data: state });
  } catch (error) {
    console.error('Error iniciando juego:', error);
    const msg = (error as Error).message;
    res.status(isKnownError(msg) ? 400 : 500).json({ success: false, error: isKnownError(msg) ? msg : 'Error interno del servidor' });
  }
});

// POST /api/games/:id/pause - Pausar juego (admin y moderador)
router.post('/:id/pause', requirePermission('games:play'), async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const gameId = parseInt(req.params.id as string, 10);
    const state = await pauseGame(pool, gameId);
    emitGameUpdate(gameId, state);

    res.json({ success: true, data: state });
  } catch (error) {
    console.error('Error pausando juego:', error);
    const msg = (error as Error).message;
    res.status(isKnownError(msg) ? 400 : 500).json({ success: false, error: isKnownError(msg) ? msg : 'Error interno del servidor' });
  }
});

// POST /api/games/:id/resume - Reanudar juego (admin y moderador)
router.post('/:id/resume', requirePermission('games:play'), async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const gameId = parseInt(req.params.id as string, 10);
    const state = await resumeGame(pool, gameId);
    emitGameUpdate(gameId, state);

    res.json({ success: true, data: state });
  } catch (error) {
    console.error('Error reanudando juego:', error);
    const msg = (error as Error).message;
    res.status(isKnownError(msg) ? 400 : 500).json({ success: false, error: isKnownError(msg) ? msg : 'Error interno del servidor' });
  }
});

// POST /api/games/:id/call - Llamar balota específica (admin y moderador)
router.post('/:id/call', requirePermission('games:play'), async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const { ball } = req.body;

    if (ball === undefined || typeof ball !== 'number' || !Number.isInteger(ball) || ball < 1 || ball > 75) {
      return res.status(400).json({ success: false, error: 'Balota inválida (1-75, entero)' });
    }

    const gameId = parseInt(req.params.id as string, 10);
    const result = await callBall(pool, gameId, ball);
    emitBallCalled(gameId, result);
    if (result.winners?.length > 0) {
      emitWinnerFound(gameId, result.winners);
    }

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error llamando balota:', error);
    const msg = (error as Error).message;
    res.status(isKnownError(msg) ? 400 : 500).json({ success: false, error: isKnownError(msg) ? msg : 'Error interno del servidor' });
  }
});

// POST /api/games/:id/call-random - Llamar balota aleatoria (admin y moderador)
router.post('/:id/call-random', requirePermission('games:play'), async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const gameId = parseInt(req.params.id as string, 10);
    const result = await callRandomBall(pool, gameId);
    emitBallCalled(gameId, result);
    if (result.winners?.length > 0) {
      emitWinnerFound(gameId, result.winners);
    }

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error llamando balota aleatoria:', error);
    const msg = (error as Error).message;
    res.status(isKnownError(msg) ? 400 : 500).json({ success: false, error: isKnownError(msg) ? msg : 'Error interno del servidor' });
  }
});

// POST /api/games/:id/finish - Finalizar juego y generar reporte (admin y moderador)
router.post('/:id/finish', requirePermission('games:finish'), async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const gameId = parseInt(req.params.id as string, 10);
    const { gameState, report } = await finishGame(pool, gameId);
    emitGameUpdate(gameId, gameState);

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
    res.status(isKnownError(msg) ? 400 : 500).json({ success: false, error: isKnownError(msg) ? msg : 'Error interno del servidor' });
  }
});

// POST /api/games/:id/cancel - Cancelar juego (admin y moderador)
router.post('/:id/cancel', requirePermission('games:finish'), async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const gameId = parseInt(req.params.id as string, 10);
    const state = await cancelGame(pool, gameId);
    emitGameUpdate(gameId, state);

    res.json({ success: true, data: state });
  } catch (error) {
    console.error('Error cancelando juego:', error);
    const msg = (error as Error).message;
    res.status(isKnownError(msg) ? 400 : 500).json({ success: false, error: isKnownError(msg) ? msg : 'Error interno del servidor' });
  }
});

// POST /api/games/:id/reset - Reiniciar juego (admin y moderador)
router.post('/:id/reset', requirePermission('games:play'), async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const gameId = parseInt(req.params.id as string, 10);
    const state = await resetGame(pool, gameId);
    emitGameUpdate(gameId, state);

    res.json({ success: true, data: state });
  } catch (error) {
    console.error('Error reiniciando juego:', error);
    const msg = (error as Error).message;
    res.status(isKnownError(msg) ? 400 : 500).json({ success: false, error: isKnownError(msg) ? msg : 'Error interno del servidor' });
  }
});

// POST /api/games/:id/replay - Crear nuevo juego con misma configuración (admin y moderador)
router.post('/:id/replay', requirePermission('games:create'), async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const newGame = await replayGame(pool, parseInt(req.params.id as string, 10));
    const state = await getGameState(pool, newGame.id);

    res.status(201).json({ success: true, data: state });
  } catch (error) {
    console.error('Error creando replay:', error);
    const msg = (error as Error).message;
    res.status(isKnownError(msg) ? 400 : 500).json({ success: false, error: isKnownError(msg) ? msg : 'Error interno del servidor' });
  }
});

// GET /api/games/:id/stats - Estadísticas del juego
router.get('/:id/stats', async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const stats = await getGameStats(pool, parseInt(req.params.id as string, 10));

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
router.get('/:id/winners', requirePermission('games:read'), async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const state = await getGameState(pool, parseInt(req.params.id as string, 10));

    if (!state) {
      return res.status(404).json({ success: false, error: 'Juego no encontrado' });
    }

    const { rows: gameRows } = await pool.query('SELECT * FROM games WHERE id = $1', [req.params.id]);
    const game = gameRows[0] as { custom_pattern: string | null };
    const customPattern = game.custom_pattern ? JSON.parse(game.custom_pattern) : undefined;

    const winners = await findWinners(
      pool,
      state.eventId,
      state.id,
      state.calledBalls,
      state.gameType,
      state.isPracticeMode,
      customPattern
    );

    // Ocultar validation_code para roles sin permiso games:finish
    const canSeeValidation = (req as unknown as { jwtPayload?: { role: string } }).jwtPayload?.role === 'admin' ||
      (req as unknown as { jwtPayload?: { role: string } }).jwtPayload?.role === 'moderator';
    const safeWinners = canSeeValidation ? winners : winners.map(w => ({ ...w, validationCode: undefined, validation_code: undefined }));

    res.json({ success: true, data: safeWinners });
  } catch (error) {
    console.error('Error obteniendo ganadores:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

export default router;
