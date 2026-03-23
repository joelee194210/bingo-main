import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, AreaChart, Area,
} from 'recharts';
import {
  CreditCard, Package, ShoppingCart, TrendingUp, Building2,
  BarChart3, PieChart as PieChartIcon, Loader2, Warehouse, Eye,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { getEvents, getDashboardVentas } from '@/services/api';

const COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#06b6d4', '#ec4899', '#14b8a6', '#f97316', '#6366f1',
];

function formatNumber(n: number): string {
  return n.toLocaleString('es-DO');
}

export default function DashboardVentas() {
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);

  const { data: eventsData } = useQuery({
    queryKey: ['events'],
    queryFn: getEvents,
  });
  const events = eventsData?.data ?? [];

  const eventId = selectedEventId || events[0]?.id;

  const { data: dashData, isLoading } = useQuery({
    queryKey: ['dashboard-ventas', eventId],
    queryFn: () => getDashboardVentas(eventId!),
    enabled: !!eventId,
    refetchInterval: 30000,
  });

  const dashboard = dashData?.data;

  const ventasDiaData = useMemo(() => {
    if (!dashboard?.ventas_por_dia) return [];
    return dashboard.ventas_por_dia.map(d => ({
      fecha: new Date(d.fecha).toLocaleDateString('es-DO', { day: '2-digit', month: 'short' }),
      vendidos: d.vendidos,
    }));
  }, [dashboard?.ventas_por_dia]);

  const pieData = useMemo(() => {
    if (!dashboard) return [];
    return [
      { name: 'Vendidos', value: dashboard.resumen.cartones_vendidos, color: '#10b981' },
      { name: 'Disponibles', value: dashboard.resumen.cartones_disponibles, color: '#e2e8f0' },
    ];
  }, [dashboard]);

  const almacenesBarData = useMemo(() => {
    if (!dashboard?.almacenes) return [];
    return dashboard.almacenes
      .filter(a => a.total_cartones > 0)
      .map(a => ({
        name: a.name.length > 15 ? a.name.substring(0, 15) + '...' : a.name,
        fullName: a.name,
        vendidos: a.cartones_vendidos,
        disponibles: a.cartones_disponibles,
      }));
  }, [dashboard?.almacenes]);

  if (!eventId && events.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        No hay eventos disponibles
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-3">
            Resumen de Ventas
            <Badge variant="outline" className="text-xs gap-1 font-normal">
              <Eye className="h-3 w-3" /> Solo lectura
            </Badge>
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Vista informativa de ventas por todos los almacenes
          </p>
        </div>
        <Select
          value={eventId?.toString() || ''}
          onValueChange={(v) => setSelectedEventId(Number(v))}
        >
          <SelectTrigger className="w-64">
            <SelectValue placeholder="Seleccionar evento..." />
          </SelectTrigger>
          <SelectContent>
            {events.map(e => (
              <SelectItem key={e.id} value={e.id.toString()}>{e.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {[...Array(6)].map((_, i) => (
              <Card key={i}><CardContent className="pt-6"><Skeleton className="h-16 w-full" /></CardContent></Card>
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card><CardContent className="pt-6"><Skeleton className="h-64 w-full" /></CardContent></Card>
            <Card><CardContent className="pt-6"><Skeleton className="h-64 w-full" /></CardContent></Card>
          </div>
        </div>
      ) : !dashboard ? (
        <div className="flex items-center justify-center h-64 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin mr-2" /> Cargando datos...
        </div>
      ) : (
        <>
          {/* Stat Cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <StatCard icon={CreditCard} label="Total Cartones" value={formatNumber(dashboard.resumen.total_cartones)} color="blue" />
            <StatCard icon={ShoppingCart} label="Vendidos" value={formatNumber(dashboard.resumen.cartones_vendidos)} color="emerald" />
            <StatCard icon={CreditCard} label="Disponibles" value={formatNumber(dashboard.resumen.cartones_disponibles)} color="amber" />
            <StatCard icon={Package} label="Total Cajas" value={formatNumber(dashboard.resumen.total_cajas)} color="violet" />
            <StatCard icon={BarChart3} label="Total Lotes" value={formatNumber(dashboard.resumen.total_lotes)} color="cyan" />
            <StatCard icon={TrendingUp} label="% Vendido" value={`${dashboard.resumen.porcentaje_vendido}%`} color="rose" />
          </div>

          {/* Charts Row 1 */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <TrendingUp className="h-5 w-5 text-blue-500" />
                  Ventas por Dia (ultimos 30 dias)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {ventasDiaData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={280}>
                    <AreaChart data={ventasDiaData}>
                      <defs>
                        <linearGradient id="colorVentasInfo" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="fecha" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }} />
                      <Area type="monotone" dataKey="vendidos" stroke="#3b82f6" strokeWidth={2.5} fill="url(#colorVentasInfo)" name="Cartones vendidos" />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
                    Sin datos de ventas en los ultimos 30 dias
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <PieChartIcon className="h-5 w-5 text-emerald-500" />
                  Distribucion de Cartones
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={2} dataKey="value" strokeWidth={0}>
                      {pieData.map((entry, index) => (
                        <Cell key={index} fill={entry.color} />
                      ))}
                    </Pie>
                    <Legend verticalAlign="bottom" formatter={(value: string) => <span className="text-sm">{value}</span>} />
                    <Tooltip formatter={(value: any) => formatNumber(Number(value))} contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }} />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {/* Charts Row 2 */}
          {almacenesBarData.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Warehouse className="h-5 w-5 text-violet-500" />
                    Cartones por Almacen
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={Math.max(280, almacenesBarData.length * 45)}>
                    <BarChart data={almacenesBarData} layout="vertical" margin={{ left: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11 }} />
                      <Tooltip contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }} formatter={(value: any, name: any) => [formatNumber(Number(value)), name === 'vendidos' ? 'Vendidos' : 'Disponibles']} />
                      <Bar dataKey="vendidos" stackId="a" fill="#10b981" radius={[0, 0, 0, 0]} name="Vendidos" />
                      <Bar dataKey="disponibles" stackId="a" fill="#e2e8f0" radius={[0, 4, 4, 0]} name="Disponibles" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <TrendingUp className="h-5 w-5 text-amber-500" />
                    Ranking de Almacenes
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3 max-h-[400px] overflow-y-auto">
                    {[...dashboard.almacenes]
                      .filter(a => a.total_cartones > 0)
                      .sort((a, b) => b.cartones_vendidos - a.cartones_vendidos)
                      .map((a, i) => (
                        <div key={a.id} className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0 ${
                            i === 0 ? 'bg-amber-500' : i === 1 ? 'bg-slate-400' : i === 2 ? 'bg-amber-700' : 'bg-muted text-muted-foreground'
                          }`}>
                            {i + 1}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">
                              {a.name}
                              {a.es_agencia_loteria && (
                                <Badge variant="outline" className="ml-2 text-[9px] px-1">Loteria</Badge>
                              )}
                            </p>
                            <div className="flex items-center gap-2 mt-1">
                              <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${a.porcentaje}%`, backgroundColor: COLORS[i % COLORS.length] }} />
                              </div>
                              <span className="text-xs text-muted-foreground shrink-0">{a.porcentaje}%</span>
                            </div>
                          </div>
                          <Badge variant="secondary" className="text-xs shrink-0">
                            {formatNumber(a.cartones_vendidos)}
                          </Badge>
                        </div>
                      ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Tabla detallada */}
          {dashboard.almacenes.filter(a => a.total_cartones > 0).length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Building2 className="h-5 w-5 text-blue-500" />
                  Detalle por Almacen
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="py-3 px-2 font-semibold">Almacen</th>
                        <th className="py-3 px-2 font-semibold text-center">Tipo</th>
                        <th className="py-3 px-2 font-semibold text-center">Cajas</th>
                        <th className="py-3 px-2 font-semibold text-center">Lotes</th>
                        <th className="py-3 px-2 font-semibold text-center">Cartones</th>
                        <th className="py-3 px-2 font-semibold text-center">Vendidos</th>
                        <th className="py-3 px-2 font-semibold text-center">Disponibles</th>
                        <th className="py-3 px-2 font-semibold text-center">% Venta</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dashboard.almacenes
                        .filter(a => a.total_cartones > 0)
                        .map((a, i) => (
                        <tr key={a.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                          <td className="py-3 px-2">
                            <div className="flex items-center gap-2">
                              <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                              <span className="font-medium">{a.name}</span>
                              <Badge variant="outline" className="text-[10px]">{a.code}</Badge>
                            </div>
                          </td>
                          <td className="py-3 px-2 text-center">
                            {a.es_agencia_loteria ? (
                              <Badge variant="secondary" className="text-[10px]">Loteria</Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px]">General</Badge>
                            )}
                          </td>
                          <td className="py-3 px-2 text-center">{formatNumber(a.total_cajas)}</td>
                          <td className="py-3 px-2 text-center">{formatNumber(a.total_lotes)}</td>
                          <td className="py-3 px-2 text-center">{formatNumber(a.total_cartones)}</td>
                          <td className="py-3 px-2 text-center font-semibold text-emerald-600">{formatNumber(a.cartones_vendidos)}</td>
                          <td className="py-3 px-2 text-center text-muted-foreground">{formatNumber(a.cartones_disponibles)}</td>
                          <td className="py-3 px-2 text-center">
                            <Badge variant={a.porcentaje >= 80 ? 'success' : a.porcentaje >= 50 ? 'warning' : 'secondary'}>
                              {a.porcentaje}%
                            </Badge>
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-muted/50 font-bold">
                        <td className="py-3 px-2">TOTAL</td>
                        <td className="py-3 px-2"></td>
                        <td className="py-3 px-2 text-center">{formatNumber(dashboard.resumen.total_cajas)}</td>
                        <td className="py-3 px-2 text-center">{formatNumber(dashboard.resumen.total_lotes)}</td>
                        <td className="py-3 px-2 text-center">{formatNumber(dashboard.resumen.total_cartones)}</td>
                        <td className="py-3 px-2 text-center text-emerald-600">{formatNumber(dashboard.resumen.cartones_vendidos)}</td>
                        <td className="py-3 px-2 text-center">{formatNumber(dashboard.resumen.cartones_disponibles)}</td>
                        <td className="py-3 px-2 text-center">
                          <Badge variant="info">{dashboard.resumen.porcentaje_vendido}%</Badge>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: string; color: string }) {
  const colorMap: Record<string, string> = {
    blue: 'from-blue-500/10 to-blue-500/5 text-blue-600 dark:text-blue-400',
    emerald: 'from-emerald-500/10 to-emerald-500/5 text-emerald-600 dark:text-emerald-400',
    amber: 'from-amber-500/10 to-amber-500/5 text-amber-600 dark:text-amber-400',
    violet: 'from-violet-500/10 to-violet-500/5 text-violet-600 dark:text-violet-400',
    cyan: 'from-cyan-500/10 to-cyan-500/5 text-cyan-600 dark:text-cyan-400',
    rose: 'from-rose-500/10 to-rose-500/5 text-rose-600 dark:text-rose-400',
  };
  const iconColorMap: Record<string, string> = {
    blue: 'bg-blue-500/10 text-blue-500',
    emerald: 'bg-emerald-500/10 text-emerald-500',
    amber: 'bg-amber-500/10 text-amber-500',
    violet: 'bg-violet-500/10 text-violet-500',
    cyan: 'bg-cyan-500/10 text-cyan-500',
    rose: 'bg-rose-500/10 text-rose-500',
  };

  return (
    <Card className={`bg-gradient-to-br ${colorMap[color]} border-0 shadow-sm`}>
      <CardContent className="pt-5 pb-4 px-4">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${iconColorMap[color]}`}>
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xl font-bold leading-tight">{value}</p>
            <p className="text-[11px] text-muted-foreground font-medium">{label}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
