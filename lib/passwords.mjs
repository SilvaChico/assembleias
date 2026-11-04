import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
// OWASP's 32 MiB scrypt profile; Node 22 provides it without a native dependency.
const options = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
export const passwordInput = value => typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= 1024;
export const newPasswordInput = value => passwordInput(value) && [...value].length >= 15;

export async function hashPassword(password) {
  if (!passwordInput(password)) throw new TypeError('Invalid password input');
  const salt = randomBytes(16);
  const hash = await derive(password, salt, 32, options);
  return `scrypt$32768$8$3$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function verifyPassword(password, encoded) {
  if (!passwordInput(password)) return false;
  // Accept only the supported, bounded profile; corrupt database values fail closed.
  const match = typeof encoded === 'string' && encoded.match(/^scrypt\$32768\$8\$3\$([a-f0-9]{32})\$([a-f0-9]{64})$/);
  if (!match) return false;
  const candidate = await derive(password, Buffer.from(match[1], 'hex'), 32, options);
  return timingSafeEqual(candidate, Buffer.from(match[2], 'hex'));
}
