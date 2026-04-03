import { randomBytes } from 'crypto';

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function secureRandomInt(min: number, max: number): number {
  const range = max - min + 1;
  const bytesNeeded = Math.ceil(Math.log2(range) / 8) || 1;
  const maxValid = Math.floor(256 ** bytesNeeded / range) * range - 1;

  let randomValue: number;
  do {
    const buf = randomBytes(bytesNeeded);
    randomValue = 0;
    for (let i = 0; i < bytesNeeded; i++) {
      randomValue = (randomValue << 8) | buf[i];
    }
  } while (randomValue > maxValid);

  return min + (randomValue % range);
}

export function generateUniqueCode(length: number = 5): string {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += CODE_CHARS[secureRandomInt(0, CODE_CHARS.length - 1)];
  }
  return code;
}
