import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type Database from 'better-sqlite3';
import type { User, UserPublic, JWTPayload, UserRole, CreateUserRequest, UpdateUserRequest } from '../types/auth.js';

// Clave secreta para JWT
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.warn('⚠️  JWT_SECRET no configurado. Usando clave por defecto (NO usar en producción).');
}
const EFFECTIVE_JWT_SECRET = JWT_SECRET || 'bingo-dev-secret-local-only';
const JWT_EXPIRES_IN = '24h';
const SALT_ROUNDS = 10;

/**
 * Convierte un usuario de BD a formato público (sin password_hash)
 */
export function toUserPublic(user: User): UserPublic {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    full_name: user.full_name,
    role: user.role,
    is_active: user.is_active === 1,
    last_login: user.last_login,
    created_at: user.created_at,
  };
}

/**
 * Hash de contraseña con bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * Verificar contraseña
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Generar token JWT
 */
export function generateToken(user: User): string {
  const payload: JWTPayload = {
    userId: user.id,
    username: user.username,
    role: user.role,
  };

  return jwt.sign(payload, EFFECTIVE_JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

/**
 * Verificar y decodificar token JWT
 */
export function verifyToken(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, EFFECTIVE_JWT_SECRET) as JWTPayload;
  } catch {
    return null;
  }
}

/**
 * Login de usuario
 */
export async function loginUser(
  db: Database.Database,
  username: string,
  password: string
): Promise<{ token: string; user: UserPublic } | null> {
  const user = db.prepare(
    'SELECT * FROM users WHERE username = ? AND is_active = 1'
  ).get(username) as User | undefined;

  if (!user) {
    return null;
  }

  const isValid = await verifyPassword(password, user.password_hash);
  if (!isValid) {
    return null;
  }

  // Actualizar last_login
  db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);

  const token = generateToken(user);

  return {
    token,
    user: toUserPublic(user),
  };
}

/**
 * Obtener usuario por ID
 */
export function getUserById(db: Database.Database, userId: number): UserPublic | null {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as User | undefined;
  return user ? toUserPublic(user) : null;
}

/**
 * Obtener usuario por username
 */
export function getUserByUsername(db: Database.Database, username: string): UserPublic | null {
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as User | undefined;
  return user ? toUserPublic(user) : null;
}

/**
 * Listar todos los usuarios
 */
export function getAllUsers(db: Database.Database): UserPublic[] {
  const users = db.prepare('SELECT * FROM users ORDER BY created_at DESC').all() as User[];
  return users.map(toUserPublic);
}

/**
 * Crear nuevo usuario
 */
export async function createUser(
  db: Database.Database,
  data: CreateUserRequest
): Promise<UserPublic> {
  // Verificar username único
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(data.username);
  if (existing) {
    throw new Error('El nombre de usuario ya existe');
  }

  // Verificar email único si se proporciona
  if (data.email) {
    const existingEmail = db.prepare('SELECT id FROM users WHERE email = ?').get(data.email);
    if (existingEmail) {
      throw new Error('El email ya está registrado');
    }
  }

  const passwordHash = await hashPassword(data.password);

  const result = db.prepare(`
    INSERT INTO users (username, email, password_hash, full_name, role)
    VALUES (?, ?, ?, ?, ?)
  `).run(data.username, data.email || null, passwordHash, data.full_name, data.role);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid) as User;
  return toUserPublic(user);
}

/**
 * Actualizar usuario
 */
export async function updateUser(
  db: Database.Database,
  userId: number,
  data: UpdateUserRequest
): Promise<UserPublic | null> {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as User | undefined;
  if (!user) {
    return null;
  }

  const updates: string[] = [];
  const values: unknown[] = [];

  if (data.email !== undefined) {
    // Verificar email único
    if (data.email) {
      const existing = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(data.email, userId);
      if (existing) {
        throw new Error('El email ya está registrado');
      }
    }
    updates.push('email = ?');
    values.push(data.email || null);
  }

  if (data.full_name !== undefined) {
    updates.push('full_name = ?');
    values.push(data.full_name);
  }

  if (data.role !== undefined) {
    updates.push('role = ?');
    values.push(data.role);
  }

  if (data.is_active !== undefined) {
    updates.push('is_active = ?');
    values.push(data.is_active ? 1 : 0);
  }

  if (data.password !== undefined && data.password.length > 0) {
    const passwordHash = await hashPassword(data.password);
    updates.push('password_hash = ?');
    values.push(passwordHash);
  }

  if (updates.length > 0) {
    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(userId);
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  }

  return getUserById(db, userId);
}

/**
 * Eliminar usuario
 */
export function deleteUser(db: Database.Database, userId: number): boolean {
  const result = db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  return result.changes > 0;
}

/**
 * Cambiar contraseña
 */
export async function changePassword(
  db: Database.Database,
  userId: number,
  currentPassword: string,
  newPassword: string
): Promise<boolean> {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as User | undefined;
  if (!user) {
    return false;
  }

  const isValid = await verifyPassword(currentPassword, user.password_hash);
  if (!isValid) {
    return false;
  }

  const newHash = await hashPassword(newPassword);
  db.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(newHash, userId);

  return true;
}

/**
 * Crear usuario admin por defecto si no existe ningún usuario
 */
export async function ensureAdminExists(db: Database.Database): Promise<void> {
  const count = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };

  if (count.count === 0) {
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
    console.log('🔐 Creando usuario administrador por defecto...');
    await createUser(db, {
      username: 'admin',
      password: adminPassword,
      full_name: 'Administrador',
      role: 'admin',
    });
    console.log('✅ Usuario admin creado (usuario: admin)');
    if (!process.env.ADMIN_PASSWORD) {
      console.log('⚠️  IMPORTANTE: Establece ADMIN_PASSWORD en las variables de entorno. Usando contraseña por defecto.');
    }
  }
}
