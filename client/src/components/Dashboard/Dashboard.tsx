import { useQuery } from '@tanstack/react-query';
import { Link, Navigate } from 'react-router-dom';
import {
  CalendarDays,
  CreditCard,
  Gamepad2,
  TrendingUp,
  ShoppingCart,
  Plus,
  ArrowRight,
  AlertCircle,
  Trophy,
  CheckCircle,
  Zap,
} from 'lucide-react';
import { getDashboard } from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import { GAME_TYPE_LABELS } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

export default function Dashboard() {
  const { user } = useAuth();

  // Usuarios de inventario van directo a su sección
  if (user?.role === 'inventory') {
    return <Navigate to="/inventory" replace />;
  }

  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: getDashboard,
    refetchInterval: 30000,
  });

  if (isLoading) {
    return (
      <div className="space-y-8">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-4 w-64" />
          </div>
          <Skeleton className="h-10 w-32" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="stat-card p-6">
              <div className="flex items-center gap-4">
                <Skeleton className="h-12 w-12 rounded-xl" />
                <div className="space-y-2">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-7 w-12" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error || !data?.success) {
    return (
      <Card className="border-destructive/50">
        <CardContent className="pt-6">
          <div className="flex items-center gap-3 text-destructive">
            <AlertCircle className="h-5 w-5" />
            <p>Error cargando dashboard. Verifica que el servidor este corriendo.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const stats = data.data!;

  const statCards = [
    { label: 'Total Eventos', value: stats.total_events, icon: CalendarDays, variant: 'blue' as const },
    { label: 'Eventos Activos', value: stats.active_events, icon: TrendingUp, variant: 'emerald' as const },
    { label: 'Total Cartones', value: stats.total_cards.toLocaleString(), icon: CreditCard, variant: 'violet' as const },
    { label: 'Cartones Vendidos', value: stats.total_cards_sold.toLocaleString(), icon: ShoppingCart, variant: 'rose' as const },
    { label: 'Juegos Jugados', value: stats.total_games_played, icon: Gamepad2, variant: 'sky' as const },
  ];

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
      case 'in_progress':
        return <Badge variant="success">Activo</Badge>;
      case 'completed':
        return <Badge variant="info">Completado</Badge>;
      case 'draft':
        return <Badge variant="secondary">Borrador</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="page-header flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Dashboard</h2>
          <p className="text-muted-foreground text-sm mt-1">Resumen general del sistema</p>
        </div>
        <Button asChild className="shadow-sm">
          <Link to="/events">
            <Plus className="mr-2 h-4 w-4" />
            Nuevo Evento
          </Link>
        </Button>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        {statCards.map((stat) => (
          <div key={stat.label} className={`stat-card stat-card-${stat.variant} p-5`}>
            <div className="flex items-center gap-4">
              <div className={`stat-icon-${stat.variant} p-3 rounded-xl`}>
                <stat.icon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium">{stat.label}</p>
                <p className="text-2xl font-bold tracking-tight mt-0.5">{stat.value}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Recent Events & Games */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Events */}
        <Card className="glow-card">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-sm font-semibold">Eventos Recientes</CardTitle>
            </div>
            <Button variant="ghost" size="sm" asChild className="h-7 text-xs">
              <Link to="/events">
                Ver todos <ArrowRight className="ml-1 h-3 w-3" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {stats.recent_events.length === 0 ? (
              <div className="text-center py-10">
                <CalendarDays className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-muted-foreground text-sm">No hay eventos aun</p>
              </div>
            ) : (
              <div className="space-y-1">
                {stats.recent_events.map((event) => (
                  <Link
                    key={event.id}
                    to={`/events/${event.id}`}
                    className="flex items-center justify-between p-3 rounded-lg hover:bg-muted/60 transition-colors group"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                        <CalendarDays className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <p className="text-sm font-medium group-hover:text-primary transition-colors">{event.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {event.total_cards.toLocaleString()} cartones
                        </p>
                      </div>
                    </div>
                    {getStatusBadge(event.status)}
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Games */}
        <Card className="glow-card">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div className="flex items-center gap-2">
              <Gamepad2 className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-sm font-semibold">Juegos Recientes</CardTitle>
            </div>
            <Button variant="ghost" size="sm" asChild className="h-7 text-xs">
              <Link to="/games">
                Ver todos <ArrowRight className="ml-1 h-3 w-3" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {stats.recent_games.length === 0 ? (
              <div className="text-center py-10">
                <Gamepad2 className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-muted-foreground text-sm">No hay juegos aun</p>
              </div>
            ) : (
              <div className="space-y-1">
                {stats.recent_games.map((game) => (
                  <Link
                    key={game.id}
                    to={`/games/${game.id}`}
                    className="flex items-center justify-between p-3 rounded-lg hover:bg-muted/60 transition-colors group"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center">
                        {game.status === 'completed' ? (
                          <Trophy className="h-4 w-4 text-blue-500" />
                        ) : (
                          <Gamepad2 className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                        )}
                      </div>
                      <div>
                        <p className="text-sm font-medium group-hover:text-primary transition-colors">
                          {game.name || GAME_TYPE_LABELS[game.game_type]}
                        </p>
                        <p className="text-xs text-muted-foreground">{game.event_name}</p>
                      </div>
                    </div>
                    {getStatusBadge(game.status)}
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Zap className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Acciones Rapidas</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Link to="/events" className="action-card">
            <div className="stat-icon-blue p-2.5 rounded-xl">
              <CalendarDays className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold">Crear Evento</p>
              <p className="text-xs text-muted-foreground">Nuevo evento de bingo</p>
            </div>
          </Link>

          <Link to="/cards" className="action-card">
            <div className="stat-icon-emerald p-2.5 rounded-xl">
              <CreditCard className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold">Ver Cartones</p>
              <p className="text-xs text-muted-foreground">Administrar cartones</p>
            </div>
          </Link>

          <Link to="/games" className="action-card">
            <div className="stat-icon-violet p-2.5 rounded-xl">
              <Gamepad2 className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold">Iniciar Juego</p>
              <p className="text-xs text-muted-foreground">Nueva partida de bingo</p>
            </div>
          </Link>

          <Link to="/cards/validate" className="action-card">
            <div className="stat-icon-rose p-2.5 rounded-xl">
              <CheckCircle className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold">Validar Carton</p>
              <p className="text-xs text-muted-foreground">Verificar ganador</p>
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
}
