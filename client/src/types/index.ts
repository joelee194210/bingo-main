// Tipos compartidos con el backend

export type EventStatus = 'draft' | 'active' | 'completed' | 'cancelled';
export type GameType = 'horizontal_line' | 'vertical_line' | 'diagonal' | 'blackout' | 'four_corners' | 'x_pattern' | 'custom';
export type GameStatus = 'pending' | 'in_progress' | 'paused' | 'completed' | 'cancelled';

export interface BingoEvent {
  id: number;
  name: string;
  description: string | null;
  total_cards: number;
  cards_sold: number;
  use_free_center: number; // 1 = FREE en centro, 0 = número en centro
  status: EventStatus;
  created_at: string;
  updated_at: string;
}

export interface CardNumbers {
  B: number[]; // 5 números
  I: number[]; // 5 números
  N: number[]; // 4 números si use_free_center=true, 5 si use_free_center=false
  G: number[]; // 5 números
  O: number[]; // 5 números
}

export interface BingoCard {
  id: number;
  event_id: number;
  card_number: number;
  serial: string; // Serie-Secuencia ej: 00001-01
  card_code: string;
  validation_code: string;
  numbers: CardNumbers;
  matrix?: (number | 'FREE')[][];
  is_sold: boolean;
  sold_at: string | null;
  buyer_name: string | null;
  buyer_phone: string | null;
  promo_text: string | null;
  created_at: string;
}

export interface BingoGame {
  id: number;
  event_id: number;
  name: string | null;
  game_type: GameType;
  status: GameStatus;
  is_practice_mode: boolean;
  called_balls: string;
  winner_cards: string;
  prize_description: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export interface GameState {
  id: number;
  eventId: number;
  name: string | null;
  gameType: GameType;
  status: GameStatus;
  isPracticeMode: boolean;
  calledBalls: number[];
  winnerCards: number[];
  availableBalls: number[];
  totalCards: number;
  activeCards: number;
  startedAt: string | null;
}

export interface DashboardStats {
  total_events: number;
  active_events: number;
  total_cards: number;
  total_cards_sold: number;
  total_games_played: number;
  recent_events: BingoEvent[];
  recent_games: (BingoGame & { event_name: string })[];
}

export interface Winner {
  cardId: number;
  cardCode: string;
  cardNumber: number;
  serial: string;
  validationCode: string;
  winningPattern: string;
  buyerName?: string;
}

export interface CallBallResult {
  ball: number;
  column: string;
  gameState: GameState;
  winners: Winner[];
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export const GAME_TYPE_LABELS: Record<GameType, string> = {
  horizontal_line: 'Línea Horizontal',
  vertical_line: 'Línea Vertical',
  diagonal: 'Diagonal',
  blackout: 'Cartón Lleno',
  four_corners: 'Cuatro Esquinas',
  x_pattern: 'Patrón X',
  custom: 'Personalizado',
};

export const STATUS_LABELS: Record<GameStatus, string> = {
  pending: 'Pendiente',
  in_progress: 'En Progreso',
  paused: 'Pausado',
  completed: 'Completado',
  cancelled: 'Cancelado',
};

export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  draft: 'Borrador',
  active: 'Activo',
  completed: 'Completado',
  cancelled: 'Cancelado',
};

// Tipos para reportes
export interface BallHistoryEntry {
  ball_number: number;
  ball_column: string;
  call_order: number;
  called_at: string;
}

export interface GameWinner {
  id: number;
  game_id: number;
  card_id: number;
  card_number: number;
  serial: string;
  card_code: string;
  validation_code: string;
  buyer_name: string | null;
  buyer_phone: string | null;
  winning_pattern: string;
  balls_to_win: number;
  won_at: string;
}

export interface GameReport {
  game_id: number;
  event_name: string;
  event_id: number;
  game_name: string | null;
  game_type: string;
  game_type_label: string;
  is_practice_mode: boolean;
  status: string;
  total_balls_called: number;
  started_at: string | null;
  finished_at: string | null;
  duration_seconds: number | null;
  ball_history: BallHistoryEntry[];
  winners: GameWinner[];
  report_generated_at: string;
}

export interface FinishGameResult {
  gameState: GameState;
  report: GameReport | null;
}

// =====================================================
// MÓDULO DE INVENTARIO (AISLADO)
// =====================================================

export type AsignacionProposito = 'custodia' | 'venta';
export type AsignacionEstado = 'asignado' | 'parcial' | 'completado' | 'devuelto' | 'cancelado';
export type TipoEntidad = 'caja' | 'libreta' | 'carton';
export type AlmacenRol = 'administrador' | 'operador' | 'vendedor';

export interface Almacen {
  id: number;
  event_id: number;
  parent_id: number | null;
  name: string;
  code: string;
  address: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  is_active: number;
  es_agencia_loteria: boolean;
  created_at: string;
  updated_at: string;
  children?: Almacen[];
  inv_cajas?: number;
  inv_libretas?: number;
  inv_cartones?: number;
  inv_vendidos?: number;
}

export interface AlmacenUsuario {
  id: number;
  almacen_id: number;
  user_id: number;
  rol: AlmacenRol;
  is_active: number;
  created_at: string;
  full_name?: string;
  username?: string;
}

export interface InvAsignacion {
  id: number;
  event_id: number;
  almacen_id: number;
  tipo_entidad: TipoEntidad;
  referencia: string;
  cantidad_cartones: number;
  persona_nombre: string;
  persona_telefono: string | null;
  persona_user_id: number | null;
  proposito: AsignacionProposito;
  estado: AsignacionEstado;
  cartones_vendidos: number;
  asignado_por: number;
  asignado_por_nombre: string;
  created_at: string;
  updated_at: string;
  devuelto_at: string | null;
  almacen_name?: string;
  cartones?: InvAsignacionCarton[];
}

export interface InvAsignacionCarton {
  id: number;
  asignacion_id: number;
  card_id: number;
  card_code: string;
  serial: string;
  vendido: number;
  vendido_at: string | null;
  comprador_nombre: string | null;
  comprador_telefono: string | null;
}

export interface InvMovimiento {
  id: number;
  event_id: number;
  almacen_id: number | null;
  asignacion_id: number | null;
  tipo_entidad: TipoEntidad;
  referencia: string;
  accion: string;
  de_persona: string | null;
  a_persona: string | null;
  cantidad_cartones: number;
  detalles: string | null;
  realizado_por: number;
  realizado_por_nombre: string;
  pdf_path: string | null;
  nombre_entrega: string | null;
  nombre_recibe: string | null;
  created_at: string;
}

export interface ResumenInventario {
  totalCartones: number;
  totalLibretas: number;
  totalCajas: number;
  cartonesAsignados: number;
  cartonesDisponibles: number;
}

export interface CajaReal {
  id: number;
  caja_code: string;
  total_lotes: number;
  status: string;
  total_cartones: number;
  asignados: number;
  lotes: LoteReal[];
}

export interface LoteReal {
  id: number;
  lote_code: string;
  series_number: string;
  caja_id: number | null;
  caja_code: string | null;
  total_cards: number;
  cards_sold: number;
  status: string;
}

export const PROPOSITO_LABELS: Record<AsignacionProposito, string> = {
  custodia: 'Custodia',
  venta: 'Venta',
};

export const ESTADO_LABELS: Record<AsignacionEstado, string> = {
  asignado: 'Asignado',
  parcial: 'Parcial',
  completado: 'Completado',
  devuelto: 'Devuelto',
  cancelado: 'Cancelado',
};

export const ROL_ALMACEN_LABELS: Record<AlmacenRol, string> = {
  administrador: 'Administrador',
  operador: 'Operador',
  vendedor: 'Vendedor',
};

// =====================================================
// PROMOCIONES / RASPADITO
// =====================================================

export interface PromoConfig {
  id: number;
  event_id: number;
  is_enabled: number;
  no_prize_text: string;
  created_at: string;
  updated_at: string;
}

export interface PromoPrize {
  id: number;
  event_id: number;
  name: string;
  quantity: number;
  distributed: number;
  created_at: string;
}

export interface PromoStats {
  total_cards: number;
  cards_with_promo: number;
  cards_with_prize: number;
}

export interface PromoData {
  config: PromoConfig;
  prizes: PromoPrize[];
  stats: PromoStats;
}

export interface PromoFixedRule {
  id: number;
  event_id: number;
  prize_name: string;
  quantity: number;
  series_from: number;
  series_to: number;
  created_at?: string;
}

export interface PromoVerificationDetail {
  prize: string;
  expected: number;
  actual: number;
  ok: boolean;
}

export interface PromoFixedRuleApplied {
  prize: string;
  series: string;
  placed: number;
}

export interface PromoDistributeResult {
  total_cards: number;
  winners: number;
  no_prize: number;
  message: string;
  verification?: {
    passed: boolean;
    details: PromoVerificationDetail[];
  };
  fixed_rules_applied?: PromoFixedRuleApplied[];
}

export interface PromoWinner {
  id: number;
  card_number: number;
  serial: string;
  card_code: string;
  promo_text: string;
  is_sold: number;
  buyer_name: string | null;
}

