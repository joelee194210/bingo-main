import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';
import type { Pool } from 'pg';
import type { User, UserPublic, JWTPayload, CreateUserRequest, UpdateUserRequest } from '../types/auth.js';

// Clave secreta para JWT
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET debe estar configurado en producción');
  }
  console.warn('⚠️  JWT_SECRET no configurado. Usando clave por defecto (NO usar en producción).');
}
const EFFECTIVE_JWT_SECRET = JWT_SECRET || randomBytes(32).toString('hex');
const JWT_EXPIRES_IN = '24h';
const SALT_ROUNDS = 12;

/**
 * Valida fortaleza de contraseña: mínimo 8 chars, letras y números
 */
export function validatePassword(password: string): string | null {
  if (!password || password.length < 8) return 'La contraseña debe tener al menos 8 caracteres';
  if (!/[a-zA-Z]/.test(password)) return 'La contraseña debe incluir al menos una letra';
  if (!/\d/.test(password)) return 'La contraseña debe incluir al menos un número';
  return null;
}

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
    is_active: user.is_active,
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
  pool: Pool,
  username: string,
  password: string
): Promise<{ token: string; user: UserPublic } | null> {
  const userResult = await pool.query(
    'SELECT * FROM users WHERE username = $1 AND is_active = true', [username]
  );
  const user = userResult.rows[0] as User | undefined;

  if (!user) {
    return null;
  }

  const isValid = await verifyPassword(password, user.password_hash);
  if (!isValid) {
    return null;
  }

  // Actualizar last_login
  await pool.query('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1', [user.id]);

  const token = generateToken(user);

  return {
    token,
    user: toUserPublic(user),
  };
}

/**
 * Obtener usuario por ID
 */
export async function getUserById(pool: Pool, userId: number): Promise<UserPublic | null> {
  const result = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
  const user = result.rows[0] as User | undefined;
  return user ? toUserPublic(user) : null;
}

/**
 * Obtener usuario por username
 */
export async function getUserByUsername(pool: Pool, username: string): Promise<UserPublic | null> {
  const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
  const user = result.rows[0] as User | undefined;
  return user ? toUserPublic(user) : null;
}

/**
 * Listar todos los usuarios
 */
export async function getAllUsers(pool: Pool): Promise<UserPublic[]> {
  const result = await pool.query('SELECT * FROM users ORDER BY created_at DESC');
  const users = result.rows as User[];
  return users.map(toUserPublic);
}

/**
 * Crear nuevo usuario
 */
export async function createUser(
  pool: Pool,
  data: CreateUserRequest
): Promise<UserPublic> {
  // Verificar username único
  const existingResult = await pool.query('SELECT id FROM users WHERE username = $1', [data.username]);
  if (existingResult.rows[0]) {
    throw new Error('El nombre de usuario ya existe');
  }

  // Verificar email único si se proporciona
  if (data.email) {
    const existingEmailResult = await pool.query('SELECT id FROM users WHERE email = $1', [data.email]);
    if (existingEmailResult.rows[0]) {
      throw new Error('El email ya está registrado');
    }
  }

  const passwordHash = await hashPassword(data.password);

  const result = await pool.query(`
    INSERT INTO users (username, email, password_hash, full_name, role)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id
  `, [data.username, data.email || null, passwordHash, data.full_name, data.role]);

  const newUserId = result.rows[0].id;
  const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [newUserId]);
  const user = userResult.rows[0] as User;
  return toUserPublic(user);
}

/**
 * Actualizar usuario
 */
export async function updateUser(
  pool: Pool,
  userId: number,
  data: UpdateUserRequest
): Promise<UserPublic | null> {
  const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
  const user = userResult.rows[0] as User | undefined;
  if (!user) {
    return null;
  }

  const updates: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (data.email !== undefined) {
    // Verificar email único
    if (data.email) {
      const existing = await pool.query('SELECT id FROM users WHERE email = $1 AND id != $2', [data.email, userId]);
      if (existing.rows[0]) {
        throw new Error('El email ya está registrado');
      }
    }
    updates.push(`email = $${paramIndex++}`);
    values.push(data.email || null);
  }

  if (data.full_name !== undefined) {
    updates.push(`full_name = $${paramIndex++}`);
    values.push(data.full_name);
  }

  if (data.role !== undefined) {
    updates.push(`role = $${paramIndex++}`);
    values.push(data.role);
  }

  if (data.is_active !== undefined) {
    updates.push(`is_active = $${paramIndex++}`);
    values.push(data.is_active);
  }

  if (data.password !== undefined && data.password.length > 0) {
    const passwordHash = await hashPassword(data.password);
    updates.push(`password_hash = $${paramIndex++}`);
    values.push(passwordHash);
  }

  if (updates.length > 0) {
    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(userId);
    await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIndex}`, values);
  }

  return getUserById(pool, userId);
}

/**
 * Eliminar usuario
 */
export async function deleteUser(pool: Pool, userId: number): Promise<boolean> {
  const result = await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  return (result.rowCount ?? 0) > 0;
}

/**
 * Cambiar contraseña
 */
export async function changePassword(
  pool: Pool,
  userId: number,
  currentPassword: string,
  newPassword: string
): Promise<boolean> {
  const result = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
  const user = result.rows[0] as User | undefined;
  if (!user) {
    return false;
  }

  const isValid = await verifyPassword(currentPassword, user.password_hash);
  if (!isValid) {
    return false;
  }

  const newHash = await hashPassword(newPassword);
  await pool.query(
    'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
    [newHash, userId]
  );

  return true;
}

/**
 * Crear usuario admin por defecto si no existe ningún usuario
 */
export async function ensureAdminExists(pool: Pool): Promise<void> {
  const countResult = await pool.query('SELECT COUNT(*) as count FROM users');
  const count = countResult.rows[0] as { count: string };

  if (parseInt(count.count, 10) === 0) {
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!adminPassword) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('ADMIN_PASSWORD debe estar configurado en producción');
      }
      console.warn('⚠️  ADMIN_PASSWORD no configurado. Usando contraseña por defecto (NO usar en producción).');
    }
    const finalPassword = adminPassword || (process.env.NODE_ENV === 'production' ? undefined : 'Admin123!dev');
    if (!finalPassword) throw new Error('ADMIN_PASSWORD requerido en producción');
    console.log('🔐 Creando usuario administrador por defecto...');
    await createUser(pool, {
      username: 'admin',
      password: finalPassword,
      full_name: 'Administrador',
      role: 'admin',
    });
    console.log('✅ Usuario admin creado (usuario: admin)');
  }
}
