import { randomBytes } from 'crypto';

const ALPHABET =
  'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

export function generatePassword(length = 16): string {
  if (length <= 0) throw new Error('password length must be positive');

  const out: string[] = [];
  const max = Math.floor(256 / ALPHABET.length) * ALPHABET.length;

  while (out.length < length) {
    const buf = randomBytes(length * 2);
    for (let i = 0; i < buf.length && out.length < length; i++) {
      const b = buf[i];
      if (b < max) out.push(ALPHABET[b % ALPHABET.length]);
    }
  }

  return out.join('');
}
