import { randomInt } from 'crypto';
import type { Pool } from 'pg';
import type { BingoGame, GameType, GameStatus, Position } from '../types/index.js';
import { findWinners } from './cardVerifier.js';
import { recordBallCall, recordWinner, generateGameReport, type GameReport } from './reportService.js';

export interface GameState {
  id: number;
  eventId: number;
  name: string | null;
  gameType: GameType;
  status: GameStatus;
  isPracticeMode: boolean;
  calledBalls: number[];
  winnerCards: number[];
  availableBalls: number[];
  totalCards: number;
  activeCards: number;
  startedAt: string | null;
}

/**
 * Crea un nuevo juego de Bingo
 */
export async function createGame(
  pool: Pool,
  eventId: number,
  gameType: GameType,
  options: {
    name?: string;
    isPracticeMode?: boolean;
    customPattern?: Position[];
    prizeDescription?: string;
  } = {}
): Promise<BingoGame> {
  const {
    name = null,
    isPracticeMode = true,
    customPattern = null,
    prizeDescription = null,
  } = options;

  const result = await pool.query(`
    INSERT INTO games (event_id, name, game_type, custom_pattern, is_practice_mode, prize_description)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id
  `, [
    eventId,
    name,
    gameType,
    customPattern ? JSON.stringify(customPattern) : null,
    isPracticeMode,
    prizeDescription
  ]);

  const row = (await pool.query('SELECT * FROM games WHERE id = $1', [result.rows[0].id])).rows[0];
  return row as BingoGame;
}

/**
 * Obtiene el estado actual de un juego.
 *
 * DB-H8/CR-M7: antes hacía COUNT(*) + SUM(is_sold) sobre `cards` en cada
 * llamada — con 1M+ cartones y varias llamadas por operación de juego
 * (callBall → getGameState 2x dentro+fuera de tx), esto se convertía en
 * cientos de full scans por minuto durante un juego en vivo. Los triggers
 * ya mantienen events.total_cards y events.cards_sold desnormalizados, así
 * que hacemos un JOIN en lugar del COUNT en tiempo real.
 */
export async function getGameState(pool: Pool, gameId: number): Promise<GameState | null> {
  const { rows } = await pool.query<BingoGame & { total_cards: number; cards_sold: number }>(`
    SELECT g.*,
           e.total_cards AS total_cards,
           e.cards_sold AS cards_sold
    FROM games g
    JOIN events e ON e.id = g.event_id
    WHERE g.id = $1
  `, [gameId]);
  const game = rows[0];

  if (!game) {
    return null;
  }

  const calledBalls: number[] = JSON.parse(game.called_balls || '[]');
  const winnerCards: number[] = JSON.parse(game.winner_cards || '[]');

  // Calcular balotas disponibles (1-75 menos las ya llamadas)
  const calledSet = new Set(calledBalls);
  const availableBalls: number[] = [];
  for (let i = 1; i <= 75; i++) {
    if (!calledSet.has(i)) {
      availableBalls.push(i);
    }
  }

  const totalCards = Number(game.total_cards) || 0;
  const cardsSold = Number(game.cards_sold) || 0;

  return {
    id: game.id,
    eventId: game.event_id,
    name: game.name,
    gameType: game.game_type,
    status: game.status,
    isPracticeMode: !!game.is_practice_mode,
    calledBalls,
    winnerCards,
    availableBalls,
    totalCards,
    activeCards: game.is_practice_mode ? totalCards : cardsSold,
    startedAt: game.started_at,
  };
}

/**
 * Inicia un juego
 */
export async function startGame(pool: Pool, gameId: number): Promise<GameState> {
  const game = await getGameState(pool, gameId);

  if (!game) {
    throw new Error('Juego no encontrado');
  }

  if (game.status !== 'pending') {
    throw new Error(`No se puede iniciar un juego en estado: ${game.status}`);
  }

  if (!game.isPracticeMode && game.activeCards === 0) {
    throw new Error('No hay cartones vendidos para jugar en modo real');
  }

  await pool.query(`
    UPDATE games
    SET status = 'in_progress', started_at = CURRENT_TIMESTAMP
    WHERE id = $1
  `, [gameId]);

  return (await getGameState(pool, gameId))!;
}

/**
 * Pausa un juego
 */
export async function pauseGame(pool: Pool, gameId: number): Promise<GameState> {
  const game = await getGameState(pool, gameId);

  if (!game) {
    throw new Error('Juego no encontrado');
  }

  if (game.status !== 'in_progress') {
    throw new Error('Solo se puede pausar un juego en progreso');
  }

  await pool.query('UPDATE games SET status = $1 WHERE id = $2', ['paused', gameId]);

  return (await getGameState(pool, gameId))!;
}

/**
 * Reanuda un juego pausado
 */
export async function resumeGame(pool: Pool, gameId: number): Promise<GameState> {
  const game = await getGameState(pool, gameId);

  if (!game) {
    throw new Error('Juego no encontrado');
  }

  if (game.status !== 'paused') {
    throw new Error('Solo se puede reanudar un juego pausado');
  }

  await pool.query('UPDATE games SET status = $1 WHERE id = $2', ['in_progress', gameId]);

  return (await getGameState(pool, gameId))!;
}

/**
 * Llama una balota y verifica ganadores
 */
export interface CallBallResult {
  ball: number;
  column: string;
  gameState: GameState;
  winners: Array<{
    cardId: number;
    cardCode: string;
    cardNumber: number;
    serial: string;
    validationCode: string;
    winningPattern: string;
    buyerName?: string;
  }>;
}

export async function callBall(
  pool: Pool,
  gameId: number,
  ball: number
): Promise<CallBallResult> {
  const game = await getGameState(pool, gameId);

  if (!game) {
    throw new Error('Juego no encontrado');
  }

  if (game.status !== 'in_progress') {
    throw new Error('El juego no está en progreso');
  }

  if (ball < 1 || ball > 75) {
    throw new Error('Balota inválida. Debe estar entre 1 y 75');
  }

  // Determinar columna de la balota
  let column: string;
  if (ball <= 15) column = 'B';
  else if (ball <= 30) column = 'I';
  else if (ball <= 45) column = 'N';
  else if (ball <= 60) column = 'G';
  else column = 'O';

  // Envolver todo en transacción con conexión dedicada para consistencia
  let newWinners: Array<{
    cardId: number;
    cardCode: string;
    cardNumber: number;
    serial: string;
    validationCode: string;
    winningPattern: string;
    buyerName?: string;
  }> = [];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // FOR UPDATE bloquea la fila para evitar race conditions entre llamadas concurrentes
    const freshGameResult = await client.query('SELECT called_balls, winner_cards, custom_pattern FROM games WHERE id = $1 FOR UPDATE', [gameId]);
    const freshGame = freshGameResult.rows[0] as { called_balls: string; winner_cards: string; custom_pattern: string | null };
    const currentBalls: number[] = JSON.parse(freshGame.called_balls || '[]');

    if (currentBalls.includes(ball)) {
      throw new Error(`La balota ${ball} ya fue llamada`);
    }

    // Agregar balota a la lista
    const newCalledBalls = [...currentBalls, ball];
    const callOrder = newCalledBalls.length;

    // Actualizar en BD
    await client.query('UPDATE games SET called_balls = $1 WHERE id = $2',
      [JSON.stringify(newCalledBalls), gameId]);

    // Registrar balota en historial (para certificación)
    await recordBallCall(client, gameId, ball, callOrder);

    // Verificar ganadores
    const customPattern = freshGame.custom_pattern ? JSON.parse(freshGame.custom_pattern) : undefined;

    // Obtener ganadores existentes para no registrar duplicados
    const existingWinnerIds = new Set(JSON.parse(freshGame.winner_cards || '[]') as number[]);

    const winners = await findWinners(
      client,
      game.eventId,
      gameId,
      newCalledBalls,
      game.gameType,
      game.isPracticeMode,
      customPattern
    );

    // Filtrar solo los nuevos ganadores
    newWinners = winners.filter(w => !existingWinnerIds.has(w.cardId));

    // Si hay nuevos ganadores, registrarlos y finalizar el juego
    if (newWinners.length > 0) {
      for (const winner of newWinners) {
        await recordWinner(client, gameId, winner.cardId, winner.winningPattern, callOrder);
      }

      // Actualizar lista de ganadores en el juego
      const allWinnerIds = [...existingWinnerIds, ...newWinners.map(w => w.cardId)];
      await client.query('UPDATE games SET winner_cards = $1 WHERE id = $2',
        [JSON.stringify(allWinnerIds), gameId]);

      // Finalizar el juego automaticamente al detectar ganador(es)
      await client.query(`
        UPDATE games SET status = 'completed', finished_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `, [gameId]);

      // Generar reporte automatico
      await generateGameReport(client, gameId);
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  return {
    ball,
    column,
    gameState: (await getGameState(pool, gameId))!,
    winners: newWinners,
  };
}

/**
 * Llama una balota aleatoria
 */
export async function callRandomBall(pool: Pool, gameId: number): Promise<CallBallResult> {
  const MAX_RETRIES = 3;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const game = await getGameState(pool, gameId);

    if (!game) {
      throw new Error('Juego no encontrado');
    }

    if (game.availableBalls.length === 0) {
      throw new Error('No quedan balotas disponibles');
    }

    // Seleccionar balota con CSPRNG (seguro para bingo televisado)
    const randomIndex = randomInt(game.availableBalls.length);
    const ball = game.availableBalls[randomIndex];

    try {
      return await callBall(pool, gameId, ball);
    } catch (err: any) {
      // Si la balota ya fue llamada por otra request concurrente, reintentar
      if (err.message?.includes('ya fue llamada') && attempt < MAX_RETRIES - 1) {
        continue;
      }
      throw err;
    }
  }

  // No debería llegar aquí, pero satisface TypeScript
  throw new Error('No se pudo llamar una balota después de múltiples intentos');
}

/**
 * Finaliza un juego y genera el reporte
 */
export async function finishGame(pool: Pool, gameId: number): Promise<{ gameState: GameState; report: GameReport | null }> {
  const game = await getGameState(pool, gameId);

  if (!game) {
    throw new Error('Juego no encontrado');
  }

  if (game.status === 'completed' || game.status === 'cancelled') {
    throw new Error('El juego ya ha terminado');
  }

  if (game.status === 'pending') {
    throw new Error('No se puede finalizar un juego que no ha iniciado');
  }

  await pool.query(`
    UPDATE games
    SET status = 'completed', finished_at = CURRENT_TIMESTAMP
    WHERE id = $1
  `, [gameId]);

  // Generar reporte automáticamente al finalizar
  const report = await generateGameReport(pool, gameId);

  return {
    gameState: (await getGameState(pool, gameId))!,
    report,
  };
}

/**
 * Cancela un juego
 */
export async function cancelGame(pool: Pool, gameId: number): Promise<GameState> {
  const game = await getGameState(pool, gameId);

  if (!game) {
    throw new Error('Juego no encontrado');
  }

  if (game.status === 'completed') {
    throw new Error('No se puede cancelar un juego completado');
  }

  await pool.query(`
    UPDATE games
    SET status = 'cancelled', finished_at = CURRENT_TIMESTAMP
    WHERE id = $1
  `, [gameId]);

  return (await getGameState(pool, gameId))!;
}

/**
 * Reinicia un juego (borra balotas llamadas, ganadores e historial)
 */
export async function resetGame(pool: Pool, gameId: number): Promise<GameState> {
  const game = await getGameState(pool, gameId);

  if (!game) {
    throw new Error('Juego no encontrado');
  }

  if (game.status === 'completed') {
    throw new Error('No se puede reiniciar un juego completado. Los datos de certificación son permanentes.');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM games WHERE id = $1 FOR UPDATE', [gameId]);
    await client.query('DELETE FROM ball_history WHERE game_id = $1', [gameId]);
    await client.query('DELETE FROM game_winners WHERE game_id = $1', [gameId]);
    await client.query('DELETE FROM game_reports WHERE game_id = $1', [gameId]);
    await client.query(`
      UPDATE games
      SET status = 'pending',
          called_balls = '[]',
          winner_cards = '[]',
          started_at = NULL,
          finished_at = NULL
      WHERE id = $1
    `, [gameId]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return (await getGameState(pool, gameId))!;
}

/**
 * Crea un nuevo juego con la misma configuración de uno existente
 */
export async function replayGame(pool: Pool, gameId: number): Promise<BingoGame> {
  const gameResult = await pool.query('SELECT * FROM games WHERE id = $1', [gameId]);
  const game = gameResult.rows[0] as BingoGame | undefined;

  if (!game) {
    throw new Error('Juego no encontrado');
  }

  return createGame(pool, game.event_id, game.game_type, {
    name: game.name ?? undefined,
    isPracticeMode: !!game.is_practice_mode,
    customPattern: game.custom_pattern ? JSON.parse(game.custom_pattern) : undefined,
    prizeDescription: game.prize_description ?? undefined,
  });
}

/**
 * Obtiene estadísticas de un juego
 */
export interface GameStats {
  totalBallsCalled: number;
  remainingBalls: number;
  ballsByColumn: Record<string, number[]>;
  winnerCount: number;
  duration: number | null; // en segundos
}

export async function getGameStats(pool: Pool, gameId: number): Promise<GameStats | null> {
  const gameResult = await pool.query('SELECT * FROM games WHERE id = $1', [gameId]);
  const game = gameResult.rows[0] as BingoGame | undefined;

  if (!game) {
    return null;
  }

  const calledBalls: number[] = JSON.parse(game.called_balls || '[]');
  const winners: number[] = JSON.parse(game.winner_cards || '[]');

  // Agrupar balotas por columna
  const ballsByColumn: Record<string, number[]> = {
    B: [], I: [], N: [], G: [], O: []
  };

  for (const ball of calledBalls) {
    if (ball <= 15) ballsByColumn.B.push(ball);
    else if (ball <= 30) ballsByColumn.I.push(ball);
    else if (ball <= 45) ballsByColumn.N.push(ball);
    else if (ball <= 60) ballsByColumn.G.push(ball);
    else ballsByColumn.O.push(ball);
  }

  // Calcular duración
  let duration: number | null = null;
  if (game.started_at) {
    const start = new Date(game.started_at).getTime();
    const end = game.finished_at
      ? new Date(game.finished_at).getTime()
      : Date.now();
    duration = Math.floor((end - start) / 1000);
  }

  return {
    totalBallsCalled: calledBalls.length,
    remainingBalls: 75 - calledBalls.length,
    ballsByColumn,
    winnerCount: winners.length,
    duration,
  };
}

/**
 * Obtiene todos los juegos de un evento
 */
export async function getEventGames(
  pool: Pool,
  eventId: number
): Promise<BingoGame[]> {
  const result = await pool.query(`
    SELECT * FROM games
    WHERE event_id = $1
    ORDER BY created_at DESC
  `, [eventId]);
  return result.rows as BingoGame[];
}
