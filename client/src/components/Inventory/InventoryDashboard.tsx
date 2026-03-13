import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Package, Warehouse, ClipboardList, Users, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { getEvents, getResumenInventario, getAsignaciones } from '@/services/api';
import { ESTADO_LABELS, PROPOSITO_LABELS, type AsignacionEstado } from '@/types';

const estadoColor: Record<AsignacionEstado, string> = {
  asignado: 'bg-blue-100 text-blue-800',
  parcial: 'bg-yellow-100 text-yellow-800',
  completado: 'bg-green-100 text-green-800',
  devuelto: 'bg-gray-100 text-gray-800',
  cancelado: 'bg-red-100 text-red-800',
};

export default function InventoryDashboard() {
  const navigate = useNavigate();
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);

  const { data: eventsData, isLoading: eventsLoading } = useQuery({
    queryKey: ['events'],
    queryFn: getEvents,
  });

  const events = eventsData?.data ?? [];
  const eventId = selectedEventId ?? events[0]?.id ?? null;

  const { data: resumenData, isLoading: resumenLoading } = useQuery({
    queryKey: ['resumen-inventario', eventId],
    queryFn: () => getResumenInventario(eventId!),
    enabled: !!eventId,
  });

  const { data: asignacionesData, isLoading: asignacionesLoading } = useQuery({
    queryKey: ['asignaciones-recientes', eventId],
    queryFn: () => getAsignaciones(eventId!, { limit: 10 }),
    enabled: !!eventId,
  });

  const resumen = resumenData?.data;
  const asignaciones = asignacionesData?.data ?? [];
  const isLoading = resumenLoading;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Inventario</h1>
          <p className="text-muted-foreground">Gestion de almacenes, asignaciones y movimientos de cartones</p>
        </div>
        <div className="w-64">
          {eventsLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <Select
              value={eventId?.toString() ?? ''}
              onValueChange={(v) => setSelectedEventId(Number(v))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar evento" />
              </SelectTrigger>
              <SelectContent>
                {events.map((ev) => (
                  <SelectItem key={ev.id} value={ev.id.toString()}>
                    {ev.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {!eventId ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Selecciona un evento para ver el inventario
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Cartones</CardTitle>
                <Package className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <Skeleton className="h-8 w-20" />
                ) : (
                  <div className="text-2xl font-bold">{resumen?.totalCartones ?? 0}</div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Lotes</CardTitle>
                <ClipboardList className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <Skeleton className="h-8 w-20" />
                ) : (
                  <div className="text-2xl font-bold">{resumen?.totalLibretas ?? 0}</div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Cartones Asignados</CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <Skeleton className="h-8 w-20" />
                ) : (
                  <div className="text-2xl font-bold">{resumen?.cartonesAsignados ?? 0}</div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Cartones Disponibles</CardTitle>
                <Package className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <Skeleton className="h-8 w-20" />
                ) : (
                  <div className="text-2xl font-bold text-green-600">{resumen?.cartonesDisponibles ?? 0}</div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Quick Links */}
          <Card>
            <CardHeader>
              <CardTitle>Acciones</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-3">
                <Button onClick={() => navigate(`/inventory/${eventId}`)}>
                  <Warehouse className="mr-2 h-4 w-4" />
                  Gestionar Inventario
                </Button>
                <Button variant="outline" onClick={() => navigate(`/inventory/${eventId}?tab=almacenes`)}>
                  <Warehouse className="mr-2 h-4 w-4" />
                  Almacenes
                </Button>
                <Button variant="outline" onClick={() => navigate(`/inventory/${eventId}?tab=asignaciones`)}>
                  <Users className="mr-2 h-4 w-4" />
                  Asignaciones
                </Button>
                <Button variant="outline" onClick={() => navigate(`/inventory/${eventId}?tab=movimientos`)}>
                  <ClipboardList className="mr-2 h-4 w-4" />
                  Movimientos
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Recent Asignaciones */}
          <Card>
            <CardHeader>
              <CardTitle>Asignaciones Recientes</CardTitle>
            </CardHeader>
            <CardContent>
              {asignacionesLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : asignaciones.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No hay asignaciones registradas</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Referencia</TableHead>
                      <TableHead>Persona</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Proposito</TableHead>
                      <TableHead>Cartones</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead>Fecha</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {asignaciones.map((a) => (
                      <TableRow
                        key={a.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => navigate(`/inventory/${eventId}/asignacion/${a.id}`)}
                      >
                        <TableCell className="font-mono text-sm">{a.referencia}</TableCell>
                        <TableCell>{a.persona_nombre}</TableCell>
                        <TableCell className="capitalize">{a.tipo_entidad}</TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {PROPOSITO_LABELS[a.proposito]}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {a.cartones_vendidos}/{a.cantidad_cartones}
                        </TableCell>
                        <TableCell>
                          <Badge className={estadoColor[a.estado]}>
                            {ESTADO_LABELS[a.estado]}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(a.created_at).toLocaleDateString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
