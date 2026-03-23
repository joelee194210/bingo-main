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
