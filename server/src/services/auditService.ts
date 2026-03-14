import type { Pool } from 'pg';
import type { Request } from 'express';

interface LogActivityParams {
  userId?: number;
  username?: string;
  action: string;
  category: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
}

/**
 * Registra actividad en el log de auditoría (fire-and-forget)
 */
export function logActivity(pool: Pool, params: LogActivityParams): void {
  const { userId, username, action, category, details, ipAddress } = params;
  pool.query(
    `INSERT INTO activity_log (user_id, username, action, category, details, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId || null, username || null, action, category, details || {}, ipAddress || null]
  ).catch((err) => {
    console.error('Error registrando actividad:', err);
  });
}

/**
 * Extrae la IP del cliente desde headers o req.ip
 */
export function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || 'unknown';
}

/**
 * Helper que crea los params de auditoría desde un request autenticado
 */
export function auditFromReq(req: Request, action: string, category: string, details?: Record<string, unknown>): LogActivityParams {
  return {
    userId: req.user?.id,
    username: req.user?.username || req.user?.full_name,
    action,
    category,
    details,
    ipAddress: getClientIp(req),
  };
}
