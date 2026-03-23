import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Package, ClipboardList, CreditCard, Warehouse,
  ChevronRight, ChevronDown, Search, Loader2,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  getMisAlmacenes,
  getResumenInventario,
  getCajas,
  getCartonesLote,
  getLibretasSueltas,
  getCartonesSueltos,
} from '@/services/api';

export default function MiInventario() {
  const [selectedAlmacen, setSelectedAlmacen] = useState<string>('');
  const [search, setSearch] = useState('');
  const [expandedCajas, setExpandedCajas] = useState<Set<number>>(new Set());
  const [expandedLotes, setExpandedLotes] = useState<Set<number>>(new Set());
  const [loteCartones, setLoteCartones] = useState<Record<number, { id: number; card_code: string; serial: string; is_sold: boolean; buyer_name: string | null }[]>>({});
  const [loadingLotes, setLoadingLotes] = useState<Set<number>>(new Set());

  const { data: misAlmacenesData, isLoading: loadingAlmacenes } = useQuery({
    queryKey: ['mis-almacenes'],
    queryFn: getMisAlmacenes,
  });

  const misAlmacenes = useMemo(() => misAlmacenesData?.data || [], [misAlmacenesData?.data]);
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

  const { data: libretasSueltasData } = useQuery({
    queryKey: ['libretas-sueltas', currentAlmacen?.event_id, currentAlmacen?.almacen_id],
    queryFn: () => getLibretasSueltas(currentAlmacen!.event_id, currentAlmacen!.almacen_id),
    enabled: !!currentAlmacen,
  });

  const { data: cartonesSueltosData } = useQuery({
    queryKey: ['cartones-sueltos', currentAlmacen?.event_id, currentAlmacen?.almacen_id],
    queryFn: () => getCartonesSueltos(currentAlmacen!.event_id, currentAlmacen!.almacen_id),
    enabled: !!currentAlmacen,
  });

  const resumen = resumenData?.data;
  const cajas = cajasData?.data ?? [];
  const libretasSueltas = libretasSueltasData?.data ?? [];
  const cartonesSueltos = cartonesSueltosData?.data ?? [];

  // Auto-select if only one almacen
  useEffect(() => {
    if (misAlmacenes.length === 1 && !selectedAlmacen) {
      setSelectedAlmacen(misAlmacenes[0].almacen_id.toString());
    }
  }, [misAlmacenes, selectedAlmacen]);

  const toggleCaja = (cajaId: number) => {
    setExpandedCajas(prev => {
      const next = new Set(prev);
      if (next.has(cajaId)) next.delete(cajaId);
      else next.add(cajaId);
      return next;
    });
  };

  const toggleLote = async (loteId: number) => {
    if (expandedLotes.has(loteId)) {
      setExpandedLotes(prev => { const next = new Set(prev); next.delete(loteId); return next; });
      return;
    }

    // Cargar cartones si no estan cargados
    if (!loteCartones[loteId]) {
      setLoadingLotes(prev => new Set(prev).add(loteId));
      try {
        const result = await getCartonesLote(loteId);
        setLoteCartones(prev => ({ ...prev, [loteId]: result.data || [] }));
      } catch {
        setLoteCartones(prev => ({ ...prev, [loteId]: [] }));
      } finally {
        setLoadingLotes(prev => { const next = new Set(prev); next.delete(loteId); return next; });
      }
    }

    setExpandedLotes(prev => new Set(prev).add(loteId));
  };

  // Filtrar cajas por búsqueda
  const searchLower = search.toLowerCase();
  const filteredCajas = search
    ? cajas.filter(c =>
        c.caja_code.toLowerCase().includes(searchLower) ||
        c.lotes.some(l =>
          l.lote_code.toLowerCase().includes(searchLower) ||
          l.series_number.toLowerCase().includes(searchLower)
        )
      )
    : cajas;

  if (loadingAlmacenes) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-10 w-full" />
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
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
          <div className="flex flex-wrap items-center gap-2 px-1">
            <Warehouse className="h-5 w-5 text-primary shrink-0" />
            <div className="min-w-0">
              <span className="font-semibold truncate">{currentAlmacen.almacen_name}</span>
              <span className="text-muted-foreground text-sm ml-1">({currentAlmacen.almacen_code})</span>
            </div>
            <Badge variant="outline" className="capitalize shrink-0">{currentAlmacen.rol}</Badge>
            <span className="text-sm text-muted-foreground w-full sm:w-auto sm:ml-auto">{currentAlmacen.event_name}</span>
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
                    <ClipboardList className="h-4 w-4" /> Lotes
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

          {/* Buscador */}
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar caja, lote o serie..."
              className="pl-9"
            />
          </div>

          {/* Arbol expandible */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Inventario ({filteredCajas.length} cajas)</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {cajasLoading ? (
                <div className="p-6"><Skeleton className="h-32 w-full" /></div>
              ) : filteredCajas.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  {search ? 'Sin resultados' : 'No hay cajas en este almacen'}
                </p>
              ) : (
                <div className="divide-y">
                  {filteredCajas.map((caja) => {
                    const isExpanded = expandedCajas.has(caja.id);
                    const vendidosCaja = caja.lotes.reduce((s, l) => s + l.cards_sold, 0);

                    return (
                      <div key={caja.id}>
                        {/* Fila de Caja */}
                        <button
                          onClick={() => toggleCaja(caja.id)}
                          className="w-full px-4 py-3 hover:bg-muted/50 transition-colors text-left"
                        >
                          <div className="flex items-center gap-2">
                            {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
                            <Package className="h-4 w-4 text-blue-600 shrink-0" />
                            <span className="font-mono font-bold text-sm">{caja.caja_code}</span>
                            <Badge variant="outline" className="capitalize text-xs ml-auto shrink-0">{caja.status}</Badge>
                          </div>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 ml-10 text-xs text-muted-foreground">
                            <span>{caja.total_lotes} lotes</span>
                            <span>{caja.total_cartones} cartones</span>
                            <span className="text-blue-600">{vendidosCaja} vendidos</span>
                            <span className="text-green-600 font-medium">{caja.total_cartones - vendidosCaja} disp.</span>
                          </div>
                        </button>

                        {/* Lotes de la caja */}
                        {isExpanded && (
                          <div className="bg-muted/30">
                            {caja.lotes.map((lote) => {
                              const isLoteExpanded = expandedLotes.has(lote.id);
                              const isLoading = loadingLotes.has(lote.id);
                              const cartones = loteCartones[lote.id];
                              const disponibles = lote.total_cards - lote.cards_sold;

                              return (
                                <div key={lote.id}>
                                  {/* Fila de Libreta */}
                                  <button
                                    onClick={() => toggleLote(lote.id)}
                                    className="w-full px-4 py-2 pl-12 hover:bg-muted/60 transition-colors text-left"
                                  >
                                    <div className="flex items-center gap-2">
                                      {isLoading ? (
                                        <Loader2 className="h-3.5 w-3.5 text-muted-foreground animate-spin shrink-0" />
                                      ) : isLoteExpanded ? (
                                        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                      ) : (
                                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                      )}
                                      <ClipboardList className="h-3.5 w-3.5 text-purple-600 shrink-0" />
                                      <span className="font-mono font-medium text-sm">{lote.lote_code}</span>
                                      <span className="text-xs text-muted-foreground hidden sm:inline">Serie: {lote.series_number}</span>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 ml-8 text-xs text-muted-foreground">
                                      <span className="sm:hidden">S: {lote.series_number}</span>
                                      <span>{lote.total_cards} cartones</span>
                                      <span className="text-blue-600">{lote.cards_sold} vendidos</span>
                                      <span className="text-green-600 font-medium">{disponibles} disp.</span>
                                    </div>
                                  </button>

                                  {/* Cartones del lote */}
                                  {isLoteExpanded && cartones && (
                                    <div className="bg-muted/50 px-4 py-2 pl-8 sm:pl-20">
                                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-1.5">
                                        {cartones.map((c) => (
                                          <div
                                            key={c.id}
                                            className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs border ${
                                              c.is_sold
                                                ? 'bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-400'
                                                : 'bg-green-50 border-green-200 text-green-700 dark:bg-green-900/20 dark:border-green-800 dark:text-green-400'
                                            }`}
                                          >
                                            <CreditCard className="h-3 w-3 shrink-0" />
                                            <span className="font-mono font-medium">
                                              {c.serial.replace(/^0+/, '').replace(/-0+/, '-')}
                                            </span>
                                            {c.is_sold && c.buyer_name && (
                                              <span className="truncate text-[10px] opacity-70">({c.buyer_name})</span>
                                            )}
                                          </div>
                                        ))}
                                      </div>
                                      <div className="mt-2 text-xs text-muted-foreground">
                                        {cartones.filter(c => !c.is_sold).length} disponibles — {cartones.filter(c => c.is_sold).length} vendidos
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Libretas sueltas (sin caja en este almacén) — expandibles */}
          {libretasSueltas.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <ClipboardList className="h-4 w-4 text-amber-500" />
                  Libretas Individuales ({libretasSueltas.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="divide-y">
                  {libretasSueltas.map(l => {
                    const isExpanded = expandedLotes.has(l.id);
                    const cartones = loteCartones[l.id];
                    const isLoadingLote = loadingLotes.has(l.id);
                    return (
                      <div key={l.id}>
                        <div
                          className="py-2 flex items-center justify-between cursor-pointer hover:bg-muted/50 rounded px-2"
                          onClick={() => toggleLote(l.id)}
                        >
                          <div className="flex items-center gap-2">
                            <ChevronRight className={`h-3.5 w-3.5 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                            <span className="font-mono font-medium text-sm">{l.lote_code}</span>
                            {l.caja_code && <span className="text-xs text-muted-foreground">(de caja {l.caja_code})</span>}
                          </div>
                          <div className="flex items-center gap-2 text-xs">
                            <span>{l.total_cards - l.cards_sold} disp.</span>
                            <span className="text-muted-foreground">/ {l.total_cards}</span>
                            <Badge variant={l.cards_sold > 0 ? 'success' : 'secondary'} className="text-[10px]">
                              {l.cards_sold} vend.
                            </Badge>
                          </div>
                        </div>
                        {isExpanded && (
                          <div className="pl-8 pb-2">
                            {isLoadingLote ? (
                              <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
                                <Loader2 className="h-3 w-3 animate-spin" /> Cargando cartones...
                              </div>
                            ) : cartones ? (
                              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1">
                                {cartones.map(c => (
                                  <div key={c.id} className={`text-xs px-2 py-1 rounded flex items-center justify-between ${c.is_sold ? 'bg-green-50 dark:bg-green-950/30' : 'bg-muted/50'}`}>
                                    <span className="font-mono">{c.serial}</span>
                                    {c.is_sold ? (
                                      <span className="text-[10px] text-green-600 truncate ml-1" title={c.buyer_name || ''}>
                                        {c.buyer_name || 'Vendido'}
                                      </span>
                                    ) : (
                                      <span className="text-[10px] text-muted-foreground">Disp.</span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Cartones sueltos (sin lote en este almacén) */}
          {cartonesSueltos.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-blue-500" />
                  Cartones Individuales ({cartonesSueltos.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="divide-y">
                  {cartonesSueltos.map(c => (
                    <div key={c.id} className={`py-2 flex items-center justify-between px-2 rounded ${c.is_sold ? 'bg-green-50 dark:bg-green-950/30' : ''}`}>
                      <div>
                        <span className="font-mono font-medium text-sm">{c.serial}</span>
                        <span className="text-xs text-muted-foreground ml-2">{c.card_code}</span>
                        {c.lote_code && <span className="text-xs text-muted-foreground ml-1">(de libreta {c.lote_code})</span>}
                      </div>
                      <div className="flex items-center gap-2">
                        {c.is_sold && c.buyer_name && (
                          <span className="text-xs text-green-600 truncate max-w-[120px]">{c.buyer_name}</span>
                        )}
                        <Badge variant={c.is_sold ? 'success' : 'secondary'} className="text-[10px]">
                          {c.is_sold ? 'Vendido' : 'Disponible'}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
