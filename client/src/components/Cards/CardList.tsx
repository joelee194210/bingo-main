import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Search, Eye, CreditCard, ChevronLeft, ChevronRight, Package, ClipboardList,
  Filter, X, Warehouse, ChevronsLeft, ChevronsRight,
} from 'lucide-react';
import { getCards, getEvents, getAlmacenes } from '@/services/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { DataExportMenu } from '@/components/ui/data-export-menu';
import { SortableHeader } from '@/components/ui/sortable-header';
import { getStatusColor } from '@/lib/badge-variants';
import type { SortState } from '@/hooks/useTableControls';

const EXPORT_COLUMNS = [
  { key: 'serial', label: 'Serie' },
  { key: 'card_number', label: '#' },
  { key: 'card_code', label: 'Codigo' },
  { key: 'validation_code', label: 'Validacion' },
  { key: 'caja_code', label: 'Caja' },
  { key: 'lote_code', label: 'Libreta' },
  { key: 'almacen_name', label: 'Ubicacion' },
  { key: 'is_sold', label: 'Vendido' },
  { key: 'buyer_name', label: 'Comprador' },
];

export default function CardList() {
  const [eventId, setEventId] = useState<number | undefined>();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [estadoFilter, setEstadoFilter] = useState<string>('all');
  const [almacenFilter, setAlmacenFilter] = useState<string>('');
  const [showFilters, setShowFilters] = useState(false);
  const [sort, setSort] = useState<SortState>({ column: null, direction: null });
  const limit = 30;

  const { data: eventsData } = useQuery({ queryKey: ['events'], queryFn: getEvents });
  const { data: almacenesData } = useQuery({
    queryKey: ['almacenes', eventId],
    queryFn: () => getAlmacenes(eventId!),
    enabled: !!eventId,
  });

  const queryParams: Record<string, unknown> = { event_id: eventId, page, limit };
  if (search.trim()) { queryParams.search = search.trim(); queryParams.page = 1; }
  if (estadoFilter && estadoFilter !== 'all') queryParams.is_sold = estadoFilter;
  if (almacenFilter) queryParams.almacen_id = Number(almacenFilter);
  if (sort.column && sort.direction) {
    queryParams.sort_by = sort.column;
    queryParams.sort_dir = sort.direction;
  }

  const { data, isLoading } = useQuery({
    queryKey: ['cards', eventId, page, search, estadoFilter, almacenFilter, sort.column, sort.direction],
    queryFn: () => getCards(queryParams as any),
    enabled: !!eventId,
  });

  const events = eventsData?.data || [];
  const cards = data?.data || [];
  const pagination = data?.pagination;
  const almacenes = almacenesData?.data || [];

  const hasActiveFilters = estadoFilter !== 'all' || !!almacenFilter;

  const clearFilters = () => { setEstadoFilter('all'); setAlmacenFilter(''); setSearch(''); setPage(1); };

  const toggleSort = (column: string) => {
    setSort(prev => {
      if (prev.column !== column) return { column, direction: 'asc' };
      if (prev.direction === 'asc') return { column, direction: 'desc' };
      return { column: null, direction: null };
    });
    setPage(1);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Cartones</h2>
          <p className="text-muted-foreground text-sm mt-1">Busca por codigo, caja, libreta, serie, comprador</p>
        </div>
        <div className="flex items-center gap-2">
          <DataExportMenu
            data={cards as unknown as Record<string, unknown>[]}
            columns={EXPORT_COLUMNS}
            filename={`cartones_pagina_${page}`}
          />
          {events.length > 0 && eventId && (
            <Button asChild>
              <Link to={`/cards/generate/${eventId}`}><CreditCard className="mr-2 h-4 w-4" /> Generar Cartones</Link>
            </Button>
          )}
        </div>
      </div>

      {/* Search bar */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="w-full sm:w-[220px] space-y-1">
              <Label className="text-xs">Evento</Label>
              <Select value={eventId?.toString() || ''} onValueChange={(v) => { setEventId(Number(v)); setPage(1); }}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                <SelectContent>
                  {events.map((ev) => (
                    <SelectItem key={ev.id} value={ev.id.toString()}>{ev.name} ({ev.total_cards.toLocaleString()})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 space-y-1">
              <Label className="text-xs">Buscar</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground h-4 w-4" />
                <Input className="pl-9 h-9" placeholder="Codigo carton, caja, libreta, serie, comprador..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
              </div>
            </div>
            <Button variant={showFilters || hasActiveFilters ? 'default' : 'outline'} size="sm" className="h-9" onClick={() => setShowFilters(!showFilters)}>
              <Filter className="h-4 w-4 mr-1" /> Filtros
              {hasActiveFilters && <Badge variant="secondary" className="ml-1 h-5 px-1 text-[10px]">!</Badge>}
            </Button>
          </div>
          {showFilters && (
            <div className="flex flex-wrap gap-3 items-end mt-3 pt-3 border-t">
              <div className="w-[160px] space-y-1">
                <Label className="text-xs">Estado</Label>
                <Select value={estadoFilter} onValueChange={(v) => { setEstadoFilter(v); setPage(1); }}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="false">Disponible</SelectItem>
                    <SelectItem value="true">Vendido</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="w-[220px] space-y-1">
                <Label className="text-xs">Ubicacion (Almacen)</Label>
                <Select value={almacenFilter} onValueChange={(v) => { setAlmacenFilter(v); setPage(1); }}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Todos" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Todos</SelectItem>
                    {almacenes.map((a) => (
                      <SelectItem key={a.id} value={a.id.toString()}>{a.name} ({a.code})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {hasActiveFilters && (
                <Button variant="ghost" size="sm" className="h-9 text-xs" onClick={clearFilters}>
                  <X className="h-3 w-3 mr-1" /> Limpiar
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Resultados */}
      {!eventId ? (
        <Card className="text-center py-12">
          <CardContent>
            <CreditCard className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-1">Selecciona un evento</h3>
            <p className="text-muted-foreground text-sm">Elige un evento para ver sus cartones</p>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <Card><CardContent className="pt-6 space-y-3">{[...Array(8)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</CardContent></Card>
      ) : cards.length === 0 ? (
        <Card className="text-center py-12">
          <CardContent>
            <Search className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <h3 className="text-lg font-semibold mb-1">Sin resultados</h3>
            <p className="text-muted-foreground text-sm">{search ? `No se encontraron cartones para "${search}"` : 'No hay cartones con estos filtros'}</p>
            {(search || hasActiveFilters) && <Button variant="outline" size="sm" className="mt-3" onClick={clearFilters}>Limpiar filtros</Button>}
          </CardContent>
        </Card>
      ) : (
        <Card>
          {pagination && (
            <div className="px-4 py-2 border-b bg-muted/30 flex items-center gap-4 text-sm">
              <span className="font-medium">{pagination.total.toLocaleString()} cartones</span>
              {search && <Badge variant="secondary" className="text-xs">Busqueda: "{search}"</Badge>}
              {estadoFilter === 'true' && <Badge className={getStatusColor('sold') + ' text-xs'}>Vendidos</Badge>}
              {estadoFilter === 'false' && <Badge className={getStatusColor('available') + ' text-xs'}>Disponibles</Badge>}
            </div>
          )}
          <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <SortableHeader label="Serie" column="serial" sort={sort} onSort={toggleSort} />
                </TableHead>
                <TableHead className="w-16">
                  <SortableHeader label="#" column="card_number" sort={sort} onSort={toggleSort} />
                </TableHead>
                <TableHead>
                  <SortableHeader label="Codigo" column="card_code" sort={sort} onSort={toggleSort} />
                </TableHead>
                <TableHead>Validacion</TableHead>
                <TableHead><div className="flex items-center gap-1"><Package className="h-3.5 w-3.5" /> Caja</div></TableHead>
                <TableHead><div className="flex items-center gap-1"><ClipboardList className="h-3.5 w-3.5" /> Libreta</div></TableHead>
                <TableHead><div className="flex items-center gap-1"><Warehouse className="h-3.5 w-3.5" /> Ubicacion</div></TableHead>
                <TableHead>
                  <SortableHeader label="Estado" column="is_sold" sort={sort} onSort={toggleSort} />
                </TableHead>
                <TableHead>
                  <SortableHeader label="Comprador" column="buyer_name" sort={sort} onSort={toggleSort} />
                </TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cards.map((card) => (
                <TableRow key={card.id} className={card.is_sold ? 'bg-green-50/50 dark:bg-green-950/10' : ''}>
                  <TableCell className="font-mono text-sm text-muted-foreground">{card.serial}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{card.card_number}</TableCell>
                  <TableCell><span className="font-mono font-bold text-primary">{card.card_code}</span></TableCell>
                  <TableCell><span className="font-mono text-xs text-muted-foreground">{card.validation_code}</span></TableCell>
                  <TableCell>
                    {card.caja_code ? <Badge variant="outline" className="font-mono text-xs">{card.caja_code}</Badge> : <span className="text-muted-foreground">-</span>}
                  </TableCell>
                  <TableCell>
                    {card.lote_code ? <Badge variant="outline" className="font-mono text-xs">{card.lote_code}</Badge> : <span className="text-muted-foreground">-</span>}
                  </TableCell>
                  <TableCell>
                    {card.almacen_name ? <span className="text-xs">{card.almacen_name}</span> : <span className="text-xs text-muted-foreground">Sin asignar</span>}
                  </TableCell>
                  <TableCell>
                    <Badge className={getStatusColor(card.is_sold ? 'sold' : 'available') + ' text-xs'}>
                      {card.is_sold ? 'Vendido' : 'Disponible'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{card.buyer_name || <span className="text-muted-foreground">-</span>}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
                      <Link to={`/cards/validate?code=${card.card_code}`}><Eye className="h-3.5 w-3.5" /></Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>

          {/* Pagination */}
          {pagination && pagination.totalPages > 1 && (
            <div className="px-4 py-3 border-t flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Mostrando {(page - 1) * limit + 1}-{Math.min(page * limit, pagination.total)} de {pagination.total.toLocaleString()}
              </p>
              <div className="flex items-center gap-1.5">
                <Button variant="outline" size="icon" className="h-8 w-8" disabled={page <= 1} onClick={() => setPage(1)}>
                  <ChevronsLeft className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="icon" className="h-8 w-8" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm font-medium px-2 tabular-nums">{page} / {pagination.totalPages}</span>
                <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= pagination.totalPages} onClick={() => setPage(p => p + 1)}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= pagination.totalPages} onClick={() => setPage(pagination.totalPages)}>
                  <ChevronsRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
