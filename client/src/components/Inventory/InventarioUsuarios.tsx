import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  UserPlus, Trash2, Search, Loader2, Warehouse, Shield, Edit2,
} from 'lucide-react';
import { toast } from 'sonner';
import api from '@/services/api';
import { useTableControls } from '@/hooks/useTableControls';
import { SortableHeader } from '@/components/ui/sortable-header';
import { TablePagination } from '@/components/ui/table-pagination';
import { DataExportMenu } from '@/components/ui/data-export-menu';
import { getStatusColor } from '@/lib/badge-variants';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  getEvents,
  getAlmacenes,
  getInventarioUsuarios,
  addUsuarioToAlmacen,
  removeUsuarioFromAlmacen,
  updateUsuarioAlmacen,
} from '@/services/api';
import type { User } from '@/types/auth';
import { ROL_ALMACEN_LABELS, type AlmacenRol } from '@/types';

export default function InventarioUsuarios() {
  const queryClient = useQueryClient();
  const [eventId, setEventId] = useState<number | undefined>();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [dialogTab, setDialogTab] = useState<'crear' | 'existente'>('crear');

  // Assign existing user fields
  const [selectedAlmacenId, setSelectedAlmacenId] = useState<string>('');
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [selectedRol, setSelectedRol] = useState<AlmacenRol>('vendedor');

  // Create new user fields
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newFullName, setNewFullName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [createError, setCreateError] = useState('');

  // Edit user fields
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editingUser, setEditingUser] = useState<{ user_id: number; almacen_id: number; full_name: string; username: string; rol: string } | null>(null);
  const [editRol, setEditRol] = useState<AlmacenRol>('vendedor');
  const [editAlmacenId, setEditAlmacenId] = useState<string>('');

  const { data: eventsData } = useQuery({
    queryKey: ['events'],
    queryFn: getEvents,
  });

  const { data: almacenesData } = useQuery({
    queryKey: ['almacenes', eventId],
    queryFn: () => getAlmacenes(eventId!),
    enabled: !!eventId,
  });

  const { data: usuariosData, isLoading } = useQuery({
    queryKey: ['inventario-usuarios', eventId],
    queryFn: () => getInventarioUsuarios(eventId!),
    enabled: !!eventId,
  });

  const { data: allUsers } = useQuery<User[]>({
    queryKey: ['users'],
    queryFn: async () => {
      const res = await api.get('/auth/users');
      return res.data.data;
    },
    enabled: showAddDialog && dialogTab === 'existente',
  });

  const events = eventsData?.data || [];
  const almacenes = almacenesData?.data || [];
  const usuarios = usuariosData?.data || [];

  const resetDialog = () => {
    setSelectedAlmacenId('');
    setSelectedUserId('');
    setSelectedRol('vendedor');
    setNewUsername('');
    setNewPassword('');
    setNewFullName('');
    setNewEmail('');
    setCreateError('');
  };

  // Create new user + assign to almacen
  const createAndAssignMutation = useMutation({
    mutationFn: async () => {
      // 1. Create user with role 'inventory' via inventario endpoint (no requiere admin)
      const res = await api.post('/inventario/crear-usuario', {
        username: newUsername,
        password: newPassword,
        full_name: newFullName,
        email: newEmail || undefined,
      });
      const newUser = res.data.data;
      // 2. Assign to almacen
      await addUsuarioToAlmacen(Number(selectedAlmacenId), {
        user_id: newUser.id,
        rol: selectedRol,
      });
      return newUser;
    },
    onSuccess: (newUser) => {
      queryClient.invalidateQueries({ queryKey: ['inventario-usuarios', eventId] });
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success(`Usuario "${newUser.full_name}" creado y asignado al almacen`);
      setShowAddDialog(false);
      resetDialog();
    },
    onError: (err: any) => {
      setCreateError(err.response?.data?.error ?? 'Error al crear usuario');
    },
  });

  // Assign existing user
  const addMutation = useMutation({
    mutationFn: () => addUsuarioToAlmacen(Number(selectedAlmacenId), {
      user_id: Number(selectedUserId),
      rol: selectedRol,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventario-usuarios', eventId] });
      toast.success('Usuario asignado al almacen');
      setShowAddDialog(false);
      resetDialog();
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error ?? 'Error al asignar usuario');
    },
  });

  const removeMutation = useMutation({
    mutationFn: ({ almacenId, userId }: { almacenId: number; userId: number }) =>
      removeUsuarioFromAlmacen(almacenId, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventario-usuarios', eventId] });
      toast.success('Usuario removido del almacen');
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error ?? 'Error al remover usuario');
    },
  });

  const editMutation = useMutation({
    mutationFn: () => {
      if (!editingUser) throw new Error('No user selected');
      const data: { rol?: string; new_almacen_id?: number } = {};
      if (editRol !== editingUser.rol) data.rol = editRol;
      if (Number(editAlmacenId) !== editingUser.almacen_id) data.new_almacen_id = Number(editAlmacenId);
      return updateUsuarioAlmacen(editingUser.almacen_id, editingUser.user_id, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventario-usuarios', eventId] });
      toast.success('Usuario actualizado');
      setShowEditDialog(false);
      setEditingUser(null);
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error ?? 'Error al actualizar usuario');
    },
  });

  const openEditDialog = (u: typeof filteredUsuarios[0]) => {
    setEditingUser({ user_id: u.user_id, almacen_id: u.almacen_id, full_name: u.full_name || '', username: u.username || '', rol: u.rol });
    setEditRol(u.rol as AlmacenRol);
    setEditAlmacenId(u.almacen_id.toString());
    setShowEditDialog(true);
  };

  const table = useTableControls(
    usuarios as (typeof usuarios[0] & Record<string, unknown>)[],
    ['full_name', 'username', 'almacen_name'],
  );

  const filteredUsuarios = table.paginatedData as typeof usuarios;

  const availableUsers = allUsers?.filter(
    (u) => u.is_active && !usuarios.some((au) => au.user_id === u.id && au.almacen_id === Number(selectedAlmacenId))
  ) || [];

  const EXPORT_COLUMNS = [
    { key: 'full_name', label: 'Nombre' },
    { key: 'username', label: 'Usuario' },
    { key: 'almacen_name', label: 'Almacen' },
    { key: 'almacen_code', label: 'Codigo Almacen' },
    { key: 'rol', label: 'Rol' },
  ];

  if (isLoading && eventId) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-10 w-full" />
        <Card><CardContent className="pt-6 space-y-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
        </CardContent></Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Usuarios de Inventario</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Crea y asigna usuarios a almacenes para gestionar inventario
          </p>
        </div>
        {eventId && (
          <div className="flex items-center gap-2">
            <DataExportMenu
              data={table.allFilteredData as Record<string, unknown>[]}
              columns={EXPORT_COLUMNS}
              filename="usuarios_inventario"
            />
            <Button onClick={() => { resetDialog(); setShowAddDialog(true); }}>
              <UserPlus className="mr-2 h-4 w-4" />
              Nuevo Usuario
            </Button>
          </div>
        )}
      </div>

      {/* Event selector + Search */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-4">
            <div className="flex-1 min-w-[200px] space-y-2">
              <Label>Evento</Label>
              <Select
                value={eventId?.toString() || ''}
                onValueChange={(v) => setEventId(Number(v))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar evento..." />
                </SelectTrigger>
                <SelectContent>
                  {events.map((e) => (
                    <SelectItem key={e.id} value={e.id.toString()}>
                      {e.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {eventId && (
              <div className="flex-1 min-w-[200px] space-y-2">
                <Label>Buscar</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground h-4 w-4" />
                  <Input
                    className="pl-9"
                    placeholder="Nombre, usuario o almacen..."
                    value={table.search}
                    onChange={(e) => table.setSearch(e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Content */}
      {!eventId ? (
        <Card className="text-center py-12">
          <CardContent>
            <Shield className="h-16 w-16 mx-auto mb-4 text-muted-foreground/40" />
            <h3 className="text-xl font-semibold mb-2">Selecciona un evento</h3>
            <p className="text-muted-foreground">Elige un evento para gestionar sus usuarios de inventario</p>
          </CardContent>
        </Card>
      ) : filteredUsuarios.length === 0 ? (
        <Card className="text-center py-12">
          <CardContent>
            <UserPlus className="h-16 w-16 mx-auto mb-4 text-muted-foreground/40" />
            <h3 className="text-xl font-semibold mb-2">Sin usuarios de inventario</h3>
            <p className="text-muted-foreground mb-4">
              Crea usuarios y asignalos a almacenes para que puedan gestionar inventario
            </p>
            <Button onClick={() => { resetDialog(); setShowAddDialog(true); }}>
              <UserPlus className="mr-2 h-4 w-4" />
              Nuevo Usuario
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead><SortableHeader label="Usuario" column="full_name" sort={table.sort} onSort={table.toggleSort} /></TableHead>
                <TableHead><SortableHeader label="Almacen" column="almacen_name" sort={table.sort} onSort={table.toggleSort} /></TableHead>
                <TableHead><SortableHeader label="Rol" column="rol" sort={table.sort} onSort={table.toggleSort} /></TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredUsuarios.map((u) => (
                <TableRow key={`${u.almacen_id}-${u.user_id}`}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="h-8 w-8">
                        <AvatarFallback className="bg-primary/10 text-primary text-xs">
                          {u.full_name?.charAt(0).toUpperCase() || 'U'}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-medium text-sm">{u.full_name}</p>
                        <p className="text-xs text-muted-foreground">@{u.username}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Warehouse className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">{u.almacen_name}</span>
                      <span className="text-xs text-muted-foreground font-mono">{u.almacen_code}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge className={getStatusColor(u.rol)}>
                      {ROL_ALMACEN_LABELS[u.rol as AlmacenRol] || u.rol}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="hover:text-primary"
                        onClick={() => openEditDialog(u)}
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="hover:text-destructive"
                        onClick={() => removeMutation.mutate({ almacenId: u.almacen_id, userId: u.user_id })}
                        disabled={removeMutation.isPending}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
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

      {/* Edit user dialog */}
      <Dialog open={showEditDialog} onOpenChange={(v) => { if (!v) setEditingUser(null); setShowEditDialog(v); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Editar Usuario</DialogTitle>
            <DialogDescription>
              Cambia el rol o reasigna a otro almacen: {editingUser?.full_name} (@{editingUser?.username})
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Almacen</Label>
              <Select value={editAlmacenId} onValueChange={setEditAlmacenId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {almacenes.map((a) => (
                    <SelectItem key={a.id} value={a.id.toString()}>
                      {a.name} ({a.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Rol en el Almacen</Label>
              <Select value={editRol} onValueChange={(v) => setEditRol(v as AlmacenRol)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(ROL_ALMACEN_LABELS) as AlmacenRol[]).map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROL_ALMACEN_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => editMutation.mutate()}
              disabled={editMutation.isPending || (editRol === editingUser?.rol && Number(editAlmacenId) === editingUser?.almacen_id)}
            >
              {editMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add/Create user dialog */}
      <Dialog open={showAddDialog} onOpenChange={(v) => { if (!v) resetDialog(); setShowAddDialog(v); }}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Agregar Usuario de Inventario</DialogTitle>
            <DialogDescription>
              Crea un nuevo usuario o asigna uno existente a un almacen.
            </DialogDescription>
          </DialogHeader>

          <Tabs value={dialogTab} onValueChange={(v) => { setDialogTab(v as 'crear' | 'existente'); setCreateError(''); }}>
            <TabsList className="w-full">
              <TabsTrigger value="crear" className="flex-1">Crear Nuevo</TabsTrigger>
              <TabsTrigger value="existente" className="flex-1">Asignar Existente</TabsTrigger>
            </TabsList>

            {/* Shared: Almacen + Rol */}
            <div className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>Almacen</Label>
                <Select value={selectedAlmacenId} onValueChange={setSelectedAlmacenId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar almacen..." />
                  </SelectTrigger>
                  <SelectContent>
                    {almacenes.map((a) => (
                      <SelectItem key={a.id} value={a.id.toString()}>
                        {a.name} ({a.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Rol en el Almacen</Label>
                <Select value={selectedRol} onValueChange={(v) => setSelectedRol(v as AlmacenRol)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(ROL_ALMACEN_LABELS) as AlmacenRol[]).map((r) => (
                      <SelectItem key={r} value={r}>
                        {ROL_ALMACEN_LABELS[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {selectedRol === 'administrador' && 'Control total del almacen: asignar, vender, devolver'}
                  {selectedRol === 'operador' && 'Puede asignar y recibir inventario'}
                  {selectedRol === 'vendedor' && 'Solo puede vender cartones de su almacen'}
                </p>
              </div>
            </div>

            {/* Tab: Create new user */}
            <TabsContent value="crear" className="space-y-4 mt-2">
              {createError && (
                <div className="p-3 bg-destructive/10 border border-destructive/20 text-destructive text-sm rounded-lg">
                  {createError}
                </div>
              )}
              <div className="space-y-2">
                <Label>Nombre Completo</Label>
                <Input
                  value={newFullName}
                  onChange={(e) => setNewFullName(e.target.value)}
                  placeholder="Juan Perez"
                />
              </div>
              <div className="space-y-2">
                <Label>Usuario</Label>
                <Input
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="juan_perez"
                />
              </div>
              <div className="space-y-2">
                <Label>Contrasena</Label>
                <Input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Minimo 6 caracteres"
                />
              </div>
              <div className="space-y-2">
                <Label>Email (opcional)</Label>
                <Input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="usuario@ejemplo.com"
                />
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setShowAddDialog(false)}>
                  Cancelar
                </Button>
                <Button
                  onClick={() => createAndAssignMutation.mutate()}
                  disabled={!selectedAlmacenId || !newUsername || !newPassword || !newFullName || createAndAssignMutation.isPending}
                >
                  {createAndAssignMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Crear y Asignar
                </Button>
              </DialogFooter>
            </TabsContent>

            {/* Tab: Assign existing user */}
            <TabsContent value="existente" className="space-y-4 mt-2">
              <div className="space-y-2">
                <Label>Usuario</Label>
                <Select
                  value={selectedUserId}
                  onValueChange={setSelectedUserId}
                  disabled={!selectedAlmacenId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={selectedAlmacenId ? 'Seleccionar usuario...' : 'Primero selecciona almacen'} />
                  </SelectTrigger>
                  <SelectContent>
                    {availableUsers.map((u) => (
                      <SelectItem key={u.id} value={u.id.toString()}>
                        {u.full_name} (@{u.username})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setShowAddDialog(false)}>
                  Cancelar
                </Button>
                <Button
                  onClick={() => addMutation.mutate()}
                  disabled={!selectedAlmacenId || !selectedUserId || addMutation.isPending}
                >
                  {addMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Asignar
                </Button>
              </DialogFooter>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </div>
  );
}
