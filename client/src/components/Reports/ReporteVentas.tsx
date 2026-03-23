import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getReporteVentas,
  downloadReporteVentasPdf,
  getEvents,
  getAlmacenTree,
  getDocumentoPdf,
  type ReporteVentasResumen,
} from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  FileDown,
  Search,
  ShoppingCart,
  Package,
  FileText,
  Loader2,
  Calendar,
  BarChart3,
} from 'lucide-react';

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateTime(dateStr: string) {
  return new Date(dateStr).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function ReporteVentas() {
  const { hasPermission } = useAuth();
  const isAdmin = hasPermission('reports:export');

  // Default: ultimos 7 dias (hora local, no UTC)
  const formatLocalDate = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  const today = formatLocalDate(new Date());
  const weekAgo = formatLocalDate(new Date(Date.now() - 7 * 86400000));

  const [eventId, setEventId] = useState<number | null>(null);
  const [desde, setDesde] = useState(weekAgo);
  const [hasta, setHasta] = useState(today);
  const [almacenId, setAlmacenId] = useState<number | undefined>();
  const [vendedorId, setVendedorId] = useState<number | undefined>();
  const [downloading, setDownloading] = useState(false);

  // Obtener eventos
  const { data: eventsRes } = useQuery({
    queryKey: ['events'],
    queryFn: () => getEvents(),
  });
  const events = eventsRes?.data || [];

  // Auto-seleccionar primer evento
  useEffect(() => {
    if (!eventId && events.length > 0) setEventId(events[0].id);
  }, [events, eventId]);

  // Almacenes del evento (para filtro)
  const { data: treeData } = useQuery({
    queryKey: ['almacen-tree', eventId],
    queryFn: () => getAlmacenTree(eventId!),
    enabled: !!eventId,
  });
  const almacenesEvento = useMemo(() => {
    const flat: { id: number; name: string }[] = [];
    const walk = (nodes: any[]) => {
      for (const n of nodes) {
        flat.push({ id: n.id, name: n.name });
        if (n.children?.length) walk(n.children);
      }
    };
    walk(treeData?.data || []);
    return flat;
  }, [treeData]);

  // Reporte — carga automáticamente cuando hay evento y fechas
  const { data: reporteRes, isLoading, refetch } = useQuery({
    queryKey: ['reporte-ventas', eventId, desde, hasta, almacenId, vendedorId],
    queryFn: () => getReporteVentas(eventId!, { desde, hasta, almacen_id: almacenId, vendedor_id: vendedorId }),
    enabled: !!eventId && !!desde && !!hasta,
  });
  const reporte = reporteRes?.data;

  // Vendedores unicos del reporte (para filtro)
  const vendedores = useMemo(() => {
    if (!reporte) return [];
    const map = new Map<number, string>();
    for (const r of reporte.resumen) {
      if (r.vendedor_id) map.set(r.vendedor_id, r.vendedor_nombre);
    }
    return Array.from(map, ([id, nombre]) => ({ id, nombre }));
  }, [reporte]);

  const handleDescargarPdf = async () => {
    if (!eventId) return;
    setDownloading(true);
    try {
      const blob = await downloadReporteVentasPdf(eventId, { desde, hasta, almacen_id: almacenId, vendedor_id: vendedorId });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `reporte_ventas_${desde}_${hasta}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error descargando PDF:', err);
    } finally {
      setDownloading(false);
    }
  };

  const handleDescargarDocPdf = async (docId: number) => {
    try {
      const blob = await getDocumentoPdf(docId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `documento_venta_${docId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error descargando PDF:', err);
    }
  };

  // Agrupar resumen por fecha
  const resumenPorFecha = useMemo(() => {
    if (!reporte) return [];
    const map = new Map<string, { fecha: string; cartones: number; detalles: ReporteVentasResumen[] }>();
    for (const r of reporte.resumen) {
      const key = r.fecha;
      if (!map.has(key)) map.set(key, { fecha: key, cartones: 0, detalles: [] });
      const entry = map.get(key)!;
      entry.cartones += r.cartones_vendidos;
      entry.detalles.push(r);
    }
    return Array.from(map.values());
  }, [reporte]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Reporte de Ventas</h1>
          <p className="text-muted-foreground text-sm">Consulta tus ventas por rango de fecha y almacen</p>
        </div>
        <Button onClick={handleDescargarPdf} disabled={!eventId || !reporte || downloading}>
          {downloading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileDown className="h-4 w-4 mr-2" />}
          Exportar PDF
        </Button>
      </div>

      {/* Filtros */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Search className="h-4 w-4" /> Filtros
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {/* Evento */}
            <div className="space-y-1.5">
              <Label className="text-xs">Evento</Label>
              <Select value={eventId?.toString() || ''} onValueChange={(v) => setEventId(parseInt(v, 10))}>
                <SelectTrigger><SelectValue placeholder="Seleccionar evento" /></SelectTrigger>
                <SelectContent>
                  {events.map((e: any) => (
                    <SelectItem key={e.id} value={e.id.toString()}>{e.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Desde */}
            <div className="space-y-1.5">
              <Label className="text-xs">Desde</Label>
              <Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
            </div>

            {/* Hasta */}
            <div className="space-y-1.5">
              <Label className="text-xs">Hasta</Label>
              <Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
            </div>

            {/* Almacen */}
            {almacenesEvento.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-xs">Almacen</Label>
                <Select value={almacenId?.toString() || 'all'} onValueChange={(v) => setAlmacenId(v === 'all' ? undefined : parseInt(v, 10))}>
                  <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    {almacenesEvento.map(a => (
                      <SelectItem key={a.id} value={a.id.toString()}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Vendedor (solo admin) */}
            {isAdmin && vendedores.length > 1 && (
              <div className="space-y-1.5">
                <Label className="text-xs">Vendedor</Label>
                <Select value={vendedorId?.toString() || 'all'} onValueChange={(v) => setVendedorId(v === 'all' ? undefined : parseInt(v, 10))}>
                  <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    {vendedores.map(v => (
                      <SelectItem key={v.id} value={v.id.toString()}>{v.nombre}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {/* Botón Buscar */}
            <div className="flex items-end">
              <Button onClick={() => refetch()} disabled={!eventId || !desde || !hasta || isLoading}>
                {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                Buscar
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Resultados */}
      {reporte && !isLoading && (
        <>
          {/* Tarjetas resumen */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-950">
                    <ShoppingCart className="h-5 w-5 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{reporte.totales.cartones.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">Cartones vendidos</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-green-50 dark:bg-green-950">
                    <FileText className="h-5 w-5 text-green-600" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{reporte.totales.documentos}</p>
                    <p className="text-xs text-muted-foreground">Documentos de venta</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-purple-50 dark:bg-purple-950">
                    <Calendar className="h-5 w-5 text-purple-600" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{resumenPorFecha.length}</p>
                    <p className="text-xs text-muted-foreground">Dias con ventas</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Tabs */}
          <Tabs defaultValue="resumen">
            <TabsList>
              <TabsTrigger value="resumen" className="gap-1.5">
                <BarChart3 className="h-3.5 w-3.5" /> Resumen
              </TabsTrigger>
              <TabsTrigger value="detalle" className="gap-1.5">
                <FileText className="h-3.5 w-3.5" /> Documentos
              </TabsTrigger>
            </TabsList>

            {/* Tab Resumen */}
            <TabsContent value="resumen">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Ventas por dia</CardTitle>
                </CardHeader>
                <CardContent>
                  {resumenPorFecha.length === 0 ? (
                    <p className="text-muted-foreground text-sm py-8 text-center">No hay ventas en este rango</p>
                  ) : (
                    <div className="space-y-3">
                      {resumenPorFecha.map(({ fecha, cartones, detalles }) => (
                        <div key={fecha} className="border rounded-lg overflow-hidden">
                          <div className="bg-muted/50 px-4 py-2 flex items-center justify-between">
                            <span className="font-medium text-sm">{formatDate(fecha)}</span>
                            <Badge variant="secondary">{cartones.toLocaleString()} cartones</Badge>
                          </div>
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Almacen</TableHead>
                                <TableHead>Vendedor</TableHead>
                                <TableHead className="text-right">Cartones</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {detalles.map((d, i) => (
                                <TableRow key={i}>
                                  <TableCell className="text-sm">{d.almacen_nombre}</TableCell>
                                  <TableCell className="text-sm">{d.vendedor_nombre || '-'}</TableCell>
                                  <TableCell className="text-right font-medium">{d.cartones_vendidos.toLocaleString()}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Tab Detalle */}
            <TabsContent value="detalle">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Documentos de Venta</CardTitle>
                </CardHeader>
                <CardContent>
                  {reporte.detalle.length === 0 ? (
                    <p className="text-muted-foreground text-sm py-8 text-center">No hay documentos de venta en este rango</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-[50px]">#</TableHead>
                            <TableHead>Fecha</TableHead>
                            <TableHead>Almacen</TableHead>
                            <TableHead>Comprador</TableHead>
                            <TableHead>Cedula</TableHead>
                            <TableHead>Items</TableHead>
                            <TableHead className="text-right">Cartones</TableHead>
                            <TableHead>Vendedor</TableHead>
                            <TableHead className="w-[60px]"></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {reporte.detalle.map((doc, i) => (
                            <TableRow key={doc.documento_id}>
                              <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                              <TableCell className="text-sm whitespace-nowrap">{formatDateTime(doc.fecha)}</TableCell>
                              <TableCell className="text-sm">{doc.almacen_nombre}</TableCell>
                              <TableCell className="text-sm font-medium">{doc.comprador}</TableCell>
                              <TableCell className="text-sm">{doc.cedula || '-'}</TableCell>
                              <TableCell>
                                <div className="flex flex-wrap gap-1">
                                  {doc.items?.map((item, j) => (
                                    <Badge key={j} variant="outline" className="text-[10px]">
                                      <Package className="h-2.5 w-2.5 mr-1" />
                                      {item.tipo === 'caja' ? 'C' : item.tipo === 'libreta' ? 'L' : '#'}: {item.referencia}
                                    </Badge>
                                  ))}
                                </div>
                              </TableCell>
                              <TableCell className="text-right font-bold">{doc.total_cartones.toLocaleString()}</TableCell>
                              <TableCell className="text-sm">{doc.vendedor_nombre}</TableCell>
                              <TableCell>
                                {doc.pdf_path && (
                                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleDescargarDocPdf(doc.documento_id)} title="Descargar PDF">
                                    <FileDown className="h-3.5 w-3.5" />
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
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
