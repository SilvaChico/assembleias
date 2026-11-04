import { t } from './public/i18n.js';
import { createServer } from 'node:http';
import { readFile, mkdir, chmod } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { randomBytes, timingSafeEqual, createHash, createHmac } from 'node:crypto';
import { createStore, AppError } from './lib/store.mjs';
import { hashPassword, verifyPassword, passwordInput, newPasswordInput } from './lib/passwords.mjs';

const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/mesa', ['index.html', 'text/html; charset=utf-8']],
  ['/mesa/', ['index.html', 'text/html; charset=utf-8']],
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
  const roomSecret = sessionSecret;
  const credentialBinding = (slug, version) => createHmac('sha256', sessionSecret).update(`mesa-v2:${slug}:${version}`).digest('hex');
  await store.initializeRooms(roomCodes);
  for (const slug of ['lisboa', 'porto']) {
    if (!await store.getCredential(slug) && passwordInput(passwords[slug]) && passwords[slug].length >= 12) {
      await store.initializeCredential(slug, await hashPassword(passwords[slug]), randomBytes(16).toString('hex'));
    }
  }
  const sessionFor = async (request, slug) => {
    const token = request.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith(`mesa_${slug}=`))?.slice(`mesa_${slug}=`.length);
    if (!token) return null;
    const tokenHash = hashToken(token), session = await store.getSession(tokenHash);
    const credential = await store.getCredential(slug);
    if (!session || session.slug !== slug || !credential || !equal(session.binding, credentialBinding(slug, credential.version))) return null;
    return { ...session, tokenHash, version: credential.version, setupRequired: Boolean(credential.must_change) };
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
  // The grant is identical for everyone in one room; it carries no participant identity.
  const grantFor = room => createHmac('sha256', roomSecret).update(`${room.id}:${room.code}`).digest('hex');
  const roomCookie = value => `sala=${value}; HttpOnly; SameSite=Strict; Path=/api${value ? '' : '; Max-Age=0'}${origin.startsWith('https:') ? '; Secure' : ''}`;
  const admittedRoom = async request => {
    const value = request.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith('sala='))?.slice(5);
    if (!value || !/^(lisboa|porto|room-[a-f0-9]{24})\.[a-f0-9]{64}$/.test(value)) return null;
    const [id, grant] = value.split('.');
    const room = await store.getRoom(id).catch(error => { if (error.status === 404) return null; throw error; });
    return room?.code && equal(grant, grantFor(room)) ? room : null;
  };
  // Shared per-proposal admission, separate from both room access and individual receipts.
  const voteGrant = vote => createHmac('sha256', sessionSecret).update(`vote-v1:${vote.id}:${vote.code}`).digest('hex');
  const voteCookie = value => `votacao=${value}; HttpOnly; SameSite=Strict; Path=/api/votes${value ? '' : '; Max-Age=0'}${origin.startsWith('https:') ? '; Secure' : ''}`;
  const admittedVote = async request => {
    const value = request.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith('votacao='))?.slice(8);
    if (!value || !/^[A-Z]{4}\.[a-f0-9]{64}$/.test(value)) return null;
    const [code, grant] = value.split('.');
    const vote = await store.resolveVote(code).catch(error => { if (error.status === 401) return null; throw error; });
    return vote && equal(grant, voteGrant(vote)) ? vote : null;
  };
  const participantAction = async (room, route, data) => {
    const action = route.match(/^\/proposals\/(\d+)\/support$/);
    if (!action) throw new AppError(t('acao_nao_encontrada'), 404);
    const id = Number(action[1]);
    await store.support(room.id, id);
    return { status: 200, data: { ok: true } };
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
      if (pathname.startsWith('/api/votes/')) {
        const route = pathname.slice('/api/votes'.length);
        const admitted = await admittedVote(request);
        if (route === '/session' && request.method === 'GET') {
          send(response, 200, { ...(admitted ? await store.voteSnapshot(admitted.id) : {}), voteGranted: Boolean(admitted), testMode, hosted: store.remote }); return;
        }
        if (request.method !== 'POST') throw new AppError(t('metodo_nao_permitido'), 405);
        assertOrigin(request);
        const data = await readJson(request);
        if (route === '/enter') {
          let vote;
          try { vote = await store.resolveVote(data.code); }
          catch (error) {
            if (error.status !== 401) throw error;
            await store.reserveAttempt('votes', 'entry', 30); throw error;
          }
          if (admitted?.status === 'open' && admitted.id !== vote.id) throw new AppError(t('vote_stay_focused'), 409);
          response.setHeader('Set-Cookie', voteCookie(`${vote.code}.${voteGrant(vote)}`));
          send(response, 200, { granted: true }); return;
        }
        if (!admitted) throw new AppError(t('vote_enter_first'), 401);
        if (route === '/leave') {
          if (admitted.status !== 'closed') throw new AppError(t('vote_stay_focused'), 409);
          response.setHeader('Set-Cookie', voteCookie('')); send(response, 200, { granted: false }); return;
        }
        const action = route.match(/^\/proposals\/(\d+)\/(vote|vote-status)$/);
        if (!action || Number(action[1]) !== admitted.id) throw new AppError(t('proposta_nao_encontrada_nesta_assembleia'), 404);
        if (action[2] === 'vote-status') send(response, 200, { recorded: await store.voteRecorded(admitted.room, admitted.id, data.token) });
        else send(response, 200, { ok: true, ...await store.vote(admitted.room, admitted.id, data.choice, data.token) });
        return;
      }
      if (pathname.startsWith('/api/rooms/')) {
        const route = pathname.slice('/api/rooms'.length);
        if (route === '/session' && request.method === 'GET') {
          const room = await admittedRoom(request);
          send(response, 200, { ...(room ? await store.snapshot(room.id) : {}), roomGranted: Boolean(room), testMode, hosted: store.remote }); return;
        }
        if (request.method !== 'POST') throw new AppError(t('metodo_nao_permitido'), 405);
        assertOrigin(request);
        const data = await readJson(request);
        if (route === '/enter') {
          let room;
          try { room = await store.resolveRoom(data.code); }
          catch (error) {
            if (error.status !== 401) throw error;
            await store.reserveAttempt('rooms', 'entry', 30); throw error;
          }
          response.setHeader('Set-Cookie', roomCookie(`${room.id}.${grantFor(room)}`));
          send(response, 200, { granted: true, room }); return;
        }
        if (route === '/leave') { response.setHeader('Set-Cookie', roomCookie('')); send(response, 200, { granted: false }); return; }
        if (route === '/proposals') throw new AppError(t('mesa_only_proposals'), 403);
        const room = await admittedRoom(request);
        if (!room) throw new AppError(t('introduza_o_codigo_de_sala'), 401);
        const result = await participantAction(room, route, data);
        send(response, result.status, result.data); return;
      }
      if (pathname === '/api/assemblies' && request.method === 'GET') {
        send(response, 200, { assemblies: await store.listAssemblies(), testMode }); return;
      }
      const match = pathname.match(/^\/api\/assemblies\/(lisboa|porto)(\/.*)?$/);
      if (!match) throw new AppError(t('recurso_nao_encontrado'), 404);
      const slug = match[1];
      let route = match[2] || '', roomId = slug;
      if (route === '/admin/session' && request.method === 'GET') {
        const session = await sessionFor(request, slug);
        const authenticated = Boolean(session && !session.setupRequired);
        let snapshot = {};
        if (authenticated) {
          roomId = new URL(request.url, origin).searchParams.get('room') || slug;
          if ((await store.getRoom(roomId)).assembly !== slug) throw new AppError(t('room_not_found'), 404);
          snapshot = { ...await store.snapshot(roomId, { admin: true }), rooms: await store.listRooms(slug) };
        }
        send(response, 200, { authenticated, setupRequired: Boolean(session?.setupRequired), configured: Boolean(await store.getCredential(slug)), testMode, hosted: store.remote, ...snapshot }); return;
      }
      if (request.method !== 'POST') throw new AppError(t('metodo_nao_permitido'), 405);
      assertOrigin(request);
      const data = await readJson(request);
      if (route === '/admin/login') {
        const configured = await store.getCredential(slug);
        if (!configured) throw new AppError(t('a_palavra_passe_desta_mesa_2'), 503);
        await store.reserveAttempt(slug, 'login', 10);
        if (!await verifyPassword(data.password, configured.password_hash) || data.username !== 'mesa') throw new AppError(t('nome_de_utilizador_ou_palavra'), 401);
        const token = randomBytes(32).toString('hex');
        const duration = configured.must_change ? Math.min(sessionMs, 10 * 60 * 1000) : sessionMs;
        await store.saveSession(hashToken(token), slug, Date.now() + duration, credentialBinding(slug, configured.version), configured.version);
        response.setHeader('Set-Cookie', cookie(slug, token, Math.ceil(duration / 1000)));
        send(response, 200, { authenticated: !configured.must_change, setupRequired: Boolean(configured.must_change) }); return;
      }
      if (route.startsWith('/admin/')) {
        const session = await sessionFor(request, slug);
        if (!session) throw new AppError(t('entre_na_mesa_desta_assembleia'), 401);
        if (route === '/admin/logout') {
          const token = request.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith(`mesa_${slug}=`))?.split('=')[1];
          if (token) await store.deleteSession(hashToken(token));
          response.setHeader('Set-Cookie', cookie(slug, '', 0));
          send(response, 200, { authenticated: false }); return;
        }
        if (route === '/admin/password') {
          await store.reserveAttempt(slug, 'password', 10);
          const credential = await store.getCredential(slug);
          if (credential.version !== session.version) throw new AppError(t('password_changed_elsewhere'), 409);
          if (!session.setupRequired && !await verifyPassword(data.currentPassword, credential.password_hash)) throw new AppError(t('password_current_wrong'), 401);
          if (!newPasswordInput(data.password)) throw new AppError(t('password_length'));
          if (data.password !== data.confirmation) throw new AppError(t('password_mismatch'));
          if (await verifyPassword(data.password, credential.password_hash)) throw new AppError(t('password_must_differ'));
          const hash = await hashPassword(data.password), version = randomBytes(16).toString('hex'), token = randomBytes(32).toString('hex');
          await store.replaceCredential(session, hash, version, { hash: hashToken(token), expires: Date.now() + sessionMs, binding: credentialBinding(slug, version) });
          response.setHeader('Set-Cookie', cookie(slug, token, Math.ceil(sessionMs / 1000)));
          send(response, 200, { authenticated: true, setupRequired: false }); return;
        }
        if (session.setupRequired) throw new AppError(t('password_setup_required'), 403);
        if (route === '/admin/rooms') { send(response, 201, { room: await store.createRoom(slug, session) }); return; }
        const roomRoute = route.match(/^\/admin\/rooms\/([^/]+)(\/.*)$/);
        if (roomRoute) { roomId = roomRoute[1]; route = `/admin${roomRoute[2]}`; }
        if ((await store.getRoom(roomId)).assembly !== slug) throw new AppError(t('room_not_found'), 404);
        if (route === '/admin/proposals') { send(response, 201, await store.submit(roomId, data, session)); return; }
        const action = route.match(/^\/admin\/proposals\/(\d+)\/(open|counts|close)$/);
        if (!action) throw new AppError(t('acao_nao_encontrada'), 404);
        const id = Number(action[1]);
        if (action[2] === 'open') await store.open(roomId, id, session);
        if (action[2] === 'counts') await store.saveCounts(roomId, id, data, session);
        if (action[2] === 'close') await store.closeVoting(roomId, id, data, session);
        send(response, 200, { ok: true }); return;
      }
      throw new AppError(t('recurso_nao_encontrado'), 404);
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
