/**
 * Constantes de dominio del sistema de bingo.
 * CR-H4: evitar magic numbers dispersos en el codebase.
 */

/**
 * Cartones por serie/libreta. Un lote corresponde a una serie de
 * CARDS_PER_SERIES cartones numerados consecutivamente (ej. 00001-01 a
 * 00001-50). El serial de cada cartón se construye como `${series}-${seq}`
 * donde `seq` va de 01 a CARDS_PER_SERIES.
 *
 * Cambiar este valor implica migración de serials existentes, recálculo de
 * contadores de lotes y regeneración de códigos de barras/QR.
 */
export const CARDS_PER_SERIES = 50;
