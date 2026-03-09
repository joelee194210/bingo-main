import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Search, Eye, CreditCard, ChevronLeft, ChevronRight } from 'lucide-react';
import { getCards, getEvents } from '@/services/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export default function CardList() {
  const [eventId, setEventId] = useState<number | undefined>();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const limit = 20;

  const { data: eventsData } = useQuery({
    queryKey: ['events'],
    queryFn: getEvents,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['cards', eventId, page, search],
    queryFn: () => getCards({ event_id: eventId, page: search ? 1 : page, limit }),
  });

  const events = eventsData?.data || [];
  const cards = data?.data || [];
  const pagination = data?.pagination;

  const filteredCards = search
    ? cards.filter(c =>
        c.card_code.toLowerCase().includes(search.toLowerCase()) ||
        c.card_number.toString().includes(search) ||
        (c.serial && c.serial.includes(search))
      )
    : cards;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-4 w-48" />
          </div>
          <Skeleton className="h-10 w-40" />
        </div>
        <Card>
          <CardContent className="pt-6">
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 space-y-3">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="page-header flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Cartones</h2>
          <p className="text-muted-foreground text-sm mt-1">Administra los cartones de bingo</p>
        </div>
        {events.length > 0 && (
          <Button asChild>
            <Link to={`/cards/generate/${events[0].id}`}>
              <CreditCard className="mr-2 h-4 w-4" /> Generar Cartones
            </Link>
          </Button>
        )}
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-4">
            <div className="flex-1 min-w-[200px] space-y-2">
              <Label>Evento</Label>
              <Select
                value={eventId?.toString() || 'all'}
                onValueChange={(value) => {
                  setEventId(value === 'all' ? undefined : Number(value));
                  setPage(1);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Todos los eventos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los eventos</SelectItem>
                  {events.map((event) => (
                    <SelectItem key={event.id} value={event.id.toString()}>
                      {event.name} ({event.total_cards.toLocaleString()} cartones)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 min-w-[200px] space-y-2">
              <Label>Buscar</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground h-4 w-4" />
                <Input
                  className="pl-9"
                  placeholder="Código o número..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      {filteredCards.length === 0 ? (
        <Card className="text-center py-12">
          <CardContent>
            <div className="text-6xl mb-4">🎴</div>
            <h3 className="text-xl font-semibold mb-2">No hay cartones</h3>
            <p className="text-muted-foreground">Selecciona un evento o genera nuevos cartones</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Serie</TableHead>
                <TableHead>Código</TableHead>
                <TableHead>Validación</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Comprador</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredCards.map((card) => (
                <TableRow key={card.id}>
                  <TableCell className="font-mono">{card.card_number}</TableCell>
                  <TableCell className="font-mono text-sm">{card.serial}</TableCell>
                  <TableCell className="font-mono font-bold text-primary">{card.card_code}</TableCell>
                  <TableCell className="font-mono text-muted-foreground">{card.validation_code}</TableCell>
                  <TableCell>
                    <Badge variant={card.is_sold ? 'success' : 'secondary'}>
                      {card.is_sold ? 'Vendido' : 'Disponible'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{card.buyer_name || '-'}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" asChild>
                      <Link to={`/cards/validate?code=${card.card_code}`}>
                        <Eye className="h-4 w-4" />
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {/* Pagination */}
          {pagination && pagination.totalPages > 1 && (
            <div className="px-4 py-3 border-t flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Mostrando {(page - 1) * limit + 1}-{Math.min(page * limit, pagination.total)} de {pagination.total.toLocaleString()}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                >
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Anterior
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))}
                  disabled={page === pagination.totalPages}
                >
                  Siguiente
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
