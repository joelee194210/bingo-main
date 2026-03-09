import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CreditCard, Gamepad2, Play, Settings, Loader2, Download } from 'lucide-react';
import { toast } from 'sonner';
import { getEventStats, updateEvent, createGame, downloadCardsCSV } from '@/services/api';
import { EVENT_STATUS_LABELS, GAME_TYPE_LABELS, type GameType, type EventStatus } from '@/types';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export default function EventDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showGameModal, setShowGameModal] = useState(false);
  const [downloadingCSV, setDownloadingCSV] = useState(false);
  const [gameConfig, setGameConfig] = useState<{
    game_type: GameType;
    name: string;
    is_practice_mode: boolean;
    custom_pattern: boolean[][];
  }>({
    game_type: 'blackout',
    name: '',
    is_practice_mode: true,
    custom_pattern: Array(5).fill(null).map(() => Array(5).fill(false))
  });

  const togglePatternCell = (row: number, col: number) => {
    const newPattern = gameConfig.custom_pattern.map((r, ri) =>
      r.map((c, ci) => (ri === row && ci === col ? !c : c))
    );
    setGameConfig({ ...gameConfig, custom_pattern: newPattern });
  };

  const getPatternPositions = (): number[][] => {
    const positions: number[][] = [];
    gameConfig.custom_pattern.forEach((row, ri) => {
      row.forEach((cell, ci) => {
        if (cell) positions.push([ri, ci]);
      });
    });
    return positions;
  };

  const patternPresets = {
    letter_L: [[0,0],[1,0],[2,0],[3,0],[4,0],[4,1],[4,2],[4,3],[4,4]],
    letter_T: [[0,0],[0,1],[0,2],[0,3],[0,4],[1,2],[2,2],[3,2],[4,2]],
    small_frame: [[0,0],[0,1],[0,2],[0,3],[0,4],[1,0],[1,4],[2,0],[2,4],[3,0],[3,4],[4,0],[4,1],[4,2],[4,3],[4,4]],
    plus_sign: [[0,2],[1,2],[2,0],[2,1],[2,2],[2,3],[2,4],[3,2],[4,2]],
  };

  const applyPreset = (preset: number[][]) => {
    const newPattern = Array(5).fill(null).map(() => Array(5).fill(false));
    preset.forEach(([r, c]) => { newPattern[r][c] = true; });
    setGameConfig({ ...gameConfig, custom_pattern: newPattern });
  };

  const clearPattern = () => {
    setGameConfig({
      ...gameConfig,
      custom_pattern: Array(5).fill(null).map(() => Array(5).fill(false))
    });
  };

  const { data, isLoading } = useQuery({
    queryKey: ['event', id],
    queryFn: () => getEventStats(Number(id)),
    enabled: !!id,
  });

  const updateMutation = useMutation({
    mutationFn: (status: EventStatus) => updateEvent(Number(id), { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['event', id] }),
  });

  const createGameMutation = useMutation({
    mutationFn: (data: { event_id: number; game_type: GameType; name?: string; is_practice_mode?: boolean; custom_pattern?: number[][] }) =>
      createGame(data),
    onSuccess: (response) => {
      if (response.success && response.data) {
        navigate(`/games/${response.data.id}`);
      }
    },
  });

  const handleStartGame = (e: React.FormEvent) => {
    e.preventDefault();

    if (gameConfig.game_type === 'custom') {
      const positions = getPatternPositions();
      if (positions.length === 0) {
        toast.warning('Debes seleccionar al menos una celda para el patrón personalizado');
        return;
      }
    }

    createGameMutation.mutate({
      event_id: Number(id),
      game_type: gameConfig.game_type,
      name: gameConfig.name || undefined,
      is_practice_mode: gameConfig.is_practice_mode,
      custom_pattern: gameConfig.game_type === 'custom' ? getPatternPositions() : undefined,
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <Badge variant="success">{EVENT_STATUS_LABELS[status]}</Badge>;
      case 'draft':
        return <Badge variant="secondary">{EVENT_STATUS_LABELS[status]}</Badge>;
      case 'completed':
        return <Badge variant="info">{EVENT_STATUS_LABELS[status]}</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10 rounded-lg" />
          <div className="space-y-2">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-64" />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i}>
              <CardContent className="pt-6">
                <Skeleton className="h-4 w-24 mb-2" />
                <Skeleton className="h-10 w-20" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (!data?.success || !data.data) {
    return (
      <Card className="border-destructive/50">
        <CardContent className="pt-6 text-center text-destructive">
          Evento no encontrado
        </CardContent>
      </Card>
    );
  }

  const { event, cards, games } = data.data;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/events">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div className="flex-1">
          <h2 className="text-2xl font-bold">{event.name}</h2>
          {event.description && <p className="text-muted-foreground">{event.description}</p>}
        </div>
        {getStatusBadge(event.status)}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Total Cartones</p>
            <p className="text-3xl font-bold">{cards.total.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Vendidos</p>
            <p className="text-3xl font-bold text-green-600">{cards.sold.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Disponibles</p>
            <p className="text-3xl font-bold text-blue-600">{cards.available.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Juegos</p>
            <p className="text-3xl font-bold text-purple-600">{games.total}</p>
          </CardContent>
        </Card>
      </div>

      {/* Actions */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Link to={`/cards/generate/${event.id}`}>
          <Card className="hover:shadow-md transition-shadow cursor-pointer">
            <CardContent className="flex items-center gap-4 p-6">
              <div className="p-3 bg-green-100 dark:bg-green-900/30 rounded-lg text-green-600">
                <CreditCard className="h-6 w-6" />
              </div>
              <div>
                <p className="font-semibold">Generar Cartones</p>
                <p className="text-sm text-muted-foreground">Crear nuevos cartones para este evento</p>
              </div>
            </CardContent>
          </Card>
        </Link>

        <Card
          className="hover:shadow-md transition-shadow cursor-pointer"
          onClick={() => setShowGameModal(true)}
        >
          <CardContent className="flex items-center gap-4 p-6">
            <div className="p-3 bg-purple-100 dark:bg-purple-900/30 rounded-lg text-purple-600">
              <Gamepad2 className="h-6 w-6" />
            </div>
            <div>
              <p className="font-semibold">Iniciar Juego</p>
              <p className="text-sm text-muted-foreground">Comenzar una nueva partida</p>
            </div>
          </CardContent>
        </Card>

        <Card
          className={`hover:shadow-md transition-shadow ${cards.total > 0 ? 'cursor-pointer' : 'opacity-50'}`}
          onClick={async () => {
            if (cards.total === 0 || downloadingCSV) return;
            setDownloadingCSV(true);
            try {
              const blob = await downloadCardsCSV(event.id);
              const url = window.URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `cartones_${event.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.csv`;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              window.URL.revokeObjectURL(url);
            } catch {
              toast.error('Error al descargar CSV');
            } finally {
              setDownloadingCSV(false);
            }
          }}
        >
          <CardContent className="flex items-center gap-4 p-6">
            <div className="p-3 bg-blue-100 dark:bg-blue-900/30 rounded-lg text-blue-600">
              {downloadingCSV ? <Loader2 className="h-6 w-6 animate-spin" /> : <Download className="h-6 w-6" />}
            </div>
            <div>
              <p className="font-semibold">Exportar para Imprenta</p>
              <p className="text-sm text-muted-foreground">Descargar CSV con todos los cartones</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4 mb-4">
              <div className="p-3 bg-orange-100 dark:bg-orange-900/30 rounded-lg text-orange-600">
                <Settings className="h-6 w-6" />
              </div>
              <div>
                <p className="font-semibold">Estado</p>
                <p className="text-sm text-muted-foreground">Cambiar estado del evento</p>
              </div>
            </div>
            <div className="flex gap-2">
              {(['draft', 'active', 'completed'] as EventStatus[]).map((status) => (
                <Button
                  key={status}
                  variant={event.status === status ? 'default' : 'outline'}
                  size="sm"
                  className="flex-1"
                  onClick={() => updateMutation.mutate(status)}
                  disabled={event.status === status || updateMutation.isPending}
                >
                  {EVENT_STATUS_LABELS[status]}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Modal Crear Juego */}
      <Dialog open={showGameModal} onOpenChange={setShowGameModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nuevo Juego</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleStartGame} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="game-name">Nombre del Juego (opcional)</Label>
              <Input
                id="game-name"
                value={gameConfig.name}
                onChange={(e) => setGameConfig({ ...gameConfig, name: e.target.value })}
                placeholder="Ej: Ronda 1"
              />
            </div>

            <div className="space-y-2">
              <Label>Tipo de Juego *</Label>
              <Select
                value={gameConfig.game_type}
                onValueChange={(value) => setGameConfig({ ...gameConfig, game_type: value as GameType })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(GAME_TYPE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Editor de Patrón Personalizado */}
            {gameConfig.game_type === 'custom' && (
              <div className="rounded-lg border bg-muted/50 p-4">
                <Label className="mb-3 block">Diseña tu Patrón</Label>
                <p className="text-xs text-muted-foreground mb-3">
                  Haz clic en las celdas para marcar las posiciones que deben completarse para ganar
                </p>

                {/* Presets */}
                <div className="flex flex-wrap gap-2 mb-3">
                  <Button type="button" variant="outline" size="sm" onClick={() => applyPreset(patternPresets.letter_L)}>
                    Letra L
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => applyPreset(patternPresets.letter_T)}>
                    Letra T
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => applyPreset(patternPresets.small_frame)}>
                    Marco
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => applyPreset(patternPresets.plus_sign)}>
                    Cruz +
                  </Button>
                  <Button type="button" variant="destructive" size="sm" onClick={clearPattern}>
                    Limpiar
                  </Button>
                </div>

                {/* Cuadrícula 5x5 */}
                <div className="flex justify-center">
                  <div className="inline-block">
                    <div className="flex">
                      <div className="w-8 h-8" />
                      {['B', 'I', 'N', 'G', 'O'].map(col => (
                        <div key={col} className="w-10 h-8 flex items-center justify-center font-bold text-sm text-muted-foreground">
                          {col}
                        </div>
                      ))}
                    </div>

                    {gameConfig.custom_pattern.map((row, ri) => (
                      <div key={ri} className="flex">
                        <div className="w-8 h-10 flex items-center justify-center text-xs text-muted-foreground">
                          {ri + 1}
                        </div>
                        {row.map((cell, ci) => (
                          <button
                            key={ci}
                            type="button"
                            onClick={() => togglePatternCell(ri, ci)}
                            className={`w-10 h-10 border flex items-center justify-center text-xs font-bold transition-colors ${
                              cell
                                ? 'bg-primary text-primary-foreground border-primary'
                                : 'bg-background text-muted-foreground border-border hover:bg-muted'
                            } ${ri === 2 && ci === 2 ? 'ring-2 ring-purple-300' : ''}`}
                          >
                            {ri === 2 && ci === 2 ? '★' : cell ? '✓' : ''}
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>

                <p className="text-xs text-center text-muted-foreground mt-2">
                  {getPatternPositions().length} celdas seleccionadas
                  {getPatternPositions().some(([r, c]) => r === 2 && c === 2) && ' (incluye centro)'}
                </p>
              </div>
            )}

            <div className="flex items-center space-x-3">
              <Checkbox
                id="practice-mode"
                checked={gameConfig.is_practice_mode}
                onCheckedChange={(checked) =>
                  setGameConfig({ ...gameConfig, is_practice_mode: checked as boolean })
                }
              />
              <div className="grid gap-0.5 leading-none">
                <Label htmlFor="practice-mode" className="cursor-pointer">
                  Modo Práctica
                </Label>
                <p className="text-sm text-muted-foreground">
                  {gameConfig.is_practice_mode
                    ? 'Todos los cartones participan'
                    : 'Solo cartones vendidos participan'}
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowGameModal(false)}>
                Cancelar
              </Button>
              <Button type="submit" variant="success" disabled={createGameMutation.isPending}>
                {createGameMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Play className="mr-2 h-4 w-4" />
                )}
                {createGameMutation.isPending ? 'Creando...' : 'Iniciar Juego'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
