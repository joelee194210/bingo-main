import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getInventoryMovements } from '@/services/api';
import { MOVEMENT_TYPE_LABELS } from '@/types';
import { Button } from '@/components/ui/button';
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
import { ArrowLeft, ChevronLeft, ChevronRight, Package } from 'lucide-react';

export default function MovementHistory() {
  const { eventId } = useParams<{ eventId: string }>();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [filterType, setFilterType] = useState<string>('all');
  const limit = 50;

  const { data, isLoading } = useQuery({
    queryKey: ['inventory-movements', eventId, page, filterType],
    queryFn: () =>
      getInventoryMovements(Number(eventId), {
        page,
        limit,
        movement_type: filterType === 'all' ? undefined : filterType,
      }),
    enabled: !!eventId,
  });

  const movements = data?.data || [];
  const pagination = data?.pagination;

  const getMovementBadge = (type: string) => {
    switch (type) {
      case 'initial_load':
        return <Badge variant="info">{MOVEMENT_TYPE_LABELS[type] || type}</Badge>;
      case 'assign_down':
        return <Badge variant="default">{MOVEMENT_TYPE_LABELS[type] || type}</Badge>;
      case 'return_up':
        return <Badge variant="warning">{MOVEMENT_TYPE_LABELS[type] || type}</Badge>;
      case 'mark_sold':
        return <Badge variant="success">{MOVEMENT_TYPE_LABELS[type] || type}</Badge>;
      case 'unmark_sold':
        return <Badge variant="destructive">{MOVEMENT_TYPE_LABELS[type] || type}</Badge>;
      default:
        return <Badge variant="secondary">{type}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/inventory')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Historial de Movimientos</h1>
            <p className="text-muted-foreground text-sm">Registro de todas las operaciones de inventario</p>
          </div>
        </div>
      </div>

      <div className="glow-card p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Package className="h-5 w-5 text-amber-500" />
            <span className="font-semibold">Filtrar por tipo</span>
          </div>
          <Select value={filterType} onValueChange={(v) => { setFilterType(v); setPage(1); }}>
            <SelectTrigger className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="initial_load">Carga Inicial</SelectItem>
              <SelectItem value="assign_down">Asignacion</SelectItem>
              <SelectItem value="return_up">Devolucion</SelectItem>
              <SelectItem value="mark_sold">Venta</SelectItem>
              <SelectItem value="unmark_sold">Reversion Venta</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500" />
          </div>
        ) : movements.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Package className="h-12 w-12 mx-auto mb-3 opacity-40" />
            <p>No hay movimientos registrados</p>
          </div>
        ) : (
          <>
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Carton</TableHead>
                    <TableHead>Serie</TableHead>
                    <TableHead>Desde</TableHead>
                    <TableHead>Hacia</TableHead>
                    <TableHead>Realizado por</TableHead>
                    <TableHead>Lote</TableHead>
                    <TableHead>Notas</TableHead>
                    <TableHead>Fecha</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {movements.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell>{getMovementBadge(m.movement_type)}</TableCell>
                      <TableCell className="font-mono text-sm">#{m.card_number}</TableCell>
                      <TableCell className="font-mono text-sm">{m.serial}</TableCell>
                      <TableCell>{m.from_node_name || '-'}</TableCell>
                      <TableCell>{m.to_node_name || '-'}</TableCell>
                      <TableCell>{m.performed_by_name}</TableCell>
                      <TableCell className="font-mono text-xs">{m.batch_id?.slice(0, 8) || '-'}</TableCell>
                      <TableCell className="max-w-[200px] truncate">{m.notes || '-'}</TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {new Date(m.created_at).toLocaleString('es')}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {pagination && pagination.totalPages > 1 && (
              <div className="flex items-center justify-between mt-4">
                <p className="text-sm text-muted-foreground">
                  Pagina {pagination.page} de {pagination.totalPages} ({pagination.total} registros)
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= pagination.totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
