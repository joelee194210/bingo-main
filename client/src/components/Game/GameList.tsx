import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Gamepad2, Play, Clock, Trophy, Search } from 'lucide-react';
import { getGames, getEvents } from '@/services/api';
import { GAME_TYPE_LABELS, STATUS_LABELS, type GameStatus } from '@/types';
import { useState, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { DataExportMenu } from '@/components/ui/data-export-menu';
import { getStatusColor } from '@/lib/badge-variants';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export default function GameList() {
  const [eventId, setEventId] = useState<number | undefined>();
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');

  const { data: eventsData } = useQuery({
    queryKey: ['events'],
    queryFn: getEvents,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['games', eventId, statusFilter],
    queryFn: () => getGames({ event_id: eventId, status: statusFilter || undefined }),
  });

  const events = eventsData?.data || [];
  const games = useMemo(() => {
    const allGames = data?.data || [];
    if (!searchTerm.trim()) return allGames;
    const q = searchTerm.toLowerCase();
    return allGames.filter(g =>
      (g.name && g.name.toLowerCase().includes(q)) ||
      GAME_TYPE_LABELS[g.game_type]?.toLowerCase().includes(q)
    );
  }, [data?.data, searchTerm]);

  const EXPORT_COLUMNS = [
    { key: 'name', label: 'Nombre' },
    { key: 'game_type', label: 'Tipo' },
    { key: 'status', label: 'Estado' },
    { key: 'is_practice_mode', label: 'Modo' },
  ];

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'in_progress': return <Play className="text-green-500 h-4 w-4" />;
      case 'completed': return <Trophy className="text-yellow-500 h-4 w-4" />;
      case 'paused': return <Clock className="text-yellow-500 h-4 w-4" />;
      default: return <Gamepad2 className="text-muted-foreground h-4 w-4" />;
    }
  };

  const getStatusBadge = (status: GameStatus) => (
    <Badge className={getStatusColor(status)}>{STATUS_LABELS[status]}</Badge>
  );

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
        <Card>
          <CardContent className="pt-6">
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <Card key={i}>
              <CardContent className="pt-6">
                <Skeleton className="h-32 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="page-header flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Juegos</h2>
          <p className="text-muted-foreground text-sm mt-1">Gestiona las partidas de bingo</p>
        </div>
        <div className="flex items-center gap-2">
          <DataExportMenu
            data={games as unknown as Record<string, unknown>[]}
            columns={EXPORT_COLUMNS}
            filename="juegos"
          />
          {events.length > 0 && (
            <Button asChild>
              <Link to={`/events/${eventId ? eventId : events[0].id}`}>
                <Play className="mr-2 h-4 w-4" /> Nuevo Juego
              </Link>
            </Button>
          )}
        </div>
      </div>

      {/* Search + Filters */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground h-4 w-4" />
        <Input className="pl-9" placeholder="Buscar juego..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
      </div>
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-4">
            <div className="flex-1 min-w-[200px] space-y-2">
              <Label>Evento</Label>
              <Select
                value={eventId?.toString() || 'all'}
                onValueChange={(value) => setEventId(value === 'all' ? undefined : Number(value))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Todos los eventos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los eventos</SelectItem>
                  {events.map((event) => (
                    <SelectItem key={event.id} value={event.id.toString()}>{event.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 min-w-[200px] space-y-2">
              <Label>Estado</Label>
              <Select
                value={statusFilter || 'all'}
                onValueChange={(value) => setStatusFilter(value === 'all' ? '' : value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="pending">Pendiente</SelectItem>
                  <SelectItem value="in_progress">En Progreso</SelectItem>
                  <SelectItem value="paused">Pausado</SelectItem>
                  <SelectItem value="completed">Completado</SelectItem>
                  <SelectItem value="cancelled">Cancelado</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Games Grid */}
      {games.length === 0 ? (
        <Card className="text-center py-12">
          <CardContent>
            <div className="text-6xl mb-4">🎮</div>
            <h3 className="text-xl font-semibold mb-2">No hay juegos</h3>
            <p className="text-muted-foreground mb-4">Crea un nuevo juego desde un evento</p>
            {events.length > 0 && (
              <Button asChild>
                <Link to={`/events/${eventId ? eventId : events[0].id}`}>
                  <Play className="mr-2 h-4 w-4" /> Ir a Eventos
                </Link>
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {games.map((game) => {
            let calledBalls: number[] = [];
            let winners: number[] = [];
            try {
              calledBalls = JSON.parse(game.called_balls || '[]') as number[];
              winners = JSON.parse(game.winner_cards || '[]') as number[];
            } catch {
              // fallback to empty arrays
            }
            const progressPercent = Math.round((calledBalls.length / 75) * 100);

            return (
              <Link key={game.id} to={`/games/${game.id}`}>
                <Card className="glow-card">
                  <CardContent className="pt-6">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-2">
                        {getStatusIcon(game.status)}
                        <span className="font-semibold">
                          {game.name || GAME_TYPE_LABELS[game.game_type]}
                        </span>
                      </div>
                      {getStatusBadge(game.status)}
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Tipo</span>
                        <span className="font-medium">{GAME_TYPE_LABELS[game.game_type]}</span>
                      </div>

                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Modo</span>
                        <Badge variant={game.is_practice_mode ? 'default' : 'success'} className="text-xs">
                          {game.is_practice_mode ? 'Práctica' : 'Real'}
                        </Badge>
                      </div>

                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Balotas</span>
                        <span className="font-medium">{calledBalls.length} / 75</span>
                      </div>

                      {winners.length > 0 && (
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">Ganadores</span>
                          <span className="font-medium text-yellow-600 flex items-center gap-1">
                            <Trophy className="h-4 w-4" /> {winners.length}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Progress */}
                    <div className="mt-4">
                      <Progress value={progressPercent} className="h-2" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
