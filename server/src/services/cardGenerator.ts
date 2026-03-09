import { randomBytes, createHash } from 'crypto';
import type { CardNumbers, BingoColumn, BINGO_RANGES } from '../types/index.js';

// Rangos de números por columna - Bingo Americano 75
const BINGO_COLUMN_RANGES: Record<BingoColumn, { min: number; max: number }> = {
  B: { min: 1, max: 15 },
  I: { min: 16, max: 30 },
  N: { min: 31, max: 45 },
  G: { min: 46, max: 60 },
  O: { min: 61, max: 75 },
};

const COLUMNS: BingoColumn[] = ['B', 'I', 'N', 'G', 'O'];

/**
 * Genera un número aleatorio criptográficamente seguro en un rango
 */
function secureRandomInt(min: number, max: number): number {
  const range = max - min + 1;
  const bytesNeeded = Math.ceil(Math.log2(range) / 8) || 1;
  const maxValid = Math.floor(256 ** bytesNeeded / range) * range - 1;

  let randomValue: number;
  do {
    const bytes = randomBytes(bytesNeeded);
    randomValue = bytes.reduce((acc, byte, i) => acc + byte * 256 ** i, 0);
  } while (randomValue > maxValid);

  return min + (randomValue % range);
}

/**
 * Genera n números únicos aleatorios en un rango usando Fisher-Yates parcial
 */
function generateUniqueNumbers(min: number, max: number, count: number): number[] {
  const range = max - min + 1;
  if (count > range) {
    throw new Error(`Cannot generate ${count} unique numbers in range ${min}-${max}`);
  }

  // Crear array con todos los números del rango
  const pool: number[] = [];
  for (let i = min; i <= max; i++) {
    pool.push(i);
  }

  // Fisher-Yates shuffle parcial (solo necesitamos 'count' elementos)
  const result: number[] = [];
  for (let i = 0; i < count; i++) {
    const randomIndex = secureRandomInt(i, pool.length - 1);
    // Swap
    [pool[i], pool[randomIndex]] = [pool[randomIndex], pool[i]];
    result.push(pool[i]);
  }

  return result;
}

/**
 * Genera los números de un cartón de Bingo Americano
 * @param useFreeCenter - Si true, el centro es FREE (4 números en N). Si false, 5 números en N.
 */
export function generateCardNumbers(useFreeCenter: boolean = true): CardNumbers {
  const numbers: CardNumbers = {
    B: generateUniqueNumbers(1, 15, 5),
    I: generateUniqueNumbers(16, 30, 5),
    N: generateUniqueNumbers(31, 45, useFreeCenter ? 4 : 5), // 4 si FREE, 5 si no
    G: generateUniqueNumbers(46, 60, 5),
    O: generateUniqueNumbers(61, 75, 5),
  };

  return numbers;
}

/**
 * Genera un código alfanumérico único de longitud especificada
 * Usa caracteres que no se confunden fácilmente (sin O, 0, I, 1, L)
 */
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateUniqueCode(length: number = 5): string {
  let code = '';
  for (let i = 0; i < length; i++) {
    const index = secureRandomInt(0, CODE_CHARS.length - 1);
    code += CODE_CHARS[index];
  }
  return code;
}

/**
 * Calcula un hash único para los números del cartón
 * Este hash se usa para detectar duplicados rápidamente
 */
export function calculateCardHash(numbers: CardNumbers): string {
  // Normalizar: ordenar números dentro de cada columna para comparación consistente
  const normalized = {
    B: [...numbers.B].sort((a, b) => a - b),
    I: [...numbers.I].sort((a, b) => a - b),
    N: [...numbers.N].sort((a, b) => a - b),
    G: [...numbers.G].sort((a, b) => a - b),
    O: [...numbers.O].sort((a, b) => a - b),
  };

  const hashInput = JSON.stringify(normalized);
  return createHash('sha256').update(hashInput).digest('hex').substring(0, 32);
}

/**
 * Convierte los números del cartón a formato de visualización (matriz 5x5)
 * @param useFreeCenter - Si true, el centro es FREE. Si false, el centro tiene número.
 */
export function cardNumbersToMatrix(numbers: CardNumbers, useFreeCenter: boolean = true): (number | 'FREE')[][] {
  const matrix: (number | 'FREE')[][] = [];
  const hasFiveInN = numbers.N.length === 5;

  for (let row = 0; row < 5; row++) {
    const rowData: (number | 'FREE')[] = [];

    for (let col = 0; col < 5; col++) {
      const column = COLUMNS[col];

      if (col === 2 && row === 2 && useFreeCenter && !hasFiveInN) {
        // Centro es FREE solo si useFreeCenter y N tiene 4 números
        rowData.push('FREE');
      } else if (col === 2) {
        if (hasFiveInN) {
          // N tiene 5 números (sin FREE center)
          rowData.push(numbers.N[row]);
        } else {
          // Columna N con FREE: ajustar índice porque solo tiene 4 números
          const nIndex = row < 2 ? row : row - 1;
          rowData.push(numbers.N[nIndex]);
        }
      } else {
        rowData.push(numbers[column][row]);
      }
    }

    matrix.push(rowData);
  }

  return matrix;
}

/**
 * Obtiene el número en una posición específica del cartón
 * @param useFreeCenter - Si true, el centro es FREE. Si false, el centro tiene número.
 */
export function getNumberAtPosition(
  numbers: CardNumbers,
  row: number,
  col: number,
  useFreeCenter: boolean = true
): number | 'FREE' {
  const hasFiveInN = numbers.N.length === 5;

  if (row === 2 && col === 2 && useFreeCenter && !hasFiveInN) {
    return 'FREE';
  }

  const column = COLUMNS[col];

  if (col === 2) {
    if (hasFiveInN) {
      return numbers.N[row];
    } else {
      // Columna N con FREE: ajustar índice
      const nIndex = row < 2 ? row : row - 1;
      return numbers.N[nIndex];
    }
  }

  return numbers[column][row];
}

/**
 * Valida que los números del cartón cumplan las reglas del Bingo Americano
 * @param useFreeCenter - Si true, N debe tener 4 números. Si false, N debe tener 5.
 */
export function validateCardNumbers(numbers: CardNumbers, useFreeCenter: boolean = true): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Validar cada columna
  for (const col of COLUMNS) {
    const colNumbers = numbers[col];
    const { min, max } = BINGO_COLUMN_RANGES[col];
    const expectedCount = col === 'N' ? (useFreeCenter ? 4 : 5) : 5;

    // Verificar cantidad
    if (colNumbers.length !== expectedCount) {
      errors.push(`Columna ${col}: esperados ${expectedCount} números, encontrados ${colNumbers.length}`);
    }

    // Verificar rango
    for (const num of colNumbers) {
      if (num < min || num > max) {
        errors.push(`Columna ${col}: número ${num} fuera de rango [${min}-${max}]`);
      }
    }

    // Verificar duplicados dentro de la columna
    const uniqueNumbers = new Set(colNumbers);
    if (uniqueNumbers.size !== colNumbers.length) {
      errors.push(`Columna ${col}: contiene números duplicados`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Genera un cartón completo con todos sus datos
 */
export interface GeneratedCard {
  card_code: string;
  validation_code: string;
  numbers: CardNumbers;
  numbers_hash: string;
}

export function generateCard(useFreeCenter: boolean = true): GeneratedCard {
  const numbers = generateCardNumbers(useFreeCenter);
  const validation = validateCardNumbers(numbers, useFreeCenter);

  if (!validation.valid) {
    // Esto no debería pasar nunca, pero por seguridad
    throw new Error(`Error generando cartón: ${validation.errors.join(', ')}`);
  }

  return {
    card_code: generateUniqueCode(5),
    validation_code: generateUniqueCode(5),
    numbers,
    numbers_hash: calculateCardHash(numbers),
  };
}

/**
 * Genera múltiples cartones verificando unicidad
 * @param quantity Cantidad de cartones a generar
 * @param existingHashes Set de hashes existentes para verificar duplicados
 * @param existingCodes Set de códigos existentes para verificar duplicados
 * @param onProgress Callback para reportar progreso
 * @param useFreeCenter Si true, el centro es FREE. Si false, tiene número.
 */
export interface GenerationResult {
  cards: GeneratedCard[];
  duplicatesAvoided: number;
  generationTime: number;
}

export async function generateCards(
  quantity: number,
  existingHashes: Set<string> = new Set(),
  existingCodes: Set<string> = new Set(),
  onProgress?: (generated: number, total: number) => void,
  useFreeCenter: boolean = true
): Promise<GenerationResult> {
  const startTime = Date.now();
  const cards: GeneratedCard[] = [];
  const newHashes = new Set<string>(existingHashes);
  const newCodes = new Set<string>(existingCodes);
  let duplicatesAvoided = 0;
  let attempts = 0;
  const maxAttempts = quantity * 10; // Límite de seguridad

  while (cards.length < quantity && attempts < maxAttempts) {
    attempts++;

    const card = generateCard(useFreeCenter);

    // Verificar que el hash no exista (cartón único)
    if (newHashes.has(card.numbers_hash)) {
      duplicatesAvoided++;
      continue;
    }

    // Verificar que los códigos no existan
    if (newCodes.has(card.card_code) || newCodes.has(card.validation_code)) {
      continue;
    }

    // Agregar a los sets de verificación
    newHashes.add(card.numbers_hash);
    newCodes.add(card.card_code);
    newCodes.add(card.validation_code);

    cards.push(card);

    // Reportar progreso cada 100 cartones
    if (onProgress && cards.length % 100 === 0) {
      onProgress(cards.length, quantity);
    }

    // Yield para no bloquear el event loop en generaciones grandes
    if (cards.length % 1000 === 0) {
      await new Promise(resolve => setImmediate(resolve));
    }
  }

  if (cards.length < quantity) {
    throw new Error(
      `No se pudieron generar ${quantity} cartones únicos después de ${attempts} intentos. ` +
      `Generados: ${cards.length}, Duplicados evitados: ${duplicatesAvoided}`
    );
  }

  const generationTime = Date.now() - startTime;

  return {
    cards,
    duplicatesAvoided,
    generationTime,
  };
}

/**
 * Formatea los números del cartón como string separado por comas
 * Formato: B1,B2,B3,B4,B5,I1,I2,I3,I4,I5,N1,N2,N3,N4,G1,G2,G3,G4,G5,O1,O2,O3,O4,O5
 */
export function formatCardNumbersAsString(numbers: CardNumbers): string {
  return [
    ...numbers.B,
    ...numbers.I,
    ...numbers.N,
    ...numbers.G,
    ...numbers.O,
  ].join(',');
}

/**
 * Parsea un string de números de cartón al formato CardNumbers
 * Soporta 24 números (con FREE center) o 25 números (sin FREE center)
 */
export function parseCardNumbersFromString(numbersStr: string): CardNumbers {
  const nums = numbersStr.split(',').map(n => parseInt(n, 10));

  if (nums.length === 24) {
    // Con FREE center: N tiene 4 números
    return {
      B: nums.slice(0, 5),
      I: nums.slice(5, 10),
      N: nums.slice(10, 14),
      G: nums.slice(14, 19),
      O: nums.slice(19, 24),
    };
  } else if (nums.length === 25) {
    // Sin FREE center: N tiene 5 números
    return {
      B: nums.slice(0, 5),
      I: nums.slice(5, 10),
      N: nums.slice(10, 15),
      G: nums.slice(15, 20),
      O: nums.slice(20, 25),
    };
  } else {
    throw new Error(`Se esperaban 24 o 25 números, se encontraron ${nums.length}`);
  }
}
