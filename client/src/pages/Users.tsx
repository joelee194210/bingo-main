import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Edit2, UserCheck, UserX, Search, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/services/api';
import type { User, UserRole } from '@/types/auth';
import { ROLE_LABELS } from '@/types/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useTableControls } from '@/hooks/useTableControls';
import { SortableHeader } from '@/components/ui/sortable-header';
import { TablePagination } from '@/components/ui/table-pagination';
import { DataExportMenu } from '@/components/ui/data-export-menu';
import { getStatusColor } from '@/lib/badge-variants';

interface UserFormData {
  username: string;
  password: string;
  full_name: string;
  email: string;
  role: UserRole;
}

const initialFormData: UserFormData = {
  username: '',
  password: '',
  full_name: '',
  email: '',
  role: 'viewer',
};

const EXPORT_COLUMNS = [
  { key: 'username', label: 'Usuario' },
  { key: 'full_name', label: 'Nombre' },
  { key: 'email', label: 'Email' },
  { key: 'role', label: 'Rol' },
  { key: 'is_active', label: 'Activo' },
  { key: 'last_login', label: 'Ultimo acceso' },
];

export default function Users() {
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [formData, setFormData] = useState<UserFormData>(initialFormData);
  const [error, setError] = useState('');

  const queryClient = useQueryClient();

  const { data: users, isLoading } = useQuery<User[]>({
    queryKey: ['users'],
    queryFn: async () => {
      const res = await api.get('/auth/users');
      return res.data.data;
    },
  });

  const baseUsers = (users || []).filter(u => u.role !== 'inventory') as (User & Record<string, unknown>)[];

  const table = useTableControls(baseUsers, ['username', 'full_name', 'email']);

  const createMutation = useMutation({
    mutationFn: async (data: UserFormData) => {
      const res = await api.post('/auth/users', data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      closeModal();
      toast.success('Usuario creado');
    },
    onError: (err: { response?: { data?: { error?: string } } }) => {
      toast.error(err.response?.data?.error || 'Error al crear usuario');
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<UserFormData> }) => {
      const res = await api.put(`/auth/users/${id}`, data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      closeModal();
      toast.success('Usuario actualizado');
    },
    onError: (err: { response?: { data?: { error?: string } } }) => {
      toast.error(err.response?.data?.error || 'Error al actualizar usuario');
    },
  });

  const [confirmAction, setConfirmAction] = useState<{ type: 'toggle' | 'delete'; user: User } | null>(null);

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: number; is_active: boolean }) => {
      const res = await api.put(`/auth/users/${id}`, { is_active });
      return res.data;
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success(vars.is_active ? 'Usuario activado' : 'Usuario desactivado');
    },
    onError: (err: { response?: { data?: { error?: string } } }) => {
      toast.error(err.response?.data?.error || 'Error al cambiar estado del usuario');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await api.delete(`/auth/users/${id}`);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success('Usuario eliminado');
    },
    onError: (err: { response?: { data?: { error?: string } } }) => {
      toast.error(err.response?.data?.error || 'Error al eliminar usuario');
    },
  });

  const handleConfirmAction = () => {
    if (!confirmAction) return;
    if (confirmAction.type === 'toggle') {
      toggleActiveMutation.mutate({ id: confirmAction.user.id, is_active: !confirmAction.user.is_active });
    } else {
      deleteMutation.mutate(confirmAction.user.id);
    }
    setConfirmAction(null);
  };

  const openCreateModal = () => {
    setEditingUser(null);
    setFormData(initialFormData);
    setError('');
    setShowModal(true);
  };

  const openEditModal = (user: User) => {
    setEditingUser(user);
    setFormData({
      username: user.username,
      password: '',
      full_name: user.full_name,
      email: user.email || '',
      role: user.role,
    });
    setError('');
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingUser(null);
    setFormData(initialFormData);
    setError('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (editingUser) {
      const updateData: Partial<UserFormData> = {};
      if (formData.full_name !== editingUser.full_name) updateData.full_name = formData.full_name;
      if (formData.email !== (editingUser.email || '')) updateData.email = formData.email;
      if (formData.role !== editingUser.role) updateData.role = formData.role;
      if (formData.password) updateData.password = formData.password;
      updateMutation.mutate({ id: editingUser.id, data: updateData });
    } else {
      if (!formData.username || !formData.password || !formData.full_name) {
        setError('Usuario, contrasena y nombre completo son requeridos');
        return;
      }
      createMutation.mutate(formData);
    }
  };


  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'Nunca';
    return new Date(dateStr).toLocaleString('es-ES', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-64" />
          </div>
          <Skeleton className="h-10 w-36" />
        </div>
        <Skeleton className="h-10 w-full" />
        <Card>
          <CardContent className="pt-6 space-y-4">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Gestion de Usuarios</h1>
          <p className="text-muted-foreground text-sm mt-1">Administra los usuarios del sistema</p>
        </div>
        <div className="flex items-center gap-2">
          <DataExportMenu
            data={table.allFilteredData as Record<string, unknown>[]}
            columns={EXPORT_COLUMNS}
            filename="usuarios"
          />
          <Button onClick={openCreateModal}>
            <Plus className="mr-2 h-4 w-4" />
            Nuevo Usuario
          </Button>
        </div>
      </div>

      {/* Busqueda */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground h-4 w-4" />
        <Input
          className="pl-9"
          placeholder="Buscar por usuario, nombre o email..."
          value={table.search}
          onChange={(e) => table.setSearch(e.target.value)}
        />
      </div>

      {/* Tabla */}
      {table.paginatedData.length === 0 ? (
        <Card className="text-center py-12">
          <CardContent>
            <h3 className="text-xl font-semibold mb-2">No se encontraron usuarios</h3>
            <p className="text-muted-foreground">Intenta con otro termino de busqueda</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <SortableHeader label="Usuario" column="full_name" sort={table.sort} onSort={table.toggleSort} />
                </TableHead>
                <TableHead>
                  <SortableHeader label="Rol" column="role" sort={table.sort} onSort={table.toggleSort} />
                </TableHead>
                <TableHead>
                  <SortableHeader label="Estado" column="is_active" sort={table.sort} onSort={table.toggleSort} />
                </TableHead>
                <TableHead>
                  <SortableHeader label="Ultimo acceso" column="last_login" sort={table.sort} onSort={table.toggleSort} />
                </TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {table.paginatedData.map((user) => {
                const u = user as unknown as User;
                return (
                  <TableRow key={u.id} className={!u.is_active ? 'opacity-60' : ''}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar>
                          <AvatarFallback className="bg-primary/10 text-primary">
                            {u.full_name.charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium">{u.full_name}</p>
                          <p className="text-sm text-muted-foreground">@{u.username}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge className={getStatusColor(u.role)}>
                        {ROLE_LABELS[u.role]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {u.is_active ? (
                        <Badge className={getStatusColor('active')}>Activo</Badge>
                      ) : (
                        <Badge className={getStatusColor('inactive')}>Inactivo</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(u.last_login)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openEditModal(u)} title="Editar">
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost" size="icon"
                          onClick={() => setConfirmAction({ type: 'toggle', user: u })}
                          title={u.is_active ? 'Desactivar' : 'Activar'}
                          className={u.is_active ? 'hover:text-destructive' : 'hover:text-green-600'}
                        >
                          {u.is_active ? <UserX className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
                        </Button>
                        <Button
                          variant="ghost" size="icon"
                          onClick={() => setConfirmAction({ type: 'delete', user: u })}
                          title="Eliminar"
                          className="hover:text-destructive"
                          disabled={deleteMutation.isPending}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          </div>
          <TablePagination
            page={table.page} totalPages={table.totalPages} pageSize={table.pageSize}
            from={table.from} to={table.to} total={table.totalFiltered}
            onPageChange={table.setPage} onPageSizeChange={table.setPageSize}
          />
        </Card>
      )}

      {/* Modal crear/editar */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingUser ? 'Editar Usuario' : 'Nuevo Usuario'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="p-3 bg-destructive/10 border border-destructive/20 text-destructive text-sm rounded-lg">
                {error}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="username">Usuario</Label>
              <Input id="username" value={formData.username} onChange={(e) => setFormData({ ...formData, username: e.target.value })} disabled={!!editingUser} placeholder="nombre_usuario" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{editingUser ? 'Nueva Contrasena (dejar vacio para no cambiar)' : 'Contrasena'}</Label>
              <PasswordInput id="password" value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })} placeholder={editingUser ? '••••••••' : 'Ingrese contrasena'} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="full_name">Nombre Completo</Label>
              <Input id="full_name" value={formData.full_name} onChange={(e) => setFormData({ ...formData, full_name: e.target.value })} placeholder="Juan Perez" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email (opcional)</Label>
              <Input id="email" type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} placeholder="usuario@ejemplo.com" />
            </div>
            <div className="space-y-2">
              <Label>Rol</Label>
              <Select value={formData.role} onValueChange={(value) => setFormData({ ...formData, role: value as UserRole })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Administrador</SelectItem>
                  <SelectItem value="moderator">Moderador</SelectItem>
                  <SelectItem value="seller">Vendedor</SelectItem>
                  <SelectItem value="viewer">Visor</SelectItem>
                  <SelectItem value="loteria">Loteria</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {formData.role === 'admin' && 'Acceso completo a todas las funciones'}
                {formData.role === 'moderator' && 'Puede crear y administrar juegos'}
                {formData.role === 'seller' && 'Puede vender cartones'}
                {formData.role === 'viewer' && 'Solo puede ver informacion'}
                {formData.role === 'loteria' && 'Gestiona su equipo, vende cartones e inventario'}
              </p>
            </div>
            <div className="flex justify-end gap-3 pt-4">
              <Button type="button" variant="outline" onClick={closeModal}>Cancelar</Button>
              <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                {(createMutation.isPending || updateMutation.isPending) ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Guardando...</>
                ) : 'Guardar'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Confirmation Dialog */}
      <AlertDialog open={!!confirmAction} onOpenChange={() => setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction?.type === 'delete' ? 'Eliminar usuario' :
               confirmAction?.user.is_active ? 'Desactivar usuario' : 'Activar usuario'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction?.type === 'delete' ? (
                <>¿Estas seguro que quieres eliminar a <strong className="text-foreground">{confirmAction.user.full_name}</strong> (@{confirmAction.user.username})? Esta accion no se puede deshacer.</>
              ) : confirmAction?.user.is_active ? (
                <>¿Estas seguro que quieres desactivar a <strong className="text-foreground">{confirmAction.user.full_name}</strong> (@{confirmAction.user.username})? No podra iniciar sesion.</>
              ) : (
                <>¿Estas seguro que quieres activar a <strong className="text-foreground">{confirmAction?.user.full_name}</strong> (@{confirmAction?.user.username})? Podra iniciar sesion nuevamente.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmAction}
              className={confirmAction?.type === 'delete' || confirmAction?.user.is_active ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : ''}
            >
              {confirmAction?.type === 'delete' ? 'Si, Eliminar' :
               confirmAction?.user.is_active ? 'Si, Desactivar' : 'Si, Activar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
