import { Router } from 'express';
import type { Request, Response } from 'express';
import { getDatabase } from '../database/init.js';
import type { DashboardStats, BingoEvent, BingoGame } from '../types/index.js';

const router = Router();

// GET /api/dashboard - Estadísticas generales
router.get('/', (_req: Request, res: Response) => {
  try {
    const db = getDatabase();

    // Estadísticas de eventos
    const eventStats = db.prepare(`
      SELECT
        COUNT(*) as total_events,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_events
      FROM events
    `).get() as { total_events: number; active_events: number };

    // Estadísticas de cartones
    const cardStats = db.prepare(`
      SELECT
        COUNT(*) as total_cards,
        SUM(CASE WHEN is_sold = 1 THEN 1 ELSE 0 END) as total_cards_sold
      FROM cards
    `).get() as { total_cards: number; total_cards_sold: number };

    // Estadísticas de juegos
    const gameStats = db.prepare(`
      SELECT COUNT(*) as total_games_played
      FROM games WHERE status = 'completed'
    `).get() as { total_games_played: number };

    // Eventos recientes
    const recentEvents = db.prepare(`
      SELECT * FROM events ORDER BY created_at DESC LIMIT 5
    `).all() as BingoEvent[];

    // Juegos recientes
    const recentGames = db.prepare(`
      SELECT g.*, e.name as event_name
      FROM games g
      JOIN events e ON g.event_id = e.id
      ORDER BY g.created_at DESC LIMIT 5
    `).all() as (BingoGame & { event_name: string })[];

    db.close();

    const stats: DashboardStats = {
      total_events: eventStats.total_events || 0,
      active_events: eventStats.active_events || 0,
      total_cards: cardStats.total_cards || 0,
      total_cards_sold: cardStats.total_cards_sold || 0,
      total_games_played: gameStats.total_games_played || 0,
      recent_events: recentEvents,
      recent_games: recentGames,
    };

    res.json({ success: true, data: stats });
  } catch (error) {
    console.error('Error obteniendo dashboard:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// GET /api/dashboard/chart-data - Datos para gráficos
router.get('/chart-data', (req: Request, res: Response) => {
  try {
    const { days = '7' } = req.query;
    const daysNum = Math.min(30, Math.max(1, parseInt(days as string, 10) || 7));

    const db = getDatabase();

    // Cartones generados por día (usando parámetro bind en vez de interpolación)
    const cardsPerDay = db.prepare(`
      SELECT DATE(created_at) as date, COUNT(*) as count
      FROM cards
      WHERE created_at >= DATE('now', '-' || ? || ' days')
      GROUP BY DATE(created_at)
      ORDER BY date
    `).all(daysNum) as Array<{ date: string; count: number }>;

    // Juegos por día
    const gamesPerDay = db.prepare(`
      SELECT DATE(created_at) as date, COUNT(*) as count
      FROM games
      WHERE created_at >= DATE('now', '-' || ? || ' days')
      GROUP BY DATE(created_at)
      ORDER BY date
    `).all(daysNum) as Array<{ date: string; count: number }>;

    // Distribución por tipo de juego
    const gameTypeDistribution = db.prepare(`
      SELECT game_type, COUNT(*) as count
      FROM games
      GROUP BY game_type
    `).all() as Array<{ game_type: string; count: number }>;

    db.close();

    res.json({
      success: true,
      data: {
        cardsPerDay,
        gamesPerDay,
        gameTypeDistribution,
      },
    });
  } catch (error) {
    console.error('Error obteniendo chart data:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

export default router;
