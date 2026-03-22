import type { Pool, PoolClient } from 'pg';
import PDFDocument from 'pdfkit';
import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';

const LOGO_PATH = resolve(process.cwd(), 'client/public/logo.png');
import type { BingoGame } from '../types/index.js';

const REPORTS_DIR = join(process.cwd(), 'reports');

// Asegurar que existe el directorio de reports
if (!existsSync(REPORTS_DIR)) {
  mkdirSync(REPORTS_DIR, { recursive: true });
}

export interface BallHistoryEntry {
  ball_number: number;
  ball_column: string;
  call_order: number;
  called_at: string;
}

export interface WinnerEntry {
  id: number;
  card_id: number;
  card_number: number;
  serial: string;
  card_code: string;
  validation_code: string;
  buyer_name: string | null;
  buyer_phone: string | null;
  winning_pattern: string;
  balls_to_win: number;
  won_at: string;
}

export interface GameReport {
  game_id: number;
  event_name: string;
  event_id: number;
  game_name: string | null;
  game_type: string;
  game_type_label: string;
  is_practice_mode: boolean;
  status: string;
  total_balls_called: number;
  started_at: string | null;
  finished_at: string | null;
  duration_seconds: number | null;
  ball_history: BallHistoryEntry[];
  winners: WinnerEntry[];
  report_generated_at: string;
}

const GAME_TYPE_LABELS: Record<string, string> = {
  horizontal_line: 'Línea Horizontal',
  vertical_line: 'Línea Vertical',
  diagonal: 'Diagonal',
  blackout: 'Cartón Lleno',
  four_corners: 'Cuatro Esquinas',
  x_pattern: 'Patrón X',
  custom: 'Personalizado',
};

/**
 * Registra una balota llamada en el historial
 */
export async function recordBallCall(
  pool: Pool | PoolClient,
  gameId: number,
  ballNumber: number,
  callOrder: number
): Promise<void> {
  let column: string;
  if (ballNumber <= 15) column = 'B';
  else if (ballNumber <= 30) column = 'I';
  else if (ballNumber <= 45) column = 'N';
  else if (ballNumber <= 60) column = 'G';
  else column = 'O';

  await pool.query(`
    INSERT INTO ball_history (game_id, ball_number, ball_column, call_order)
    VALUES ($1, $2, $3, $4)
  `, [gameId, ballNumber, column, callOrder]);
}

/**
 * Registra un ganador del juego
 */
export async function recordWinner(
  pool: Pool | PoolClient,
  gameId: number,
  cardId: number,
  winningPattern: string,
  ballsToWin: number
): Promise<void> {
  const cardResult = await pool.query(`
    SELECT card_number, card_code, validation_code, buyer_name, buyer_phone
    FROM cards WHERE id = $1
  `, [cardId]);
  const card = cardResult.rows[0] as {
    card_number: number;
    card_code: string;
    validation_code: string;
    buyer_name: string | null;
    buyer_phone: string | null;
  } | undefined;

  if (card) {
    await pool.query(`
      INSERT INTO game_winners (game_id, card_id, card_number, card_code, validation_code, buyer_name, buyer_phone, winning_pattern, balls_to_win)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [
      gameId,
      cardId,
      card.card_number,
      card.card_code,
      card.validation_code,
      card.buyer_name,
      card.buyer_phone,
      winningPattern,
      ballsToWin
    ]);
  }
}

/**
 * Genera el reporte completo de un juego
 */
export async function generateGameReport(pool: Pool | PoolClient, gameId: number): Promise<GameReport | null> {
  // Obtener datos del juego
  const gameResult = await pool.query(`
    SELECT g.*, e.name as event_name
    FROM games g
    JOIN events e ON g.event_id = e.id
    WHERE g.id = $1
  `, [gameId]);
  const game = gameResult.rows[0] as (BingoGame & { event_name: string }) | undefined;

  if (!game) {
    return null;
  }

  // Obtener historial de balotas
  const ballHistoryResult = await pool.query(`
    SELECT ball_number, ball_column, call_order, called_at
    FROM ball_history
    WHERE game_id = $1
    ORDER BY call_order ASC
  `, [gameId]);
  const ballHistory = ballHistoryResult.rows as BallHistoryEntry[];

  // Obtener ganadores (con serial del cartón)
  const winnersResult = await pool.query(`
    SELECT gw.*, c.serial
    FROM game_winners gw
    LEFT JOIN cards c ON c.id = gw.card_id
    WHERE gw.game_id = $1
    ORDER BY gw.won_at ASC
  `, [gameId]);
  const winners = winnersResult.rows as WinnerEntry[];

  // Calcular duración
  let durationSeconds: number | null = null;
  if (game.started_at && game.finished_at) {
    const start = new Date(game.started_at).getTime();
    const end = new Date(game.finished_at).getTime();
    durationSeconds = Math.floor((end - start) / 1000);
  }

  const report: GameReport = {
    game_id: game.id,
    event_name: game.event_name,
    event_id: game.event_id,
    game_name: game.name,
    game_type: game.game_type,
    game_type_label: GAME_TYPE_LABELS[game.game_type] || game.game_type,
    is_practice_mode: !!game.is_practice_mode,
    status: game.status,
    total_balls_called: ballHistory.length,
    started_at: game.started_at,
    finished_at: game.finished_at,
    duration_seconds: durationSeconds,
    ball_history: ballHistory,
    winners,
    report_generated_at: new Date().toISOString(),
  };

  // Guardar reporte en la BD
  // PostgreSQL uses ON CONFLICT instead of INSERT OR REPLACE
  await pool.query(`
    INSERT INTO game_reports (game_id, event_name, game_name, game_type, is_practice_mode, total_balls_called, total_winners, started_at, finished_at, report_data)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    ON CONFLICT (game_id) DO UPDATE SET
      event_name = EXCLUDED.event_name,
      game_name = EXCLUDED.game_name,
      game_type = EXCLUDED.game_type,
      is_practice_mode = EXCLUDED.is_practice_mode,
      total_balls_called = EXCLUDED.total_balls_called,
      total_winners = EXCLUDED.total_winners,
      started_at = EXCLUDED.started_at,
      finished_at = EXCLUDED.finished_at,
      report_data = EXCLUDED.report_data
  `, [
    gameId,
    game.event_name,
    game.name,
    game.game_type,
    game.is_practice_mode,
    ballHistory.length,
    winners.length,
    game.started_at,
    game.finished_at,
    JSON.stringify(report)
  ]);

  return report;
}

/**
 * Genera un PDF del reporte del juego
 */
export async function generateReportPDF(report: GameReport): Promise<string> {
  const filename = `reporte_juego_${report.game_id}_${Date.now()}.pdf`;
  const filepath = join(REPORTS_DIR, filename);

  return new Promise((res, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
    const stream = createWriteStream(filepath);
    doc.pipe(stream);

    const pageWidth = doc.page.width - 100;
    const margin = 50;

    // Logo + Título
    if (existsSync(LOGO_PATH)) {
      doc.image(LOGO_PATH, doc.page.width / 2 - 50, 30, { width: 100 });
      doc.moveDown(5);
    }
    doc.fontSize(20).font('Helvetica-Bold').text('REPORTE DE JUEGO', { align: 'center' });
    doc.fontSize(10).font('Helvetica').text('MegabingoTV', { align: 'center' });
    doc.moveDown(0.5);
    doc.moveTo(margin, doc.y).lineTo(margin + pageWidth, doc.y).stroke('#cccccc');
    doc.moveDown();

    // Información del juego
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#2563eb').text('INFORMACIÓN DEL JUEGO');
    doc.fillColor('#333333');
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(10);
    doc.text(`Evento: ${report.event_name}`);
    doc.text(`Nombre del Juego: ${report.game_name || 'Sin nombre'}`);
    doc.text(`Tipo de Juego: ${report.game_type_label}`);
    doc.text(`Modo: ${report.is_practice_mode ? 'Práctica' : 'Real (Solo vendidos)'}`);
    doc.text(`Estado: ${report.status === 'completed' ? 'Finalizado' : report.status}`);
    doc.moveDown();

    // Tiempos
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#2563eb').text('TIEMPOS');
    doc.fillColor('#333333');
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(10);
    doc.text(`Inicio: ${report.started_at ? new Date(report.started_at).toLocaleString('es') : 'N/A'}`);
    doc.text(`Finalización: ${report.finished_at ? new Date(report.finished_at).toLocaleString('es') : 'N/A'}`);
    if (report.duration_seconds) {
      const mins = Math.floor(report.duration_seconds / 60);
      const secs = report.duration_seconds % 60;
      doc.text(`Duración: ${mins} minutos ${secs} segundos`);
    }
    doc.moveDown();

    // Estadísticas
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#2563eb').text('ESTADÍSTICAS');
    doc.fillColor('#333333');
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(10);
    doc.text(`Total Balotas Llamadas: ${report.total_balls_called}`);
    doc.text(`Total Ganadores: ${report.winners.length}`);
    doc.moveDown();

    // Ganadores
    if (report.winners.length > 0) {
      doc.addPage();
      if (existsSync(LOGO_PATH)) {
        doc.image(LOGO_PATH, doc.page.width / 2 - 30, 30, { width: 60 });
        doc.moveDown(3.5);
      }
      doc.fontSize(16).font('Helvetica-Bold').fillColor('#2563eb').text('CARTONES GANADORES', { align: 'center' });
      doc.fillColor('#333333');
      doc.moveDown(0.5);
      doc.moveTo(margin, doc.y).lineTo(margin + pageWidth, doc.y).stroke('#cccccc');
      doc.moveDown();

      report.winners.forEach((winner, index) => {
        if (doc.y > 650) doc.addPage();
        // Caja con fondo
        const boxY = doc.y;
        doc.rect(margin, boxY, pageWidth, 16).fill('#e8edf2');
        doc.fillColor('#333333').fontSize(11).font('Helvetica-Bold')
          .text(`Ganador #${index + 1}  —  Serie: ${winner.serial || 'N/A'}`, margin + 8, boxY + 3);
        doc.y = boxY + 22;
        doc.fontSize(10).font('Helvetica');
        doc.text(`  No. de Control: ${winner.card_number}    |    Código: ${winner.card_code}    |    Validación: ${winner.validation_code}`);
        if (winner.buyer_name) {
          doc.text(`  Comprador: ${winner.buyer_name}${winner.buyer_phone ? `  |  Tel: ${winner.buyer_phone}` : ''}`);
        }
        doc.text(`  Patrón: ${winner.winning_pattern}    |    Balotas para ganar: ${winner.balls_to_win}    |    Hora: ${new Date(winner.won_at).toLocaleString('es')}`);
        doc.moveDown(0.8);
      });
    }

    // Historial de balotas (certificación)
    doc.addPage();
    if (existsSync(LOGO_PATH)) {
      doc.image(LOGO_PATH, doc.page.width / 2 - 30, 30, { width: 60 });
      doc.moveDown(3.5);
    }
    doc.fontSize(16).font('Helvetica-Bold').fillColor('#2563eb').text('CERTIFICACIÓN DE BALOTAS', { align: 'center' });
    doc.fillColor('#333333');
    doc.fontSize(10).font('Helvetica').text('Orden cronológico de balotas llamadas', { align: 'center' });
    doc.moveDown();

    // Tabla de balotas
    const ballsPerRow = 10;
    let currentY = doc.y;
    const cellWidth = 45;
    const cellHeight = 25;

    report.ball_history.forEach((ball, index) => {
      const col = index % ballsPerRow;
      const _row = Math.floor(index / ballsPerRow);

      if (col === 0 && index > 0) {
        currentY += cellHeight;
        if (currentY > 700) {
          doc.addPage();
          currentY = 50;
        }
      }

      const x = 50 + col * cellWidth;
      const y = currentY;

      // Dibujar celda
      doc.rect(x, y, cellWidth, cellHeight).stroke();
      doc.fontSize(10).text(`${ball.call_order}. ${ball.ball_column}${ball.ball_number}`, x + 2, y + 8, {
        width: cellWidth - 4,
        align: 'center',
      });
    });

    doc.moveDown(3);

    // Pie de página con certificación
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#2563eb')
      .text('CERTIFICACIÓN', { align: 'center' });
    doc.fillColor('#333333').font('Helvetica')
      .text(`Este reporte certifica el orden y resultado del juego de bingo.`, { align: 'center' })
      .text(`Generado automáticamente por MegabingoTV el ${new Date().toLocaleString('es')}`, { align: 'center' })
      .text(`ID del Juego: ${report.game_id}`, { align: 'center' });

    doc.end();

    stream.on('finish', () => res(filepath));
    stream.on('error', reject);
  });
}

/**
 * Obtiene los ganadores de un juego específico
 */
export async function getGameWinners(pool: Pool, gameId: number): Promise<WinnerEntry[]> {
  const result = await pool.query(`
    SELECT gw.*, c.serial FROM game_winners gw
    LEFT JOIN cards c ON c.id = gw.card_id
    WHERE gw.game_id = $1 ORDER BY gw.won_at ASC
  `, [gameId]);
  return result.rows as WinnerEntry[];
}

/**
 * Obtiene el historial de balotas de un juego
 */
export async function getBallHistory(pool: Pool, gameId: number): Promise<BallHistoryEntry[]> {
  const result = await pool.query(`
    SELECT * FROM ball_history WHERE game_id = $1 ORDER BY call_order ASC
  `, [gameId]);
  return result.rows as BallHistoryEntry[];
}

/**
 * Obtiene todos los juegos donde un cartón fue ganador
 */
export async function getCardWins(pool: Pool, cardId: number): Promise<Array<WinnerEntry & { game_name: string; event_name: string }>> {
  const result = await pool.query(`
    SELECT gw.*, g.name as game_name, e.name as event_name
    FROM game_winners gw
    JOIN games g ON gw.game_id = g.id
    JOIN events e ON g.event_id = e.id
    WHERE gw.card_id = $1
    ORDER BY gw.won_at DESC
  `, [cardId]);
  return result.rows as Array<WinnerEntry & { game_name: string; event_name: string }>;
}
