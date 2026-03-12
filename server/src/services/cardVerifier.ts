import type { Pool } from 'pg';
import type { CardNumbers, Position, GameType, WinPattern, WIN_PATTERNS, BLACKOUT_POSITIONS } from '../types/index.js';
import { getNumberAtPosition, calculateCardHash } from './cardGenerator.js';

// Patrones de victoria
const WIN_PATTERNS_DATA: Record<string, { name: string; positions: Position[] }> = {
  horizontal_1: { name: 'Línea Horizontal 1', positions: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]] },
  horizontal_2: { name: 'Línea Horizontal 2', positions: [[1, 0], [1, 1], [1, 2], [1, 3], [1, 4]] },
  horizontal_3: { name: 'Línea Horizontal 3 (FREE)', positions: [[2, 0], [2, 1], [2, 2], [2, 3], [2, 4]] },
  horizontal_4: { name: 'Línea Horizontal 4', positions: [[3, 0], [3, 1], [3, 2], [3, 3], [3, 4]] },
  horizontal_5: { name: 'Línea Horizontal 5', positions: [[4, 0], [4, 1], [4, 2], [4, 3], [4, 4]] },

  vertical_b: { name: 'Línea Vertical B', positions: [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]] },
  vertical_i: { name: 'Línea Vertical I', positions: [[0, 1], [1, 1], [2, 1], [3, 1], [4, 1]] },
  vertical_n: { name: 'Línea Vertical N (FREE)', positions: [[0, 2], [1, 2], [2, 2], [3, 2], [4, 2]] },
  vertical_g: { name: 'Línea Vertical G', positions: [[0, 3], [1, 3], [2, 3], [3, 3], [4, 3]] },
  vertical_o: { name: 'Línea Vertical O', positions: [[0, 4], [1, 4], [2, 4], [3, 4], [4, 4]] },

  diagonal_1: { name: 'Diagonal ↘ (FREE)', positions: [[0, 0], [1, 1], [2, 2], [3, 3], [4, 4]] },
  diagonal_2: { name: 'Diagonal ↙ (FREE)', positions: [[0, 4], [1, 3], [2, 2], [3, 1], [4, 0]] },

  four_corners: { name: 'Cuatro Esquinas', positions: [[0, 0], [0, 4], [4, 0], [4, 4]] },

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

// Blackout: todas las 25 posiciones (incluyendo el centro)
// El centro [2,2] cuenta como FREE si useFreeCenter=true, o como número si useFreeCenter=false
const BLACKOUT_PATTERN: Position[] = [
  [0, 0], [0, 1], [0, 2], [0, 3], [0, 4],
  [1, 0], [1, 1], [1, 2], [1, 3], [1, 4],
  [2, 0], [2, 1], [2, 2], [2, 3], [2, 4],
  [3, 0], [3, 1], [3, 2], [3, 3], [3, 4],
  [4, 0], [4, 1], [4, 2], [4, 3], [4, 4],
];

export interface VerificationResult {
  success: boolean;
  totalChecked: number;
  duplicatesFound: number;
  issues: VerificationIssue[];
  duration: number;
}

export interface VerificationIssue {
  type: 'duplicate_hash' | 'duplicate_code' | 'invalid_numbers' | 'collision_risk';
  cardIds: number[];
  description: string;
}

/**
 * Verifica la unicidad de todos los cartones de un evento
 */
export async function verifyEventCards(
  pool: Pool,
  eventId: number,
  onProgress?: (checked: number, total: number) => void
): Promise<VerificationResult> {
  const startTime = Date.now();
  const issues: VerificationIssue[] = [];

  // Obtener todos los cartones del evento
  const cardsResult = await pool.query(`
    SELECT id, card_code, validation_code, numbers_hash
    FROM cards
    WHERE event_id = $1
    ORDER BY id
  `, [eventId]);
  const cards = cardsResult.rows as Array<{
    id: number;
    card_code: string;
    validation_code: string;
    numbers_hash: string;
  }>;

  const totalCards = cards.length;
  const hashMap = new Map<string, number[]>();
  const codeMap = new Map<string, number[]>();

  // Fase 1: Verificar duplicados de hash y códigos
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];

    // Verificar hash duplicado
    if (hashMap.has(card.numbers_hash)) {
      hashMap.get(card.numbers_hash)!.push(card.id);
    } else {
      hashMap.set(card.numbers_hash, [card.id]);
    }

    // Verificar código de cartón duplicado
    if (codeMap.has(card.card_code)) {
      codeMap.get(card.card_code)!.push(card.id);
    } else {
      codeMap.set(card.card_code, [card.id]);
    }

    // Verificar código de validación duplicado
    const valCodeKey = `val_${card.validation_code}`;
    if (codeMap.has(valCodeKey)) {
      codeMap.get(valCodeKey)!.push(card.id);
    } else {
      codeMap.set(valCodeKey, [card.id]);
    }

    if (onProgress && (i + 1) % 1000 === 0) {
      onProgress(i + 1, totalCards);
    }
  }

  // Recopilar issues de duplicados
  let duplicatesFound = 0;

  for (const [hash, cardIds] of hashMap) {
    if (cardIds.length > 1) {
      duplicatesFound += cardIds.length - 1;
      issues.push({
        type: 'duplicate_hash',
        cardIds,
        description: `${cardIds.length} cartones tienen los mismos números (hash: ${hash.substring(0, 8)}...)`,
      });
    }
  }

  for (const [code, cardIds] of codeMap) {
    if (cardIds.length > 1) {
      const isValidation = code.startsWith('val_');
      issues.push({
        type: 'duplicate_code',
        cardIds,
        description: `${cardIds.length} cartones tienen el mismo ${isValidation ? 'código de validación' : 'código de cartón'}`,
      });
    }
  }

  const duration = Date.now() - startTime;

  return {
    success: issues.length === 0,
    totalChecked: totalCards,
    duplicatesFound,
    issues,
    duration,
  };
}

/**
 * Verifica si un cartón específico ya existe (antes de insertar)
 */
export async function checkCardExists(
  pool: Pool,
  numbersHash: string,
  cardCode: string,
  eventId?: number
): Promise<{ exists: boolean; reason?: string }> {
  // Verificar hash
  let hashResult;
  if (eventId) {
    hashResult = (await pool.query('SELECT id FROM cards WHERE numbers_hash = $1 AND event_id = $2 LIMIT 1', [numbersHash, eventId])).rows[0];
  } else {
    hashResult = (await pool.query('SELECT id FROM cards WHERE numbers_hash = $1 LIMIT 1', [numbersHash])).rows[0];
  }

  if (hashResult) {
    return { exists: true, reason: 'Ya existe un cartón con los mismos números' };
  }

  // Verificar código
  const codeResult = (await pool.query(
    'SELECT id FROM cards WHERE card_code = $1 LIMIT 1', [cardCode]
  )).rows[0];

  if (codeResult) {
    return { exists: true, reason: 'Ya existe un cartón con el mismo código' };
  }

  return { exists: false };
}

/**
 * Obtiene los patrones de victoria según el tipo de juego
 */
export function getPatternsForGameType(gameType: GameType): Position[][] {
  switch (gameType) {
    case 'horizontal_line':
      return [
        WIN_PATTERNS_DATA.horizontal_1.positions,
        WIN_PATTERNS_DATA.horizontal_2.positions,
        WIN_PATTERNS_DATA.horizontal_3.positions,
        WIN_PATTERNS_DATA.horizontal_4.positions,
        WIN_PATTERNS_DATA.horizontal_5.positions,
      ];

    case 'vertical_line':
      return [
        WIN_PATTERNS_DATA.vertical_b.positions,
        WIN_PATTERNS_DATA.vertical_i.positions,
        WIN_PATTERNS_DATA.vertical_n.positions,
        WIN_PATTERNS_DATA.vertical_g.positions,
        WIN_PATTERNS_DATA.vertical_o.positions,
      ];

    case 'diagonal':
      return [
        WIN_PATTERNS_DATA.diagonal_1.positions,
        WIN_PATTERNS_DATA.diagonal_2.positions,
      ];

    case 'four_corners':
      return [WIN_PATTERNS_DATA.four_corners.positions];

    case 'x_pattern':
      return [WIN_PATTERNS_DATA.x_pattern.positions];

    case 'blackout':
      return [BLACKOUT_PATTERN];

    default:
      return [];
  }
}

/**
 * Verifica si un cartón es ganador con los números llamados
 * @param useFreeCenter - Si true, el centro FREE cuenta como marcado. Si false, el centro tiene número.
 */
export function checkCardWinner(
  numbers: CardNumbers,
  calledBalls: Set<number>,
  gameType: GameType,
  customPattern?: Position[],
  useFreeCenter: boolean = true
): { isWinner: boolean; winningPattern?: string } {
  const patterns = gameType === 'custom' && customPattern
    ? [customPattern]
    : getPatternsForGameType(gameType);

  for (const pattern of patterns) {
    let matches = 0;
    let required = pattern.length;

    for (const [row, col] of pattern) {
      const num = getNumberAtPosition(numbers, row, col, useFreeCenter);

      // FREE siempre cuenta como marcado (solo si useFreeCenter está activo)
      if (num === 'FREE') {
        matches++;
        continue;
      }

      if (calledBalls.has(num)) {
        matches++;
      }
    }

    if (matches === required) {
      // Encontrar el nombre del patrón
      const patternName = Object.entries(WIN_PATTERNS_DATA)
        .find(([_, p]) => JSON.stringify(p.positions) === JSON.stringify(pattern))
        ?.[1]?.name || (gameType === 'blackout' ? 'Cartón Lleno' : 'Patrón Personalizado');

      return { isWinner: true, winningPattern: patternName };
    }
  }

  return { isWinner: false };
}

/**
 * Busca todos los cartones ganadores en un evento
 */
export async function findWinners(
  pool: Pool,
  eventId: number,
  gameId: number,
  calledBalls: number[],
  gameType: GameType,
  isPracticeMode: boolean,
  customPattern?: Position[]
): Promise<Array<{
  cardId: number;
  cardCode: string;
  cardNumber: number;
  validationCode: string;
  winningPattern: string;
  buyerName?: string;
}>> {
  const calledSet = new Set(calledBalls);
  const winners: Array<{
    cardId: number;
    cardCode: string;
    cardNumber: number;
    validationCode: string;
    winningPattern: string;
    buyerName?: string;
  }> = [];

  // Obtener configuración del evento
  const eventResult = await pool.query('SELECT use_free_center FROM events WHERE id = $1', [eventId]);
  const event = eventResult.rows[0] as { use_free_center: boolean } | undefined;
  const useFreeCenter = event?.use_free_center !== false; // Por defecto true

  // Obtener cartones (todos o solo vendidos según el modo)
  const query = isPracticeMode
    ? 'SELECT id, card_number, card_code, validation_code, numbers, buyer_name FROM cards WHERE event_id = $1'
    : 'SELECT id, card_number, card_code, validation_code, numbers, buyer_name FROM cards WHERE event_id = $1 AND is_sold = TRUE';

  const cardsResult = await pool.query(query, [eventId]);
  const cards = cardsResult.rows as Array<{
    id: number;
    card_number: number;
    card_code: string;
    validation_code: string;
    numbers: string;
    buyer_name: string | null;
  }>;

  for (const card of cards) {
    const numbers: CardNumbers = JSON.parse(card.numbers);
    const result = checkCardWinner(numbers, calledSet, gameType, customPattern, useFreeCenter);

    if (result.isWinner) {
      winners.push({
        cardId: card.id,
        cardCode: card.card_code,
        cardNumber: card.card_number,
        validationCode: card.validation_code,
        winningPattern: result.winningPattern!,
        buyerName: card.buyer_name || undefined,
      });
    }
  }

  return winners;
}

/**
 * Valida un cartón por su código de validación
 */
export async function validateCard(
  pool: Pool,
  cardCode: string,
  validationCode: string
): Promise<{
  valid: boolean;
  card?: {
    id: number;
    cardNumber: number;
    eventId: number;
    numbers: CardNumbers;
    isSold: boolean;
  };
  error?: string;
}> {
  const cardResult = await pool.query(`
    SELECT id, event_id, card_number, numbers, is_sold
    FROM cards
    WHERE card_code = $1 AND validation_code = $2
  `, [cardCode, validationCode]);
  const card = cardResult.rows[0] as {
    id: number;
    event_id: number;
    card_number: number;
    numbers: string;
    is_sold: boolean;
  } | undefined;

  if (!card) {
    return {
      valid: false,
      error: 'Código de cartón o validación inválido',
    };
  }

  return {
    valid: true,
    card: {
      id: card.id,
      cardNumber: card.card_number,
      eventId: card.event_id,
      numbers: JSON.parse(card.numbers),
      isSold: !!card.is_sold,
    },
  };
}

/**
 * Recalcula y verifica el hash de un cartón
 */
export async function verifyCardIntegrity(
  pool: Pool,
  cardId: number
): Promise<{ valid: boolean; error?: string }> {
  const cardResult = await pool.query(
    'SELECT numbers, numbers_hash FROM cards WHERE id = $1', [cardId]
  );
  const card = cardResult.rows[0] as { numbers: string; numbers_hash: string } | undefined;

  if (!card) {
    return { valid: false, error: 'Cartón no encontrado' };
  }

  const numbers: CardNumbers = JSON.parse(card.numbers);
  const recalculatedHash = calculateCardHash(numbers);

  if (recalculatedHash !== card.numbers_hash) {
    return {
      valid: false,
      error: 'El hash del cartón no coincide - posible corrupción de datos',
    };
  }

  return { valid: true };
}
