import test from 'node:test';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createStore } from '../lib/store.mjs';
import { start, requests } from './helpers/http.mjs';

const proposal = { title: 'Uma proposta de teste', description: 'Uma ideia fictícia para verificar os percursos de votação.' };
const token = () => randomBytes(32).toString('hex');
const zeros = { favor: 0, against: 0, abstain: 0 };
async function open(store, room = 'lisboa') {
  const { id } = await store.submit(room, proposal); await store.open(room, id);
  return { id, code: (await store.snapshot(room, { admin: true })).proposals.find(item => item.id === id).voteCode };
}
const enter = (request, code, cookie) => request('/api/votes/enter', { body: { code }, cookie });
const vote = (request, id, cookie, receipt = token()) => request(`/api/votes/proposals/${id}/vote`, { cookie, body: { choice: 'favor', token: receipt } });

test('vote codes reserve collisions globally, never recycle closed codes, and roll back allocation failure', async t => {
  const candidates = ['ABCD', 'ABCD', 'EFGH'];
  const store = await createStore(':memory:', { voteCodeGenerator: () => candidates.shift() || 'ABCD' });
  t.after(() => store.close());
  const first = await open(store), second = await open(store, 'porto');
  assert.equal(first.code, 'ABCD'); assert.equal(second.code, 'EFGH');
  await store.saveCounts('lisboa', first.id, { ...zeros, version: 0 }); await store.closeVoting('lisboa', first.id, { version: 1 });
  const next = await store.submit('lisboa', proposal);
  await assert.rejects(store.open('lisboa', next.id), error => error.status === 503);
  assert.equal((await store.snapshot('lisboa')).proposals.find(item => item.id === next.id).status, 'waiting');
  assert.equal((await store.resolveVote(' abcd ')).id, first.id);
  assert.equal((await store.resolveVote('abcd')).status, 'closed');
  await assert.rejects(store.open('lisboa', first.id), error => error.status === 409);
});

test('vote entry validates exactly four ASCII letters, has no identity, and valid entry survives failed-attempt limits', async t => {
  const { store, request } = await start(t, { passwords: {} });
  const current = await open(store);
  for (const code of ['', null, 1234, {}, ['ABCD'], 'ABC', 'ABCDE', 'A1CD', 'ÁBCD', 'ßAB', 'AB C', 'ＡＢＣＤ']) {
    assert.equal((await enter(request, code)).status, 401);
  }
  for (let i = 0; i < 35; i++) assert.equal((await enter(request, current.code.toLowerCase())).status, 200);
  const first = await enter(request, current.code), second = await enter(request, ` ${current.code} `);
  assert.equal(first.cookie, second.cookie, 'The admission cookie is shared, not a participant identifier');
  assert.equal((await enter(request, current.code, first.cookie)).cookie, first.cookie, 'Re-entry does not create a voting receipt');
  for (let i = 0; i < 30; i++) await enter(request, '1234');
  assert.equal((await enter(request, '1234')).status, 429);
  assert.equal((await enter(request, current.code)).status, 200);
  assert.equal((await enter(request, current.code, undefined)).status, 200);
  assert.equal((await request('/api/votes/enter', { origin: 'http://elsewhere.invalid', body: { code: current.code } })).status, 403);
});

test('proposal admission isolates same-city rooms and cities; room access cannot vote or reveal voting codes', async t => {
  const { store, request } = await start(t, { passwords: {}, roomCodes: { lisboa: 'proposal-room', porto: 'porto-room' } });
  const otherRoom = await store.createRoom('lisboa');
  const first = await open(store), other = await open(store, otherRoom.id), porto = await open(store, 'porto');
  const room = await request('/api/rooms/enter', { body: { code: 'proposal-room' } });
  const entry = await enter(request, first.code);
  assert.equal((await vote(request, first.id, room.cookie)).status, 401);
  assert.equal((await request(`/api/rooms/proposals/${first.id}/vote`, { cookie: room.cookie, body: { choice: 'favor', token: token() } })).status, 404);
  const roomSnapshot = (await request('/api/rooms/session', { cookie: room.cookie })).data;
  assert.equal(roomSnapshot.proposals[0].voteCode, undefined);
  for (const target of [other, porto]) {
    assert.equal((await vote(request, target.id, entry.cookie)).status, 404);
    assert.equal((await request(`/api/votes/proposals/${target.id}/vote-status`, { cookie: entry.cookie, body: { token: token() } })).status, 404);
    assert.equal((await enter(request, target.code, entry.cookie)).status, 409);
  }
  assert.equal((await request('/api/votes/leave', { cookie: entry.cookie, body: {} })).status, 409);
  const snapshot = (await request('/api/votes/session', { cookie: entry.cookie })).data;
  assert.deepEqual(snapshot.proposals.map(item => item.id), [first.id]);
  assert.deepEqual(snapshot.room, { id: 'lisboa' });
  assert.equal(snapshot.rooms, undefined); assert.equal(snapshot.room.code, undefined);
  assert.equal(snapshot.proposals[0].digital, undefined); assert.equal(snapshot.proposals[0].inPerson, undefined);
  assert.equal((await store.snapshot('lisboa', { admin: true })).proposals[0].digital, undefined);
  assert.equal((await request('/api/votes/session', { cookie: entry.cookie.replace(first.code, other.code) })).data.voteGranted, false);
  assert.equal((await request('/api/votes/session')).data.proposals, undefined);
  assert.equal((await request('/api/votes/proposals', { cookie: entry.cookie, body: proposal })).status, 404);
  assert.equal((await request('/api/rooms/proposals', { cookie: room.cookie, body: proposal })).status, 403);
});

test('re-entered proposal codes retain receipt idempotency; close races are atomic and old grants stay on their final result', async t => {
  const { store, request } = await start(t, { passwords: {} });
  const current = await open(store), receipt = token();
  const admitted = await enter(request, current.code);
  const again = await enter(request, current.code.toLowerCase(), admitted.cookie);
  const responses = await Promise.all(Array.from({ length: 20 }, () => vote(request, current.id, again.cookie, receipt)));
  assert.equal(responses.filter(response => response.data.alreadyRecorded === false).length, 1);
  assert.equal((await request(`/api/votes/proposals/${current.id}/vote-status`, { cookie: admitted.cookie, body: { token: receipt } })).data.recorded, true);
  await store.saveCounts('lisboa', current.id, { favor: 3, against: 2, abstain: 1, version: 0 });
  const [racing] = await Promise.all([vote(request, current.id, admitted.cookie), store.closeVoting('lisboa', current.id, { version: 1 })]);
  assert.ok([200, 409].includes(racing.status));
  const final = (await request('/api/votes/session', { cookie: admitted.cookie })).data;
  assert.equal(final.proposals[0].status, 'closed');
  assert.equal(final.proposals[0].digital.favor, racing.status === 200 ? 2 : 1);
  assert.deepEqual(final.proposals[0].inPerson, { favor: 3, against: 2, abstain: 1 });
  assert.equal((await vote(request, current.id, admitted.cookie)).status, 409);
  assert.equal((await request(`/api/votes/proposals/${current.id}/vote-status`, { cookie: admitted.cookie, body: { token: receipt } })).status, 409);
  const next = await open(store);
  assert.notEqual(next.code, current.code);
  assert.deepEqual((await request('/api/votes/session', { cookie: admitted.cookie })).data.proposals, final.proposals, 'A later vote cannot replace the closed proposal');
  assert.equal((await vote(request, next.id, admitted.cookie)).status, 404);
  assert.equal((await enter(request, current.code)).status, 200);
  assert.equal((await request('/api/votes/leave', { cookie: admitted.cookie, body: {} })).status, 200);
  assert.equal((await enter(request, next.code, admitted.cookie)).status, 200);
});

test('additive vote migration preserves legacy content, counts, active receipts and the password lifecycle across restart', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'assembleias-vote-migration-')), filename = join(directory, 'state.sqlite');
  t.after(() => rm(directory, { recursive: true, force: true }));
  const first = await start(t, { filename, roomCodes: { lisboa: 'existing-room' } });
  const chair = await first.replace((await first.login()).cookie);
  const closed = await open(first.store); await first.store.saveCounts('lisboa', closed.id, { ...zeros, version: 0 }); await first.store.closeVoting('lisboa', closed.id, { version: 1 });
  const active = await open(first.store), receipt = token(); await first.store.vote('lisboa', active.id, 'against', receipt);
  const before = await first.store.snapshot('lisboa');
  await first.stop();
  const db = new DatabaseSync(filename);
  const credentials = db.prepare('SELECT * FROM mesa_credentials').all(), sessions = db.prepare('SELECT * FROM admin_sessions').all();
  db.exec('DROP TABLE vote_codes'); db.close();
  const restarted = await start(t, { filename, passwords: {}, roomCodes: { lisboa: 'changed-environment' } });
  assert.deepEqual(await restarted.store.snapshot('lisboa'), before);
  assert.equal((await restarted.session(chair.cookie)).data.authenticated, true);
  assert.equal(await restarted.store.voteRecorded('lisboa', active.id, receipt), true);
  const newCode = (await restarted.store.snapshot('lisboa', { admin: true })).proposals.find(item => item.id === active.id).voteCode;
  const admitted = await enter(restarted.request, newCode);
  assert.equal((await vote(restarted.request, active.id, admitted.cookie, receipt)).data.alreadyRecorded, true);
  await restarted.stop();
  const stable = await createStore(filename);
  assert.equal((await stable.resolveVote(newCode)).id, active.id);
  await stable.close();
  const inspection = new DatabaseSync(filename);
  assert.deepEqual(inspection.prepare('SELECT * FROM mesa_credentials').all(), credentials);
  assert.deepEqual(inspection.prepare('SELECT * FROM admin_sessions').all(), sessions); inspection.close();
});

test('only a current authorized mesa creates proposals in its own city and room', async t => {
  const app = await start(t, { roomCodes: { lisboa: 'legacy-room' } });
  const ready = await app.replace((await app.login()).cookie), current = await open(app.store);
  const room = await app.request('/api/rooms/enter', { body: { code: 'legacy-room' } });
  const participant = await enter(app.request, current.code);
  for (const cookie of [undefined, room.cookie, participant.cookie]) {
    assert.equal((await app.request('/api/rooms/proposals', { cookie, body: proposal })).status, 403);
    assert.equal((await app.request('/api/votes/proposals', { cookie, body: proposal })).status >= 400, true);
    assert.equal((await app.request('/api/assemblies/lisboa/admin/proposals', { cookie, body: proposal })).status, 401);
    assert.equal((await app.request('/api/assemblies/lisboa/proposals', { cookie, body: proposal })).status, 404);
  }
  const allowed = await app.request('/api/assemblies/lisboa/admin/rooms/lisboa/proposals', { cookie: ready.cookie, body: proposal });
  assert.equal(allowed.status, 201);
  const portoRoom = await app.store.createRoom('porto');
  assert.equal((await app.request(`/api/assemblies/lisboa/admin/rooms/${portoRoom.id}/proposals`, { cookie: ready.cookie, body: proposal })).status, 404);
  assert.equal((await app.request('/api/assemblies/porto/admin/proposals', { cookie: ready.cookie, body: proposal })).status, 401);
  const replacement = await app.replace(ready.cookie, 'another-fictional-passphrase', { currentPassword: 'fictional-chosen-passphrase' });
  assert.equal(replacement.status, 200);
  assert.equal((await app.request('/api/assemblies/lisboa/admin/proposals', { cookie: ready.cookie, body: proposal })).status, 401);
  assert.equal((await app.request('/api/assemblies/lisboa/admin/proposals', { cookie: replacement.cookie, body: proposal })).status, 201);
});

test('independent server instances serialize colliding code allocations and duplicate receipt submissions', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'assembleias-vote-workers-')), filename = join(directory, 'state.sqlite');
  const setup = await createStore(filename), otherRoom = await setup.createRoom('porto');
  const first = (await setup.submit('lisboa', proposal)).id, second = (await setup.submit(otherRoom.id, proposal)).id;
  await setup.close();
  const workers = [
    new Worker(new URL('./helpers/vote-worker.mjs', import.meta.url), { workerData: { filename, room: 'lisboa', proposal: first } }),
    new Worker(new URL('./helpers/vote-worker.mjs', import.meta.url), { workerData: { filename, room: otherRoom.id, proposal: second } }),
  ];
  t.after(async () => { await Promise.all(workers.map(async worker => { const stopped = once(worker, 'exit'); worker.postMessage('stop'); await stopped; })); await rm(directory, { recursive: true, force: true }); });
  const ports = await Promise.all(workers.map(async worker => (await once(worker, 'message'))[0]));
  const [a, b] = ports.map(requests);
  const firstEntry = await enter(a.request, 'ABCD'), snapshot = (await a.request('/api/votes/session', { cookie: firstEntry.cookie })).data;
  const id = snapshot.proposals[0].id;
  const secondEntry = await enter(b.request, 'EFGH');
  assert.notEqual((await b.request('/api/votes/session', { cookie: secondEntry.cookie })).data.proposals[0].id, id);
  const receipt = token();
  const results = await Promise.all(Array.from({ length: 20 }, (_, index) => vote(index % 2 ? a.request : b.request, id, firstEntry.cookie, receipt)));
  assert.ok(results.every(result => result.status === 200));
  assert.equal(results.filter(result => !result.data.alreadyRecorded).length, 1);
});
