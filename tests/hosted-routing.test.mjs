import test from 'node:test';
import assert from 'node:assert/strict';
import { createHostedServer } from './helpers/hosted-server.mjs';
import { bootstrap, requests } from './helpers/http.mjs';

test('hosted mesa selection preserves a new proposal through opening and final publication', async t => {
  const server = await createHostedServer({ origin: 'http://127.0.0.1', passwords: bootstrap });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const { request, login, replace } = requests(server.address().port);
  const initial = await login();
  const { cookie } = await replace(initial.cookie);
  const create = title => request('/api/assemblies/lisboa/admin/proposals', { cookie, body: {
    title, description: 'Uma proposta fictícia para verificar a seleção e votação pela mesa.',
  } });
  const first = await create('Uma proposta anterior');
  const second = await create('Uma nova proposta');
  assert.equal(first.status, 201); assert.equal(second.status, 201);
  const id = second.data.id;
  const selected = () => request(`/api/assemblies/lisboa/admin/session?proposal=${id}`, { cookie });
  const snapshot = await selected();
  assert.equal(snapshot.status, 200);
  assert.equal(snapshot.data.selectedProposal, id, 'The hosted adapter must not fall back to the first proposal');
  assert.deepEqual(snapshot.data.proposals.map(item => item.id), [id]);
  assert.equal(snapshot.data.proposals[0].status, 'waiting');
  assert.equal((await request(`/api/assemblies/lisboa/admin/proposals/${id}/open`, { cookie, body: {} })).status, 200);
  assert.equal((await selected()).data.proposals[0].status, 'open');
  assert.equal((await request(`/api/assemblies/lisboa/admin/proposals/${id}/counts`, { cookie, body: { favor: 0, against: 0, abstain: 0, version: 0 } })).status, 200);
  assert.equal((await request(`/api/assemblies/lisboa/admin/proposals/${id}/close`, { cookie, body: { version: 1 } })).status, 200);
  assert.equal((await selected()).data.proposals[0].status, 'closed');
  assert.equal((await request(`/api/assemblies/lisboa/admin/session?proposal=999999`, { cookie })).status, 404);
  assert.equal((await request('/api/assemblies/porto/admin/session', { cookie })).data.authenticated, false);
});
