import axios from 'axios';
import type {
  ApiResponse,
  BingoEvent,
  BingoCard,
  BingoGame,
  GameState,
  DashboardStats,
  GameType,
  CallBallResult,
  Winner,
  GameReport,
  GameWinner,
  FinishGameResult,
  PromoData,
  PromoConfig,
  PromoPrize,
  PromoDistributeResult,
  PromoWinner,
  PromoFixedRule,
  Almacen,
  AlmacenUsuario,
  InvAsignacion,
  InvAsignacionCarton,
  InvMovimiento,
  ResumenInventario,
  CajaReal,
} from '../types';

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true, // M10: enviar httpOnly cookies automáticamente
});

// Interceptor: redirigir a login en 401
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && !error.config?.url?.includes('/auth/') && !error.config?.url?.includes('/backup/progress')) {
      localStorage.removeItem('bingo_auth_user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// Dashboard
export const getDashboard = () =>
  api.get<ApiResponse<DashboardStats>>('/dashboard').then(r => r.data);

// Events
export const getEvents = () =>
  api.get<ApiResponse<BingoEvent[]>>('/events').then(r => r.data);

export const getEvent = (id: number) =>
  api.get<ApiResponse<BingoEvent>>(`/events/${id}`).then(r => r.data);

export const createEvent = (data: { name: string; description?: string; use_free_center?: boolean }) =>
  api.post<ApiResponse<BingoEvent>>('/events', data).then(r => r.data);

export const updateEvent = (id: number, data: Partial<BingoEvent>) =>
  api.put<ApiResponse<BingoEvent>>(`/events/${id}`, data).then(r => r.data);

export const deleteEvent = (id: number) =>
  api.delete<ApiResponse<void>>(`/events/${id}`).then(r => r.data);

export const getEventStats = (id: number) =>
  api.get<ApiResponse<{ event: BingoEvent; cards: { total: number; sold: number; available: number }; games: { total: number; completed: number; active: number } }>>(`/events/${id}/stats`).then(r => r.data);

// Cards
export const getCards = (params: { event_id?: number; page?: number; limit?: number; is_sold?: string; search?: string; caja?: string; lote?: string; almacen_id?: number }) =>
  api.get<ApiResponse<(BingoCard & { lote_code?: string; caja_code?: string; almacen_name?: string })[]>>('/cards', { params }).then(r => r.data);

export const getCard = (id: number) =>
  api.get<ApiResponse<BingoCard>>(`/cards/${id}`).then(r => r.data);

export const generateCards = (eventId: number, quantity: number, lotesPorCaja: number = 50) =>
  api.post<ApiResponse<{ generated: number; duplicatesAvoided: number; generationTime: number; lotes_creados: number; cajas_creadas: number; lotes_por_caja: number; cartones_por_caja: number }>>('/cards/generate', { event_id: eventId, quantity, lotes_por_caja: lotesPorCaja }).then(r => r.data);

export const getGenerationProgress = (eventId: number) =>
  api.get<ApiResponse<{ total: number; generated: number; status: string } | null>>(`/cards/generate/progress/${eventId}`).then(r => r.data);

export const validateCard = (cardCode: string, validationCode: string) =>
  api.post<ApiResponse<BingoCard>>('/cards/validate', { card_code: cardCode, validation_code: validationCode }).then(r => r.data);

export const verifyEventCards = (eventId: number) =>
  api.post<ApiResponse<{ success: boolean; totalChecked: number; duplicatesFound: number; issues: unknown[] }>>(`/cards/verify/${eventId}`).then(r => r.data);

export const sellCard = (id: number, data: { buyer_name?: string; buyer_phone?: string }) =>
  api.put<ApiResponse<BingoCard>>(`/cards/${id}/sell`, data).then(r => r.data);

export const searchCard = (code: string) =>
  api.get<ApiResponse<BingoCard>>(`/cards/search/${code}`).then(r => r.data);

// Games
export const getGames = (params?: { event_id?: number; status?: string }) =>
  api.get<ApiResponse<BingoGame[]>>('/games', { params }).then(r => r.data);

export const getGame = (id: number) =>
  api.get<ApiResponse<GameState>>(`/games/${id}`).then(r => r.data);

export const createGame = (data: { event_id: number; game_type: GameType; name?: string; is_practice_mode?: boolean; prize_description?: string; custom_pattern?: number[][] }) =>
  api.post<ApiResponse<GameState>>('/games', data).then(r => r.data);

export const startGame = (id: number) =>
  api.post<ApiResponse<GameState>>(`/games/${id}/start`).then(r => r.data);

export const pauseGame = (id: number) =>
  api.post<ApiResponse<GameState>>(`/games/${id}/pause`).then(r => r.data);

export const resumeGame = (id: number) =>
  api.post<ApiResponse<GameState>>(`/games/${id}/resume`).then(r => r.data);

export const callBall = (id: number, ball: number) =>
  api.post<ApiResponse<CallBallResult>>(`/games/${id}/call`, { ball }).then(r => r.data);

export const callRandomBall = (id: number) =>
  api.post<ApiResponse<CallBallResult>>(`/games/${id}/call-random`).then(r => r.data);

export const finishGame = (id: number) =>
  api.post<ApiResponse<FinishGameResult>>(`/games/${id}/finish`).then(r => r.data);

export const cancelGame = (id: number) =>
  api.post<ApiResponse<GameState>>(`/games/${id}/cancel`).then(r => r.data);

export const resetGame = (id: number) =>
  api.post<ApiResponse<GameState>>(`/games/${id}/reset`).then(r => r.data);

export const replayGame = (id: number) =>
  api.post<ApiResponse<GameState>>(`/games/${id}/replay`).then(r => r.data);

export const getGameWinners = (id: number) =>
  api.get<ApiResponse<Winner[]>>(`/games/${id}/winners`).then(r => r.data);

export const getGameStats = (id: number) =>
  api.get<ApiResponse<{ totalBallsCalled: number; remainingBalls: number; ballsByColumn: Record<string, number[]>; winnerCount: number; duration: number | null }>>(`/games/${id}/stats`).then(r => r.data);

// Reports
export const getGameReport = (gameId: number) =>
  api.get<ApiResponse<GameReport>>(`/reports/game/${gameId}`).then(r => r.data);

export const downloadGameReportPDF = (gameId: number) =>
  api.get(`/reports/game/${gameId}/pdf`, { responseType: 'blob' }).then(r => r.data);

export const getReportWinners = (gameId: number) =>
  api.get<ApiResponse<GameWinner[]>>(`/reports/game/${gameId}/winners`).then(r => r.data);

export const getBallHistory = (gameId: number) =>
  api.get<ApiResponse<{ ball_number: number; ball_column: string; call_order: number; called_at: string }[]>>(`/reports/game/${gameId}/balls`).then(r => r.data);

export const getEventWinners = (eventId: number) =>
  api.get<ApiResponse<GameWinner[]>>(`/reports/event/${eventId}/winners`).then(r => r.data);

export const getRecentWinners = (limit?: number) =>
  api.get<ApiResponse<(GameWinner & { game_name: string; event_name: string })[]>>('/reports/recent-winners', { params: { limit } }).then(r => r.data);

// Export
export const downloadCardsCSV = (eventId: number) =>
  api.get(`/export/csv/${eventId}`, { responseType: 'blob' }).then(r => r.data);

export const generateQRCodes = (data: {
  event_id: number;
  base_url: string;
  size?: number;
  from_card?: number;
  to_card?: number;
  from_series?: number;
  to_series?: number;
}) =>
  api.post<ApiResponse<{
    event_name: string;
    cards_total: number;
    qr_size: string;
    url_template: string;
    sample_url: string;
    message: string;
  }>>('/export/qr', data).then(r => r.data);

export const getQRProgress = (eventId: number) =>
  api.get<ApiResponse<{ total: number; generated: number; status: string } | null>>(`/export/qr/progress/${eventId}`).then(r => r.data);

export const downloadQRZip = (eventId: number) =>
  api.get(`/export/qr/download/${eventId}`, { responseType: 'blob' }).then(r => r.data);

// Barcode (Code 128)
export const generateBarcodes = (data: {
  event_id: number;
  from_card?: number;
  to_card?: number;
  from_series?: number;
  to_series?: number;
}) =>
  api.post<ApiResponse<{
    event_name: string;
    cards_total: number;
    sample_serial: string;
    message: string;
  }>>('/export/barcode', data).then(r => r.data);

export const getBarcodeProgress = (eventId: number) =>
  api.get<ApiResponse<{ total: number; generated: number; status: string } | null>>(`/export/barcode/progress/${eventId}`).then(r => r.data);

export const downloadBarcodeZip = (eventId: number) =>
  api.get(`/export/barcode/download/${eventId}`, { responseType: 'blob' }).then(r => r.data);

// QR Cajas
export const generateQRCajas = (data: { event_id: number; size?: number }) =>
  api.post<ApiResponse<{
    event_name: string;
    cajas_processed: number;
    qr_size: string;
    zip_size_mb: string;
  }>>('/export/qr-cajas', data).then(r => r.data);

export const getQRCajasProgress = (eventId: number) =>
  api.get<ApiResponse<{ total: number; generated: number; status: string } | null>>(`/export/qr-cajas/progress/${eventId}`).then(r => r.data);

export const downloadQRCajasZip = (eventId: number) =>
  api.get(`/export/qr-cajas/download/${eventId}`, { responseType: 'blob' }).then(r => r.data);

// QR Libretas
export const generateQRLibretas = (data: { event_id: number; size?: number }) =>
  api.post<ApiResponse<{
    event_name: string;
    libretas_processed: number;
    qr_size: string;
    zip_size_mb: string;
  }>>('/export/qr-libretas', data).then(r => r.data);

export const getQRLibretasProgress = (eventId: number) =>
  api.get<ApiResponse<{ total: number; generated: number; status: string } | null>>(`/export/qr-libretas/progress/${eventId}`).then(r => r.data);

export const downloadQRLibretasZip = (eventId: number) =>
  api.get(`/export/qr-libretas/download/${eventId}`, { responseType: 'blob' }).then(r => r.data);

// =====================================================
// PROMOCIONES / RASPADITO
// =====================================================

export const getPromoConfig = (eventId: number) =>
  api.get<ApiResponse<PromoData>>(`/promo/events/${eventId}`).then(r => r.data);

export const savePromoConfig = (eventId: number, data: { is_enabled: boolean; no_prize_text: string }) =>
  api.post<ApiResponse<PromoConfig>>(`/promo/events/${eventId}/config`, data).then(r => r.data);

export const savePromoPrizes = (eventId: number, prizes: { name: string; quantity: number }[]) =>
  api.post<ApiResponse<PromoPrize[]>>(`/promo/events/${eventId}/prizes`, { prizes }).then(r => r.data);

export const distributePromo = (eventId: number) =>
  api.post<ApiResponse<PromoDistributeResult>>(`/promo/events/${eventId}/distribute`).then(r => r.data);

export const clearPromo = (eventId: number) =>
  api.post<ApiResponse<{ message: string }>>(`/promo/events/${eventId}/clear`).then(r => r.data);

export const getPromoWinners = (eventId: number, params?: { page?: number; limit?: number; prize?: string }) =>
  api.get<ApiResponse<PromoWinner[]>>(`/promo/events/${eventId}/winners`, { params }).then(r => r.data);

export const getPromoFixedRules = (eventId: number) =>
  api.get<ApiResponse<PromoFixedRule[]>>(`/promo/events/${eventId}/fixed-rules`).then(r => r.data);

export const savePromoFixedRules = (eventId: number, rules: Omit<PromoFixedRule, 'id' | 'event_id' | 'created_at'>[]) =>
  api.post<ApiResponse<PromoFixedRule[]>>(`/promo/events/${eventId}/fixed-rules`, { rules }).then(r => r.data);

export const deletePromoFixedRules = (eventId: number) =>
  api.delete<ApiResponse<void>>(`/promo/events/${eventId}/fixed-rules`).then(r => r.data);

// =====================================================
// INVENTARIO - ALMACENES
// =====================================================

export const getAlmacenes = (eventId: number) =>
  api.get<ApiResponse<Almacen[]>>('/inventario/almacenes', { params: { event_id: eventId } }).then(r => r.data);

export const getAlmacenTree = (eventId: number) =>
  api.get<ApiResponse<Almacen[]>>(`/inventario/almacenes/tree/${eventId}`).then(r => r.data);

export const createAlmacen = (data: { event_id: number; name: string; code?: string; parent_id?: number; address?: string; contact_name?: string; contact_phone?: string }) =>
  api.post<ApiResponse<Almacen>>('/inventario/almacenes', data).then(r => r.data);

export const updateAlmacen = (id: number, data: { name?: string; parent_id?: number | null; address?: string; contact_name?: string; contact_phone?: string; is_active?: boolean; es_agencia_loteria?: boolean }) =>
  api.put<ApiResponse<Almacen>>(`/inventario/almacenes/${id}`, data).then(r => r.data);

export const getAlmacen = (id: number) =>
  api.get<ApiResponse<Almacen>>(`/inventario/almacenes/${id}`).then(r => r.data);

export const getAlmacenUsuarios = (almacenId: number) =>
  api.get<ApiResponse<AlmacenUsuario[]>>(`/inventario/almacenes/${almacenId}/usuarios`).then(r => r.data);

export const getInventarioUsuarios = (eventId: number) =>
  api.get<ApiResponse<(AlmacenUsuario & { almacen_name: string; almacen_code: string })[]>>(`/inventario/usuarios/${eventId}`).then(r => r.data);

export const getMisAlmacenes = () =>
  api.get<ApiResponse<{ almacen_id: number; almacen_name: string; almacen_code: string; event_id: number; event_name: string; rol: string }[]>>('/inventario/mis-almacenes').then(r => r.data);

export const addUsuarioToAlmacen = (almacenId: number, data: { user_id: number; rol: string }) =>
  api.post<ApiResponse<AlmacenUsuario>>(`/inventario/almacenes/${almacenId}/usuarios`, data).then(r => r.data);

export const removeUsuarioFromAlmacen = (almacenId: number, userId: number) =>
  api.delete<ApiResponse<void>>(`/inventario/almacenes/${almacenId}/usuarios/${userId}`).then(r => r.data);

export const updateUsuarioAlmacen = (almacenId: number, userId: number, data: { rol?: string; new_almacen_id?: number }) =>
  api.put<ApiResponse<AlmacenUsuario>>(`/inventario/almacenes/${almacenId}/usuarios/${userId}`, data).then(r => r.data);

// =====================================================
// INVENTARIO - RESUMEN
// =====================================================

export const getResumenInventario = (eventId: number, almacenId?: number) =>
  api.get<ApiResponse<ResumenInventario>>(`/inventario/resumen/${eventId}`, { params: almacenId ? { almacen_id: almacenId } : undefined }).then(r => r.data);

export const getCajas = (eventId: number, almacenId?: number) =>
  api.get<ApiResponse<CajaReal[]>>(`/inventario/cajas/${eventId}`, { params: almacenId ? { almacen_id: almacenId } : undefined }).then(r => r.data);

export const getCartonesLote = (loteId: number) =>
  api.get<ApiResponse<{ id: number; card_code: string; serial: string; is_sold: boolean; buyer_name: string | null; sold_at: string | null }[]>>(`/inventario/lotes/${loteId}/cartones`).then(r => r.data);

export const getCajasDisponibles = (eventId: number) =>
  api.get<ApiResponse<{ id: number; caja_code: string; total_lotes: number; total_cartones: number; almacen_id: number | null; almacen_name: string | null }[]>>(`/inventario/cajas-disponibles/${eventId}`).then(r => r.data);

export const cargarInventario = (data: { event_id: number; almacen_id: number; caja_ids: number[] }) =>
  api.post<ApiResponse<{ cargadas: number }>>('/inventario/cargar-inventario', data).then(r => r.data);

export const crearInventarioInicial = (eventId: number) =>
  api.post<ApiResponse<{ cajasAsignadas: number; almacen: string; message?: string }>>(`/inventario/inventario-inicial/${eventId}`).then(r => r.data);

export const cargarPorReferencia = (data: { event_id: number; almacen_id: number; tipo_entidad: string; referencia: string; firma_entrega?: string; firma_recibe?: string; nombre_entrega?: string; nombre_recibe?: string }) =>
  api.post<ApiResponse<{ tipo: string; referencia: string; cartones: number; movimientoId?: number }>>('/inventario/cargar-por-referencia', data).then(r => r.data);

// =====================================================
// INVENTARIO - ASIGNACIONES
// =====================================================

export const getAsignaciones = (eventId: number, params?: { almacen_id?: number; estado?: string; proposito?: string; persona?: string; page?: number; limit?: number }) =>
  api.get<ApiResponse<InvAsignacion[]>>(`/inventario/asignaciones/${eventId}`, { params }).then(r => r.data);

export const getAsignacion = (id: number) =>
  api.get<ApiResponse<InvAsignacion>>(`/inventario/asignaciones/detalle/${id}`).then(r => r.data);

export const createAsignacion = (data: {
  event_id: number; almacen_id: number; tipo_entidad: string; referencia: string;
  persona_nombre: string; persona_telefono?: string; persona_user_id?: number; proposito: string;
  firma_entrega?: string; firma_recibe?: string; nombre_entrega?: string; nombre_recibe?: string;
}) =>
  api.post<ApiResponse<InvAsignacion>>('/inventario/asignaciones', data).then(r => r.data);

export const devolverAsignacion = (id: number, firmas?: { firma_entrega?: string; firma_recibe?: string; nombre_entrega?: string; nombre_recibe?: string }) =>
  api.post<ApiResponse<InvAsignacion>>(`/inventario/asignaciones/${id}/devolver`, firmas).then(r => r.data);

export const cancelarAsignacion = (id: number, firmas?: { firma_entrega?: string; nombre_entrega?: string }) =>
  api.post<ApiResponse<InvAsignacion>>(`/inventario/asignaciones/${id}/cancelar`, firmas).then(r => r.data);

export const getMovimientoPdf = (movimientoId: number) =>
  api.get(`/inventario/movimientos/pdf/${movimientoId}`, { responseType: 'blob' }).then(r => r.data);

// =====================================================
// INVENTARIO - VENTAS
// =====================================================

export const venderCarton = (cartonId: number, data?: { comprador_nombre?: string; comprador_telefono?: string }) =>
  api.post<ApiResponse<InvAsignacionCarton>>(`/inventario/vender/carton/${cartonId}`, data).then(r => r.data);

export const venderTodos = (asignacionId: number, data?: { comprador_nombre?: string; comprador_telefono?: string }) =>
  api.post<ApiResponse<{ vendidos: number }>>(`/inventario/vender/todos/${asignacionId}`, data).then(r => r.data);

export const validarReferencia = (eventId: number, referencia: string, almacenId?: number) =>
  api.get<ApiResponse<{
    tipo: string | null; referencia: string; existe: boolean; enMiAlmacen?: boolean;
    almacen?: string; totalCartones?: number; vendidos?: number; disponibles?: number;
  }>>(`/inventario/validar-referencia/${eventId}/${encodeURIComponent(referencia)}`, {
    params: almacenId ? { almacen_id: almacenId } : undefined,
  }).then(r => r.data);

export const ejecutarVenta = (data: {
  event_id: number; almacen_id: number;
  items: { tipo: string; referencia: string }[];
  buyer_name?: string; buyer_cedula?: string; buyer_libreta?: string; buyer_phone?: string;
  firma_entrega?: string; firma_recibe?: string; nombre_entrega?: string; nombre_recibe?: string;
}) =>
  api.post<ApiResponse<{ documentoId: number; exitosos: number; totalCartones: number; errores: string[] }>>('/inventario/venta', data).then(r => r.data);

// =====================================================
// INVENTARIO - MOVIMIENTOS
// =====================================================

export const getMovimientos = (eventId: number, params?: { almacen_id?: number; tipo_entidad?: string; accion?: string; referencia?: string; page?: number; limit?: number }) =>
  api.get<ApiResponse<InvMovimiento[]>>(`/inventario/movimientos/${eventId}`, { params }).then(r => r.data);

export const getTrazabilidad = (eventId: number, referencia: string) =>
  api.get<ApiResponse<InvMovimiento[]>>(`/inventario/trazabilidad/${eventId}/${referencia}`).then(r => r.data);

// Documentos de movimiento (agrupados)
export const ejecutarMovimientoBulk = (data: {
  event_id: number; accion: string; almacen_destino_id: number; almacen_origen_id?: number;
  items: { tipo: string; referencia: string }[];
  firma_entrega?: string; firma_recibe?: string; nombre_entrega?: string; nombre_recibe?: string;
}) =>
  api.post<ApiResponse<{ documentoId: number; exitosos: number; errores: string[] }>>('/inventario/movimiento-bulk', data).then(r => r.data);

export const getDocumentos = (eventId: number, params?: { almacen_id?: number; accion?: string; page?: number; limit?: number }) =>
  api.get<ApiResponse<any[]>>(`/inventario/documentos/${eventId}`, { params }).then(r => r.data);

export const getDocumento = (documentoId: number) =>
  api.get<ApiResponse<{ documento: any; movimientos: InvMovimiento[] }>>(`/inventario/documentos/detalle/${documentoId}`).then(r => r.data);

export const getDocumentoPdf = (documentoId: number) =>
  api.get(`/inventario/documentos/pdf/${documentoId}`, { responseType: 'blob' }).then(r => r.data);

// =====================================================
// INVENTARIO - ESCANEO
// =====================================================

export const escanearCodigo = (eventId: number, codigo: string) =>
  api.get<ApiResponse<{ tipo: string; entidad: unknown; asignacion: InvAsignacion | null }>>(`/inventario/escanear/${eventId}/${codigo}`).then(r => r.data);

// =====================================================
// DASHBOARD LOTERÍA
// =====================================================

export interface LoteriaDashboardData {
  resumen: {
    total_cartones: number;
    cartones_vendidos: number;
    cartones_disponibles: number;
    total_cajas: number;
    total_lotes: number;
    porcentaje_vendido: number;
  };
  agencias: {
    id: number;
    name: string;
    code: string;
    total_cajas: number;
    total_lotes: number;
    total_cartones: number;
    cartones_vendidos: number;
    cartones_disponibles: number;
    porcentaje: number;
  }[];
  ventas_por_dia: { fecha: string; vendidos: number }[];
  ventas_agencia_dia: { agencia: string; fecha: string; vendidos: number }[];
}

export const getLoteriaDashboard = (eventId: number) =>
  api.get<ApiResponse<LoteriaDashboardData>>(`/inventario/loteria-dashboard/${eventId}`).then(r => r.data);

// =====================================================
// DASHBOARD GENERAL (todos los almacenes)
// =====================================================

export interface DashboardGeneralData {
  resumen: {
    total_cartones: number;
    cartones_vendidos: number;
    cartones_disponibles: number;
    total_cajas: number;
    total_lotes: number;
    porcentaje_vendido: number;
  };
  almacenes: {
    id: number;
    name: string;
    code: string;
    es_agencia_loteria: boolean;
    total_cajas: number;
    total_lotes: number;
    total_cartones: number;
    cartones_vendidos: number;
    cartones_disponibles: number;
    porcentaje: number;
  }[];
  ventas_por_dia: { fecha: string; vendidos: number }[];
  ventas_almacen_dia: { almacen: string; fecha: string; vendidos: number }[];
}

export const getDashboardGeneral = (eventId: number) =>
  api.get<ApiResponse<DashboardGeneralData>>(`/inventario/dashboard-general/${eventId}`).then(r => r.data);

// =====================================================
// REPORTES DE VENTAS
// =====================================================

export interface ReporteVentasResumen {
  fecha: string;
  almacen_id: number;
  almacen_nombre: string;
  vendedor_id: number;
  vendedor_nombre: string;
  cartones_vendidos: number;
}

export interface ReporteVentasDetalle {
  documento_id: number;
  fecha: string;
  almacen_id: number;
  almacen_nombre: string;
  comprador: string;
  cedula: string | null;
  libreta: string | null;
  total_items: number;
  total_cartones: number;
  vendedor_id: number;
  vendedor_nombre: string;
  pdf_path: string | null;
  items: { tipo: string; referencia: string; cantidad: number }[];
}

export interface ReporteVentasData {
  resumen: ReporteVentasResumen[];
  detalle: ReporteVentasDetalle[];
  totales: { cartones: number; documentos: number };
}

export const getReporteVentas = (eventId: number, params: { desde: string; hasta: string; almacen_id?: number; vendedor_id?: number }) =>
  api.get<ApiResponse<ReporteVentasData>>(`/reports/sales/${eventId}`, { params }).then(r => r.data);

export const downloadReporteVentasPdf = (eventId: number, params: { desde: string; hasta: string; almacen_id?: number; vendedor_id?: number }) =>
  api.get(`/reports/sales/${eventId}/pdf`, { params, responseType: 'blob', timeout: 60000 }).then(r => r.data);

// =====================================================
// BACKUP / RESTORE
// =====================================================

export interface BackupEvent {
  id: number;
  name: string;
  status: string;
  total_cards: number;
  cards_sold: number;
  total_games: number;
  created_at: string;
}

export const getBackupEvents = () =>
  api.get<ApiResponse<BackupEvent[]>>('/backup/events').then(r => r.data);

export const downloadFullBackup = () =>
  api.get('/backup/full', { responseType: 'blob', timeout: 300000 }).then(r => r.data);

export const downloadEventBackup = (eventId: number) =>
  api.get(`/backup/event/${eventId}`, { responseType: 'blob' }).then(r => r.data);

export const restoreEventBackup = (file: File) => {
  const formData = new FormData();
  formData.append('file', file);
  return api.post<ApiResponse<{ jobId: string }>>('/backup/restore-event', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 300000,
  }).then(r => r.data);
};

export const restoreFullBackup = (file: File) => {
  const formData = new FormData();
  formData.append('file', file);
  return api.post<ApiResponse<{ jobId: string }>>('/backup/restore-full', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 600000,
  }).then(r => r.data);
};

export interface BackupJobProgress {
  jobId: string;
  type: string;
  status: 'running' | 'completed' | 'error';
  step: string;
  current: number;
  total: number;
  details: string;
  result?: any;
  error?: string;
  startedAt: number;
  updatedAt: number;
}

export const getBackupProgress = (jobId: string) =>
  api.get<ApiResponse<BackupJobProgress>>(`/backup/progress/${jobId}`).then(r => r.data);

export const downloadEventDump = (eventId: number) =>
  api.get(`/backup/event/${eventId}/dump`, { responseType: 'blob' }).then(r => r.data);

export const restoreEventDump = (file: File) => {
  const formData = new FormData();
  formData.append('file', file);
  return api.post<ApiResponse<{ jobId: string }>>('/backup/restore-event-dump', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 300000,
  }).then(r => r.data);
};

// =====================================================
// PERMISOS
// =====================================================

export const getPermissionMatrix = () =>
  api.get<ApiResponse<{ matrix: Record<string, Record<string, boolean>>; permissions: string[]; roles: string[] }>>('/permissions/matrix').then(r => r.data);

export const updateRolePermission = (role: string, permission: string, granted: boolean) =>
  api.put<ApiResponse<void>>(`/permissions/role/${role}`, { permission, granted }).then(r => r.data);

export const getMyPermissions = () =>
  api.get<ApiResponse<{ permissions: string[]; role: string }>>('/permissions/my').then(r => r.data);

// =====================================================
// AUDITORÍA / ACTIVITY LOG
// =====================================================

export interface ActivityLogEntry {
  id: number;
  user_id: number | null;
  username: string | null;
  action: string;
  category: string;
  details: Record<string, unknown>;
  ip_address: string | null;
  created_at: string;
}

export interface ActivityLogStats {
  byCategory: { category: string; count: string }[];
  topUsers: { user_id: number; username: string; count: string }[];
  counts: { last_24h: string; last_7d: string; last_30d: string };
}

export const getActivityLog = (params?: { category?: string; userId?: string; action?: string; from?: string; to?: string; page?: number; limit?: number }) =>
  api.get<ApiResponse<ActivityLogEntry[]>>('/activity-log', { params }).then(r => r.data);

export const getActivityLogStats = () =>
  api.get<ApiResponse<ActivityLogStats>>('/activity-log/stats').then(r => r.data);

export default api;
