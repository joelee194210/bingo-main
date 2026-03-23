import { Router } from 'express';
import type { Request, Response } from 'express';
import { getPool } from '../database/init.js';
import { createUser, updateUser, validatePassword } from '../services/authService.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import type { UserRole } from '../types/auth.js';
import { logActivity, getClientIp } from '../services/auditService.js';

const router = Router();

// Roles que un loterista puede asignar a sus sub-usuarios
const SUB_USER_ROLES: UserRole[] = ['seller', 'inventory', 'viewer'];

// GET /api/mis-usuarios — listar sub-usuarios propios
router.get('/', authenticate, requirePermission('sub_users:manage'), async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const result = await pool.query(
      `SELECT id, username, email, full_name, role, is_active, last_login, created_at
       FROM users WHERE created_by = $1 ORDER BY created_at DESC`,
      [req.user!.id]
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Error listando sub-usuarios:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// POST /api/mis-usuarios — crear sub-usuario
router.post('/', authenticate, requirePermission('sub_users:manage'), async (req: Request, res: Response) => {
  try {
    const { username, password, email, full_name, role } = req.body;

    if (!username || !password || !full_name || !role) {
      return res.status(400).json({ success: false, error: 'Usuario, contraseña, nombre completo y rol son requeridos' });
    }

    const pwError = validatePassword(password);
    if (pwError) {
      return res.status(400).json({ success: false, error: pwError });
    }

    if (!SUB_USER_ROLES.includes(role)) {
      return res.status(400).json({ success: false, error: `Rol inválido. Roles permitidos: ${SUB_USER_ROLES.join(', ')}` });
    }

    const pool = getPool();
    const user = await createUser(pool, { username, password, email, full_name, role });

    // Marcar como sub-usuario de este loterista
    await pool.query('UPDATE users SET created_by = $1 WHERE id = $2', [req.user!.id, user.id]);

    logActivity(pool, {
      userId: req.user!.id,
      username: req.user!.username,
      action: 'sub_user_created',
      category: 'users',
      details: { created_user: username, role },
      ipAddress: getClientIp(req),
    });

    res.status(201).json({ success: true, data: { ...user, created_by: req.user!.id } });
  } catch (error) {
    console.error('Error creando sub-usuario:', error);
    const message = (error as Error).message;
    if (message.includes('ya existe') || message.includes('ya está registrado')) {
      return res.status(400).json({ success: false, error: message });
    }
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// PUT /api/mis-usuarios/:id — actualizar sub-usuario propio
router.put('/:id', authenticate, requirePermission('sub_users:manage'), async (req: Request, res: Response) => {
  try {
    const subUserId = parseInt(req.params.id as string, 10);
    const pool = getPool();

    // Verificar que es sub-usuario de este loterista
    const check = await pool.query('SELECT id FROM users WHERE id = $1 AND created_by = $2', [subUserId, req.user!.id]);
    if (check.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
    }

    const { email, full_name, role, is_active, password } = req.body;

    if (role && !SUB_USER_ROLES.includes(role)) {
      return res.status(400).json({ success: false, error: `Rol inválido. Roles permitidos: ${SUB_USER_ROLES.join(', ')}` });
    }

    if (password) {
      const pwError = validatePassword(password);
      if (pwError) return res.status(400).json({ success: false, error: pwError });
    }

    const user = await updateUser(pool, subUserId, { email, full_name, role, is_active, password });

    logActivity(pool, {
      userId: req.user!.id,
      username: req.user!.username,
      action: 'sub_user_updated',
      category: 'users',
      details: { updated_user_id: subUserId, changes: { email, full_name, role, is_active } },
      ipAddress: getClientIp(req),
    });

    res.json({ success: true, data: user });
  } catch (error) {
    console.error('Error actualizando sub-usuario:', error);
    const message = (error as Error).message;
    if (message.includes('ya está registrado')) {
      return res.status(400).json({ success: false, error: message });
    }
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// DELETE /api/mis-usuarios/:id — eliminar sub-usuario propio
router.delete('/:id', authenticate, requirePermission('sub_users:manage'), async (req: Request, res: Response) => {
  try {
    const subUserId = parseInt(req.params.id as string, 10);
    const pool = getPool();

    // Verificar que es sub-usuario de este loterista
    const check = await pool.query('SELECT id, username FROM users WHERE id = $1 AND created_by = $2', [subUserId, req.user!.id]);
    if (check.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
    }

    await pool.query('DELETE FROM users WHERE id = $1', [subUserId]);

    logActivity(pool, {
      userId: req.user!.id,
      username: req.user!.username,
      action: 'sub_user_deleted',
      category: 'users',
      details: { deleted_user: check.rows[0].username },
      ipAddress: getClientIp(req),
    });

    res.json({ success: true, message: 'Usuario eliminado' });
  } catch (error) {
    console.error('Error eliminando sub-usuario:', error);
    const code = (error as any)?.code;
    if (code === '23503') {
      return res.status(409).json({ success: false, error: 'No se puede eliminar el usuario porque tiene registros asociados. Desactivalo en su lugar.' });
    }
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

export default router;
