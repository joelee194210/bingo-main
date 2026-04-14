import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Normaliza un serial de cartón: "81-1" → "00081-01", "203-21" → "00203-21"
 * Si no tiene formato de serial (N-N), retorna el valor original sin cambios.
 */
export function normalizeSerial(ref: string): string {
  const match = ref.match(/^(\d+)-(\d+)$/);
  if (match) {
    return match[1].padStart(5, '0') + '-' + match[2].padStart(2, '0');
  }
  return ref;
}

/**
 * Extrae el código de un texto escaneado. Los QR de cartones se exportan como
 * URL completa (ver server/src/routes/export.ts buildUrl), mientras que cajas y
 * libretas codifican el código plano. Este helper acepta ambos casos.
 *
 * Orden de búsqueda en URL:
 *   1. query params: card_code, serial, code, validation_code
 *   2. último segmento no vacío del pathname
 * Si el input no es URL, lo devuelve tal cual.
 */
export function extractScanCode(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (!/^https?:\/\//i.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    const keys = ['card_code', 'serial', 'code', 'validation_code'];
    for (const k of keys) {
      const v = url.searchParams.get(k);
      if (v) return v;
    }
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length > 0) return segments[segments.length - 1];
    return trimmed;
  } catch {
    return trimmed;
  }
}
