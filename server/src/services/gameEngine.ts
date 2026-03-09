import { randomInt } from 'crypto';
import type Database from 'better-sqlite3';
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
export function createGame(
  db: Database.Database,
  eventId: number,
  gameType: GameType,
  options: {
    name?: string;
    isPracticeMode?: boolean;
    customPattern?: Position[];
    prizeDescription?: string;
  } = {}
): BingoGame {
  const {
    name = null,
    isPracticeMode = true,
    customPattern = null,
    prizeDescription = null,
  } = options;

  const result = db.prepare(`
    INSERT INTO games (event_id, name, game_type, custom_pattern, is_practice_mode, prize_description)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    eventId,
    name,
    gameType,
    customPattern ? JSON.stringify(customPattern) : null,
    isPracticeMode ? 1 : 0,
    prizeDescription
  );

  return db.prepare('SELECT * FROM games WHERE id = ?').get(result.lastInsertRowid) as BingoGame;
}

/**
 * Obtiene el estado actual de un juego
 */
export function getGameState(db: Database.Database, gameId: number): GameState | null {
  const game = db.prepare('SELECT * FROM games WHERE id = ?').get(gameId) as BingoGame | undefined;

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

  // Contar cartones
  const cardCounts = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN is_sold = 1 THEN 1 ELSE 0 END) as sold
    FROM cards
    WHERE event_id = ?
  `).get(game.event_id) as { total: number; sold: number };

  return {
    id: game.id,
    eventId: game.event_id,
    name: game.name,
    gameType: game.game_type,
    status: game.status,
    isPracticeMode: game.is_practice_mode === 1,
    calledBalls,
    winnerCards,
    availableBalls,
    totalCards: cardCounts.total,
    activeCards: game.is_practice_mode === 1 ? cardCounts.total : cardCounts.sold,
    startedAt: game.started_at,
  };
}

/**
 * Inicia un juego
 */
export function startGame(db: Database.Database, gameId: number): GameState {
  const game = getGameState(db, gameId);

  if (!game) {
    throw new Error('Juego no encontrado');
  }

  if (game.status !== 'pending') {
    throw new Error(`No se puede iniciar un juego en estado: ${game.status}`);
  }

  if (!game.isPracticeMode && game.activeCards === 0) {
    throw new Error('No hay cartones vendidos para jugar en modo real');
  }

  db.prepare(`
    UPDATE games
    SET status = 'in_progress', started_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(gameId);

  return getGameState(db, gameId)!;
}

/**
 * Pausa un juego
 */
export function pauseGame(db: Database.Database, gameId: number): GameState {
  const game = getGameState(db, gameId);

  if (!game) {
    throw new Error('Juego no encontrado');
  }

  if (game.status !== 'in_progress') {
    throw new Error('Solo se puede pausar un juego en progreso');
  }

  db.prepare('UPDATE games SET status = ? WHERE id = ?').run('paused', gameId);

  return getGameState(db, gameId)!;
}

/**
 * Reanuda un juego pausado
 */
export function resumeGame(db: Database.Database, gameId: number): GameState {
  const game = getGameState(db, gameId);

  if (!game) {
    throw new Error('Juego no encontrado');
  }

  if (game.status !== 'paused') {
    throw new Error('Solo se puede reanudar un juego pausado');
  }

  db.prepare('UPDATE games SET status = ? WHERE id = ?').run('in_progress', gameId);

  return getGameState(db, gameId)!;
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
    validationCode: string;
    winningPattern: string;
    buyerName?: string;
  }>;
}

export function callBall(
  db: Database.Database,
  gameId: number,
  ball: number
): CallBallResult {
  const game = getGameState(db, gameId);

  if (!game) {
    throw new Error('Juego no encontrado');
  }

  if (game.status !== 'in_progress') {
    throw new Error('El juego no está en progreso');
  }

  if (ball < 1 || ball > 75) {
    throw new Error('Balota inválida. Debe estar entre 1 y 75');
  }

  if (game.calledBalls.includes(ball)) {
    throw new Error(`La balota ${ball} ya fue llamada`);
  }

  // Determinar columna de la balota
  let column: string;
  if (ball <= 15) column = 'B';
  else if (ball <= 30) column = 'I';
  else if (ball <= 45) column = 'N';
  else if (ball <= 60) column = 'G';
  else column = 'O';

  // Envolver todo en transacción para consistencia y rendimiento
  const callBallTx = db.transaction(() => {
    // Agregar balota a la lista
    const newCalledBalls = [...game.calledBalls, ball];
    const callOrder = newCalledBalls.length;

    // Actualizar en BD
    db.prepare('UPDATE games SET called_balls = ? WHERE id = ?')
      .run(JSON.stringify(newCalledBalls), gameId);

    // Registrar balota en historial (para certificación)
    recordBallCall(db, gameId, ball, callOrder);

    // Verificar ganadores
    const gameData = db.prepare('SELECT * FROM games WHERE id = ?').get(gameId) as BingoGame;
    const customPattern = gameData.custom_pattern ? JSON.parse(gameData.custom_pattern) : undefined;

    // Obtener ganadores existentes para no registrar duplicados
    const existingWinnerIds = new Set(JSON.parse(gameData.winner_cards || '[]') as number[]);

    const winners = findWinners(
      db,
      game.eventId,
      gameId,
      newCalledBalls,
      game.gameType,
      game.isPracticeMode,
      customPattern
    );

    // Filtrar solo los nuevos ganadores
    const newWinners = winners.filter(w => !existingWinnerIds.has(w.cardId));

    // Si hay nuevos ganadores, registrarlos
    if (newWinners.length > 0) {
      for (const winner of newWinners) {
        recordWinner(db, gameId, winner.cardId, winner.winningPattern, callOrder);
      }

      // Actualizar lista de ganadores en el juego
      const allWinnerIds = [...existingWinnerIds, ...newWinners.map(w => w.cardId)];
      db.prepare('UPDATE games SET winner_cards = ? WHERE id = ?')
        .run(JSON.stringify(allWinnerIds), gameId);
    }

    return newWinners;
  });

  const newWinners = callBallTx();

  return {
    ball,
    column,
    gameState: getGameState(db, gameId)!,
    winners: newWinners,
  };
}

/**
 * Llama una balota aleatoria
 */
export function callRandomBall(db: Database.Database, gameId: number): CallBallResult {
  const game = getGameState(db, gameId);

  if (!game) {
    throw new Error('Juego no encontrado');
  }

  if (game.availableBalls.length === 0) {
    throw new Error('No quedan balotas disponibles');
  }

  // Seleccionar balota con CSPRNG (seguro para bingo televisado)
  const randomIndex = randomInt(game.availableBalls.length);
  const ball = game.availableBalls[randomIndex];

  return callBall(db, gameId, ball);
}

/**
 * Finaliza un juego y genera el reporte
 */
export function finishGame(db: Database.Database, gameId: number): { gameState: GameState; report: GameReport | null } {
  const game = getGameState(db, gameId);

  if (!game) {
    throw new Error('Juego no encontrado');
  }

  if (game.status === 'completed' || game.status === 'cancelled') {
    throw new Error('El juego ya ha terminado');
  }

  if (game.status === 'pending') {
    throw new Error('No se puede finalizar un juego que no ha iniciado');
  }

  db.prepare(`
    UPDATE games
    SET status = 'completed', finished_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(gameId);

  // Generar reporte automáticamente al finalizar
  const report = generateGameReport(db, gameId);

  return {
    gameState: getGameState(db, gameId)!,
    report,
  };
}

/**
 * Cancela un juego
 */
export function cancelGame(db: Database.Database, gameId: number): GameState {
  const game = getGameState(db, gameId);

  if (!game) {
    throw new Error('Juego no encontrado');
  }

  if (game.status === 'completed') {
    throw new Error('No se puede cancelar un juego completado');
  }

  db.prepare(`
    UPDATE games
    SET status = 'cancelled', finished_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(gameId);

  return getGameState(db, gameId)!;
}

/**
 * Reinicia un juego (borra balotas llamadas, ganadores e historial)
 */
export function resetGame(db: Database.Database, gameId: number): GameState {
  const game = getGameState(db, gameId);

  if (!game) {
    throw new Error('Juego no encontrado');
  }

  // Limpiar historial de balotas
  db.prepare('DELETE FROM ball_history WHERE game_id = ?').run(gameId);

  // Limpiar ganadores
  db.prepare('DELETE FROM game_winners WHERE game_id = ?').run(gameId);

  // Limpiar reporte si existe
  db.prepare('DELETE FROM game_reports WHERE game_id = ?').run(gameId);

  // Reiniciar el juego
  db.prepare(`
    UPDATE games
    SET status = 'pending',
        called_balls = '[]',
        winner_cards = '[]',
        started_at = NULL,
        finished_at = NULL
    WHERE id = ?
  `).run(gameId);

  return getGameState(db, gameId)!;
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

export function getGameStats(db: Database.Database, gameId: number): GameStats | null {
  const game = db.prepare('SELECT * FROM games WHERE id = ?').get(gameId) as BingoGame | undefined;

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
export function getEventGames(
  db: Database.Database,
  eventId: number
): BingoGame[] {
  return db.prepare(`
    SELECT * FROM games
    WHERE event_id = ?
    ORDER BY created_at DESC
  `).all(eventId) as BingoGame[];
}
