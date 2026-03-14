import { Router } from 'express';
import type { Request, Response } from 'express';
import { getPool } from '../database/init.js';
import { requirePermission } from '../middleware/auth.js';
import {
  getFullMatrix,
  setPermission,
  getPermissionsForRole,
  getAllPermissions,
  getRoles,
} from '../services/permissionService.js';
import { logActivity, auditFromReq } from '../services/auditService.js';

const router = Router();

// GET /api/permissions/matrix — Matriz completa de roles/permisos
router.get('/matrix', requirePermission('permissions:manage'), (_req: Request, res: Response) => {
  const matrix = getFullMatrix();
  const permissions = getAllPermissions();
  const roles = getRoles();
  res.json({ success: true, data: { matrix, permissions, roles } });
});

// PUT /api/permissions/role/:role — Actualizar permiso de un rol
router.put('/role/:role', requirePermission('permissions:manage'), async (req: Request, res: Response) => {
  try {
    const role = req.params.role as string;
    const { permission, granted } = req.body;

    if (!permission || typeof granted !== 'boolean') {
      return res.status(400).json({ success: false, error: 'permission y granted son requeridos' });
    }

    const pool = getPool();
    await setPermission(pool, role, permission as string, granted, req.user!.id);

    logActivity(pool, auditFromReq(req, 'permission_changed', 'permissions', {
      role,
      permission,
      granted,
    }));

    res.json({ success: true, message: 'Permiso actualizado' });
  } catch (error) {
    const message = (error as Error).message;
    if (message.includes('permissions:manage')) {
      return res.status(400).json({ success: false, error: message });
    }
    console.error('Error actualizando permiso:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// GET /api/permissions/my — Permisos del usuario actual
router.get('/my', (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ success: false, error: 'No autenticado' });
  }
  const permissions = getPermissionsForRole(req.user.role);
  res.json({ success: true, data: { permissions, role: req.user.role } });
});

export default router;
