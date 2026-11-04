import { t } from './public/i18n.js';
import { createServer } from 'node:http';
import { readFile, mkdir, chmod } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { randomBytes, scryptSync, timingSafeEqual, createHash, createHmac } from 'node:crypto';
import { createStore, AppError } from './lib/store.mjs';

const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/i18n.js', ['i18n.js', 'text/javascript; charset=utf-8']],
  ['/icons.js', ['icons.js', 'text/javascript; charset=utf-8']],
  ['/locales/pt-PT.js', ['locales/pt-PT.js', 'text/javascript; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']],
]);
const SESSION_MS = 8 * 60 * 60 * 1000;
const hashToken = token => createHash('sha256').update(token).digest('hex');
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());

export async function createApplication({ store, passwords = {}, roomCodes = {}, origin = 'http://127.0.0.1:4173', allowedOrigins = [origin], testMode = false, sessionMs = SESSION_MS, sessionSecret = randomBytes(32).toString('hex') } = {}) {
  store ||= await createStore();
  const passwordHashes = new Map(), credentialBindings = new Map();
  const roomSecret = sessionSecret;
  const roomGrants = new Map();
  for (const slug of ['lisboa', 'porto']) {
    if (passwords[slug]?.length >= 12) {
      const salt = randomBytes(16);
      passwordHashes.set(slug, { salt, hash: scryptSync(passwords[slug], salt, 32) });
      credentialBindings.set(slug, createHmac('sha256', sessionSecret).update(`${slug}:${passwords[slug]}`).digest('hex'));
    }
    // This authorization is identical for the whole room; it is not a participant identifier.
    if (roomCodes[slug]?.length >= 4) roomGrants.set(slug, createHmac('sha256', roomSecret).update(`${slug}:${roomCodes[slug]}`).digest('hex'));
  }
  const sessionFor = async (request, slug) => {
    const token = request.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith(`mesa_${slug}=`))?.slice(`mesa_${slug}=`.length);
    if (!token) return null;
    const session = await store.getSession(hashToken(token));
    if (!session || session.slug !== slug || !equal(session.binding, credentialBindings.get(slug))) return null;
    return session;
  };
  const cookie = (slug, token, maxAge) => `mesa_${slug}=${token}; HttpOnly; SameSite=Strict; Path=/api/assemblies/${slug}/admin; Max-Age=${maxAge}${origin.startsWith('https:') ? '; Secure' : ''}`;
  const readJson = async request => {
    if (!request.headers['content-type']?.startsWith('application/json')) throw new AppError(t('envie_os_dados_em_formato'), 415);
    if (request.body !== undefined) {
      if (Buffer.byteLength(JSON.stringify(request.body)) > 8192) throw new AppError(t('o_pedido_excede_o_tamanho'), 413);
      const value = typeof request.body === 'string' ? JSON.parse(request.body) : request.body;
      if (!value || Array.isArray(value) || typeof value !== 'object') throw new AppError(t('o_pedido_nao_contem_um'));
      return value;
    }
    const chunks = []; let bytes = 0;
    for await (const chunk of request) {
      chunks.push(chunk); bytes += chunk.length;
      if (bytes > 8192) throw new AppError(t('o_pedido_excede_o_tamanho'), 413);
    }
    try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error(); return value; }
    catch { throw new AppError(t('o_pedido_nao_contem_um')); }
  };
  const send = (response, status, data) => {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.writeHead(status).end(JSON.stringify(data));
  };
  const assertOrigin = request => {
    const expectedOrigin = allowedOrigins.find(value => new URL(value).host === request.headers.host);
    if (request.headers.origin !== expectedOrigin || request.headers['sec-fetch-site'] === 'cross-site') throw new AppError(t('a_origem_do_pedido_nao'), 403);
  };
  const roomGrantFor = (request, slug) => request.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith(`sala_${slug}=`))?.slice(`sala_${slug}=`.length);
  const hasRoom = (request, slug) => roomGrants.has(slug) && equal(roomGrantFor(request, slug), roomGrants.get(slug));
  const roomCookie = (slug, grant) => `sala_${slug}=${grant}; HttpOnly; SameSite=Strict; Path=/api/assemblies/${slug}${grant ? '' : '; Max-Age=0'}${origin.startsWith('https:') ? '; Secure' : ''}`;
  const requireRoom = (request, slug) => {
    if (!hasRoom(request, slug)) throw new AppError(t('introduza_o_codigo_de_sala'), 401);
  };

  const handler = async (request, response) => {
    response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'none'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    response.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    try {
      if (!allowedOrigins.some(value => new URL(value).host === request.headers.host)) throw new AppError(t('endereco_de_acesso_nao_permitido'), 403);
      const pathname = new URL(request.url, origin).pathname;
      if (!pathname.startsWith('/api/')) {
        if (!['GET', 'HEAD'].includes(request.method)) throw new AppError(t('metodo_nao_permitido'), 405);
        const file = files.get(pathname);
        if (!file) throw new AppError(t('pagina_nao_encontrada'), 404);
        const content = await readFile(new URL(`./public/${file[0]}`, import.meta.url));
        response.setHeader('Content-Type', file[1]);
        response.writeHead(200).end(request.method === 'HEAD' ? undefined : content); return;
      }
      if (pathname === '/api/assemblies' && request.method === 'GET') {
        send(response, 200, { assemblies: await store.listAssemblies(), testMode }); return;
      }
      const match = pathname.match(/^\/api\/assemblies\/(lisboa|porto)(\/.*)?$/);
      if (!match) throw new AppError(t('recurso_nao_encontrado'), 404);
      const [, slug, route = ''] = match;
      if (route === '' && request.method === 'GET') {
        send(response, 200, { ...await store.snapshot(slug), testMode, hosted: store.remote, roomConfigured: roomGrants.has(slug), roomGranted: hasRoom(request, slug) }); return;
      }
      if (route === '/admin/session' && request.method === 'GET') {
        const authenticated = Boolean(await sessionFor(request, slug));
        send(response, 200, { authenticated, configured: passwordHashes.has(slug), ...(authenticated ? await store.snapshot(slug, { admin: true }) : {}) }); return;
      }
      if (request.method !== 'POST') throw new AppError(t('metodo_nao_permitido'), 405);
      assertOrigin(request);
      const data = await readJson(request);
      if (route === '/room/enter') {
        if (!roomGrants.has(slug)) throw new AppError(t('o_codigo_desta_sala_ainda'), 503);
        if (!equal(data.code, roomCodes[slug])) {
          await store.reserveAttempt(slug, 'room', 30);
          throw new AppError(t('codigo_de_sala_incorreto'), 401);
        }
        response.setHeader('Set-Cookie', roomCookie(slug, roomGrants.get(slug)));
        send(response, 200, { granted: true }); return;
      }
      if (route === '/room/leave') { response.setHeader('Set-Cookie', roomCookie(slug, '')); send(response, 200, { granted: false }); return; }
      if (route === '/admin/login') {
        const configured = passwordHashes.get(slug);
        if (!configured) throw new AppError(t('a_palavra_passe_desta_mesa_2'), 503);
        await store.reserveAttempt(slug, 'login', 10);
        const validType = typeof data.password === 'string' && data.password.length <= 1024;
        const candidate = scryptSync(validType ? data.password : '', configured.salt, 32);
        if (!validType || !timingSafeEqual(candidate, configured.hash) || data.username !== 'mesa') throw new AppError(t('nome_de_utilizador_ou_palavra'), 401);
        const token = randomBytes(32).toString('hex');
        await store.saveSession(hashToken(token), slug, Date.now() + sessionMs, credentialBindings.get(slug));
        response.setHeader('Set-Cookie', cookie(slug, token, Math.ceil(sessionMs / 1000)));
        send(response, 200, { authenticated: true }); return;
      }
      if (route.startsWith('/admin/')) {
        if (!await sessionFor(request, slug)) throw new AppError(t('entre_na_mesa_desta_assembleia'), 401);
        if (route === '/admin/logout') {
          const token = request.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith(`mesa_${slug}=`))?.split('=')[1];
          if (token) await store.deleteSession(hashToken(token));
          response.setHeader('Set-Cookie', cookie(slug, '', 0));
          send(response, 200, { authenticated: false }); return;
        }
        if (route === '/admin/proposals') { send(response, 201, await store.submit(slug, data)); return; }
        const action = route.match(/^\/admin\/proposals\/(\d+)\/(open|counts|close)$/);
        if (!action) throw new AppError(t('acao_nao_encontrada'), 404);
        const id = Number(action[1]);
        if (action[2] === 'open') await store.open(slug, id);
        if (action[2] === 'counts') await store.saveCounts(slug, id, data);
        if (action[2] === 'close') await store.closeVoting(slug, id, data);
        send(response, 200, { ok: true }); return;
      }
      requireRoom(request, slug);
      if (route === '/proposals') { send(response, 201, await store.submit(slug, data)); return; }
      const action = route.match(/^\/proposals\/(\d+)\/(support|vote|vote-status)$/);
      if (!action) throw new AppError(t('acao_nao_encontrada'), 404);
      if (action[2] === 'support') await store.support(slug, Number(action[1]));
      else if (action[2] === 'vote-status') { send(response, 200, { recorded: await store.voteRecorded(slug, Number(action[1]), data.token) }); return; }
      else { send(response, 200, { ok: true, ...await store.vote(slug, Number(action[1]), data.choice, data.token) }); return; }
      send(response, 200, { ok: true });
    } catch (error) {
      if (!(error instanceof AppError)) console.error('request_failure', error.code || error.name || 'Error');
      if (error instanceof AppError && error.status === 429) response.setHeader('Retry-After', '60');
      send(response, error instanceof AppError ? error.status : 500, { error: error instanceof AppError ? error.message : t('nao_foi_possivel_concluir_o') });
    }
  };
  const server = createServer(handler);
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  return { server, store, handler };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const testMode = process.argv.includes('--demo');
  const port = Number(process.env.PORT || 4173), host = process.env.APP_HOST || '127.0.0.1';
  const origin = process.env.APP_ORIGIN || `http://127.0.0.1:${port}`;
  if (host !== '127.0.0.1' && !process.env.APP_ORIGIN) throw new Error(t('defina_app_origin_ao_permitir'));
  if (new URL(origin).origin !== origin) throw new Error(t('app_origin_deve_conter_apenas'));
  process.umask(0o077);
  const filename = resolve(process.env.DATA_FILE || (testMode ? '.data/demo.sqlite' : '.data/assembleias.sqlite'));
  await mkdir(dirname(filename), { recursive: true, mode: 0o700 });
  const store = await createStore(filename);
  await chmod(filename, 0o600);
  if (testMode) await store.seedDemo();
  const { server } = await createApplication({ store, origin, testMode, sessionSecret: process.env.SESSION_SECRET, passwords: { lisboa: process.env.LISBOA_ADMIN_PASSWORD, porto: process.env.PORTO_ADMIN_PASSWORD }, roomCodes: { lisboa: process.env.LISBOA_ROOM_CODE, porto: process.env.PORTO_ROOM_CODE } });
  server.on('error', error => {
    console.error(error.code === 'EADDRINUSE' ? `A porta ${port} está ocupada. Altere PORT e APP_ORIGIN no .env.` : 'Não foi possível iniciar o servidor local.');
    store.close(); process.exitCode = 1;
  });
  server.listen(port, host, () => console.log(`Assembleias: ${origin}\n${testMode ? 'MODO DE TESTE: dados de exemplo. Sem validade eleitoral.' : 'Versão local em desenvolvimento. Restrição de repetição limitada ao mesmo navegador.'}\nPrima Ctrl+C para terminar. A aplicação não regista acessos nem conteúdos dos pedidos.`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(async () => { await store.close(); process.exit(0); }));
}
