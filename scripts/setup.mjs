import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

// Create local configuration only. Never overwrite existing credentials.
const content = `# Configuração local privada; não incluir em commits ou no pacote de publicação.\nLISBOA_ADMIN_PASSWORD=${randomBytes(24).toString('base64url')}\nPORTO_ADMIN_PASSWORD=${randomBytes(24).toString('base64url')}\nLISBOA_ROOM_CODE=${randomBytes(4).toString('hex')}\nPORTO_ROOM_CODE=${randomBytes(4).toString('hex')}\nSESSION_SECRET=${randomBytes(32).toString('hex')}\nPORT=4173\nAPP_HOST=127.0.0.1\n`;
try {
  await writeFile(new URL('../.env', import.meta.url), content, { flag: 'wx', mode: 0o600 });
  console.log('Configuração criada em .env. Consulte esse ficheiro para as palavras-passe e os códigos de sala. Os valores não são mostrados nos logs.');
} catch(error) {
  if (error.code === 'EEXIST') console.log('O ficheiro .env já existe e foi preservado.');
  else throw error;
}
