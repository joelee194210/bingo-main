import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Package, ClipboardList, CreditCard, Warehouse,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  getMisAlmacenes,
  getResumenInventario,
  getCajas,
} from '@/services/api';

export default function MiInventario() {
  const [selectedAlmacen, setSelectedAlmacen] = useState<string>('');

  const { data: misAlmacenesData, isLoading: loadingAlmacenes } = useQuery({
    queryKey: ['mis-almacenes'],
    queryFn: getMisAlmacenes,
  });

  const misAlmacenes = misAlmacenesData?.data || [];
  const currentAlmacen = misAlmacenes.find((a) => a.almacen_id.toString() === selectedAlmacen);

  const { data: resumenData } = useQuery({
    queryKey: ['resumen-inventario', currentAlmacen?.event_id, currentAlmacen?.almacen_id],
    queryFn: () => getResumenInventario(currentAlmacen!.event_id, currentAlmacen!.almacen_id),
    enabled: !!currentAlmacen,
  });

  const { data: cajasData, isLoading: cajasLoading } = useQuery({
    queryKey: ['cajas', currentAlmacen?.event_id, currentAlmacen?.almacen_id],
    queryFn: () => getCajas(currentAlmacen!.event_id, currentAlmacen!.almacen_id),
    enabled: !!currentAlmacen,
  });

  const resumen = resumenData?.data;
  const cajas = cajasData?.data ?? [];

  if (loadingAlmacenes) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-10 w-full" />
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}
        </div>
      </div>
    );
  }

  if (misAlmacenes.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">Mi Inventario</h1>
        <Card className="text-center py-12">
          <CardContent>
            <Warehouse className="h-16 w-16 mx-auto mb-4 text-muted-foreground/40" />
            <h3 className="text-xl font-semibold mb-2">Sin almacen asignado</h3>
            <p className="text-muted-foreground">
              No tienes ningun almacen asignado. Contacta al administrador.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Auto-select if only one almacen
  if (misAlmacenes.length === 1 && !selectedAlmacen) {
    setSelectedAlmacen(misAlmacenes[0].almacen_id.toString());
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Mi Inventario</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Existencias en tu almacen
        </p>
      </div>

      {/* Almacen selector */}
      {misAlmacenes.length > 1 && (
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-2 max-w-sm">
              <Label>Almacen</Label>
              <Select value={selectedAlmacen} onValueChange={setSelectedAlmacen}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar almacen..." />
                </SelectTrigger>
                <SelectContent>
                  {misAlmacenes.map((a) => (
                    <SelectItem key={a.almacen_id} value={a.almacen_id.toString()}>
                      {a.almacen_name} ({a.almacen_code}) - {a.event_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      )}

      {currentAlmacen && (
        <>
          {/* Info del almacen */}
          <div className="flex items-center gap-3 px-1">
            <Warehouse className="h-5 w-5 text-primary" />
            <div>
              <span className="font-semibold">{currentAlmacen.almacen_name}</span>
              <span className="text-muted-foreground text-sm ml-2">({currentAlmacen.almacen_code})</span>
            </div>
            <Badge variant="outline" className="capitalize ml-2">{currentAlmacen.rol}</Badge>
            <span className="text-sm text-muted-foreground ml-auto">{currentAlmacen.event_name}</span>
          </div>

          {/* Resumen */}
          {resumen && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <Package className="h-4 w-4" /> Cajas
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{resumen.totalCajas}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <ClipboardList className="h-4 w-4" /> Libretas
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{resumen.totalLibretas}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <CreditCard className="h-4 w-4" /> Cartones
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{resumen.totalCartones}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Disponibles</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-green-600">{resumen.cartonesDisponibles}</div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Cajas */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Cajas</CardTitle>
            </CardHeader>
            <CardContent>
              {cajasLoading ? (
                <Skeleton className="h-32 w-full" />
              ) : cajas.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No hay cajas en este almacen
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Caja</TableHead>
                      <TableHead>Lotes</TableHead>
                      <TableHead>Cartones</TableHead>
                      <TableHead>Vendidos</TableHead>
                      <TableHead>Disponibles</TableHead>
                      <TableHead>Estado</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cajas.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-mono font-medium">{c.caja_code}</TableCell>
                        <TableCell>{c.total_lotes}</TableCell>
                        <TableCell>{c.total_cartones}</TableCell>
                        <TableCell>{c.asignados}</TableCell>
                        <TableCell className="text-green-600 font-medium">
                          {c.total_cartones - c.asignados}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="capitalize">{c.status}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Lotes */}
          {cajas.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Lotes (Libretas)</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Lote</TableHead>
                      <TableHead>Caja</TableHead>
                      <TableHead>Serie</TableHead>
                      <TableHead>Cartones</TableHead>
                      <TableHead>Vendidos</TableHead>
                      <TableHead>Estado</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cajas.flatMap((c) =>
                      c.lotes.map((l) => (
                        <TableRow key={l.id}>
                          <TableCell className="font-mono font-medium">{l.lote_code}</TableCell>
                          <TableCell className="font-mono text-sm">{c.caja_code}</TableCell>
                          <TableCell className="font-mono text-sm">{l.series_number}</TableCell>
                          <TableCell>{l.total_cards}</TableCell>
                          <TableCell>{l.cards_sold}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="capitalize text-xs">{l.status.replace('_', ' ')}</Badge>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
