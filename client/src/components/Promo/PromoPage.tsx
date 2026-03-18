import { useState, useMemo, useEffect } from 'react';
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
  Search,
  ChevronsLeft,
  ChevronsRight,
  ChevronLeft,
  ChevronRight,
  Lock,
  XCircle,
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
  getPromoFixedRules,
  savePromoFixedRules,
} from '@/services/api';
import type { BingoEvent, PromoWinner, PromoDistributeResult } from '@/types';
import { DataExportMenu } from '@/components/ui/data-export-menu';
import { SortableHeader } from '@/components/ui/sortable-header';
import { getStatusColor } from '@/lib/badge-variants';
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
  const [winnersSearch, setWinnersSearch] = useState('');
  const [winnersSort, setWinnersSort] = useState<{ column: string | null; direction: 'asc' | 'desc' | null }>({ column: null, direction: null });
  const [fixedRules, setFixedRules] = useState<{ prize_name: string; quantity: number; series_from: number; series_to: number }[]>([]);
  const [fixedRulesSynced, setFixedRulesSynced] = useState<number | null>(null);
  const [distributeResult, setDistributeResult] = useState<PromoDistributeResult | null>(null);

  const WINNERS_EXPORT_COLUMNS = [
    { key: 'card_number', label: '#' },
    { key: 'serial', label: 'Serial' },
    { key: 'card_code', label: 'Codigo' },
    { key: 'promo_text', label: 'Premio' },
    { key: 'is_sold', label: 'Vendido' },
    { key: 'buyer_name', label: 'Comprador' },
  ];

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

  const { data: fixedRulesData } = useQuery({
    queryKey: ['promo-fixed-rules', selectedEventId],
    queryFn: () => getPromoFixedRules(selectedEventId!),
    enabled: !!selectedEventId,
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
  useEffect(() => {
    if (promo && selectedEventId && syncedEventId !== selectedEventId) {
      setIsEnabled(!!promo.config.is_enabled);
      setNoPrizeText(promo.config.no_prize_text || 'Gracias por participar');
      setPrizes(promo.prizes.map(p => ({ name: p.name, quantity: p.quantity })));
      setSyncedEventId(selectedEventId);
    }
  }, [promo, selectedEventId, syncedEventId]);
  // Sincronizar reglas fijas
  useEffect(() => {
    if (fixedRulesData?.data && selectedEventId && fixedRulesSynced !== selectedEventId) {
      setFixedRules(fixedRulesData.data.map(r => ({
        prize_name: r.prize_name,
        quantity: r.quantity,
        series_from: r.series_from,
        series_to: r.series_to,
      })));
      setFixedRulesSynced(selectedEventId);
    }
  }, [fixedRulesData?.data, selectedEventId, fixedRulesSynced]);

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

  const saveFixedRulesMutation = useMutation({
    mutationFn: () => savePromoFixedRules(
      selectedEventId!,
      fixedRules.filter(r => r.prize_name && r.quantity > 0 && r.series_from > 0 && r.series_to >= r.series_from)
    ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['promo-fixed-rules', selectedEventId] });
      toast.success('Reglas fijas guardadas');
    },
    onError: (e: { response?: { data?: { error?: string } } }) => {
      toast.error(e.response?.data?.error || 'Error guardando reglas fijas');
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
      setDistributeResult(data.data || null);
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

  const addFixedRule = () => setFixedRules([...fixedRules, { prize_name: '', quantity: 1, series_from: 1, series_to: 1 }]);
  const removeFixedRule = (index: number) => setFixedRules(fixedRules.filter((_, i) => i !== index));
  const updateFixedRule = (index: number, field: keyof typeof fixedRules[0], value: string | number) => {
    const updated = [...fixedRules];
    if (field === 'prize_name') updated[index].prize_name = value as string;
    else updated[index][field] = Math.max(field === 'quantity' ? 1 : 1, value as number);
    setFixedRules(updated);
  };

  // Calcular sumas de reglas fijas por premio para validacion visual
  const fixedSumsByPrize = useMemo(() => {
    const sums = new Map<string, number>();
    for (const r of fixedRules) {
      if (r.prize_name) {
        const seriesCount = Math.max(0, r.series_to - r.series_from + 1);
        sums.set(r.prize_name, (sums.get(r.prize_name) || 0) + r.quantity * seriesCount);
      }
    }
    return sums;
  }, [fixedRules]);

  const addPrize = () => setPrizes([...prizes, { name: '', quantity: 1 }]);
  const removePrize = (index: number) => setPrizes(prizes.filter((_, i) => i !== index));
  const updatePrize = (index: number, field: 'name' | 'quantity', value: string | number) => {
    const updated = [...prizes];
    if (field === 'name') updated[index].name = value as string;
    else updated[index].quantity = Math.max(1, value as number);
    setPrizes(updated);
  };

  const toggleWinnersSort = (column: string) => {
    setWinnersSort(prev => {
      if (prev.column !== column) return { column, direction: 'asc' };
      if (prev.direction === 'asc') return { column, direction: 'desc' };
      return { column: null, direction: null };
    });
  };

  const totalPrizes = prizes.reduce((sum, p) => sum + (p.quantity || 0), 0);
  const selectedEvent = events.find((e: BingoEvent) => e.id === selectedEventId);
  const hasDistributed = !!(promo?.stats?.cards_with_promo && promo.stats.cards_with_promo > 0);
  const winners = useMemo(() => winnersData?.data || [], [winnersData?.data]);
  const filteredWinners = useMemo(() => {
    let result = winners;
    if (winnersSearch.trim()) {
      const q = winnersSearch.toLowerCase();
      result = result.filter((w: PromoWinner) =>
        w.serial?.toLowerCase().includes(q) ||
        w.card_code?.toLowerCase().includes(q) ||
        w.promo_text?.toLowerCase().includes(q) ||
        w.buyer_name?.toLowerCase().includes(q)
      );
    }
    if (winnersSort.column && winnersSort.direction) {
      const col = winnersSort.column;
      const dir = winnersSort.direction === 'asc' ? 1 : -1;
      result = [...result].sort((a: any, b: any) => {
        const aVal = a[col];
        const bVal = b[col];
        if (aVal === bVal) return 0;
        if (aVal == null) return 1;
        if (bVal == null) return -1;
        if (typeof aVal === 'number' && typeof bVal === 'number') return (aVal - bVal) * dir;
        return String(aVal).localeCompare(String(bVal)) * dir;
      });
    }
    return result;
  }, [winners, winnersSearch, winnersSort]);
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

                {/* Verificacion post-distribucion */}
                {distributeResult?.verification && (
                  <div className="mt-4 pt-4 border-t">
                    <div className="flex items-center gap-2 mb-3">
                      {distributeResult.verification.passed ? (
                        <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                          <CheckCircle className="h-3 w-3 mr-1" /> Verificacion OK
                        </Badge>
                      ) : (
                        <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
                          <XCircle className="h-3 w-3 mr-1" /> Discrepancia detectada
                        </Badge>
                      )}
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Premio</TableHead>
                          <TableHead className="text-xs text-right">Esperado</TableHead>
                          <TableHead className="text-xs text-right">Actual</TableHead>
                          <TableHead className="text-xs text-center">Estado</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {distributeResult.verification.details.map((d, i) => (
                          <TableRow key={i}>
                            <TableCell className="text-sm">{d.prize}</TableCell>
                            <TableCell className="text-sm text-right font-mono">{d.expected}</TableCell>
                            <TableCell className="text-sm text-right font-mono">{d.actual}</TableCell>
                            <TableCell className="text-center">
                              {d.ok ? (
                                <CheckCircle className="h-4 w-4 text-green-600 inline" />
                              ) : (
                                <XCircle className="h-4 w-4 text-red-600 inline" />
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {/* Reglas fijas aplicadas */}
                {distributeResult?.fixed_rules_applied && distributeResult.fixed_rules_applied.length > 0 && (
                  <div className="mt-3 pt-3 border-t">
                    <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1">
                      <Lock className="h-3 w-3" /> Reglas Fijas Aplicadas
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {distributeResult.fixed_rules_applied.map((r, i) => (
                        <Badge key={i} variant="outline" className="text-xs">
                          {r.placed}x &quot;{r.prize}&quot; en series {r.series}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
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
                <div className="flex items-center gap-2 text-sm text-yellow-600 bg-yellow-50 dark:bg-yellow-950/30 rounded-lg p-3">
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

          {/* Reglas de Distribucion Fija */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Lock className="h-4 w-4" />
                    Reglas de Distribucion Fija
                  </CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">
                    Garantiza premios especificos en series determinadas
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={addFixedRule} disabled={!!hasDistributed || prizes.length === 0}>
                  <Plus className="mr-1 h-4 w-4" /> Agregar Regla
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {hasDistributed && (
                <div className="flex items-center gap-2 text-sm text-yellow-600 bg-yellow-50 dark:bg-yellow-950/30 rounded-lg p-3">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  Ya se distribuyeron premios. Limpie la promocion antes de cambiar reglas fijas.
                </div>
              )}

              {prizes.length === 0 && !hasDistributed && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Primero configure premios antes de agregar reglas fijas.
                </p>
              )}

              {fixedRules.length === 0 && prizes.length > 0 && !hasDistributed && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Sin reglas fijas. Todos los premios se distribuiran 100% aleatoriamente.
                </p>
              )}

              {fixedRules.map((rule, index) => (
                <div key={index} className="flex items-end gap-2 flex-wrap">
                  <div className="flex-1 min-w-[140px] space-y-1">
                    {index === 0 && <Label className="text-xs">Premio</Label>}
                    <Select
                      value={rule.prize_name}
                      onValueChange={(v) => updateFixedRule(index, 'prize_name', v)}
                      disabled={!!hasDistributed}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Seleccionar premio" />
                      </SelectTrigger>
                      <SelectContent>
                        {prizes.filter(p => p.name.trim()).map((p, i) => (
                          <SelectItem key={i} value={p.name}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="w-20 space-y-1">
                    {index === 0 && <Label className="text-xs">Cantidad</Label>}
                    <Input
                      type="number"
                      value={rule.quantity}
                      onChange={(e) => updateFixedRule(index, 'quantity', parseInt(e.target.value) || 1)}
                      min={1}
                      disabled={!!hasDistributed}
                    />
                  </div>
                  <div className="w-24 space-y-1">
                    {index === 0 && <Label className="text-xs">Serie Desde</Label>}
                    <Input
                      type="number"
                      value={rule.series_from}
                      onChange={(e) => updateFixedRule(index, 'series_from', parseInt(e.target.value) || 1)}
                      min={1}
                      disabled={!!hasDistributed}
                    />
                  </div>
                  <div className="w-24 space-y-1">
                    {index === 0 && <Label className="text-xs">Serie Hasta</Label>}
                    <Input
                      type="number"
                      value={rule.series_to}
                      onChange={(e) => updateFixedRule(index, 'series_to', parseInt(e.target.value) || 1)}
                      min={rule.series_from}
                      disabled={!!hasDistributed}
                    />
                  </div>
                  <div className="w-16 flex items-center justify-center shrink-0">
                    {index === 0 && <Label className="text-xs block mb-1">Total</Label>}
                    <span className="text-sm font-medium text-muted-foreground">
                      = {rule.quantity * Math.max(0, rule.series_to - rule.series_from + 1)}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeFixedRule(index)}
                    disabled={!!hasDistributed}
                    className="text-destructive hover:text-destructive shrink-0"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}

              {fixedRules.length > 0 && (
                <>
                  {/* Warnings de validacion */}
                  {Array.from(fixedSumsByPrize.entries()).map(([name, sum]) => {
                    const prizeTotal = prizes.find(p => p.name === name)?.quantity || 0;
                    if (sum > prizeTotal) {
                      return (
                        <div key={name} className="flex items-center gap-2 text-sm text-red-600 bg-red-50 dark:bg-red-950/30 rounded-lg p-2">
                          <XCircle className="h-4 w-4 shrink-0" />
                          &quot;{name}&quot;: reglas fijas suman {sum} pero solo hay {prizeTotal} en total
                        </div>
                      );
                    }
                    return null;
                  })}

                  <div className="flex justify-end pt-2 border-t">
                    <Button
                      onClick={() => saveFixedRulesMutation.mutate()}
                      disabled={saveFixedRulesMutation.isPending || !!hasDistributed}
                      size="sm"
                    >
                      {saveFixedRulesMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Guardar Reglas
                    </Button>
                  </div>
                </>
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
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Trophy className="h-5 w-5" />
                    Ganadores ({promo?.stats.cards_with_prize?.toLocaleString() || 0})
                  </CardTitle>
                  <div className="flex flex-wrap items-center gap-2">
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
                    <DataExportMenu
                      data={filteredWinners as unknown as Record<string, unknown>[]}
                      columns={WINNERS_EXPORT_COLUMNS}
                      filename="ganadores_promo"
                      onFetchAll={async () => {
                        // Traer TODOS los ganadores sin paginación
                        const res = await getPromoWinners(selectedEventId!, { page: 1, limit: 999999, prize: prizeFilter || undefined });
                        return (res.data || []) as unknown as Record<string, unknown>[];
                      }}
                    />
                  </div>
                </div>
                <div className="relative max-w-sm mt-2">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground h-4 w-4" />
                  <Input
                    className="pl-9 h-9"
                    placeholder="Buscar serial, codigo, premio..."
                    value={winnersSearch}
                    onChange={(e) => setWinnersSearch(e.target.value)}
                  />
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead><SortableHeader label="#" column="card_number" sort={winnersSort} onSort={toggleWinnersSort} /></TableHead>
                      <TableHead><SortableHeader label="Serial" column="serial" sort={winnersSort} onSort={toggleWinnersSort} /></TableHead>
                      <TableHead><SortableHeader label="Codigo" column="card_code" sort={winnersSort} onSort={toggleWinnersSort} /></TableHead>
                      <TableHead><SortableHeader label="Premio" column="promo_text" sort={winnersSort} onSort={toggleWinnersSort} /></TableHead>
                      <TableHead><SortableHeader label="Vendido" column="is_sold" sort={winnersSort} onSort={toggleWinnersSort} /></TableHead>
                      <TableHead><SortableHeader label="Comprador" column="buyer_name" sort={winnersSort} onSort={toggleWinnersSort} /></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredWinners.map((w: PromoWinner) => (
                      <TableRow key={w.id}>
                        <TableCell className="font-mono">{w.card_number}</TableCell>
                        <TableCell className="font-mono">{w.serial}</TableCell>
                        <TableCell className="font-mono">{w.card_code}</TableCell>
                        <TableCell>
                          <Badge className={getStatusColor('prize') + ' text-xs'}>{w.promo_text}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge className={getStatusColor(w.is_sold ? 'sold' : 'available') + ' text-xs'}>
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
                </div>

                {/* Paginacion */}
                {winnersPagination && winnersPagination.totalPages > 1 && (
                  <div className="flex items-center justify-between mt-4 pt-3 border-t">
                    <p className="text-sm text-muted-foreground">
                      Mostrando {((winnersPage - 1) * 50) + 1}-{Math.min(winnersPage * 50, winnersPagination.total || 0)} de {(winnersPagination.total || 0).toLocaleString()}
                    </p>
                    <div className="flex items-center gap-1.5">
                      <Button variant="outline" size="icon" className="h-8 w-8" disabled={winnersPage <= 1} onClick={() => setWinnersPage(1)}>
                        <ChevronsLeft className="h-4 w-4" />
                      </Button>
                      <Button variant="outline" size="icon" className="h-8 w-8" disabled={winnersPage <= 1} onClick={() => setWinnersPage(p => p - 1)}>
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <span className="text-sm font-medium px-2 tabular-nums">{winnersPage} / {winnersPagination.totalPages}</span>
                      <Button variant="outline" size="icon" className="h-8 w-8" disabled={winnersPage >= winnersPagination.totalPages} onClick={() => setWinnersPage(p => p + 1)}>
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                      <Button variant="outline" size="icon" className="h-8 w-8" disabled={winnersPage >= winnersPagination.totalPages} onClick={() => setWinnersPage(winnersPagination.totalPages)}>
                        <ChevronsRight className="h-4 w-4" />
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
