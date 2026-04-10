import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Search, Loader2, ChevronLeft, ChevronRight, ShoppingCart,
  DollarSign, CreditCard, CheckCircle, XCircle, Clock, Mail,
  ChevronDown, ChevronUp,
} from 'lucide-react';
import api from '@/services/api';
import { getEvents } from '@/services/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';

interface OnlineOrder {
  id: number;
  event_id: number;
  event_name?: string;
  order_code: string;
  quantity: number;
  unit_price: number;
  total_amount: number;
  buyer_name: string;
  buyer_email: string;
  buyer_phone: string;
  buyer_cedula: string | null;
  status: string;
  card_ids: number[];
  yappy_transaction_id: string | null;
  yappy_transaction_data: Record<string, unknown> | null;
  payment_confirmed_at: string | null;
  payment_confirmed_by: string | null;
  card_serials?: string[];
  pdf_path: string | null;
  download_token: string | null;
  email_sent_at: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

interface OrdersResponse {
  orders: OnlineOrder[];
  total: number;
  summary: {
    total_orders: number;
    total_completed: number;
    total_amount: number;
    total_cards: number;
  };
}

const STATUS_CONFIG: Record<string, { label: string; variant: string; icon: typeof CheckCircle }> = {
  completed: { label: 'Completado', variant: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400', icon: CheckCircle },
  pending_payment: { label: 'Pendiente', variant: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400', icon: Clock },
  expired: { label: 'Expirado', variant: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400', icon: XCircle },
  cancelled: { label: 'Cancelado', variant: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400', icon: XCircle },
  failed: { label: 'Fallido', variant: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400', icon: XCircle },
};

const PAGE_SIZE = 25;

function formatDate(d: string | null | undefined) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('es-PA', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatMoney(n: number) {
  return '$' + Number(n).toFixed(2);
}

export default function VentasDigitales() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [status, setStatus] = useState('');
  const [eventId, setEventId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [pendingActionId, setPendingActionId] = useState<number | null>(null);

  const { data: eventsData } = useQuery({ queryKey: ['events'], queryFn: getEvents });
  const events = eventsData?.data ?? [];

  const queryParams = useMemo(() => ({
    event_id: eventId || undefined,
    status: status || undefined,
    search: search || undefined,
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  }), [eventId, status, search, dateFrom, dateTo, page]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['ventas-digitales', queryParams],
    queryFn: () => api.get<{ success: boolean; data: OrdersResponse }>('/venta/orders', { params: queryParams }).then(r => r.data.data),
    placeholderData: (prev) => prev,
  });

  const orders = data?.orders ?? [];
  const total = data?.total ?? 0;
  const summary = data?.summary;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const confirmMutation = useMutation({
    mutationFn: (id: number) => { setPendingActionId(id); return api.post(`/venta/orders/${id}/confirm`).then(r => r.data); },
    onSuccess: () => {
      toast.success('Pago confirmado manualmente');
      queryClient.invalidateQueries({ queryKey: ['ventas-digitales'] });
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Error confirmando'),
    onSettled: () => setPendingActionId(null),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: number) => { setPendingActionId(id); return api.post(`/venta/orders/${id}/cancel`).then(r => r.data); },
    onSuccess: () => {
      toast.success('Orden cancelada');
      queryClient.invalidateQueries({ queryKey: ['ventas-digitales'] });
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Error cancelando'),
    onSettled: () => setPendingActionId(null),
  });

  const resendMutation = useMutation({
    mutationFn: (id: number) => { setPendingActionId(id); return api.post(`/venta/orders/${id}/resend`).then(r => r.data); },
    onSuccess: () => toast.success('Email reenviado'),
    onError: (err: any) => toast.error(err.response?.data?.error || 'Error reenviando'),
    onSettled: () => setPendingActionId(null),
  });

  const handleFilter = () => {
    setSearch(searchInput);
    setPage(1);
  };

  const handleClear = () => {
    setSearchInput('');
    setSearch('');
    setStatus('');
    setEventId('');
    setDateFrom('');
    setDateTo('');
    setPage(1);
  };

  const getStatusBadge = (s: string) => {
    const cfg = STATUS_CONFIG[s] || { label: s, variant: 'bg-gray-100 text-gray-600', icon: Clock };
    return <Badge className={cfg.variant}>{cfg.label}</Badge>;
  };

  return (
    <div className="space-y-6">
      <div className="page-header">
        <h2 className="text-2xl font-bold tracking-tight">Ventas Digitales</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Ordenes de compra online y pagos con Yappy
        </p>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                  <ShoppingCart className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Total Ordenes</p>
                  <p className="text-xl font-bold">{summary.total_orders}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/30">
                  <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Completadas</p>
                  <p className="text-xl font-bold">{summary.total_completed}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
                  <DollarSign className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Monto Total</p>
                  <p className="text-xl font-bold">{formatMoney(summary.total_amount)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/30">
                  <CreditCard className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Cartones Vendidos</p>
                  <p className="text-xl font-bold">{summary.total_cards}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-wrap gap-2 items-end">
            <div className="flex-1 min-w-[180px]">
              <Input
                placeholder="Buscar orden, nombre, email, tel, Yappy ID..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleFilter()}
                className="h-9"
              />
            </div>
            <Select value={status || 'all'} onValueChange={(v) => { setStatus(v === 'all' ? '' : v); setPage(1); }}>
              <SelectTrigger className="w-[150px] h-9">
                <SelectValue placeholder="Estado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="completed">Completado</SelectItem>
                <SelectItem value="pending_payment">Pendiente</SelectItem>
                <SelectItem value="expired">Expirado</SelectItem>
                <SelectItem value="cancelled">Cancelado</SelectItem>
                <SelectItem value="failed">Fallido</SelectItem>
              </SelectContent>
            </Select>
            <Select value={eventId || 'all'} onValueChange={(v) => { setEventId(v === 'all' ? '' : v); setPage(1); }}>
              <SelectTrigger className="w-[180px] h-9">
                <SelectValue placeholder="Evento" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los eventos</SelectItem>
                {events.map(ev => (
                  <SelectItem key={ev.id} value={String(ev.id)}>{ev.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} className="w-[145px] h-9" />
            <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} className="w-[145px] h-9" />
            <Button size="sm" onClick={handleFilter} className="h-9">
              <Search className="h-4 w-4 mr-1" /> Filtrar
            </Button>
            <Button size="sm" variant="outline" onClick={handleClear} className="h-9">Limpiar</Button>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : orders.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No se encontraron ordenes
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="p-3 text-left font-medium"></th>
                    <th className="p-3 text-left font-medium">Orden</th>
                    <th className="p-3 text-left font-medium">Fecha</th>
                    <th className="p-3 text-left font-medium">Comprador</th>
                    <th className="p-3 text-left font-medium">Cartones</th>
                    <th className="p-3 text-left font-medium">Monto</th>
                    <th className="p-3 text-left font-medium">Estado</th>
                    <th className="p-3 text-left font-medium">Pago</th>
                    <th className="p-3 text-left font-medium">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map(order => {
                    const isExpanded = expandedId === order.id;
                    const yappyData = order.yappy_transaction_data as Record<string, unknown> | null;

                    return (
                      <React.Fragment key={order.id}>
                        <tr
                          className={`border-b border-border/50 hover:bg-muted/30 cursor-pointer ${isExpanded ? 'bg-muted/20' : ''}`}
                          onClick={() => setExpandedId(isExpanded ? null : order.id)}
                        >
                          <td className="p-3 w-8">
                            {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                          </td>
                          <td className="p-3">
                            <span className="font-mono font-bold text-primary">{order.order_code}</span>
                          </td>
                          <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">{formatDate(order.created_at)}</td>
                          <td className="p-3">
                            <div className="font-medium">{order.buyer_name}</div>
                            <div className="text-xs text-muted-foreground">{order.buyer_phone}</div>
                          </td>
                          <td className="p-3 text-center font-bold">{order.quantity}</td>
                          <td className="p-3 font-mono font-bold">{formatMoney(Number(order.total_amount))}</td>
                          <td className="p-3">{getStatusBadge(order.status)}</td>
                          <td className="p-3">
                            {order.payment_confirmed_by ? (
                              <span className="text-xs text-muted-foreground">{order.payment_confirmed_by}</span>
                            ) : (
                              <span className="text-xs text-muted-foreground">-</span>
                            )}
                          </td>
                          <td className="p-3">
                            <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                              {order.status === 'pending_payment' && (
                                <>
                                  <Button
                                    size="sm" variant="outline" className="h-7 text-xs"
                                    onClick={() => confirmMutation.mutate(order.id)}
                                    disabled={pendingActionId === order.id}
                                  >
                                    <CheckCircle className="h-3 w-3 mr-1" /> Confirmar
                                  </Button>
                                  <Button
                                    size="sm" variant="ghost" className="h-7 text-xs text-destructive"
                                    onClick={() => cancelMutation.mutate(order.id)}
                                    disabled={pendingActionId === order.id}
                                  >
                                    <XCircle className="h-3 w-3 mr-1" /> Cancelar
                                  </Button>
                                </>
                              )}
                              {order.status === 'completed' && (
                                <Button
                                  size="sm" variant="ghost" className="h-7 text-xs"
                                  onClick={() => resendMutation.mutate(order.id)}
                                  disabled={pendingActionId === order.id}
                                >
                                  <Mail className="h-3 w-3 mr-1" /> {order.email_sent_at ? 'Reenviar' : 'Enviar'}
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>

                        {/* Expanded detail row */}
                        {isExpanded && (
                          <tr className="bg-muted/10 border-b">
                            <td colSpan={9} className="p-4">
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-sm">
                                {/* Datos del comprador */}
                                <div className="space-y-2">
                                  <h4 className="font-semibold text-xs uppercase text-muted-foreground tracking-wider">Comprador</h4>
                                  <div className="space-y-1">
                                    <p><span className="text-muted-foreground">Nombre:</span> <strong>{order.buyer_name}</strong></p>
                                    <p><span className="text-muted-foreground">Email:</span> {order.buyer_email}</p>
                                    <p><span className="text-muted-foreground">Telefono:</span> {order.buyer_phone}</p>
                                    {order.buyer_cedula && <p><span className="text-muted-foreground">Cedula:</span> {order.buyer_cedula}</p>}
                                  </div>
                                </div>

                                {/* Datos de pago */}
                                <div className="space-y-2">
                                  <h4 className="font-semibold text-xs uppercase text-muted-foreground tracking-wider">Pago Yappy</h4>
                                  <div className="space-y-1">
                                    <p><span className="text-muted-foreground">Precio unitario:</span> <strong>{formatMoney(Number(order.unit_price))}</strong></p>
                                    <p><span className="text-muted-foreground">Total:</span> <strong className="text-green-600 dark:text-green-400">{formatMoney(Number(order.total_amount))}</strong></p>
                                    <p><span className="text-muted-foreground">Confirmado por:</span> {order.payment_confirmed_by || 'Sin confirmar'}</p>
                                    {order.payment_confirmed_at && (
                                      <p><span className="text-muted-foreground">Fecha pago:</span> {formatDate(order.payment_confirmed_at)}</p>
                                    )}
                                    {order.yappy_transaction_id && (
                                      <p><span className="text-muted-foreground">Yappy TXN ID:</span> <span className="font-mono text-xs">{order.yappy_transaction_id}</span></p>
                                    )}
                                    {yappyData && (
                                      <div className="mt-2">
                                        <p className="text-muted-foreground text-xs mb-1">Datos Yappy:</p>
                                        <pre className="bg-muted rounded p-2 text-xs overflow-x-auto max-h-32">
                                          {JSON.stringify(yappyData, null, 2)}
                                        </pre>
                                      </div>
                                    )}
                                  </div>
                                </div>

                                {/* Datos de orden */}
                                <div className="space-y-2">
                                  <h4 className="font-semibold text-xs uppercase text-muted-foreground tracking-wider">Orden</h4>
                                  <div className="space-y-1">
                                    <p><span className="text-muted-foreground">Evento:</span> {order.event_name || `#${order.event_id}`}</p>
                                    <p><span className="text-muted-foreground">Cartones:</span> <strong>{order.quantity}</strong></p>
                                    {order.card_serials && order.card_serials.length > 0 && (
                                      <div>
                                        <span className="text-muted-foreground">Seriales:</span>
                                        <p className="font-mono text-xs mt-1">{order.card_serials.join(' \u2022 ')}</p>
                                      </div>
                                    )}
                                    <p><span className="text-muted-foreground">Creada:</span> {formatDate(order.created_at)}</p>
                                    <p><span className="text-muted-foreground">Expira:</span> {formatDate(order.expires_at)}</p>
                                    {order.email_sent_at && (
                                      <p className="flex items-center gap-1">
                                        <Mail className="h-3 w-3 text-green-500" />
                                        <span className="text-muted-foreground">Email enviado:</span> {formatDate(order.email_sent_at)}
                                      </p>
                                    )}
                                    {order.download_token && (
                                      <p><span className="text-muted-foreground">PDF:</span> <Badge variant="success" className="text-[10px]">Generado</Badge></p>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between p-4 border-t">
              <p className="text-sm text-muted-foreground">
                Pagina {page} de {totalPages} ({total} ordenes)
                {isFetching && <Loader2 className="inline h-3 w-3 animate-spin ml-2" />}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1 || isFetching} onClick={() => setPage(p => p - 1)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages || isFetching} onClick={() => setPage(p => p + 1)}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
