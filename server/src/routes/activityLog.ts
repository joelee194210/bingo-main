import { Router } from 'express';
import type { Request, Response } from 'express';
import { getPool } from '../database/init.js';
import { requirePermission } from '../middleware/auth.js';

const router = Router();

// GET /api/activity-log — Log de actividad con filtros y paginación
router.get('/', requirePermission('audit:read'), async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (req.query.category) {
      conditions.push(`category = $${paramIdx++}`);
      params.push(req.query.category);
    }
    if (req.query.userId) {
      conditions.push(`user_id = $${paramIdx++}`);
      params.push(parseInt(req.query.userId as string));
    }
    if (req.query.action) {
      conditions.push(`action ILIKE $${paramIdx++}`);
      params.push(`%${req.query.action}%`);
    }
    if (req.query.from) {
      conditions.push(`created_at >= $${paramIdx++}`);
      params.push(req.query.from);
    }
    if (req.query.to) {
      conditions.push(`created_at <= $${paramIdx++}`);
      params.push(req.query.to);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(
      `SELECT COUNT(*) as total FROM activity_log ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0].total);

    const dataParams = [...params, limit, offset];
    const rows = await pool.query(
      `SELECT * FROM activity_log ${where} ORDER BY created_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx}`,
      dataParams
    );

    res.json({
      success: true,
      data: rows.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Error obteniendo activity log:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// GET /api/activity-log/stats — Estadísticas de actividad
router.get('/stats', requirePermission('audit:read'), async (req: Request, res: Response) => {
  try {
    const pool = getPool();

    const [byCategory, topUsers, recentCount] = await Promise.all([
      pool.query(
        `SELECT category, COUNT(*) as count FROM activity_log
         WHERE created_at >= NOW() - INTERVAL '30 days'
         GROUP BY category ORDER BY count DESC`
      ),
      pool.query(
        `SELECT user_id, username, COUNT(*) as count FROM activity_log
         WHERE created_at >= NOW() - INTERVAL '30 days' AND user_id IS NOT NULL
         GROUP BY user_id, username ORDER BY count DESC LIMIT 10`
      ),
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') as last_24h,
           COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') as last_7d,
           COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') as last_30d
         FROM activity_log`
      ),
    ]);

    res.json({
      success: true,
      data: {
        byCategory: byCategory.rows,
        topUsers: topUsers.rows,
        counts: recentCount.rows[0],
      },
    });
  } catch (error) {
    console.error('Error obteniendo stats de actividad:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

export default router;
