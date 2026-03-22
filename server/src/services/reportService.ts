import type { Pool, PoolClient } from 'pg';
import PDFDocument from 'pdfkit';
import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';

// Buscar logo en múltiples ubicaciones (dev: client/public, prod: client/dist)
const LOGO_CANDIDATES = [
  resolve(process.cwd(), 'client/public/logo.png'),
  resolve(process.cwd(), 'client/dist/logo.png'),
  resolve(process.cwd(), 'logo.png'),
  resolve(process.cwd(), '../client/public/logo.png'),
  resolve(process.cwd(), '../client/dist/logo.png'),
  resolve(process.cwd(), '../logo.png'),
];
function getLogoPath(): string {
  return LOGO_CANDIDATES.find(p => existsSync(p)) || '';
}
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

  // Colores por columna BINGO
  const BINGO_COLORS: Record<string, string> = {
    B: '#e53e3e', I: '#dd6b20', N: '#38a169', G: '#3182ce', O: '#805ad5',
  };
  const ACCENT = '#1e40af';
  const LIGHT_BG = '#f0f4ff';
  const BORDER = '#cbd5e1';

  return new Promise((res, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 40 });
    const stream = createWriteStream(filepath);
    doc.pipe(stream);

    const pw = doc.page.width - 80; // page width usable
    const m = 40; // margin

    // Helper: section title with colored bar
    const sectionTitle = (title: string, color = ACCENT) => {
      const y = doc.y;
      doc.rect(m, y, 4, 16).fill(color);
      doc.fillColor(color).fontSize(13).font('Helvetica-Bold').text(title, m + 12, y + 1);
      doc.fillColor('#333333');
      doc.y = y + 22;
    };

    // Helper: info row in a table-like layout
    const infoRow = (label: string, value: string, y: number, x: number, w: number) => {
      doc.fontSize(8).font('Helvetica-Bold').fillColor('#64748b').text(label, x + 6, y + 3, { width: w });
      doc.fontSize(10).font('Helvetica').fillColor('#1e293b').text(value, x + 6, y + 14, { width: w });
    };

    // ==================== PAGE 1: INFO ====================
    // Header bar
    doc.rect(0, 0, doc.page.width, 8).fill(ACCENT);

    // Logo
    const logoFile = getLogoPath();
    if (logoFile) {
      try {
        doc.image(logoFile, doc.page.width / 2 - 55, 20, { width: 110 });
        doc.y = 130;
      } catch (logoErr) {
        console.error('Error cargando logo en PDF:', logoErr, 'path:', logoFile);
        doc.y = 30;
      }
    } else {
      console.warn('Logo no encontrado. Buscado en:', LOGO_CANDIDATES);
      doc.y = 30;
    }

    // Title
    doc.fontSize(22).font('Helvetica-Bold').fillColor(ACCENT).text('REPORTE DE JUEGO', { align: 'center' });
    doc.fontSize(11).font('Helvetica').fillColor('#64748b').text('MegabingoTV — Sistema de Bingo Americano', { align: 'center' });
    doc.moveDown(0.3);
    doc.moveTo(m, doc.y).lineTo(m + pw, doc.y).lineWidth(1).stroke(BORDER);
    doc.moveDown(0.8);

    // Info cards — 2 columnas
    sectionTitle('INFORMACIÓN DEL JUEGO');
    const infoY = doc.y;
    const halfW = pw / 2 - 5;

    // Fila 1
    doc.rect(m, infoY, halfW, 32).lineWidth(0.5).stroke(BORDER);
    infoRow('Evento', report.event_name, infoY, m, halfW);
    doc.rect(m + halfW + 10, infoY, halfW, 32).stroke(BORDER);
    infoRow('Juego', report.game_name || 'Sin nombre', infoY, m + halfW + 10, halfW);

    // Fila 2
    const r2y = infoY + 36;
    doc.rect(m, r2y, halfW, 32).stroke(BORDER);
    infoRow('Tipo de Juego', report.game_type_label, r2y, m, halfW);
    doc.rect(m + halfW + 10, r2y, halfW, 32).stroke(BORDER);
    infoRow('Modo', report.is_practice_mode ? 'Práctica' : 'Real (Solo vendidos)', r2y, m + halfW + 10, halfW);

    doc.y = r2y + 44;

    // Estadísticas en cajas de color
    sectionTitle('ESTADÍSTICAS');
    const statY = doc.y;
    const statW = pw / 4 - 6;
    const stats = [
      { label: 'Balotas', value: String(report.total_balls_called), color: '#3182ce' },
      { label: 'Ganadores', value: String(report.winners.length), color: '#38a169' },
      { label: 'Duración', value: report.duration_seconds ? `${Math.floor(report.duration_seconds / 60)}m ${report.duration_seconds % 60}s` : 'N/A', color: '#dd6b20' },
      { label: 'Estado', value: report.status === 'completed' ? 'Finalizado' : report.status, color: '#805ad5' },
    ];
    stats.forEach((s, i) => {
      const sx = m + i * (statW + 8);
      doc.roundedRect(sx, statY, statW, 50, 4).fill(s.color);
      doc.fillColor('#ffffff').fontSize(20).font('Helvetica-Bold').text(s.value, sx, statY + 6, { width: statW, align: 'center' });
      doc.fontSize(8).font('Helvetica').text(s.label, sx, statY + 32, { width: statW, align: 'center' });
    });
    doc.fillColor('#333333');
    doc.y = statY + 60;

    // Tiempos
    sectionTitle('TIEMPOS');
    doc.fontSize(10).font('Helvetica');
    doc.text(`Inicio: ${report.started_at ? new Date(report.started_at).toLocaleString('es') : 'N/A'}`);
    doc.text(`Finalización: ${report.finished_at ? new Date(report.finished_at).toLocaleString('es') : 'N/A'}`);
    if (report.duration_seconds) {
      const mins = Math.floor(report.duration_seconds / 60);
      const secs = report.duration_seconds % 60;
      doc.text(`Duración total: ${mins} minutos ${secs} segundos`);
    }

    // ==================== PAGE 2: GANADORES ====================
    if (report.winners.length > 0) {
      doc.addPage();
      doc.rect(0, 0, doc.page.width, 8).fill(ACCENT);

      if (logoFile) {
        try { doc.image(logoFile, m, 15, { width: 60 }); } catch {}
      }
      doc.fontSize(16).font('Helvetica-Bold').fillColor(ACCENT).text('CARTONES GANADORES', m, 25, { width: pw, align: 'center' });
      doc.fillColor('#333333');
      doc.y = 50;
      doc.moveTo(m, doc.y).lineTo(m + pw, doc.y).stroke(BORDER);
      doc.moveDown(0.5);

      // Tabla de ganadores
      const cols = [
        { label: '#', w: 25 },
        { label: 'Serie', w: 75 },
        { label: 'No. Control', w: 70 },
        { label: 'Código', w: 55 },
        { label: 'Patrón', w: 90 },
        { label: 'Balotas', w: 45 },
        { label: 'Comprador', w: 90 },
        { label: 'Hora', w: pw - 25 - 75 - 70 - 55 - 90 - 45 - 90 },
      ];

      // Header de tabla
      let ty = doc.y;
      doc.rect(m, ty, pw, 18).fill(ACCENT);
      let cx = m;
      cols.forEach(c => {
        doc.fillColor('#ffffff').fontSize(7).font('Helvetica-Bold').text(c.label, cx + 3, ty + 5, { width: c.w - 6 });
        cx += c.w;
      });
      doc.fillColor('#333333');
      ty += 18;

      report.winners.forEach((w, i) => {
        if (ty > 720) {
          doc.addPage();
          doc.rect(0, 0, doc.page.width, 8).fill(ACCENT);
          ty = 20;
        }
        const bg = i % 2 === 0 ? LIGHT_BG : '#ffffff';
        doc.rect(m, ty, pw, 20).fill(bg);

        const vals = [
          String(i + 1),
          w.serial || 'N/A',
          String(w.card_number),
          w.card_code,
          w.winning_pattern,
          String(w.balls_to_win),
          w.buyer_name || '-',
          new Date(w.won_at).toLocaleTimeString('es'),
        ];

        cx = m;
        vals.forEach((v, ci) => {
          doc.fillColor('#1e293b').fontSize(8).font(ci === 0 ? 'Helvetica-Bold' : 'Helvetica')
            .text(v, cx + 3, ty + 6, { width: cols[ci].w - 6 });
          cx += cols[ci].w;
        });
        ty += 20;
      });

      doc.y = ty + 5;
    }

    // ==================== PAGE 3: CERTIFICACIÓN BALOTAS ====================
    doc.addPage();
    doc.rect(0, 0, doc.page.width, 8).fill(ACCENT);

    if (logoFile) {
      try { doc.image(logoFile, m, 15, { width: 60 }); } catch {}
    }
    doc.fontSize(16).font('Helvetica-Bold').fillColor(ACCENT).text('CERTIFICACIÓN DE BALOTAS', m, 25, { width: pw, align: 'center' });
    doc.fillColor('#64748b').fontSize(9).font('Helvetica').text('Orden cronológico de balotas llamadas', m, 45, { width: pw, align: 'center' });
    doc.fillColor('#333333');
    doc.y = 65;

    // Tabla de balotas con colores BINGO
    const bpr = 10; // balls per row
    const cw = pw / bpr;
    const ch = 28;
    let by = doc.y;

    // Header BINGO columns (repeat every page)
    const drawBallsHeader = () => {
      // No header needed — each ball shows its column color
    };
    drawBallsHeader();

    report.ball_history.forEach((ball, index) => {
      const col = index % bpr;

      if (col === 0 && index > 0) {
        by += ch;
        if (by > 700) {
          doc.addPage();
          doc.rect(0, 0, doc.page.width, 8).fill(ACCENT);
          by = 20;
        }
      }

      const x = m + col * cw;
      const ballColor = BINGO_COLORS[ball.ball_column] || '#333333';

      // Celda con color de fondo suave
      doc.rect(x, by, cw, ch).lineWidth(0.5).stroke(BORDER);
      // Número de orden
      doc.fontSize(6).font('Helvetica').fillColor('#94a3b8').text(String(ball.call_order), x + 2, by + 2, { width: cw - 4 });
      // Balota con color
      doc.fontSize(12).font('Helvetica-Bold').fillColor(ballColor)
        .text(`${ball.ball_column}${ball.ball_number}`, x, by + 10, { width: cw, align: 'center' });
    });

    doc.fillColor('#333333');
    doc.y = by + ch + 20;

    // Certificación final
    if (doc.y > 650) doc.addPage();
    const certY = doc.y;
    doc.roundedRect(m + pw / 4, certY, pw / 2, 80, 6).lineWidth(1).stroke(ACCENT);
    doc.fontSize(11).font('Helvetica-Bold').fillColor(ACCENT)
      .text('CERTIFICACIÓN', m + pw / 4, certY + 8, { width: pw / 2, align: 'center' });
    doc.fontSize(8).font('Helvetica').fillColor('#333333')
      .text('Este reporte certifica el orden y resultado del juego de bingo.', m + pw / 4 + 10, certY + 24, { width: pw / 2 - 20, align: 'center' })
      .text(`Generado por MegabingoTV`, { width: pw / 2 - 20, align: 'center' })
      .text(`${new Date().toLocaleString('es')}`, { width: pw / 2 - 20, align: 'center' })
      .text(`ID del Juego: ${report.game_id}`, { width: pw / 2 - 20, align: 'center' });

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
