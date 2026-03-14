import { useState, useEffect, useCallback, Fragment } from 'react';
import { getActivityLog, getActivityLogStats } from '@/services/api';
import type { ActivityLogEntry, ActivityLogStats } from '@/services/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Loader2,
  ScrollText,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  BarChart3,
} from 'lucide-react';

const CATEGORY_LABELS: Record<string, string> = {
  auth: 'Autenticacion',
  users: 'Usuarios',
  events: 'Eventos',
  games: 'Juegos',
  cards: 'Cartones',
  export: 'Exportacion',
  permissions: 'Permisos',
  system: 'Sistema',
  inventory: 'Inventario',
  backup: 'Backup',
};

const CATEGORY_COLORS: Record<string, string> = {
  auth: 'bg-blue-100 text-blue-700',
  users: 'bg-purple-100 text-purple-700',
  events: 'bg-green-100 text-green-700',
  games: 'bg-orange-100 text-orange-700',
  cards: 'bg-cyan-100 text-cyan-700',
  export: 'bg-yellow-100 text-yellow-700',
  permissions: 'bg-red-100 text-red-700',
  system: 'bg-gray-100 text-gray-700',
  inventory: 'bg-teal-100 text-teal-700',
  backup: 'bg-amber-100 text-amber-700',
};

export default function ActivityLog() {
  const [entries, setEntries] = useState<ActivityLogEntry[]>([]);
  const [stats, setStats] = useState<ActivityLogStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [showStats, setShowStats] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 0 });

  // Filtros
  const [category, setCategory] = useState<string>('');
  const [actionFilter, setActionFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [searchTrigger, setSearchTrigger] = useState(0);

  const loadLog = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = { page: pagination.page, limit: pagination.limit };
      if (category) params.category = category;
      if (actionFilter) params.action = actionFilter;
      if (dateFrom) params.from = dateFrom;
      if (dateTo) params.to = dateTo;

      const res = await getActivityLog(params as any);
      if (res.success) {
        setEntries(res.data || []);
        if (res.pagination) setPagination(res.pagination);
      }
    } catch {
      // silenciar
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.limit, category, actionFilter, dateFrom, dateTo]);

  useEffect(() => {
    loadLog();
  }, [loadLog, searchTrigger]);

  const loadStats = async () => {
    if (stats) {
      setShowStats(!showStats);
      return;
    }
    try {
      const res = await getActivityLogStats();
      if (res.success && res.data) {
        setStats(res.data);
        setShowStats(true);
      }
    } catch {
      // silenciar
    }
  };

  const handleSearch = () => {
    setPagination(p => ({ ...p, page: 1 }));
    setSearchTrigger(t => t + 1);
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleString('es', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ScrollText className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Log de Auditoria</h1>
            <p className="text-sm text-muted-foreground">
              Registro de toda la actividad del sistema
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={loadStats}>
          <BarChart3 className="h-4 w-4 mr-1" />
          {showStats ? 'Ocultar stats' : 'Ver stats'}
        </Button>
      </div>

      {/* Stats Panel */}
      {showStats && stats && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-card border rounded-lg p-4">
            <h3 className="font-semibold text-sm mb-2">Actividad reciente</h3>
            <div className="space-y-1 text-sm">
              <p>Ultimas 24h: <span className="font-bold">{stats.counts.last_24h}</span></p>
              <p>Ultimos 7 dias: <span className="font-bold">{stats.counts.last_7d}</span></p>
              <p>Ultimos 30 dias: <span className="font-bold">{stats.counts.last_30d}</span></p>
            </div>
          </div>
          <div className="bg-card border rounded-lg p-4">
            <h3 className="font-semibold text-sm mb-2">Por categoria (30d)</h3>
            <div className="space-y-1 text-sm">
              {stats.byCategory.slice(0, 5).map(c => (
                <div key={c.category} className="flex justify-between">
                  <Badge className={CATEGORY_COLORS[c.category] || 'bg-gray-100 text-gray-700'}>
                    {CATEGORY_LABELS[c.category] || c.category}
                  </Badge>
                  <span className="font-mono">{c.count}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-card border rounded-lg p-4">
            <h3 className="font-semibold text-sm mb-2">Usuarios mas activos (30d)</h3>
            <div className="space-y-1 text-sm">
              {stats.topUsers.slice(0, 5).map(u => (
                <div key={u.user_id} className="flex justify-between">
                  <span>{u.username}</span>
                  <span className="font-mono">{u.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap gap-2 items-end">
        <div className="w-40">
          <Select value={category} onValueChange={(v) => { setCategory(v === 'all' ? '' : v); setPagination(p => ({ ...p, page: 1 })); }}>
            <SelectTrigger>
              <SelectValue placeholder="Categoria" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                <SelectItem key={key} value={key}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Input
          placeholder="Buscar accion..."
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          className="w-40"
        />
        <Input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="w-36"
          placeholder="Desde"
        />
        <Input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="w-36"
          placeholder="Hasta"
        />
        <Button size="sm" onClick={handleSearch}>Filtrar</Button>
      </div>

      {/* Tabla */}
      <div className="bg-card border rounded-lg overflow-x-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : entries.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            No hay registros de actividad
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="p-3 font-medium">Fecha</th>
                <th className="p-3 font-medium">Usuario</th>
                <th className="p-3 font-medium">Accion</th>
                <th className="p-3 font-medium">Categoria</th>
                <th className="p-3 font-medium">IP</th>
                <th className="p-3 font-medium w-8"></th>
              </tr>
            </thead>
            <tbody>
              {entries.map(entry => (
                <Fragment key={entry.id}>
                  <tr
                    className="border-b border-border/50 hover:bg-muted/30 cursor-pointer"
                    onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                  >
                    <td className="p-3 font-mono text-xs whitespace-nowrap">{formatDate(entry.created_at)}</td>
                    <td className="p-3">{entry.username || '-'}</td>
                    <td className="p-3 font-medium">{entry.action}</td>
                    <td className="p-3">
                      <Badge className={CATEGORY_COLORS[entry.category] || 'bg-gray-100 text-gray-700'}>
                        {CATEGORY_LABELS[entry.category] || entry.category}
                      </Badge>
                    </td>
                    <td className="p-3 font-mono text-xs text-muted-foreground">{entry.ip_address || '-'}</td>
                    <td className="p-3">
                      {expandedId === entry.id ? (
                        <ChevronUp className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      )}
                    </td>
                  </tr>
                  {expandedId === entry.id && entry.details && Object.keys(entry.details).length > 0 && (
                    <tr key={`${entry.id}-details`}>
                      <td colSpan={6} className="bg-muted/30 px-6 py-3">
                        <pre className="text-xs font-mono whitespace-pre-wrap max-w-full overflow-x-auto">
                          {JSON.stringify(entry.details, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Paginacion */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Pagina {pagination.page} de {pagination.totalPages} ({pagination.total} registros)
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page <= 1}
              onClick={() => setPagination(p => ({ ...p, page: p.page - 1 }))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => setPagination(p => ({ ...p, page: p.page + 1 }))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
