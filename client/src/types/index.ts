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
