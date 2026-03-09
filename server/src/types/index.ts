// =====================================================
// TIPOS PARA BINGO AMERICANO (75 NÚMEROS)
// =====================================================

// Columnas del Bingo Americano
export type BingoColumn = 'B' | 'I' | 'N' | 'G' | 'O';

// Rangos de números por columna
export const BINGO_RANGES: Record<BingoColumn, { min: number; max: number }> = {
  B: { min: 1, max: 15 },
  I: { min: 16, max: 30 },
  N: { min: 31, max: 45 },
  G: { min: 46, max: 60 },
  O: { min: 61, max: 75 },
};

// Números de un cartón organizados por columna
export interface CardNumbers {
  B: number[]; // 5 números
  I: number[]; // 5 números
  N: number[]; // 4 números si use_free_center=true, 5 si use_free_center=false
  G: number[]; // 5 números
  O: number[]; // 5 números
}

// =====================================================
// ENTIDADES DE BASE DE DATOS
// =====================================================

export type EventStatus = 'draft' | 'active' | 'completed' | 'cancelled';

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

export interface BingoCard {
  id: number;
  event_id: number;
  card_number: number;
  serial: string; // Serie-Secuencia ej: 00001-01
  card_code: string;
  validation_code: string;
  numbers: string; // JSON string de CardNumbers
  numbers_hash: string;
  is_sold: number; // SQLite usa 0/1 para booleanos
  sold_at: string | null;
  buyer_name: string | null;
  buyer_phone: string | null;
  created_at: string;
}

export type GameType =
  | 'horizontal_line'
  | 'vertical_line'
  | 'diagonal'
  | 'blackout'
  | 'four_corners'
  | 'x_pattern'
  | 'custom';

export type GameStatus = 'pending' | 'in_progress' | 'paused' | 'completed' | 'cancelled';

export interface BingoGame {
  id: number;
  event_id: number;
  name: string | null;
  game_type: GameType;
  custom_pattern: string | null;
  status: GameStatus;
  is_practice_mode: number;
  called_balls: string; // JSON array de números
  winner_cards: string; // JSON array de IDs
  prize_description: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export interface VerificationLog {
  id: number;
  event_id: number;
  verification_type: 'generation' | 'batch' | 'manual';
  total_cards_checked: number;
  duplicates_found: number;
  issues_found: string | null;
  status: 'pending' | 'running' | 'completed' | 'failed';
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

// =====================================================
// TIPOS PARA API
// =====================================================

export interface CreateEventRequest {
  name: string;
  description?: string;
  use_free_center?: boolean;
}

export interface GenerateCardsRequest {
  event_id: number;
  quantity: number;
}

export interface GenerateCardsProgress {
  total: number;
  generated: number;
  verified: number;
  percentage: number;
  status: 'generating' | 'verifying' | 'completed' | 'error';
  error?: string;
}

export interface StartGameRequest {
  event_id: number;
  game_type: GameType;
  name?: string;
  is_practice_mode?: boolean;
  custom_pattern?: number[][];
  prize_description?: string;
}

export interface CallBallRequest {
  game_id: number;
  ball: number;
}

export interface WinnerCheckResult {
  has_winner: boolean;
  winning_cards: WinningCard[];
}

export interface WinningCard {
  card_id: number;
  card_code: string;
  card_number: number;
  validation_code: string;
  winning_pattern: string;
  buyer_name?: string;
}

// =====================================================
// PATRONES DE VICTORIA
// =====================================================

// Posiciones en el cartón [fila, columna] (0-indexed)
export type Position = [number, number];

export interface WinPattern {
  name: string;
  positions: Position[];
}

export const WIN_PATTERNS: Record<string, WinPattern> = {
  // Líneas horizontales
  horizontal_1: { name: 'Línea Horizontal 1', positions: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]] },
  horizontal_2: { name: 'Línea Horizontal 2', positions: [[1, 0], [1, 1], [1, 2], [1, 3], [1, 4]] },
  horizontal_3: { name: 'Línea Horizontal 3 (FREE)', positions: [[2, 0], [2, 1], [2, 2], [2, 3], [2, 4]] },
  horizontal_4: { name: 'Línea Horizontal 4', positions: [[3, 0], [3, 1], [3, 2], [3, 3], [3, 4]] },
  horizontal_5: { name: 'Línea Horizontal 5', positions: [[4, 0], [4, 1], [4, 2], [4, 3], [4, 4]] },

  // Líneas verticales
  vertical_b: { name: 'Línea Vertical B', positions: [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]] },
  vertical_i: { name: 'Línea Vertical I', positions: [[0, 1], [1, 1], [2, 1], [3, 1], [4, 1]] },
  vertical_n: { name: 'Línea Vertical N (FREE)', positions: [[0, 2], [1, 2], [2, 2], [3, 2], [4, 2]] },
  vertical_g: { name: 'Línea Vertical G', positions: [[0, 3], [1, 3], [2, 3], [3, 3], [4, 3]] },
  vertical_o: { name: 'Línea Vertical O', positions: [[0, 4], [1, 4], [2, 4], [3, 4], [4, 4]] },

  // Diagonales
  diagonal_1: { name: 'Diagonal ↘ (FREE)', positions: [[0, 0], [1, 1], [2, 2], [3, 3], [4, 4]] },
  diagonal_2: { name: 'Diagonal ↙ (FREE)', positions: [[0, 4], [1, 3], [2, 2], [3, 1], [4, 0]] },

  // Cuatro esquinas
  four_corners: { name: 'Cuatro Esquinas', positions: [[0, 0], [0, 4], [4, 0], [4, 4]] },

  // Patrón X
  x_pattern: {
    name: 'Patrón X',
    positions: [
      [0, 0], [0, 4],
      [1, 1], [1, 3],
      [2, 2],
      [3, 1], [3, 3],
      [4, 0], [4, 4]
    ]
  },
};

// Blackout: todas las 24 posiciones (excluyendo el FREE)
export const BLACKOUT_POSITIONS: Position[] = [
  [0, 0], [0, 1], [0, 2], [0, 3], [0, 4],
  [1, 0], [1, 1], [1, 2], [1, 3], [1, 4],
  [2, 0], [2, 1],         [2, 3], [2, 4], // Fila 3 sin [2,2] que es FREE
  [3, 0], [3, 1], [3, 2], [3, 3], [3, 4],
  [4, 0], [4, 1], [4, 2], [4, 3], [4, 4],
];

// =====================================================
// TIPOS PARA EXPORTACIÓN
// =====================================================

export interface ExportOptions {
  format: 'pdf' | 'png' | 'both';
  cards_per_page?: number; // Para PDF
  include_validation_code?: boolean;
  page_size?: 'letter' | 'a4';
}

export interface ExportResult {
  success: boolean;
  files: string[];
  error?: string;
}

// =====================================================
// ESTADÍSTICAS DEL DASHBOARD
// =====================================================

export interface DashboardStats {
  total_events: number;
  active_events: number;
  total_cards: number;
  total_cards_sold: number;
  total_games_played: number;
  recent_events: BingoEvent[];
  recent_games: BingoGame[];
}
