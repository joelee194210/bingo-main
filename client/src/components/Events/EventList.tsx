import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus, Trash2, Eye, CreditCard, Loader2 } from 'lucide-react';
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export default function EventList() {
  const [showModal, setShowModal] = useState(false);
  const [newEvent, setNewEvent] = useState({ name: '', description: '', use_free_center: true });
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
    if (newEvent.name.trim()) {
      createMutation.mutate(newEvent);
    }
  };

  const getStatusBadge = (status: EventStatus) => {
    switch (status) {
      case 'active':
        return <Badge variant="success">{EVENT_STATUS_LABELS[status]}</Badge>;
      case 'draft':
        return <Badge variant="secondary">{EVENT_STATUS_LABELS[status]}</Badge>;
      case 'completed':
        return <Badge variant="info">{EVENT_STATUS_LABELS[status]}</Badge>;
      default:
        return <Badge variant="destructive">{EVENT_STATUS_LABELS[status]}</Badge>;
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-4 w-48" />
          </div>
          <Skeleton className="h-10 w-36" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-4 w-48" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-20 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const events = data?.data || [];

  return (
    <div className="space-y-6">
      <div className="page-header flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Eventos</h2>
          <p className="text-muted-foreground text-sm mt-1">Administra tus eventos de bingo</p>
        </div>
        <Button onClick={() => setShowModal(true)}>
          <Plus className="mr-2 h-4 w-4" /> Nuevo Evento
        </Button>
      </div>

      {events.length === 0 ? (
        <Card className="text-center py-12">
          <CardContent>
            <div className="text-6xl mb-4">🎱</div>
            <h3 className="text-xl font-semibold mb-2">No hay eventos</h3>
            <p className="text-muted-foreground mb-4">Crea tu primer evento de bingo para comenzar</p>
            <Button onClick={() => setShowModal(true)}>Crear Evento</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {events.map((event) => (
            <Card key={event.id} className="glow-card">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <CardTitle className="text-lg">{event.name}</CardTitle>
                    {event.description && (
                      <p className="text-sm text-muted-foreground">{event.description}</p>
                    )}
                  </div>
                  {getStatusBadge(event.status)}
                </div>
              </CardHeader>

              <CardContent className="pb-2">
                <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">Total Cartones</p>
                    <p className="font-semibold">{event.total_cards.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Vendidos</p>
                    <p className="font-semibold">{event.cards_sold.toLocaleString()}</p>
                  </div>
                </div>

                <Badge variant={event.use_free_center !== 0 ? 'default' : 'warning'} className="text-xs">
                  {event.use_free_center !== 0 ? '⭐ Centro FREE' : '🔢 Centro con número'}
                </Badge>
              </CardContent>

              <CardFooter className="gap-2">
                <Button variant="secondary" size="sm" asChild className="flex-1">
                  <Link to={`/events/${event.id}`}>
                    <Eye className="mr-1 h-4 w-4" /> Ver
                  </Link>
                </Button>
                <Button variant="success" size="sm" asChild className="flex-1">
                  <Link to={`/cards/generate/${event.id}`}>
                    <CreditCard className="mr-1 h-4 w-4" /> Cartones
                  </Link>
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setDeleteConfirmId(event.id)}
                  disabled={deletingEventId === event.id && deleteMutation.isPending}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}

      {/* Confirmar Eliminación */}
      <AlertDialog open={deleteConfirmId !== null} onOpenChange={(open) => { if (!open) setDeleteConfirmId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar este evento?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. Se eliminarán todos los cartones y juegos asociados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteConfirmId) {
                  setDeletingEventId(deleteConfirmId);
                  deleteMutation.mutate(deleteConfirmId);
                }
                setDeleteConfirmId(null);
              }}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Modal Crear Evento */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nuevo Evento</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="event-name">Nombre del Evento *</Label>
              <Input
                id="event-name"
                value={newEvent.name}
                onChange={(e) => setNewEvent({ ...newEvent, name: e.target.value })}
                placeholder="Ej: Bingo Navideño 2024"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="event-desc">Descripción</Label>
              <Textarea
                id="event-desc"
                value={newEvent.description}
                onChange={(e) => setNewEvent({ ...newEvent, description: e.target.value })}
                placeholder="Descripción opcional..."
              />
            </div>
            <div className="rounded-lg border bg-muted/50 p-4">
              <div className="flex items-center gap-3">
                <Switch
                  id="free-center"
                  checked={newEvent.use_free_center}
                  onCheckedChange={(checked) => setNewEvent({ ...newEvent, use_free_center: checked })}
                />
                <div>
                  <Label htmlFor="free-center" className="cursor-pointer font-medium">Centro FREE</Label>
                  <p className="text-xs text-muted-foreground">
                    {newEvent.use_free_center
                      ? 'El centro del cartón será FREE (tradicional)'
                      : 'El centro tendrá un número (más difícil)'}
                  </p>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowModal(false)}>
                Cancelar
              </Button>
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
