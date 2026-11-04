import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { request as httpRequest } from 'node:http';
import { createStore } from '../lib/store.mjs';
import { createApplication } from '../server.mjs';

const proposal = { title: 'Uma proposta para o bairro', description: 'Uma descrição concreta para experimentar a deliberação em conjunto.', category: 'Espaço comum' };
const token = () => randomBytes(32).toString('hex');
const zeros = { favor: 0, against: 0, abstain: 0 };

test('flow: submission, discussion support, per-assembly opening, voting and closed results', async () => {
  const store = (await createStore());
  try {
    const first = (await store.submit('lisboa', proposal)).id, second = (await store.submit('lisboa', proposal)).id, porto = (await store.submit('porto', proposal)).id;
    (await store.support('lisboa', first));
    assert.equal((await store.snapshot('lisboa')).proposals[0].supports, 1);
    await assert.rejects(async () => (await store.vote('lisboa', first, 'favor', token())), /não está aberta/);
    (await store.open('lisboa', first)); (await store.open('porto', porto));
    await assert.rejects(async () => (await store.open('lisboa', second)), /Fecha a votação/);
    await assert.rejects(async () => (await store.support('lisboa', first)), /fechados/);
    const browserToken = token();
    assert.deepEqual((await store.vote('lisboa', first, 'favor', browserToken)), { alreadyRecorded: false });
    assert.deepEqual((await store.vote('lisboa', first, 'against', browserToken)), { alreadyRecorded: true });
    (await store.vote('lisboa', first, 'abstain', token()));
    assert.equal((await store.voteRecorded('lisboa', first, browserToken)), true);
    for (const snapshot of [(await store.snapshot('lisboa')), (await store.snapshot('lisboa', { admin: true }))]) {
      assert.equal(snapshot.proposals[0].digital, undefined);
      assert.equal(snapshot.proposals[0].digitalTotal, undefined);
    }
    assert.equal((await store.snapshot('lisboa')).proposals[0].inPerson, undefined);
    await assert.rejects(async () => (await store.closeVoting('lisboa', first, { version: 0 })), /Guarda a contagem/);
    (await store.saveCounts('lisboa', first, { favor: '8', against: '2', abstain: '1', version: 0 }));
    await assert.rejects(async () => (await store.saveCounts('lisboa', first, { ...zeros, version: 0 })), /alterada/);
    (await store.saveCounts('lisboa', first, { favor: '8', against: '2', abstain: '1', version: 1 }));
    await assert.rejects(async () => (await store.closeVoting('lisboa', first, { version: 1 })), /contagem mudou/);
    (await store.closeVoting('lisboa', first, { version: 2 }));
    const result = (await store.snapshot('lisboa')).proposals[0];
    assert.deepEqual(result.digital, { favor: 1, against: 0, abstain: 1 });
    assert.deepEqual(result.inPerson, { favor: 8, against: 2, abstain: 1 });
    assert.equal(Object.values(result.digital).reduce((a,b) => a+b) + Object.values(result.inPerson).reduce((a,b) => a+b), 13);
    await assert.rejects(async () => (await store.vote('lisboa', first, 'favor', token())), /não está aberta/);
    await assert.rejects(async () => (await store.saveCounts('lisboa', first, { ...zeros, version: 2 })), /não está aberta/);
    await assert.rejects(async () => (await store.open('lisboa', first)), /Só pode abrir/);
    assert.equal((await store.snapshot('porto')).proposals[0].status, 'open');
    (await store.open('lisboa', second));
  } finally { (await store.close()); }
});

test('invalid counts preserve stored values; zero counts require confirmation', async () => {
  const store = (await createStore());
  try {
    const id = (await store.submit('lisboa', proposal)).id; (await store.open('lisboa', id));
    for (const invalid of [-1, 1.5, '', null, '1e2', 'Infinity', 'NaN', '01', ' 1 ', 1000001, Number.MAX_SAFE_INTEGER + 1]) {
      await assert.rejects(async () => (await store.saveCounts('lisboa', id, { ...zeros, favor: invalid, version: 0 })));
      assert.equal((await store.snapshot('lisboa', { admin: true })).proposals[0].countVersion, 0);
    }
    (await store.saveCounts('lisboa', id, { ...zeros, version: 0 })); (await store.closeVoting('lisboa', id, { version: 1 }));
    assert.deepEqual((await store.snapshot('lisboa')).proposals[0].inPerson, zeros);
  } finally { (await store.close()); }
});

test('restart persistence; temporary receipts stay separate from choices and are removed at closure', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'assembleias-persistence-')), filename = join(directory, 'state.sqlite');
  let store = (await createStore(filename));
  try {
    const id = (await store.submit('lisboa', proposal)).id, receipt = token(); (await store.open('lisboa', id)); (await store.vote('lisboa', id, 'favor', receipt)); (await store.close());
    store = (await createStore(filename));
    assert.equal((await store.voteRecorded('lisboa', id, receipt)), true);
    assert.deepEqual((await store.vote('lisboa', id, 'against', receipt)), { alreadyRecorded: true });
    const inspection = new DatabaseSync(filename);
    assert.deepEqual(inspection.prepare('PRAGMA table_info(active_vote_receipts)').all().map(row => row.name), ['proposal', 'token_hash']);
    assert.notEqual(inspection.prepare('SELECT token_hash FROM active_vote_receipts').get().token_hash, receipt);
    (await store.saveCounts('lisboa', id, { ...zeros, version: 0 })); (await store.closeVoting('lisboa', id, { version: 1 }));
    assert.equal(inspection.prepare('SELECT count(*) AS total FROM active_vote_receipts').get().total, 0);
    assert.equal((await store.snapshot('lisboa')).proposals[0].digital.favor, 1); inspection.close();
  } finally { (await store.close()); await rm(directory, { recursive: true, force: true }); }
});

async function fixture(t, options = {}) {
  const origin = 'http://127.0.0.1';
  const app = (await createApplication({ origin, passwords: { lisboa: 'test-lisboa-password', porto: 'test-porto-password' }, roomCodes: { lisboa: 'sala-lisboa', porto: 'sala-porto' }, ...options }));
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => app.server.close(resolve)); (await app.store.close()); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const request = async (path, { body, cookie, origin: requestOrigin = origin, method = body === undefined ? 'GET' : 'POST', host = '127.0.0.1' } = {}) => {
    return new Promise((resolve, reject) => {
      const req = httpRequest(base + path, { method, headers: { Host: host, Origin: requestOrigin, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) } }, response => {
        const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('error', reject);
        response.on('end', async () => {
          const headers = new Headers();
          for (const [key,value] of Object.entries(response.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({ status: response.statusCode, data: headers.get('Content-Type')?.includes('application/json') ? JSON.parse(text) : text, headers, cookie: response.headers['set-cookie']?.[0]?.split(';')[0] });
        });
      });
      req.on('error', reject); req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  };
  return { ...app, request };
}

test('API: assembly-scoped chair access, room code, origin and private files', async t => {
  const { store, request } = await fixture(t);
  const id = (await store.submit('lisboa', proposal)).id;
  assert.equal((await request(`/api/assemblies/lisboa/admin/proposals/${id}/open`, { body: {} })).status, 401);
  assert.equal((await request('/api/assemblies/lisboa/admin/login', { body: { username: 'mesa', password: 'test-porto-password' } })).status, 401);
  const login = await request('/api/assemblies/lisboa/admin/login', { body: { username: 'mesa', password: 'test-lisboa-password' } });
  assert.equal(login.status, 200); assert.match(login.headers.get('set-cookie'), /HttpOnly; SameSite=Strict; Path=\/api\/assemblies\/lisboa\/admin/);
  assert.equal((await request('/api/assemblies/porto/admin/session', { cookie: login.cookie })).data.authenticated, false);
  assert.equal((await request(`/api/assemblies/lisboa/admin/proposals/${id}/open`, { body: {}, cookie: login.cookie, origin: 'http://other.invalid' })).status, 403);
  assert.equal((await request(`/api/assemblies/porto/admin/proposals/${id}/open`, { body: {}, cookie: login.cookie })).status, 401);
  assert.equal((await request(`/api/assemblies/lisboa/admin/proposals/${id}/open`, { body: {}, cookie: login.cookie })).status, 200);
  assert.equal((await request('/api/rooms/proposals', { body: proposal })).status, 401);
  const enter = await request('/api/rooms/enter', { body: { code: 'sala-lisboa' } });
  const otherEnter = await request('/api/rooms/enter', { body: { code: 'sala-lisboa' } });
  assert.equal(enter.cookie, otherEnter.cookie); assert.match(enter.headers.get('set-cookie'), /HttpOnly/); assert.doesNotMatch(enter.headers.get('set-cookie'), /Max-Age/);
  assert.equal((await request('/api/assemblies/porto/proposals', { body: proposal, cookie: enter.cookie })).status, 404);
  const {category: _legacyCategory, ...withoutCategory} = proposal;
  const submitted = await request('/api/rooms/proposals', { body: withoutCategory, cookie: enter.cookie }); assert.equal(submitted.status, 201);
  const publicState = await request('/api/rooms/session', { cookie: enter.cookie }); assert.equal(publicState.data.proposals[0].digital, undefined); assert.equal(publicState.data.proposals.length, 2);
  assert.equal(publicState.data.proposals[0].category,'Espaço comum','Existing category data is preserved');
  assert.equal(publicState.data.proposals[1].category,'','A new proposal needs no category');
  assert.match(publicState.headers.get('content-security-policy'), /connect-src 'self'/);
  assert.equal(publicState.headers.get('permissions-policy'), 'geolocation=(), camera=(), microphone=()');
  assert.equal((await request('/mesa')).status, 200);
  assert.equal((await request('/mesa/')).status, 200);
  assert.equal((await request('/.env')).status, 404); assert.equal((await request('/lib/store.mjs')).status, 404);
  assert.equal((await request('/', { host: 'other.invalid' })).status, 403);
  await request('/api/assemblies/lisboa/admin/logout', { body: {}, cookie: login.cookie });
  assert.equal((await request('/api/assemblies/lisboa/admin/session', { cookie: login.cookie })).data.authenticated, false);
});

test('API: concurrent submissions of one token count once; closure rejects later votes', async t => {
  const { store, request } = await fixture(t);
  const id = (await store.submit('lisboa', proposal)).id; (await store.open('lisboa', id));
  const room = await request('/api/rooms/enter', { body: { code: 'sala-lisboa' } }); const receipt = token();
  const responses = await Promise.all(Array.from({ length: 20 }, () => request(`/api/rooms/proposals/${id}/vote`, { cookie: room.cookie, body: { choice: 'favor', token: receipt } })));
  assert.equal(responses.filter(item => item.data.alreadyRecorded === false).length, 1); assert.ok(responses.every(item => item.status === 200));
  assert.equal((await request(`/api/rooms/proposals/${id}/vote-status`, { cookie: room.cookie, body: { token: receipt } })).data.recorded, true);
  (await store.saveCounts('lisboa', id, { ...zeros, version: 0 })); (await store.closeVoting('lisboa', id, { version: 1 }));
  assert.equal((await store.snapshot('lisboa')).proposals[0].digital.favor, 1);
  assert.equal((await request(`/api/rooms/proposals/${id}/vote`, { cookie: room.cookie, body: { choice: 'against', token: receipt } })).status, 409);
});

test('missing passwords do not enable default access; expired sessions are rejected', async t => {
  const missing = await fixture(t, { passwords: {} });
  assert.equal((await missing.request('/api/assemblies/lisboa/admin/session')).data.configured, false);
  assert.equal((await missing.request('/api/assemblies/lisboa/admin/login', { body: { username: 'mesa', password: '' } })).status, 503);
  const short = await fixture(t, { sessionMs: 1 });
  const login = await short.request('/api/assemblies/lisboa/admin/login', { body: { username: 'mesa', password: 'test-lisboa-password' } });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal((await short.request('/api/assemblies/lisboa/admin/session', { cookie: login.cookie })).data.authenticated, false);
});

test('valid room entries are not capped by the shared failed-code limit', async t => {
  const { request } = await fixture(t);
  for (let i=0;i<35;i++) assert.equal((await request('/api/rooms/enter',{body:{code:'sala-lisboa'}})).status,200);
  for (let i=0;i<30;i++) assert.equal((await request('/api/rooms/enter',{body:{code:'wrong-code'}})).status,401);
  assert.equal((await request('/api/rooms/enter',{body:{code:'wrong-code'}})).status,429);
  assert.equal((await request('/api/rooms/enter',{body:{code:'sala-lisboa'}})).status,200);
});


test('room codes resolve globally and room/city boundaries protect every proposal action', async t => {
  const { store, request } = await fixture(t);
  const login = await request('/api/assemblies/lisboa/admin/login', { body: { username: 'mesa', password: 'test-lisboa-password' } });
  assert.equal((await request('/api/assemblies/lisboa/admin/rooms', { body: {} })).status, 401);
  const created = await request('/api/assemblies/lisboa/admin/rooms', { body: {}, cookie: login.cookie });
  assert.equal(created.status, 201);
  const firstRoom = created.data.room, secondRoom = await store.createRoom('lisboa'), portoRoom = await store.createRoom('porto');
  assert.equal(new Set([firstRoom.code, secondRoom.code, portoRoom.code]).size, 3);
  const enter = await request('/api/rooms/enter', { body: { code: `  ${firstRoom.code.toLowerCase()}  ` } });
  assert.equal(enter.data.room.id, firstRoom.id);
  const first = await request('/api/rooms/proposals', { body: proposal, cookie: enter.cookie });
  assert.equal(first.status, 201);
  const id = first.data.id;
  const other = (await store.submit(secondRoom.id, proposal)).id, porto = (await store.submit(portoRoom.id, proposal)).id;
  const waiting = (await store.submit(firstRoom.id, proposal)).id;
  assert.equal((await request(`/api/assemblies/lisboa/admin/rooms/${firstRoom.id}/proposals/${id}/open`, { body: {}, cookie: login.cookie })).status, 200);
  await store.open(secondRoom.id, other); await store.open(portoRoom.id, porto);
  assert.equal((await request(`/api/assemblies/lisboa/admin/rooms/${firstRoom.id}/proposals/${waiting}/open`, { body: {}, cookie: login.cookie })).status, 409);
  assert.equal((await request(`/api/assemblies/lisboa/admin/rooms/${portoRoom.id}/proposals`, { body: proposal, cookie: login.cookie })).status, 404);
  assert.equal((await request(`/api/assemblies/lisboa/admin/session?room=${portoRoom.id}`, { cookie: login.cookie })).status, 404);
  for (const action of ['support', 'vote', 'vote-status']) {
    assert.equal((await request(`/api/rooms/proposals/${other}/${action}`, { body: { choice: 'favor', token: token() }, cookie: enter.cookie })).status, 404);
  }
  const participant = await request('/api/rooms/session', { cookie: enter.cookie });
  assert.deepEqual(participant.data.proposals.map(item => item.id), [id, waiting]);
  assert.equal(participant.data.assembly.slug, 'lisboa');
  assert.equal(participant.data.rooms, undefined, 'Participants do not receive other room codes');
  const mesa = await request(`/api/assemblies/lisboa/admin/session?room=${firstRoom.id}`, { cookie: login.cookie });
  assert.equal(mesa.data.room.code, firstRoom.code);
  assert.ok(mesa.data.rooms.every(room => room.assembly === 'lisboa'));
  const anonymous = await request('/api/rooms/session');
  assert.equal(anonymous.data.roomGranted, false); assert.equal(anonymous.data.proposals, undefined);
  assert.equal((await request('/api/assemblies/lisboa')).status, 405, 'The legacy city read route cannot bypass room admission');
  const tampered = enter.cookie.replace(firstRoom.id, secondRoom.id);
  assert.equal((await request('/api/rooms/session', { cookie: tampered })).data.roomGranted, false);
  await request('/api/rooms/leave', { cookie: enter.cookie, body: {} });
  const reopen = await request('/api/rooms/enter', { body: { code: secondRoom.code } });
  assert.deepEqual((await request('/api/rooms/session', { cookie: reopen.cookie })).data.proposals.map(item => item.id), [other]);
});

test('ambiguous legacy codes fail closed and generated room codes remain stable across instances', async t => {
  const { store, request } = await fixture(t, { roomCodes: { lisboa: 'DUPLICATE', porto: ' duplicate ' } });
  assert.equal((await request('/api/rooms/enter', { body: { code: 'duplicate' } })).status, 401);
  for (const invalid of ['', null, 1234, {}, 'x'.repeat(129)]) assert.equal((await request('/api/rooms/enter', { body: { code: invalid } })).status, 401);
  const rooms = [...await store.listRooms('lisboa'), ...await store.listRooms('porto')];
  assert.equal(new Set(rooms.map(room => room.code)).size, 2);
  await store.initializeRooms({ lisboa: 'CHANGED', porto: 'CHANGED-TOO' });
  assert.deepEqual([...await store.listRooms('lisboa'), ...await store.listRooms('porto')], rooms);
  for (const room of rooms) assert.equal((await request('/api/rooms/enter', { body: { code: room.code } })).data.room.id, room.id);
});

test('additive legacy migration preserves all original data, receipts and mesa sessions across restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'assembleias-migration-')), filename = join(directory, 'state.sqlite');
  let store = await createStore(filename);
  const closed = (await store.submit('lisboa', proposal)).id, open = (await store.submit('lisboa', proposal)).id;
  await store.support('lisboa', closed); await store.open('lisboa', closed);
  await store.vote('lisboa', closed, 'against', token()); await store.saveCounts('lisboa', closed, { favor: 3, against: 2, abstain: 1, version: 0 });
  await store.closeVoting('lisboa', closed, { version: 1 }); await store.open('lisboa', open);
  const receipt = token(); await store.vote('lisboa', open, 'favor', receipt);
  await store.saveSession('test-session', 'lisboa', Date.now() + 60000, 'existing-credential-binding');
  await store.close();
  const inspection = new DatabaseSync(filename);
  // Reconstruct the exact previous schema by removing only the newly added structures.
  inspection.exec('DROP INDEX one_open_per_room; DROP INDEX proposals_room; ALTER TABLE proposals DROP COLUMN room; DROP TABLE rooms; CREATE UNIQUE INDEX one_open_per_assembly ON proposals(assembly) WHERE status = \'open\'');
  const original = inspection.prepare('SELECT * FROM proposals ORDER BY id').all().map(row => ({ ...row }));
  const sessions = inspection.prepare('SELECT * FROM admin_sessions').all().map(row => ({ ...row }));
  try {
    store = await createStore(filename); await store.initializeRooms({ lisboa: 'legacy-lisboa', porto: 'legacy-porto' });
    const migrated = inspection.prepare('SELECT * FROM proposals ORDER BY id').all().map(({ room, ...row }) => row);
    assert.deepEqual(migrated, original, 'Every preexisting proposal column is preserved, including category and final counts');
    assert.deepEqual(inspection.prepare('SELECT * FROM admin_sessions').all().map(row => ({ ...row })), sessions);
    assert.equal((await store.resolveRoom('legacy-lisboa')).id, 'lisboa');
    assert.equal(await store.voteRecorded('lisboa', open, receipt), true);
    assert.equal((await store.snapshot('lisboa')).proposals.find(item => item.id === closed).digital.against, 1);
    const next = await store.createRoom('lisboa'), nextProposal = (await store.submit(next.id, proposal)).id;
    await store.open(next.id, nextProposal);
    await store.close(); store = await createStore(filename);
    assert.equal((await store.resolveRoom(next.code)).id, next.id);
    assert.deepEqual((await store.snapshot(next.id)).proposals.map(item => item.id), [nextProposal]);
    assert.equal((await store.getSession('test-session')).binding, 'existing-credential-binding');
  } finally { inspection.close(); await store.close(); await rm(directory, { recursive: true, force: true }); }
});
