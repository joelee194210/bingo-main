import { Router } from 'express';
import type { Request, Response } from 'express';
import { getPool } from '../database/init.js';
import {
  generateGameReport,
  generateReportPDF,
  getGameWinners,
  getBallHistory,
  getCardWins,
} from '../services/reportService.js';

const router = Router();

// GET /api/reports/game/:gameId - Obtener reporte de un juego
router.get('/game/:gameId', async (req: Request, res: Response) => {
  try {
    const gameId = parseInt(req.params.gameId as string, 10);
    const pool = getPool();

    const report = await generateGameReport(pool, gameId);

    if (!report) {
      return res.status(404).json({ success: false, error: 'Juego no encontrado' });
    }

    res.json({ success: true, data: report });
  } catch (error) {
    console.error('Error obteniendo reporte:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// GET /api/reports/game/:gameId/pdf - Descargar PDF del reporte
router.get('/game/:gameId/pdf', async (req: Request, res: Response) => {
  try {
    const gameId = parseInt(req.params.gameId as string, 10);
    const pool = getPool();

    const report = await generateGameReport(pool, gameId);

    if (!report) {
      return res.status(404).json({ success: false, error: 'Juego no encontrado' });
    }

    const filepath = await generateReportPDF(report);

    res.download(filepath, `reporte_juego_${gameId}.pdf`);
  } catch (error) {
    console.error('Error generando PDF:', error);
    res.status(500).json({ success: false, error: 'Error generando PDF' });
  }
});

// GET /api/reports/game/:gameId/winners - Obtener ganadores de un juego
router.get('/game/:gameId/winners', async (req: Request, res: Response) => {
  try {
    const gameId = parseInt(req.params.gameId as string, 10);
    const pool = getPool();

    const winners = await getGameWinners(pool, gameId);

    res.json({ success: true, data: winners });
  } catch (error) {
    console.error('Error obteniendo ganadores:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// GET /api/reports/game/:gameId/balls - Obtener historial de balotas
router.get('/game/:gameId/balls', async (req: Request, res: Response) => {
  try {
    const gameId = parseInt(req.params.gameId as string, 10);
    const pool = getPool();

    const balls = await getBallHistory(pool, gameId);

    res.json({ success: true, data: balls });
  } catch (error) {
    console.error('Error obteniendo historial:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// GET /api/reports/card/:cardId/wins - Obtener juegos donde un cartón ganó
router.get('/card/:cardId/wins', async (req: Request, res: Response) => {
  try {
    const cardId = parseInt(req.params.cardId as string, 10);
    const pool = getPool();

    const wins = await getCardWins(pool, cardId);

    res.json({ success: true, data: wins });
  } catch (error) {
    console.error('Error obteniendo victorias:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// GET /api/reports/event/:eventId/winners - Todos los ganadores de un evento
router.get('/event/:eventId/winners', async (req: Request, res: Response) => {
  try {
    const eventId = parseInt(req.params.eventId as string, 10);
    const pool = getPool();

    const { rows: winners } = await pool.query(`
      SELECT gw.*, g.name as game_name, g.game_type
      FROM game_winners gw
      JOIN games g ON gw.game_id = g.id
      WHERE g.event_id = $1
      ORDER BY gw.won_at DESC
    `, [eventId]);

    res.json({ success: true, data: winners });
  } catch (error) {
    console.error('Error obteniendo ganadores del evento:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// GET /api/reports/recent-winners - Ganadores recientes
router.get('/recent-winners', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(50, parseInt(req.query.limit as string, 10) || 10);
    const pool = getPool();

    const { rows: winners } = await pool.query(`
      SELECT gw.*, g.name as game_name, g.game_type, e.name as event_name
      FROM game_winners gw
      JOIN games g ON gw.game_id = g.id
      JOIN events e ON g.event_id = e.id
      ORDER BY gw.won_at DESC
      LIMIT $1
    `, [limit]);

    res.json({ success: true, data: winners });
  } catch (error) {
    console.error('Error obteniendo ganadores recientes:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

export default router;
