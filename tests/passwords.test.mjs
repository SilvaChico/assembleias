import test from 'node:test';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { start, requests, bootstrap, chosen } from './helpers/http.mjs';
import { createStore } from '../lib/store.mjs';
import { hashPassword, verifyPassword } from '../lib/passwords.mjs';

const path = '/api/assemblies/lisboa/admin';
const proposal = { title: 'Uma proposta fictícia', description: 'Uma descrição fictícia suficientemente longa para testar a preservação dos dados.' };
async function database(t) {
  const directory = await mkdtemp(join(tmpdir(), 'assembleias-passwords-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return join(directory, 'state.sqlite');
}

test('temporary access exposes setup only and requires a different, confirmed strong password', async t => {
  const app = await start(t), first = await app.login();
  assert.deepEqual(first.data, { authenticated: false, setupRequired: true });
  const state = (await app.session(first.cookie)).data;
  assert.equal(state.setupRequired, true); assert.equal(state.authenticated, false);
  for (const field of ['room', 'rooms', 'proposals', 'password_hash', 'version']) assert.equal(state[field], undefined);
  for (const route of ['/rooms', '/proposals', '/proposals/1/open', '/proposals/1/counts', '/proposals/1/close']) {
    assert.equal((await app.request(path + route, { cookie: first.cookie, body: {} })).status, 403);
  }
  assert.equal((await app.replace(first.cookie, 'short')).status, 400);
  assert.equal((await app.replace(first.cookie, chosen, { confirmation: 'different-confirmation' })).status, 400);
  assert.equal((await app.replace(first.cookie, bootstrap.lisboa)).status, 400);
  const ready = await app.replace(first.cookie);
  assert.equal(ready.status, 200); assert.equal(ready.data.authenticated, true);
  assert.equal((await app.session(first.cookie)).data.authenticated, false);
  assert.equal((await app.login()).status, 401);
  assert.equal((await app.login('lisboa', chosen)).status, 200);
  assert.equal((await app.session(ready.cookie)).data.authenticated, true);
  const credential = await app.store.getCredential('lisboa');
  assert.equal(credential.must_change, 0); assert.match(credential.password_hash, /^scrypt\$/);
  assert.equal(credential.password_hash.includes(chosen), false);
});

test('password changes require current password and confirmation; revoke other city sessions only', async t => {
  const app = await start(t), setup = await app.login(), portoSetup = await app.login('porto');
  const ready = await app.replace(setup.cookie), other = await app.login('lisboa', chosen);
  const porto = await app.replace(portoSetup.cookie, 'fictional-porto-chosen', {}, 'porto');
  const next = 'fictional-replacement-passphrase';
  assert.equal((await app.replace(ready.cookie, next, { currentPassword: 'wrong-current-password' })).status, 401);
  assert.equal((await app.replace(ready.cookie, next, { currentPassword: chosen, confirmation: 'mismatched-confirmation' })).status, 400);
  assert.equal((await app.session(other.cookie)).data.authenticated, true);
  assert.equal((await app.request(path + '/password', { cookie: ready.cookie, origin: 'https://other.invalid', body: { currentPassword: chosen, password: next, confirmation: next } })).status, 403);
  const changed = await app.replace(ready.cookie, next, { currentPassword: chosen });
  assert.equal(changed.status, 200);
  for (const cookie of [ready.cookie, other.cookie, setup.cookie]) {
    assert.equal((await app.session(cookie)).data.authenticated, false);
    assert.equal((await app.request(path + '/rooms', { cookie, body: {} })).status, 401);
  }
  assert.equal((await app.login('lisboa', chosen)).status, 401);
  assert.equal((await app.login()).status, 401);
  assert.equal((await app.login('lisboa', next)).status, 200);
  assert.equal((await app.session(changed.cookie)).data.authenticated, true);
  assert.equal((await app.session(porto.cookie, 'porto')).data.authenticated, true);
  assert.equal((await app.session(changed.cookie, 'porto')).data.authenticated, false);
});

test('concurrent setup and changes each have exactly one winner', async t => {
  const app = await start(t);
  const a = await app.login(), b = await app.login();
  const passwords = ['fictional-concurrent-first', 'fictional-concurrent-second'];
  const results = await Promise.all([app.replace(a.cookie, passwords[0]), app.replace(b.cookie, passwords[1])]);
  assert.equal(results.filter(result => result.status === 200).length, 1);
  assert.ok(results.filter(result => result.status !== 200).every(result => [401,409].includes(result.status)));
  const winner = results.findIndex(result => result.status === 200), current = passwords[winner];
  assert.equal((await app.login('lisboa', passwords[1-winner])).status, 401);
  const second = await app.login('lisboa', current);
  const changes = await Promise.all([
    app.replace(results[winner].cookie, 'fictional-change-first', { currentPassword: current }),
    app.replace(second.cookie, 'fictional-change-second', { currentPassword: current }),
  ]);
  assert.equal(changes.filter(result => result.status === 200).length, 1);
  assert.ok(changes.filter(result => result.status !== 200).every(result => [401,409].includes(result.status)));
  assert.equal((await app.login('lisboa', current)).status, 401);
});

test('database credentials and current sessions survive restart without environment passwords', async t => {
  const filename = await database(t), first = await start(t, { filename });
  const ready = await first.replace((await first.login()).cookie);
  const before = (await first.store.getCredential('lisboa')).password_hash;
  await first.stop();
  const restarted = await start(t, { filename, passwords: {} });
  assert.equal((await restarted.session(ready.cookie)).data.authenticated, true);
  assert.equal((await restarted.login()).status, 401);
  assert.equal((await restarted.login('lisboa', chosen)).status, 200);
  await restarted.stop();
  const rotated = await start(t, { filename, passwords: { lisboa: 'fictional-new-environment-secret' } });
  assert.equal((await rotated.store.getCredential('lisboa')).password_hash, before);
  assert.equal((await rotated.login('lisboa', 'fictional-new-environment-secret')).status, 401);
  assert.equal((await rotated.session(ready.cookie)).data.authenticated, true);
  await rotated.stop();
  const changedSecret = await start(t, { filename, passwords: {}, sessionSecret: 'fictional-rotated-session-secret' });
  assert.equal((await changedSecret.session(ready.cookie)).data.authenticated, false);
  assert.equal((await changedSecret.login('lisboa', chosen)).status, 200);
});

test('separate instances initialize once and observe replacement and revocation immediately', async t => {
  const filename = await database(t);
  const worker = new Worker(new URL('./helpers/server-worker.mjs', import.meta.url), { workerData: { filename } });
  const workerReady = once(worker, 'message');
  t.after(async () => { const stopped = once(worker, 'exit'); worker.postMessage('stop'); await stopped; });
  const [a, [port]] = await Promise.all([start(t, { filename }), workerReady]);
  const b = requests(port);
  const first = await a.login(), second = await b.login();
  const ready = await a.replace(first.cookie);
  assert.equal((await b.session(second.cookie)).data.setupRequired, false);
  assert.equal((await b.session(ready.cookie)).data.authenticated, true);
  assert.equal((await b.login()).status, 401);
  const changed = await b.replace(ready.cookie, 'fictional-across-instances', { currentPassword: chosen });
  assert.equal(changed.status, 200);
  assert.equal((await a.session(ready.cookie)).data.authenticated, false);
});

test('revocation also blocks an already-validated write and stale login session creation', async t => {
  const app = await start(t), ready = await app.replace((await app.login()).cookie);
  const credential = await app.store.getCredential('lisboa');
  const tokenHash = createHash('sha256').update(ready.cookie.split('=')[1]).digest('hex');
  const auth = { ...await app.store.getSession(tokenHash), tokenHash, version: credential.version };
  const room = await app.store.createRoom('lisboa');
  const id = (await app.store.submit(room.id, proposal)).id;
  await app.replace(ready.cookie, 'fictional-revoked-session', { currentPassword: chosen });
  await assert.rejects(app.store.createRoom('lisboa', auth), error => error.status === 401);
  await assert.rejects(app.store.submit(room.id, proposal, auth), error => error.status === 401);
  await assert.rejects(app.store.open(room.id, id, auth), error => error.status === 401);
  await app.store.open(room.id, id);
  await assert.rejects(app.store.saveCounts(room.id, id, { favor:0,against:0,abstain:0,version:0 }, auth), error => error.status === 401);
  await app.store.saveCounts(room.id, id, { favor:0,against:0,abstain:0,version:0 });
  await assert.rejects(app.store.closeVoting(room.id, id, { version:1 }, auth), error => error.status === 401);
  await assert.rejects(app.store.saveSession('fictional-stale-login', 'lisboa', Date.now()+60000, auth.binding, credential.version), error => error.status === 409);
});

test('credential migration preserves existing rooms, proposals, final results and active receipts', async t => {
  const filename = await database(t), store = await createStore(filename);
  await store.initializeRooms({ lisboa: 'fictional-legacy-code', porto: 'fictional-other-code' });
  const room = await store.createRoom('lisboa');
  const closed = (await store.submit(room.id, proposal)).id, active = (await store.submit(room.id, proposal)).id;
  await store.support(room.id, closed); await store.open(room.id, closed);
  await store.vote(room.id, closed, 'against', randomBytes(32).toString('hex'));
  await store.saveCounts(room.id, closed, { favor:3,against:2,abstain:1,version:0 }); await store.closeVoting(room.id, closed, { version:1 });
  await store.open(room.id, active);
  const receipt = randomBytes(32).toString('hex'); await store.vote(room.id, active, 'favor', receipt);
  await store.saveSession('fictional-pre-upgrade-session', 'lisboa', Date.now()+60000, 'old-binding');
  await store.close();
  const inspection = new DatabaseSync(filename);
  inspection.exec('DROP TABLE mesa_credentials');
  const tables = ['assemblies', 'rooms', 'proposals', 'active_vote_receipts'];
  const rows = () => tables.map(table => inspection.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map(row => ({...row})));
  const before = rows();
  const app = await start(t, { filename });
  assert.deepEqual(rows(), before);
  assert.equal(await app.store.getSession('fictional-pre-upgrade-session'), undefined);
  assert.equal(await app.store.voteRecorded(room.id, active, receipt), true);
  assert.equal((await app.login()).data.setupRequired, true);
  assert.equal((await app.store.snapshot(room.id)).proposals.find(item => item.id === closed).digital.against, 1);
  inspection.close();
});

test('operator recovery revokes sessions, requires replacement and never restores environment access', async t => {
  const app = await start(t), ready = await app.replace((await app.login()).cookie);
  const credential = await app.store.getCredential('lisboa'), temporary = 'fictional-recovery-temporary';
  await app.store.recoverCredential('lisboa', await hashPassword(temporary), credential.version, randomBytes(16).toString('hex'));
  assert.equal((await app.session(ready.cookie)).data.authenticated, false);
  assert.equal((await app.login()).status, 401);
  assert.equal((await app.login('lisboa', chosen)).status, 401);
  const recovery = await app.login('lisboa', temporary);
  assert.equal(recovery.data.setupRequired, true);
  const replaced = await app.replace(recovery.cookie, 'fictional-post-recovery-password');
  assert.equal(replaced.status, 200);
  assert.equal((await app.login('lisboa', temporary)).status, 401);
  await assert.rejects(app.store.recoverCredential('lisboa', await hashPassword(temporary), credential.version, 'stale-recovery'), error => error.status === 409);
});

test('salts differ for the same password; invalid encodings and oversized inputs fail closed', async () => {
  const [a, b] = await Promise.all([hashPassword(chosen), hashPassword(chosen)]);
  assert.notEqual(a, b); assert.equal(await verifyPassword(chosen, a), true);
  assert.equal(await verifyPassword('incorrect-fictional-password', a), false);
  assert.equal(await verifyPassword(chosen, 'scrypt$999999999$8$3$bad$bad'), false);
  assert.equal(await verifyPassword('a'.repeat(1025), a), false);
  assert.equal(await verifyPassword(null, a), false);
});
