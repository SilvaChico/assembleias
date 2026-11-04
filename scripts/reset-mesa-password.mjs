import { randomBytes } from 'node:crypto';
import { emitKeypressEvents } from 'node:readline';
import { createStore } from '../lib/store.mjs';
import { hashPassword, verifyPassword, newPasswordInput } from '../lib/passwords.mjs';

// Read only from an interactive terminal: no password in arguments, env or logs.
async function hidden(prompt) {
  process.stdout.write(prompt);
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true); process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (error) => {
      process.stdin.off('keypress', onKey); process.stdin.setRawMode(false); process.stdin.pause();
      process.stdout.write('\n');
      if (error) reject(error); else resolve(value);
    };
    const onKey = (text, key) => {
      if (key?.ctrl && key.name === 'c') return finish(new Error('Recovery cancelled'));
      if (key?.name === 'return') return finish();
      if (key?.name === 'backspace') value = [...value].slice(0, -1).join('');
      else if (text && !key?.ctrl && !key?.meta) value += text;
    };
    process.stdin.on('keypress', onKey);
  });
}

let store;
try {
  const slug = process.argv[2];
  if (process.argv.length !== 3 || !['lisboa', 'porto'].includes(slug) || !process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Use an interactive terminal and select lisboa or porto');
  const url = process.env.TURSO_DATABASE_URL || process.env.DATA_FILE || '.data/assembleias.sqlite';
  if (/^(libsql|https?):/.test(url) && !process.env.TURSO_AUTH_TOKEN) throw new Error('Database credentials are required');
  store = await createStore(url, { authToken: process.env.TURSO_AUTH_TOKEN });
  const credential = await store.getCredential(slug);
  if (!credential) throw new Error('City credentials have not been initialized');
  process.stdout.write(`Recovery for ${slug}. Existing mesa sessions will end.\n`);
  const password = await hidden('New temporary password (at least 15 characters; hidden): ');
  const confirmation = await hidden('Repeat temporary password (hidden): ');
  if (!newPasswordInput(password) || password !== confirmation || await verifyPassword(password, credential.password_hash)) throw new Error('Invalid password or confirmation');
  await store.recoverCredential(slug, await hashPassword(password), credential.version, randomBytes(16).toString('hex'));
  process.stdout.write('Temporary credential saved. First sign-in requires a replacement.\n');
} catch {
  // No database messages, values, request content, or credentials in output.
  process.stderr.write('Recovery failed or cancelled. Check the city, terminal, database configuration and matching passwords.\n');
  process.exitCode = 1;
} finally { await store?.close(); }
