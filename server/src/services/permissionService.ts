import type { Pool } from 'pg';
import { ROLE_PERMISSIONS } from '../types/auth.js';

// Cache en memoria: role → set de permisos activos
const permissionCache = new Map<string, Set<string>>();

// Todos los permisos posibles del sistema (incluye los nuevos)
const ALL_PERMISSIONS = [
  'users:read', 'users:create', 'users:update', 'users:delete',
  'events:read', 'events:create', 'events:update', 'events:delete',
  'cards:read', 'cards:create', 'cards:sell', 'cards:export',
  'games:read', 'games:create', 'games:play', 'games:finish',
  'reports:read', 'reports:export',
  'inventory:read', 'inventory:sell', 'inventory:move', 'inventory:dashboard', 'inventory:users', 'inventory:manage',
  'loteria:dashboard',
  'dashboard:read',
  'permissions:manage',
  'audit:read',
  'sub_users:manage',
];

// Permisos default extendidos (agrega los nuevos al hardcodeado)
function getDefaultPermissions(): Record<string, string[]> {
  return {
    ...ROLE_PERMISSIONS,
    admin: [...ROLE_PERMISSIONS.admin, 'permissions:manage', 'audit:read'],
    moderator: [...ROLE_PERMISSIONS.moderator, 'audit:read'],
  };
}

/**
 * Inicializa el cache de permisos: carga defaults + overrides de BD
 */
export async function initPermissions(pool: Pool): Promise<void> {
  const defaults = getDefaultPermissions();

  // Inicializar cache con defaults
  for (const [role, perms] of Object.entries(defaults)) {
    permissionCache.set(role, new Set(perms));
  }

  // Aplicar overrides de BD
  try {
    const result = await pool.query('SELECT role, permission, granted FROM role_permissions');
    for (const row of result.rows) {
      let perms = permissionCache.get(row.role);
      if (!perms) {
        perms = new Set();
        permissionCache.set(row.role, perms);
      }
      if (row.granted) {
        perms.add(row.permission);
      } else {
        perms.delete(row.permission);
      }
    }
  } catch (err) {
    // Si la tabla no existe aún, continuar con defaults
    console.warn('No se pudieron cargar overrides de permisos:', (err as Error).message);
  }

  console.log('✅ Cache de permisos inicializado');
}

/**
 * Verifica si un rol tiene un permiso
 */
export function hasPermission(role: string, permission: string): boolean {
  const perms = permissionCache.get(role);
  if (!perms) return false;
  return perms.has(permission);
}

/**
 * Retorna la lista de permisos de un rol
 */
export function getPermissionsForRole(role: string): string[] {
  const perms = permissionCache.get(role);
  return perms ? Array.from(perms) : [];
}

/**
 * Retorna la matriz completa de roles/permisos
 */
export function getFullMatrix(): Record<string, Record<string, boolean>> {
  const roles = Object.keys(getDefaultPermissions());
  const matrix: Record<string, Record<string, boolean>> = {};

  for (const role of roles) {
    matrix[role] = {};
    const perms = permissionCache.get(role) || new Set();
    for (const perm of ALL_PERMISSIONS) {
      matrix[role][perm] = perms.has(perm);
    }
  }

  return matrix;
}

/**
 * Actualiza un permiso para un rol en BD e invalida cache
 */
export async function setPermission(
  pool: Pool,
  role: string,
  permission: string,
  granted: boolean,
  updatedBy: number
): Promise<void> {
  // Prevenir lockout: no quitar permissions:manage de admin
  if (role === 'admin' && permission === 'permissions:manage' && !granted) {
    throw new Error('No se puede quitar el permiso permissions:manage del rol admin');
  }

  await pool.query(
    `INSERT INTO role_permissions (role, permission, granted, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (role, permission) DO UPDATE SET granted = $3, updated_by = $4, updated_at = NOW()`,
    [role, permission, granted, updatedBy]
  );

  // Actualizar cache inmediatamente
  await invalidateCache(pool);
}

/**
 * Recarga el cache desde BD
 */
export async function invalidateCache(pool: Pool): Promise<void> {
  await initPermissions(pool);
}

/**
 * Retorna la lista de todos los permisos disponibles en el sistema
 */
export function getAllPermissions(): string[] {
  return [...ALL_PERMISSIONS];
}

/**
 * Retorna las etiquetas de los roles
 */
export function getRoles(): string[] {
  return Object.keys(getDefaultPermissions());
}
