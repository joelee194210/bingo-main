import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Undo2, XCircle, ShoppingCart, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  getAsignacion,
  devolverAsignacion,
  cancelarAsignacion,
  venderCarton,
  venderTodos,
} from '@/services/api';
import { ESTADO_LABELS, PROPOSITO_LABELS } from '@/types';
import { getStatusColor } from '@/lib/badge-variants';
import SignaturePad from './SignaturePad';

export default function AsignacionDetail() {
  const { eventId, id } = useParams<{ eventId: string; id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [showVenderDialog, setShowVenderDialog] = useState(false);
  const [showVenderTodosDialog, setShowVenderTodosDialog] = useState(false);
  const [showDevolverDialog, setShowDevolverDialog] = useState(false);
  const [showCancelarDialog, setShowCancelarDialog] = useState(false);
  const [selectedCartonId, setSelectedCartonId] = useState<number | null>(null);
  const [compradorNombre, setCompradorNombre] = useState('');
  const [compradorTelefono, setCompradorTelefono] = useState('');
  const [firmaEntrega, setFirmaEntrega] = useState<string | null>(null);
  const [firmaRecibe, setFirmaRecibe] = useState<string | null>(null);

  const asignacionId = Number(id);

  const { data: asignacionData, isLoading } = useQuery({
    queryKey: ['asignacion', asignacionId],
    queryFn: () => getAsignacion(asignacionId),
    enabled: !!asignacionId,
  });

  const asignacion = asignacionData?.data;
  const cartones = asignacion?.cartones ?? [];

  const numEventId = Number(eventId);
  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['asignacion', asignacionId] });
    queryClient.invalidateQueries({ queryKey: ['asignaciones', numEventId] });
    queryClient.invalidateQueries({ queryKey: ['asignaciones-recientes', numEventId] });
    queryClient.invalidateQueries({ queryKey: ['resumen-inventario', numEventId] });
    queryClient.invalidateQueries({ queryKey: ['movimientos', numEventId] });
  };

  const devolverMutation = useMutation({
    mutationFn: () => devolverAsignacion(asignacionId, {
      firma_entrega: firmaEntrega || undefined,
      firma_recibe: firmaRecibe || undefined,
      nombre_entrega: asignacion?.persona_nombre,
      nombre_recibe: asignacion?.asignado_por_nombre,
    }),
    onSuccess: () => {
      invalidateAll();
      toast.success('Asignacion devuelta exitosamente');
      setShowDevolverDialog(false);
      setFirmaEntrega(null);
      setFirmaRecibe(null);
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error ?? 'Error al devolver');
    },
  });

  const cancelarMutation = useMutation({
    mutationFn: () => cancelarAsignacion(asignacionId, {
      firma_entrega: firmaEntrega || undefined,
      nombre_entrega: asignacion?.asignado_por_nombre,
    }),
    onSuccess: () => {
      invalidateAll();
      toast.success('Asignacion cancelada');
      setShowCancelarDialog(false);
      setFirmaEntrega(null);
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error ?? 'Error al cancelar');
    },
  });

  const venderCartonMutation = useMutation({
    mutationFn: () =>
      venderCarton(selectedCartonId!, {
        comprador_nombre: compradorNombre || undefined,
        comprador_telefono: compradorTelefono || undefined,
      }),
    onSuccess: () => {
      invalidateAll();
      toast.success('Carton vendido');
      setShowVenderDialog(false);
      setSelectedCartonId(null);
      setCompradorNombre('');
      setCompradorTelefono('');
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error ?? 'Error al vender carton');
    },
  });

  const venderTodosMutation = useMutation({
    mutationFn: () =>
      venderTodos(asignacionId, {
        comprador_nombre: compradorNombre || undefined,
        comprador_telefono: compradorTelefono || undefined,
      }),
    onSuccess: (res) => {
      invalidateAll();
      toast.success(`${res.data?.vendidos ?? 0} cartones vendidos`);
      setShowVenderTodosDialog(false);
      setCompradorNombre('');
      setCompradorTelefono('');
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error ?? 'Error al vender');
    },
  });

  const canModify = asignacion && ['asignado', 'parcial'].includes(asignacion.estado);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!asignacion) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={() => navigate(`/inventory/${eventId}`)}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Volver
        </Button>
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Asignacion no encontrada
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" aria-label="Volver" onClick={() => navigate(`/inventory/${eventId}?tab=asignaciones`)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">
            Asignacion: {asignacion.referencia}
          </h1>
          <p className="text-muted-foreground">
            {asignacion.tipo_entidad === 'caja' ? 'Caja' : asignacion.tipo_entidad === 'libreta' ? 'Lote' : 'Carton'} asignada a {asignacion.persona_nombre}
          </p>
        </div>
        <Badge className={`text-sm ${getStatusColor(asignacion.estado)}`}>
          {ESTADO_LABELS[asignacion.estado]}
        </Badge>
      </div>

      {/* Info Card */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Informacion de Asignacion</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Persona:</span>
              <span className="font-medium">{asignacion.persona_nombre}</span>
            </div>
            {asignacion.persona_telefono && (
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Telefono:</span>
                <span>{asignacion.persona_telefono}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Tipo:</span>
              <span className="capitalize">{asignacion.tipo_entidad}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Referencia:</span>
              <span className="font-mono">{asignacion.referencia}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Proposito:</span>
              <Badge variant="outline">{PROPOSITO_LABELS[asignacion.proposito]}</Badge>
            </div>
            {asignacion.almacen_name && (
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Almacen:</span>
                <span>{asignacion.almacen_name}</span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Resumen</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Total Cartones:</span>
              <span className="font-bold text-lg">{asignacion.cantidad_cartones}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Vendidos:</span>
              <span className="font-bold text-lg text-green-600">{asignacion.cartones_vendidos}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Pendientes:</span>
              <span className="font-bold text-lg">
                {asignacion.cantidad_cartones - asignacion.cartones_vendidos}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Asignado por:</span>
              <span>{asignacion.asignado_por_nombre}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Fecha:</span>
              <span>{new Date(asignacion.created_at).toLocaleString()}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Actions */}
      {canModify && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Acciones</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              <Button
                variant="default"
                onClick={() => {
                  setCompradorNombre('');
                  setCompradorTelefono('');
                  setShowVenderTodosDialog(true);
                }}
              >
                <ShoppingCart className="mr-2 h-4 w-4" />
                Vender Todos
              </Button>
              <Button variant="outline" onClick={() => setShowDevolverDialog(true)}>
                <Undo2 className="mr-2 h-4 w-4" />
                Devolver
              </Button>
              <Button variant="destructive" onClick={() => setShowCancelarDialog(true)}>
                <XCircle className="mr-2 h-4 w-4" />
                Cancelar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Cartones Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Cartones ({cartones.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {cartones.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No hay cartones detallados para esta asignacion
            </p>
          ) : (
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Numero</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Comprador</TableHead>
                  <TableHead>Fecha Venta</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cartones.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono">{c.serial.replace(/^0+/, '').replace(/-0+/, '-')}</TableCell>
                    <TableCell>
                      {c.vendido ? (
                        <Badge className="bg-green-100 text-green-800">
                          <CheckCircle className="mr-1 h-3 w-3" />
                          Vendido
                        </Badge>
                      ) : (
                        <Badge variant="outline">Disponible</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {c.comprador_nombre ?? '-'}
                      {c.comprador_telefono && (
                        <span className="block text-xs text-muted-foreground">{c.comprador_telefono}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {c.vendido_at ? new Date(c.vendido_at).toLocaleString() : '-'}
                    </TableCell>
                    <TableCell>
                      {!c.vendido && canModify && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setSelectedCartonId(c.id);
                            setCompradorNombre('');
                            setCompradorTelefono('');
                            setShowVenderDialog(true);
                          }}
                        >
                          Vender
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Vender Carton Dialog */}
      <Dialog open={showVenderDialog} onOpenChange={setShowVenderDialog}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Vender Carton</DialogTitle>
            <DialogDescription>
              Registrar la venta de este carton.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nombre del comprador (opcional)</Label>
              <Input
                value={compradorNombre}
                onChange={(e) => setCompradorNombre(e.target.value)}
                placeholder="Nombre"
              />
            </div>
            <div className="space-y-2">
              <Label>Telefono (opcional)</Label>
              <Input
                value={compradorTelefono}
                onChange={(e) => setCompradorTelefono(e.target.value)}
                placeholder="Telefono"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowVenderDialog(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => venderCartonMutation.mutate()}
              disabled={venderCartonMutation.isPending}
            >
              {venderCartonMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirmar Venta
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Vender Todos Dialog */}
      <Dialog open={showVenderTodosDialog} onOpenChange={setShowVenderTodosDialog}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Vender Todos los Cartones</DialogTitle>
            <DialogDescription>
              Se marcaran como vendidos todos los cartones pendientes de esta asignacion.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nombre del comprador (opcional)</Label>
              <Input
                value={compradorNombre}
                onChange={(e) => setCompradorNombre(e.target.value)}
                placeholder="Nombre"
              />
            </div>
            <div className="space-y-2">
              <Label>Telefono (opcional)</Label>
              <Input
                value={compradorTelefono}
                onChange={(e) => setCompradorTelefono(e.target.value)}
                placeholder="Telefono"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowVenderTodosDialog(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => venderTodosMutation.mutate()}
              disabled={venderTodosMutation.isPending}
            >
              {venderTodosMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Vender Todos
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Devolver Dialog con Firmas */}
      <Dialog open={showDevolverDialog} onOpenChange={(v) => { if (!v) { setFirmaEntrega(null); setFirmaRecibe(null); } setShowDevolverDialog(v); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Devolver Asignacion</DialogTitle>
            <DialogDescription>
              Se devolvera esta asignacion. Los cartones no vendidos quedaran disponibles nuevamente.
              Firme el acta de devolucion.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <SignaturePad
              label={`Entrega: ${asignacion?.persona_nombre || ''}`}
              onSignatureChange={setFirmaEntrega}
            />
            <SignaturePad
              label={`Recibe: ${asignacion?.asignado_por_nombre || ''}`}
              onSignatureChange={setFirmaRecibe}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDevolverDialog(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => devolverMutation.mutate()}
              disabled={devolverMutation.isPending || !firmaEntrega}
            >
              {devolverMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirmar Devolucion
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancelar Dialog con Firma */}
      <Dialog open={showCancelarDialog} onOpenChange={(v) => { if (!v) { setFirmaEntrega(null); } setShowCancelarDialog(v); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Cancelar Asignacion</DialogTitle>
            <DialogDescription>
              Esta accion cancelara la asignacion. Esta accion no se puede deshacer.
              Firme el acta de cancelacion.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <SignaturePad
              label={`Autoriza: ${asignacion?.asignado_por_nombre || ''}`}
              onSignatureChange={setFirmaEntrega}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCancelarDialog(false)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => cancelarMutation.mutate()}
              disabled={cancelarMutation.isPending || !firmaEntrega}
            >
              {cancelarMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirmar Cancelacion
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
