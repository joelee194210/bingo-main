import { Router } from 'express';
import type { Request, Response } from 'express';
import { getDatabase } from '../database/init.js';
import {
  generateGameReport,
  generateReportPDF,
  getGameWinners,
  getBallHistory,
  getCardWins,
} from '../services/reportService.js';

const router = Router();

// GET /api/reports/game/:gameId - Obtener reporte de un juego
router.get('/game/:gameId', (req: Request, res: Response) => {
  try {
    const gameId = parseInt(req.params.gameId as string, 10);
    const db = getDatabase();

    const report = generateGameReport(db, gameId);
    db.close();

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
    const db = getDatabase();

    const report = generateGameReport(db, gameId);
    db.close();

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
router.get('/game/:gameId/winners', (req: Request, res: Response) => {
  try {
    const gameId = parseInt(req.params.gameId as string, 10);
    const db = getDatabase();

    const winners = getGameWinners(db, gameId);
    db.close();

    res.json({ success: true, data: winners });
  } catch (error) {
    console.error('Error obteniendo ganadores:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// GET /api/reports/game/:gameId/balls - Obtener historial de balotas
router.get('/game/:gameId/balls', (req: Request, res: Response) => {
  try {
    const gameId = parseInt(req.params.gameId as string, 10);
    const db = getDatabase();

    const balls = getBallHistory(db, gameId);
    db.close();

    res.json({ success: true, data: balls });
  } catch (error) {
    console.error('Error obteniendo historial:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// GET /api/reports/card/:cardId/wins - Obtener juegos donde un cartón ganó
router.get('/card/:cardId/wins', (req: Request, res: Response) => {
  try {
    const cardId = parseInt(req.params.cardId as string, 10);
    const db = getDatabase();

    const wins = getCardWins(db, cardId);
    db.close();

    res.json({ success: true, data: wins });
  } catch (error) {
    console.error('Error obteniendo victorias:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// GET /api/reports/event/:eventId/winners - Todos los ganadores de un evento
router.get('/event/:eventId/winners', (req: Request, res: Response) => {
  try {
    const eventId = parseInt(req.params.eventId as string, 10);
    const db = getDatabase();

    const winners = db.prepare(`
      SELECT gw.*, g.name as game_name, g.game_type
      FROM game_winners gw
      JOIN games g ON gw.game_id = g.id
      WHERE g.event_id = ?
      ORDER BY gw.won_at DESC
    `).all(eventId);

    db.close();

    res.json({ success: true, data: winners });
  } catch (error) {
    console.error('Error obteniendo ganadores del evento:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// GET /api/reports/recent-winners - Ganadores recientes
router.get('/recent-winners', (req: Request, res: Response) => {
  try {
    const limit = Math.min(50, parseInt(req.query.limit as string, 10) || 10);
    const db = getDatabase();

    const winners = db.prepare(`
      SELECT gw.*, g.name as game_name, g.game_type, e.name as event_name
      FROM game_winners gw
      JOIN games g ON gw.game_id = g.id
      JOIN events e ON g.event_id = e.id
      ORDER BY gw.won_at DESC
      LIMIT ?
    `).all(limit);

    db.close();

    res.json({ success: true, data: winners });
  } catch (error) {
    console.error('Error obteniendo ganadores recientes:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

export default router;
