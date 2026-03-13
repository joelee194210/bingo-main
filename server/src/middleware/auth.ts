import type { Request, Response, NextFunction } from 'express';
import { verifyToken, getUserById } from '../services/authService.js';
import { getPool } from '../database/init.js';
import type { JWTPayload, UserRole, UserPublic } from '../types/auth.js';
import { ROLE_PERMISSIONS } from '../types/auth.js';

// Extender Request para incluir usuario autenticado
declare global {
  namespace Express {
    interface Request {
      user?: UserPublic;
      jwtPayload?: JWTPayload;
    }
  }
}

/**
 * Middleware para autenticar token JWT
 */
export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  // M10: leer token de cookie httpOnly o header Authorization
  let token: string | undefined;
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else if (req.cookies?.bingo_token) {
    token = req.cookies.bingo_token;
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Token de autenticación requerido',
    });
  }
  const payload = verifyToken(token);

  if (!payload) {
    return res.status(401).json({
      success: false,
      error: 'Token inválido o expirado',
    });
  }

  // Obtener usuario actualizado de la BD
  const pool = getPool();
  const user = await getUserById(pool, payload.userId);

  if (!user || !user.is_active) {
    return res.status(401).json({
      success: false,
      error: 'Usuario no encontrado o desactivado',
    });
  }

  req.user = user;
  req.jwtPayload = payload;
  next();
}

/**
 * Middleware para verificar rol mínimo requerido
 */
export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'No autenticado',
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: 'No tienes permisos para realizar esta acción',
      });
    }

    next();
  };
}

/**
 * Middleware para verificar permiso específico
 */
export function requirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'No autenticado',
      });
    }

    const userPermissions = ROLE_PERMISSIONS[req.user.role];
    if (!userPermissions.includes(permission)) {
      return res.status(403).json({
        success: false,
        error: 'No tienes permisos para realizar esta acción',
      });
    }

    next();
  };
}

/**
 * Middleware opcional de autenticación (no falla si no hay token)
 */
export async function optionalAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  let token: string | undefined;
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else if (req.cookies?.bingo_token) {
    token = req.cookies.bingo_token;
  }

  if (!token) {
    return next();
  }

  const payload = verifyToken(token);

  if (payload) {
    const pool = getPool();
    const user = await getUserById(pool, payload.userId);

    if (user && user.is_active) {
      req.user = user;
      req.jwtPayload = payload;
    }
  }

  next();
}

/**
 * Verificar si el usuario es admin
 */
export function isAdmin(req: Request): boolean {
  return req.user?.role === 'admin';
}

/**
 * Verificar si el usuario es admin o moderador
 */
export function isAdminOrModerator(req: Request): boolean {
  return req.user?.role === 'admin' || req.user?.role === 'moderator';
}

/**
 * Verificar si el usuario puede vender cartones
 */
export function canSellCards(req: Request): boolean {
  const role = req.user?.role;
  return role === 'admin' || role === 'moderator' || role === 'seller';
}
