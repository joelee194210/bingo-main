// Tipos para autenticación en el frontend

export type UserRole = 'admin' | 'moderator' | 'seller' | 'viewer' | 'inventory';

export interface User {
  id: number;
  username: string;
  email: string | null;
  full_name: string;
  role: UserRole;
  is_active: boolean;
  last_login: string | null;
  created_at: string;
}

export interface LoginResponse {
  token: string;
  user: User;
  expiresIn: number;
}

export interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrador',
  moderator: 'Moderador',
  seller: 'Vendedor',
  viewer: 'Visor',
  inventory: 'Inventario',
};

export const ROLE_COLORS: Record<UserRole, string> = {
  admin: 'bg-red-100 text-red-700',
  moderator: 'bg-blue-100 text-blue-700',
  seller: 'bg-green-100 text-green-700',
  viewer: 'bg-gray-100 text-gray-700',
  inventory: 'bg-purple-100 text-purple-700',
};

// Permisos por rol (para verificación en frontend)
export const ROLE_PERMISSIONS: Record<UserRole, string[]> = {
  admin: [
    'users:read', 'users:create', 'users:update', 'users:delete',
    'events:read', 'events:create', 'events:update', 'events:delete',
    'cards:read', 'cards:create', 'cards:sell', 'cards:export',
    'games:read', 'games:create', 'games:play', 'games:finish',
    'reports:read', 'reports:export',
    'inventory:read', 'inventory:manage',
    'dashboard:read',
  ],
  moderator: [
    'events:read',
    'cards:read', 'cards:sell',
    'games:read', 'games:create', 'games:play', 'games:finish',
    'reports:read',
    'inventory:read', 'inventory:manage',
    'dashboard:read',
  ],
  seller: [
    'events:read',
    'cards:read', 'cards:sell',
    'games:read',
    'inventory:read',
    'dashboard:read',
  ],
  viewer: [
    'events:read',
    'cards:read',
    'games:read',
    'reports:read',
    'inventory:read',
    'dashboard:read',
  ],
  inventory: [
    'inventory:read',
    'inventory:manage',
    'dashboard:read',
  ],
};

export function hasPermission(role: UserRole, permission: string): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}
