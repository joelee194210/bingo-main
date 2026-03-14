import { useState, useEffect, Fragment } from 'react';
import { getPermissionMatrix, updateRolePermission } from '@/services/api';
import { ROLE_LABELS, ROLE_COLORS } from '@/types/auth';
import type { UserRole } from '@/types/auth';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Loader2, ShieldCheck } from 'lucide-react';

const PERMISSION_LABELS: Record<string, string> = {
  'users:read': 'Ver usuarios',
  'users:create': 'Crear usuarios',
  'users:update': 'Editar usuarios',
  'users:delete': 'Eliminar usuarios',
  'events:read': 'Ver eventos',
  'events:create': 'Crear eventos',
  'events:update': 'Editar eventos',
  'events:delete': 'Eliminar eventos',
  'cards:read': 'Ver cartones',
  'cards:create': 'Generar cartones',
  'cards:sell': 'Vender cartones',
  'cards:export': 'Exportar cartones',
  'games:read': 'Ver juegos',
  'games:create': 'Crear juegos',
  'games:play': 'Jugar (llamar balotas)',
  'games:finish': 'Finalizar juegos',
  'reports:read': 'Ver reportes',
  'reports:export': 'Exportar reportes',
  'inventory:read': 'Ver inventario',
  'inventory:manage': 'Gestionar inventario',
  'dashboard:read': 'Ver dashboard',
  'permissions:manage': 'Gestionar permisos',
  'audit:read': 'Ver log de auditoria',
};

const PERMISSION_GROUPS: Record<string, string[]> = {
  'Usuarios': ['users:read', 'users:create', 'users:update', 'users:delete'],
  'Eventos': ['events:read', 'events:create', 'events:update', 'events:delete'],
  'Cartones': ['cards:read', 'cards:create', 'cards:sell', 'cards:export'],
  'Juegos': ['games:read', 'games:create', 'games:play', 'games:finish'],
  'Reportes': ['reports:read', 'reports:export'],
  'Inventario': ['inventory:read', 'inventory:manage'],
  'Sistema': ['dashboard:read', 'permissions:manage', 'audit:read'],
};

export default function Permissions() {
  const [matrix, setMatrix] = useState<Record<string, Record<string, boolean>>>({});
  const [roles, setRoles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadMatrix();
  }, []);

  const loadMatrix = async () => {
    try {
      const res = await getPermissionMatrix();
      if (res.success && res.data) {
        setMatrix(res.data.matrix);
        setRoles(res.data.roles);
      }
    } catch {
      setError('Error cargando permisos');
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = async (role: string, permission: string, currentValue: boolean) => {
    const key = `${role}:${permission}`;
    setUpdating(key);
    setError(null);

    try {
      const res = await updateRolePermission(role, permission, !currentValue);
      if (res.success) {
        setMatrix(prev => ({
          ...prev,
          [role]: { ...prev[role], [permission]: !currentValue },
        }));
      } else {
        setError(res.error || 'Error actualizando permiso');
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Error actualizando permiso');
    } finally {
      setUpdating(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <ShieldCheck className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Permisos por Rol</h1>
          <p className="text-sm text-muted-foreground">
            Personaliza los permisos de cada rol. Los cambios se aplican inmediatamente.
          </p>
        </div>
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive px-4 py-2 rounded-lg text-sm">
          {error}
        </div>
      )}

      <div className="bg-card border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="text-left p-3 font-medium sticky left-0 bg-card z-10 min-w-[200px]">Permiso</th>
              {roles.map(role => (
                <th key={role} className="p-3 text-center min-w-[120px]">
                  <Badge className={ROLE_COLORS[role as UserRole] || 'bg-gray-100 text-gray-700'}>
                    {ROLE_LABELS[role as UserRole] || role}
                  </Badge>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Object.entries(PERMISSION_GROUPS).map(([groupName, perms]) => (
              <Fragment key={groupName}>
                <tr>
                  <td colSpan={roles.length + 1} className="bg-muted/50 px-3 py-1.5 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                    {groupName}
                  </td>
                </tr>
                {perms.map(perm => (
                  <tr key={perm} className="border-b border-border/50 hover:bg-muted/30">
                    <td className="p-3 sticky left-0 bg-card">
                      <div>
                        <span className="font-medium">{PERMISSION_LABELS[perm] || perm}</span>
                        <span className="block text-xs text-muted-foreground font-mono">{perm}</span>
                      </div>
                    </td>
                    {roles.map(role => {
                      const key = `${role}:${perm}`;
                      const value = matrix[role]?.[perm] ?? false;
                      const isUpdating = updating === key;
                      // No permitir desactivar permissions:manage de admin
                      const isLocked = role === 'admin' && perm === 'permissions:manage';

                      return (
                        <td key={key} className="p-3 text-center">
                          {isUpdating ? (
                            <Loader2 className="h-4 w-4 animate-spin mx-auto text-muted-foreground" />
                          ) : (
                            <Switch
                              checked={value}
                              onCheckedChange={() => handleToggle(role, perm, value)}
                              disabled={isLocked}
                              className="mx-auto"
                            />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
