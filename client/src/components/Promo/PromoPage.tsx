import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Gift,
  Plus,
  Trash2,
  Shuffle,
  Eraser,
  Loader2,
  Trophy,
  AlertTriangle,
  CheckCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  getEvents,
  getPromoConfig,
  savePromoConfig,
  savePromoPrizes,
  distributePromo,
  clearPromo,
  getPromoWinners,
} from '@/services/api';
import type { BingoEvent, PromoWinner } from '@/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

export default function PromoPage() {
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const initialEventId = searchParams.get('event') ? Number(searchParams.get('event')) : null;
  const [selectedEventId, setSelectedEventId] = useState<number | null>(initialEventId);
  const [isEnabled, setIsEnabled] = useState(false);
  const [noPrizeText, setNoPrizeText] = useState('Gracias por participar');
  const [prizes, setPrizes] = useState<{ name: string; quantity: number }[]>([]);
  const [winnersPage, setWinnersPage] = useState(1);
  const [prizeFilter, setPrizeFilter] = useState<string>('');

  const { data: eventsData } = useQuery({ queryKey: ['events'], queryFn: getEvents });
  const events = eventsData?.data || [];

  const { data: promoData, isLoading: loadingPromo } = useQuery({
    queryKey: ['promo', selectedEventId],
    queryFn: () => getPromoConfig(selectedEventId!),
    enabled: !!selectedEventId,
  });

  const { data: winnersData } = useQuery({
    queryKey: ['promo-winners', selectedEventId, winnersPage, prizeFilter],
    queryFn: () => getPromoWinners(selectedEventId!, {
      page: winnersPage,
      limit: 50,
      prize: prizeFilter || undefined,
    }),
    enabled: !!selectedEventId && !!promoData?.data?.stats?.cards_with_prize,
  });

  const promo = promoData?.data;

  // Al seleccionar evento, sincronizar
  const handleSelectEvent = (eventId: string) => {
    setSelectedEventId(Number(eventId));
    setWinnersPage(1);
    setPrizeFilter('');
  };

  // Sincronizar estado local cuando llegan datos del server
  const [syncedEventId, setSyncedEventId] = useState<number | null>(null);
  if (promo && selectedEventId && syncedEventId !== selectedEventId) {
    setIsEnabled(!!promo.config.is_enabled);
    setNoPrizeText(promo.config.no_prize_text || 'Gracias por participar');
    setPrizes(promo.prizes.map(p => ({ name: p.name, quantity: p.quantity })));
    setSyncedEventId(selectedEventId);
  }

  const saveConfigMutation = useMutation({
    mutationFn: () => savePromoConfig(selectedEventId!, { is_enabled: isEnabled, no_prize_text: noPrizeText }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['promo', selectedEventId] });
      toast.success('Configuracion guardada');
    },
    onError: () => toast.error('Error guardando configuracion'),
  });

  const savePrizesMutation = useMutation({
    mutationFn: () => savePromoPrizes(selectedEventId!, prizes.filter(p => p.name.trim() && p.quantity > 0)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['promo', selectedEventId] });
      toast.success('Premios guardados');
    },
    onError: (e: { response?: { data?: { error?: string } } }) => {
      toast.error(e.response?.data?.error || 'Error guardando premios');
    },
  });

  const distributeMutation = useMutation({
    mutationFn: async () => {
      // Guardar config + premios antes de distribuir
      await savePromoConfig(selectedEventId!, { is_enabled: true, no_prize_text: noPrizeText });
      const validPrizes = prizes.filter(p => p.name.trim() && p.quantity > 0);
      if (validPrizes.length > 0) {
        await savePromoPrizes(selectedEventId!, validPrizes);
      }
      return distributePromo(selectedEventId!);
    },
    onSuccess: (data) => {
      setIsEnabled(true);
      setSyncedEventId(null); // forzar re-sync
      queryClient.invalidateQueries({ queryKey: ['promo', selectedEventId] });
      queryClient.invalidateQueries({ queryKey: ['promo-winners', selectedEventId] });
      toast.success(data.data?.message || 'Premios distribuidos');
    },
    onError: (e: { response?: { data?: { error?: string } } }) => {
      toast.error(e.response?.data?.error || 'Error distribuyendo premios');
    },
  });

  const clearMutation = useMutation({
    mutationFn: () => clearPromo(selectedEventId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['promo', selectedEventId] });
      queryClient.invalidateQueries({ queryKey: ['promo-winners', selectedEventId] });
      toast.success('Promocion limpiada');
    },
    onError: () => toast.error('Error limpiando promocion'),
  });

  const addPrize = () => setPrizes([...prizes, { name: '', quantity: 1 }]);
  const removePrize = (index: number) => setPrizes(prizes.filter((_, i) => i !== index));
  const updatePrize = (index: number, field: 'name' | 'quantity', value: string | number) => {
    const updated = [...prizes];
    if (field === 'name') updated[index].name = value as string;
    else updated[index].quantity = Math.max(1, value as number);
    setPrizes(updated);
  };

  const totalPrizes = prizes.reduce((sum, p) => sum + (p.quantity || 0), 0);
  const selectedEvent = events.find((e: BingoEvent) => e.id === selectedEventId);
  const hasDistributed = !!(promo?.stats?.cards_with_promo && promo.stats.cards_with_promo > 0);
  const winners = winnersData?.data || [];
  const winnersPagination = winnersData?.pagination;

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="page-header">
        <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Gift className="h-6 w-6" />
          Raspadito / Promocion
        </h2>
        <p className="text-muted-foreground text-sm mt-1">
          Configura premios aleatorios para los cartones de un evento
        </p>
      </div>

      {/* Selector de Evento */}
      <Card>
        <CardContent className="pt-6">
          <div className="space-y-2">
            <Label>Evento</Label>
            <Select
              value={selectedEventId?.toString() || ''}
              onValueChange={handleSelectEvent}
            >
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar evento..." />
              </SelectTrigger>
              <SelectContent>
                {events.map((event: BingoEvent) => (
                  <SelectItem key={event.id} value={event.id.toString()}>
                    {event.name} ({event.total_cards.toLocaleString()} cartones)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {selectedEventId && loadingPromo && (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {selectedEventId && !loadingPromo && (
        <>
          {/* Estadisticas rapidas */}
          {hasDistributed && (
            <Card className="border-green-200 dark:border-green-900">
              <CardContent className="pt-6">
                <div className="flex items-center gap-3 mb-3">
                  <CheckCircle className="h-5 w-5 text-green-600" />
                  <span className="font-semibold text-green-700 dark:text-green-400">Promocion Distribuida</span>
                </div>
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <p className="text-2xl font-bold">{promo?.stats.total_cards.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">Total Cartones</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-green-600">{promo?.stats.cards_with_prize?.toLocaleString() || 0}</p>
                    <p className="text-xs text-muted-foreground">Ganadores</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-muted-foreground">
                      {((promo?.stats.total_cards || 0) - (promo?.stats.cards_with_prize || 0)).toLocaleString()}
                    </p>
                    <p className="text-xs text-muted-foreground">Sin Premio</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Configuracion */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Configuracion</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Promocion Habilitada</Label>
                  <p className="text-xs text-muted-foreground">Activa el raspadito para este evento</p>
                </div>
                <Switch checked={isEnabled} onCheckedChange={setIsEnabled} />
              </div>

              <div className="space-y-2">
                <Label>Texto para cartones sin premio</Label>
                <Input
                  value={noPrizeText}
                  onChange={(e) => setNoPrizeText(e.target.value)}
                  placeholder="Gracias por participar"
                />
                <p className="text-xs text-muted-foreground">
                  Este texto aparecera en el raspadito de los cartones que no ganan
                </p>
              </div>

              <Button
                onClick={() => saveConfigMutation.mutate()}
                disabled={saveConfigMutation.isPending}
              >
                {saveConfigMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Guardar Configuracion
              </Button>
            </CardContent>
          </Card>

          {/* Premios */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">Premios</CardTitle>
                <Button variant="outline" size="sm" onClick={addPrize} disabled={!!hasDistributed}>
                  <Plus className="mr-1 h-4 w-4" /> Agregar Premio
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {hasDistributed && (
                <div className="flex items-center gap-2 text-sm text-amber-600 bg-amber-50 dark:bg-amber-950/30 rounded-lg p-3">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  Ya se distribuyeron premios. Limpie la promocion antes de cambiar premios.
                </div>
              )}

              {prizes.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No hay premios configurados. Agrega al menos un premio.
                </p>
              )}

              {prizes.map((prize, index) => (
                <div key={index} className="flex items-end gap-3">
                  <div className="flex-1 space-y-1">
                    {index === 0 && <Label className="text-xs">Nombre del Premio</Label>}
                    <Input
                      value={prize.name}
                      onChange={(e) => updatePrize(index, 'name', e.target.value)}
                      placeholder="Ej: TV 50 pulgadas"
                      disabled={!!hasDistributed}
                    />
                  </div>
                  <div className="w-28 space-y-1">
                    {index === 0 && <Label className="text-xs">Cantidad</Label>}
                    <Input
                      type="number"
                      value={prize.quantity}
                      onChange={(e) => updatePrize(index, 'quantity', parseInt(e.target.value) || 1)}
                      min={1}
                      disabled={!!hasDistributed}
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removePrize(index)}
                    disabled={!!hasDistributed}
                    className="text-destructive hover:text-destructive shrink-0"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}

              {prizes.length > 0 && (
                <div className="flex items-center justify-between pt-2 border-t">
                  <div className="text-sm">
                    <span className="text-muted-foreground">Total premios: </span>
                    <span className="font-bold">{totalPrizes.toLocaleString()}</span>
                    {selectedEvent && (
                      <span className="text-muted-foreground"> / {selectedEvent.total_cards.toLocaleString()} cartones</span>
                    )}
                  </div>
                  <Button
                    onClick={() => savePrizesMutation.mutate()}
                    disabled={savePrizesMutation.isPending || !!hasDistributed}
                    size="sm"
                  >
                    {savePrizesMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Guardar Premios
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Acciones de Distribucion */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Distribucion</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Distribuye los premios aleatoriamente entre todos los cartones del evento.
                Cada carton recibira un premio o el texto de &quot;sin premio&quot;.
              </p>

              <div className="flex gap-3">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      disabled={distributeMutation.isPending || !isEnabled || prizes.length === 0 || !!hasDistributed}
                      className="flex-1"
                    >
                      {distributeMutation.isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Shuffle className="mr-2 h-4 w-4" />
                      )}
                      Distribuir Premios
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Distribuir Premios</AlertDialogTitle>
                      <AlertDialogDescription>
                        Se distribuiran {totalPrizes.toLocaleString()} premios aleatoriamente
                        entre {selectedEvent?.total_cards.toLocaleString() || 0} cartones.
                        El resto recibira: &quot;{noPrizeText}&quot;
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction onClick={() => distributeMutation.mutate()}>
                        Distribuir
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="destructive"
                      disabled={clearMutation.isPending || !hasDistributed}
                    >
                      {clearMutation.isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Eraser className="mr-2 h-4 w-4" />
                      )}
                      Limpiar
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Limpiar Promocion</AlertDialogTitle>
                      <AlertDialogDescription>
                        Esto eliminara todos los premios asignados a los cartones.
                        Podra redistribuir nuevamente despues.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction onClick={() => clearMutation.mutate()}>
                        Limpiar
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </CardContent>
          </Card>

          {/* Tabla de Ganadores */}
          {hasDistributed && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Trophy className="h-5 w-5" />
                    Ganadores ({promo?.stats.cards_with_prize?.toLocaleString() || 0})
                  </CardTitle>
                  {promo?.prizes && promo.prizes.length > 0 && (
                    <Select value={prizeFilter} onValueChange={(v) => { setPrizeFilter(v === '__all__' ? '' : v); setWinnersPage(1); }}>
                      <SelectTrigger className="w-48">
                        <SelectValue placeholder="Filtrar por premio" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all__">Todos los premios</SelectItem>
                        {promo.prizes.map(p => (
                          <SelectItem key={p.id} value={p.name}>
                            {p.name} ({p.distributed})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Serial</TableHead>
                      <TableHead>Codigo</TableHead>
                      <TableHead>Premio</TableHead>
                      <TableHead>Vendido</TableHead>
                      <TableHead>Comprador</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {winners.map((w: PromoWinner) => (
                      <TableRow key={w.id}>
                        <TableCell className="font-mono">{w.card_number}</TableCell>
                        <TableCell className="font-mono">{w.serial}</TableCell>
                        <TableCell className="font-mono">{w.card_code}</TableCell>
                        <TableCell>
                          <Badge variant="success">{w.promo_text}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={w.is_sold ? 'default' : 'secondary'}>
                            {w.is_sold ? 'Si' : 'No'}
                          </Badge>
                        </TableCell>
                        <TableCell>{w.buyer_name || '-'}</TableCell>
                      </TableRow>
                    ))}
                    {winners.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                          No hay ganadores para mostrar
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>

                {/* Paginacion */}
                {winnersPagination && winnersPagination.totalPages > 1 && (
                  <div className="flex items-center justify-between mt-4">
                    <p className="text-sm text-muted-foreground">
                      Pagina {winnersPagination.page} de {winnersPagination.totalPages}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={winnersPage <= 1}
                        onClick={() => setWinnersPage(p => p - 1)}
                      >
                        Anterior
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={winnersPage >= winnersPagination.totalPages}
                        onClick={() => setWinnersPage(p => p + 1)}
                      >
                        Siguiente
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
