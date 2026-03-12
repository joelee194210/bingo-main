import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus, Trash2, Eye, CreditCard, Loader2, Search } from 'lucide-react';
import { getEvents, createEvent, deleteEvent } from '@/services/api';
import { EVENT_STATUS_LABELS, type EventStatus } from '@/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { DataExportMenu } from '@/components/ui/data-export-menu';
import { getStatusColor } from '@/lib/badge-variants';

const EXPORT_COLUMNS = [
  { key: 'name', label: 'Nombre' },
  { key: 'description', label: 'Descripcion' },
  { key: 'status', label: 'Estado' },
  { key: 'total_cards', label: 'Total Cartones' },
  { key: 'cards_sold', label: 'Vendidos' },
  { key: 'use_free_center', label: 'Centro FREE' },
];

export default function EventList() {
  const [showModal, setShowModal] = useState(false);
  const [newEvent, setNewEvent] = useState({ name: '', description: '', use_free_center: true });
  const [searchTerm, setSearchTerm] = useState('');
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['events'],
    queryFn: getEvents,
  });

  const createMutation = useMutation({
    mutationFn: (data: { name: string; description?: string; use_free_center?: boolean }) => createEvent(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['events'] });
      setShowModal(false);
      setNewEvent({ name: '', description: '', use_free_center: true });
    },
  });

  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [deletingEventId, setDeletingEventId] = useState<number | null>(null);
  const deleteMutation = useMutation({
    mutationFn: deleteEvent,
    onSuccess: () => {
      setDeletingEventId(null);
      queryClient.invalidateQueries({ queryKey: ['events'] });
    },
    onError: () => setDeletingEventId(null),
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (newEvent.name.trim()) createMutation.mutate(newEvent);
  };

  const events = data?.data || [];

  const filteredEvents = useMemo(() => {
    if (!searchTerm.trim()) return events;
    const q = searchTerm.toLowerCase();
    return events.filter((ev) =>
      ev.name.toLowerCase().includes(q) ||
      (ev.description && ev.description.toLowerCase().includes(q))
    );
  }, [events, searchTerm]);

  const getStatusBadge = (status: EventStatus) => (
    <Badge className={getStatusColor(status)}>{EVENT_STATUS_LABELS[status]}</Badge>
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-2"><Skeleton className="h-8 w-32" /><Skeleton className="h-4 w-48" /></div>
          <Skeleton className="h-10 w-36" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <Card key={i}><CardHeader><Skeleton className="h-5 w-32" /><Skeleton className="h-4 w-48" /></CardHeader><CardContent><Skeleton className="h-20 w-full" /></CardContent></Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="page-header flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Eventos</h2>
          <p className="text-muted-foreground text-sm mt-1">Administra tus eventos de bingo</p>
        </div>
        <div className="flex items-center gap-2">
          <DataExportMenu
            data={filteredEvents as unknown as Record<string, unknown>[]}
            columns={EXPORT_COLUMNS}
            filename="eventos"
          />
          <Button onClick={() => setShowModal(true)}>
            <Plus className="mr-2 h-4 w-4" /> Nuevo Evento
          </Button>
        </div>
      </div>

      {/* Buscador */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground h-4 w-4" />
        <Input
          className="pl-9"
          placeholder="Buscar evento..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {filteredEvents.length === 0 ? (
        <Card className="text-center py-12">
          <CardContent>
            <h3 className="text-xl font-semibold mb-2">{searchTerm ? 'Sin resultados' : 'No hay eventos'}</h3>
            <p className="text-muted-foreground mb-4">
              {searchTerm ? 'Intenta con otro termino' : 'Crea tu primer evento de bingo para comenzar'}
            </p>
            {!searchTerm && <Button onClick={() => setShowModal(true)}>Crear Evento</Button>}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredEvents.map((event) => (
            <Card key={event.id} className="glow-card">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <CardTitle className="text-lg">{event.name}</CardTitle>
                    {event.description && <p className="text-sm text-muted-foreground">{event.description}</p>}
                  </div>
                  {getStatusBadge(event.status)}
                </div>
              </CardHeader>
              <CardContent className="pb-2">
                <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
                  <div><p className="text-muted-foreground">Total Cartones</p><p className="font-semibold">{event.total_cards.toLocaleString()}</p></div>
                  <div><p className="text-muted-foreground">Vendidos</p><p className="font-semibold">{event.cards_sold.toLocaleString()}</p></div>
                </div>
                <Badge variant={event.use_free_center !== 0 ? 'default' : 'warning'} className="text-xs">
                  {event.use_free_center !== 0 ? 'Centro FREE' : 'Centro con numero'}
                </Badge>
              </CardContent>
              <CardFooter className="gap-2">
                <Button variant="secondary" size="sm" asChild className="flex-1">
                  <Link to={`/events/${event.id}`}><Eye className="mr-1 h-4 w-4" /> Ver</Link>
                </Button>
                <Button variant="success" size="sm" asChild className="flex-1">
                  <Link to={`/cards/generate/${event.id}`}><CreditCard className="mr-1 h-4 w-4" /> Cartones</Link>
                </Button>
                <Button variant="destructive" size="sm" onClick={() => setDeleteConfirmId(event.id)} disabled={deletingEventId === event.id && deleteMutation.isPending}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}

      {/* Confirmar eliminacion */}
      <AlertDialog open={deleteConfirmId !== null} onOpenChange={(open) => { if (!open) setDeleteConfirmId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar este evento?</AlertDialogTitle>
            <AlertDialogDescription>Esta accion no se puede deshacer. Se eliminaran todos los cartones y juegos asociados.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => {
              if (deleteConfirmId) { setDeletingEventId(deleteConfirmId); deleteMutation.mutate(deleteConfirmId); }
              setDeleteConfirmId(null);
            }}>Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Modal Crear */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nuevo Evento</DialogTitle></DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="event-name">Nombre del Evento *</Label>
              <Input id="event-name" value={newEvent.name} onChange={(e) => setNewEvent({ ...newEvent, name: e.target.value })} placeholder="Ej: Bingo Navideno 2024" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="event-desc">Descripcion</Label>
              <Textarea id="event-desc" value={newEvent.description} onChange={(e) => setNewEvent({ ...newEvent, description: e.target.value })} placeholder="Descripcion opcional..." />
            </div>
            <div className="rounded-lg border bg-muted/50 p-4">
              <div className="flex items-center gap-3">
                <Switch id="free-center" checked={newEvent.use_free_center} onCheckedChange={(checked) => setNewEvent({ ...newEvent, use_free_center: checked })} />
                <div>
                  <Label htmlFor="free-center" className="cursor-pointer font-medium">Centro FREE</Label>
                  <p className="text-xs text-muted-foreground">{newEvent.use_free_center ? 'El centro del carton sera FREE (tradicional)' : 'El centro tendra un numero (mas dificil)'}</p>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowModal(false)}>Cancelar</Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {createMutation.isPending ? 'Creando...' : 'Crear Evento'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
