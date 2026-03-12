// Tipos para autenticación y usuarios

export type UserRole = 'admin' | 'moderator' | 'seller' | 'viewer' | 'inventory';

export interface User {
  id: number;
  username: string;
  email: string | null;
  password_hash: string;
  full_name: string;
  role: UserRole;
  is_active: boolean;
  last_login: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserPublic {
  id: number;
  username: string;
  email: string | null;
  full_name: string;
  role: UserRole;
  is_active: boolean;
  last_login: string | null;
  created_at: string;
}

export interface JWTPayload {
  userId: number;
  username: string;
  role: UserRole;
  iat?: number;
  exp?: number;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  user: UserPublic;
  expiresIn: number;
}

export interface CreateUserRequest {
  username: string;
  password: string;
  email?: string;
  full_name: string;
  role: UserRole;
}

export interface UpdateUserRequest {
  email?: string;
  full_name?: string;
  role?: UserRole;
  is_active?: boolean;
  password?: string;
}

// Permisos por rol
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

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrador',
  moderator: 'Moderador',
  seller: 'Vendedor',
  viewer: 'Visor',
  inventory: 'Inventario',
};
