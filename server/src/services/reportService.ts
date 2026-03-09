import type Database from 'better-sqlite3';
import PDFDocument from 'pdfkit';
import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { BingoGame, CardNumbers } from '../types/index.js';

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
export function recordBallCall(
  db: Database.Database,
  gameId: number,
  ballNumber: number,
  callOrder: number
): void {
  let column: string;
  if (ballNumber <= 15) column = 'B';
  else if (ballNumber <= 30) column = 'I';
  else if (ballNumber <= 45) column = 'N';
  else if (ballNumber <= 60) column = 'G';
  else column = 'O';

  db.prepare(`
    INSERT INTO ball_history (game_id, ball_number, ball_column, call_order)
    VALUES (?, ?, ?, ?)
  `).run(gameId, ballNumber, column, callOrder);
}

/**
 * Registra un ganador del juego
 */
export function recordWinner(
  db: Database.Database,
  gameId: number,
  cardId: number,
  winningPattern: string,
  ballsToWin: number
): void {
  const card = db.prepare(`
    SELECT card_number, card_code, validation_code, buyer_name, buyer_phone
    FROM cards WHERE id = ?
  `).get(cardId) as {
    card_number: number;
    card_code: string;
    validation_code: string;
    buyer_name: string | null;
    buyer_phone: string | null;
  };

  if (card) {
    db.prepare(`
      INSERT INTO game_winners (game_id, card_id, card_number, card_code, validation_code, buyer_name, buyer_phone, winning_pattern, balls_to_win)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      gameId,
      cardId,
      card.card_number,
      card.card_code,
      card.validation_code,
      card.buyer_name,
      card.buyer_phone,
      winningPattern,
      ballsToWin
    );
  }
}

/**
 * Genera el reporte completo de un juego
 */
export function generateGameReport(db: Database.Database, gameId: number): GameReport | null {
  // Obtener datos del juego
  const game = db.prepare(`
    SELECT g.*, e.name as event_name
    FROM games g
    JOIN events e ON g.event_id = e.id
    WHERE g.id = ?
  `).get(gameId) as (BingoGame & { event_name: string }) | undefined;

  if (!game) {
    return null;
  }

  // Obtener historial de balotas
  const ballHistory = db.prepare(`
    SELECT ball_number, ball_column, call_order, called_at
    FROM ball_history
    WHERE game_id = ?
    ORDER BY call_order ASC
  `).all(gameId) as BallHistoryEntry[];

  // Obtener ganadores
  const winners = db.prepare(`
    SELECT *
    FROM game_winners
    WHERE game_id = ?
    ORDER BY won_at ASC
  `).all(gameId) as WinnerEntry[];

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
    is_practice_mode: game.is_practice_mode === 1,
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
  db.prepare(`
    INSERT OR REPLACE INTO game_reports (game_id, event_name, game_name, game_type, is_practice_mode, total_balls_called, total_winners, started_at, finished_at, report_data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
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
  );

  return report;
}

/**
 * Genera un PDF del reporte del juego
 */
export async function generateReportPDF(report: GameReport): Promise<string> {
  const filename = `reporte_juego_${report.game_id}_${Date.now()}.pdf`;
  const filepath = join(REPORTS_DIR, filename);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
    const stream = createWriteStream(filepath);
    doc.pipe(stream);

    // Título
    doc.fontSize(24).font('Helvetica-Bold').text('REPORTE DE JUEGO DE BINGO', { align: 'center' });
    doc.moveDown();

    // Información del juego
    doc.fontSize(12).font('Helvetica-Bold').text('INFORMACIÓN DEL JUEGO', { underline: true });
    doc.moveDown(0.5);
    doc.font('Helvetica');
    doc.text(`Evento: ${report.event_name}`);
    doc.text(`Nombre del Juego: ${report.game_name || 'Sin nombre'}`);
    doc.text(`Tipo de Juego: ${report.game_type_label}`);
    doc.text(`Modo: ${report.is_practice_mode ? 'Práctica' : 'Real (Solo vendidos)'}`);
    doc.text(`Estado: ${report.status}`);
    doc.moveDown();

    // Tiempos
    doc.font('Helvetica-Bold').text('TIEMPOS', { underline: true });
    doc.moveDown(0.5);
    doc.font('Helvetica');
    doc.text(`Inicio: ${report.started_at ? new Date(report.started_at).toLocaleString('es') : 'N/A'}`);
    doc.text(`Finalización: ${report.finished_at ? new Date(report.finished_at).toLocaleString('es') : 'N/A'}`);
    if (report.duration_seconds) {
      const mins = Math.floor(report.duration_seconds / 60);
      const secs = report.duration_seconds % 60;
      doc.text(`Duración: ${mins} minutos ${secs} segundos`);
    }
    doc.moveDown();

    // Estadísticas
    doc.font('Helvetica-Bold').text('ESTADÍSTICAS', { underline: true });
    doc.moveDown(0.5);
    doc.font('Helvetica');
    doc.text(`Total Balotas Llamadas: ${report.total_balls_called}`);
    doc.text(`Total Ganadores: ${report.winners.length}`);
    doc.moveDown();

    // Ganadores
    if (report.winners.length > 0) {
      doc.addPage();
      doc.fontSize(16).font('Helvetica-Bold').text('CARTONES GANADORES', { align: 'center' });
      doc.moveDown();

      report.winners.forEach((winner, index) => {
        doc.fontSize(12).font('Helvetica-Bold').text(`Ganador #${index + 1}`);
        doc.font('Helvetica');
        doc.text(`  Cartón #${winner.card_number}`);
        doc.text(`  Código: ${winner.card_code}`);
        doc.text(`  Código de Validación: ${winner.validation_code}`);
        if (winner.buyer_name) {
          doc.text(`  Comprador: ${winner.buyer_name}`);
        }
        if (winner.buyer_phone) {
          doc.text(`  Teléfono: ${winner.buyer_phone}`);
        }
        doc.text(`  Patrón Ganador: ${winner.winning_pattern}`);
        doc.text(`  Balotas para Ganar: ${winner.balls_to_win}`);
        doc.text(`  Hora de Victoria: ${new Date(winner.won_at).toLocaleString('es')}`);
        doc.moveDown();
      });
    }

    // Historial de balotas (certificación)
    doc.addPage();
    doc.fontSize(16).font('Helvetica-Bold').text('CERTIFICACIÓN DE BALOTAS', { align: 'center' });
    doc.fontSize(10).font('Helvetica').text('Orden cronológico de balotas llamadas', { align: 'center' });
    doc.moveDown();

    // Tabla de balotas
    const ballsPerRow = 10;
    let currentY = doc.y;
    const cellWidth = 45;
    const cellHeight = 25;

    report.ball_history.forEach((ball, index) => {
      const col = index % ballsPerRow;
      const row = Math.floor(index / ballsPerRow);

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
    doc.fontSize(10).font('Helvetica-Bold')
      .text('CERTIFICACIÓN', { align: 'center' });
    doc.font('Helvetica')
      .text(`Este reporte certifica el orden y resultado del juego de bingo.`, { align: 'center' })
      .text(`Generado automáticamente el ${new Date().toLocaleString('es')}`, { align: 'center' })
      .text(`ID del Juego: ${report.game_id}`, { align: 'center' });

    doc.end();

    stream.on('finish', () => resolve(filepath));
    stream.on('error', reject);
  });
}

/**
 * Obtiene los ganadores de un juego específico
 */
export function getGameWinners(db: Database.Database, gameId: number): WinnerEntry[] {
  return db.prepare(`
    SELECT * FROM game_winners WHERE game_id = ? ORDER BY won_at ASC
  `).all(gameId) as WinnerEntry[];
}

/**
 * Obtiene el historial de balotas de un juego
 */
export function getBallHistory(db: Database.Database, gameId: number): BallHistoryEntry[] {
  return db.prepare(`
    SELECT * FROM ball_history WHERE game_id = ? ORDER BY call_order ASC
  `).all(gameId) as BallHistoryEntry[];
}

/**
 * Obtiene todos los juegos donde un cartón fue ganador
 */
export function getCardWins(db: Database.Database, cardId: number): Array<WinnerEntry & { game_name: string; event_name: string }> {
  return db.prepare(`
    SELECT gw.*, g.name as game_name, e.name as event_name
    FROM game_winners gw
    JOIN games g ON gw.game_id = g.id
    JOIN events e ON g.event_id = e.id
    WHERE gw.card_id = ?
    ORDER BY gw.won_at DESC
  `).all(cardId) as Array<WinnerEntry & { game_name: string; event_name: string }>;
}
