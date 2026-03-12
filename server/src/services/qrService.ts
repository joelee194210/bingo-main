/**
 * Servicio de códigos QR para inventario
 * Prefijos: CJ- para cajas, LT- para lotes, ENV- para envíos, CT- para centros
 * Payload QR: B:<código>:<eventId>
 */

export function generateCajaCode(seq: number): string {
  return `CJ-${seq.toString().padStart(5, '0')}`;
}

export function generateLoteCode(seq: number): string {
  return `LT-${seq.toString().padStart(5, '0')}`;
}

export function generateEnvioCode(seq: number): string {
  return `ENV-${seq.toString().padStart(5, '0')}`;
}

export function generateCentroCode(seq: number): string {
  return `CT-${seq.toString().padStart(5, '0')}`;
}

export interface QRPayload {
  type: 'caja' | 'lote' | 'card';
  code: string;
  eventId: number;
}

export function generateQRPayload(type: QRPayload['type'], code: string, eventId: number): string {
  return `B:${code}:${eventId}`;
}

export function parseQRPayload(data: string): QRPayload | null {
  const parts = data.split(':');
  if (parts.length !== 3 || parts[0] !== 'B') return null;

  const code = parts[1];
  const eventId = parseInt(parts[2], 10);
  if (isNaN(eventId)) return null;

  let type: QRPayload['type'];
  if (code.startsWith('CJ-')) type = 'caja';
  else if (code.startsWith('LT-')) type = 'lote';
  else type = 'card';

  return { type, code, eventId };
}

export function identifyCodeType(code: string): 'caja' | 'lote' | 'card' {
  if (code.startsWith('CJ-')) return 'caja';
  if (code.startsWith('LT-')) return 'lote';
  return 'card';
}
