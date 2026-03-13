import { Router } from 'express';
import type { Request, Response } from 'express';
import { getPool } from '../database/init.js';
import {
  loginUser,
  getAllUsers,
  createUser,
  updateUser,
  deleteUser,
  changePassword,
  getUserById,
} from '../services/authService.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import type { CreateUserRequest, UpdateUserRequest, UserRole } from '../types/auth.js';
import { ROLE_LABELS } from '../types/auth.js';

const router = Router();

// POST /api/auth/login - Iniciar sesión
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: 'Usuario y contraseña son requeridos',
      });
    }

    const pool = getPool();
    const result = await loginUser(pool, username, password);

    if (!result) {
      return res.status(401).json({
        success: false,
        error: 'Usuario o contraseña incorrectos',
      });
    }

    res.json({
      success: true,
      data: {
        token: result.token,
        user: result.user,
        expiresIn: 24 * 60 * 60, // 24 horas en segundos
      },
    });
  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// GET /api/auth/me - Obtener usuario actual
router.get('/me', authenticate, (req: Request, res: Response) => {
  res.json({
    success: true,
    data: req.user,
  });
});

// POST /api/auth/change-password - Cambiar contraseña propia
router.post('/change-password', authenticate, async (req: Request, res: Response) => {
  try {
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
      return res.status(400).json({
        success: false,
        error: 'Contraseña actual y nueva son requeridas',
      });
    }

    if (new_password.length < 8 || !/\d/.test(new_password) || !/[a-zA-Z]/.test(new_password)) {
      return res.status(400).json({
        success: false,
        error: 'La contraseña debe tener al menos 8 caracteres, incluir letras y numeros',
      });
    }

    const pool = getPool();
    const success = await changePassword(pool, req.user!.id, current_password, new_password);

    if (!success) {
      return res.status(400).json({
        success: false,
        error: 'La contraseña actual es incorrecta',
      });
    }

    res.json({
      success: true,
      message: 'Contraseña actualizada correctamente',
    });
  } catch (error) {
    console.error('Error cambiando contraseña:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =====================================================
// RUTAS DE GESTIÓN DE USUARIOS (SOLO ADMIN)
// =====================================================

// GET /api/auth/users - Listar usuarios
router.get('/users', authenticate, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const users = await getAllUsers(pool);

    res.json({ success: true, data: users });
  } catch (error) {
    console.error('Error listando usuarios:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// GET /api/auth/users/:id - Obtener usuario
router.get('/users/:id', authenticate, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const user = await getUserById(pool, parseInt(req.params.id as string, 10));

    if (!user) {
      return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
    }

    res.json({ success: true, data: user });
  } catch (error) {
    console.error('Error obteniendo usuario:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// POST /api/auth/users - Crear usuario
router.post('/users', authenticate, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const { username, password, email, full_name, role } = req.body as CreateUserRequest;

    if (!username || !password || !full_name || !role) {
      return res.status(400).json({
        success: false,
        error: 'Usuario, contraseña, nombre completo y rol son requeridos',
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'La contraseña debe tener al menos 6 caracteres',
      });
    }

    const validRoles: UserRole[] = ['admin', 'moderator', 'seller', 'viewer', 'inventory'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        error: 'Rol inválido',
      });
    }

    const pool = getPool();
    const user = await createUser(pool, { username, password, email, full_name, role });

    res.status(201).json({ success: true, data: user });
  } catch (error) {
    console.error('Error creando usuario:', error);
    const message = (error as Error).message;
    if (message.includes('ya existe') || message.includes('ya está registrado')) {
      return res.status(400).json({ success: false, error: message });
    }
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// PUT /api/auth/users/:id - Actualizar usuario
router.put('/users/:id', authenticate, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.id as string, 10);
    const { email, full_name, role, is_active, password } = req.body as UpdateUserRequest;

    // No permitir desactivar el propio usuario admin
    if (is_active === false && req.user!.id === userId) {
      return res.status(400).json({
        success: false,
        error: 'No puedes desactivar tu propia cuenta',
      });
    }

    if (role) {
      const validRoles: UserRole[] = ['admin', 'moderator', 'seller', 'viewer', 'inventory'];
      if (!validRoles.includes(role)) {
        return res.status(400).json({
          success: false,
          error: 'Rol inválido',
        });
      }
    }

    if (password && password.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'La contraseña debe tener al menos 6 caracteres',
      });
    }

    const pool = getPool();
    const user = await updateUser(pool, userId, { email, full_name, role, is_active, password });

    if (!user) {
      return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
    }

    res.json({ success: true, data: user });
  } catch (error) {
    console.error('Error actualizando usuario:', error);
    const message = (error as Error).message;
    if (message.includes('ya está registrado')) {
      return res.status(400).json({ success: false, error: message });
    }
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// DELETE /api/auth/users/:id - Eliminar usuario
router.delete('/users/:id', authenticate, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.id as string, 10);

    // No permitir eliminar el propio usuario
    if (req.user!.id === userId) {
      return res.status(400).json({
        success: false,
        error: 'No puedes eliminar tu propia cuenta',
      });
    }

    const pool = getPool();
    const success = await deleteUser(pool, userId);

    if (!success) {
      return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
    }

    res.json({ success: true, message: 'Usuario eliminado' });
  } catch (error) {
    console.error('Error eliminando usuario:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// GET /api/auth/roles - Listar roles disponibles
router.get('/roles', authenticate, (req: Request, res: Response) => {
  res.json({
    success: true,
    data: ROLE_LABELS,
  });
});

export default router;
