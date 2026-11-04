// Browser verification always uses isolated local fixtures and no production credentials.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { createApplication } from '../server.mjs';
import { createStore } from '../lib/store.mjs';

if (process.env.APP_URL) throw new Error('Browser tests must use isolated local fixtures, not APP_URL.');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const origin = 'http://127.0.0.1:4186', password = randomBytes(24).toString('hex');
const store = await createStore();
const { server } = await createApplication({ store, origin, testMode: true, passwords: { lisboa: password, porto: randomBytes(24).toString('hex') } });
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(4186, '127.0.0.1', resolve); });
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
  const chairContext = await browser.newContext({ viewport: { width: 1365, height: 1000 }, reducedMotion: 'reduce' });
  const participantContext = await browser.newContext({ viewport: { width: 375, height: 812 }, reducedMotion: 'reduce' });
  chairContext.setDefaultTimeout(15000); participantContext.setDefaultTimeout(15000);
  const chair = await chairContext.newPage(), participant = await participantContext.newPage();
  const errors = [], external = [];
  participantContext.on('page', watch); chairContext.on('page', watch);
  function watch(page) {
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (!request.url().startsWith(origin)) external.push(request.url()); });
  }
  [chair, participant].forEach(watch);
  const card = (page, title) => page.locator('article').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
  const entry = async (page, code) => { await page.locator('#vote-code').fill(code.toLowerCase()); await page.locator('#vote-code').press('Enter'); };
  const screenshot = async (page, filename) => {
    await page.waitForFunction(() => !document.querySelector('#announcement').classList.contains('visible'));
    await page.screenshot({ path: `test-results/${filename}.png`, fullPage: true });
  };
  const newProposal = async (page, title) => {
    await page.locator('[data-action=new]').click();
    await page.locator('#proposal-title').fill(title);
    await page.locator('#proposal-description').fill('Partilhar ferramentas e aprender a reparar objetos em conjunto, uma tarde por mês.');
    await page.locator('#proposal-form button[type=submit]').click();
    await card(page, title).waitFor();
  };
  const open = async title => {
    await card(chair, title).locator('[data-action=open]').click(); await chair.locator('[data-action=confirm-open]').click();
    await chair.locator('#announced-vote-code').waitFor();
    const code = await chair.locator('#announced-vote-code').innerText(); assert.match(code, /^[A-Z]{4}$/); return code;
  };
  const close = async () => {
    await chair.locator('#save-counts').click(); await chair.waitForFunction(() => !document.querySelector('#save-counts').disabled);
    await chair.locator('[data-action=close]').click(); await chair.locator('[data-action=confirm-close]').click();
    await chair.getByRole('heading', { name: 'Resultado da contagem', exact: true }).waitFor();
  };
  await mkdir('test-results', { recursive: true });
  await participant.goto(origin); await chair.goto(origin + '/mesa');
  assert.equal(new URL(chair.url()).pathname, '/mesa');
  assert.equal(await participant.locator('a[href*="mesa"], [data-view="desk"]').count(), 0);
  await participant.locator('#vote-entry-form').waitFor();
  assert.equal(await participant.locator('input:visible').count(), 1);
  assert.equal(await participant.locator('select').count(), 0);
  assert.equal(await participant.locator('#workspace').isVisible(), false);
  assert.equal(await participant.locator('#vote-code').getAttribute('maxlength'), '4');
  await screenshot(participant, 'vote-entry-mobile');
  await participant.locator('[data-action=about]').click();
  await participant.getByRole('dialog', { name: 'Privacidade e limites', exact: true }).waitFor();
  await participant.keyboard.press('Escape');
  assert.equal(await participant.locator('[data-action=about]').evaluate(element => element === document.activeElement), true);
  await entry(participant, 'A1CD');
  await participant.getByText('Código de proposta incorreto. Usa as quatro letras anunciadas pela mesa.', { exact: true }).waitFor();
  assert.equal(await participant.locator('#vote-code').evaluate(element => element === document.activeElement), true);
  assert.equal(await participant.locator('#workspace').isVisible(), false);
  await chair.locator('#login-password').fill('fictional-wrong-password'); await chair.locator('#login-password').press('Enter');
  await chair.getByText('Nome de utilizador ou palavra-passe incorretos.', { exact: true }).waitFor();
  await chair.locator('#login-password').fill(password); await chair.locator('#login-password').press('Enter');
  {
    await chair.getByRole('heading',{name:'Escolhe a palavra-passe da mesa',exact:true}).waitFor();
    assert.equal(await chair.locator('#workspace').isVisible(),false,'Temporary mesa access is restricted to password setup');
    assert.equal(await chair.locator('#room-management').isVisible(),false);
    await chair.setViewportSize({width:320,height:740});
    assert.equal(await chair.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Password setup fits a narrow phone');
    await chair.evaluate(()=>document.documentElement.style.fontSize='200%');
    assert.equal(await chair.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Password setup supports 200% text');
    await chair.evaluate(()=>document.documentElement.style.removeProperty('font-size'));
    await chair.setViewportSize({width:1365,height:1000});
    await chair.screenshot({path:'test-results/mesa-password-first.png',fullPage:true});
    await chair.locator('#new-password').fill('fictional-initial-chosen-passphrase');
    await chair.locator('#confirm-password').fill('fictional-initial-chosen-passphrase');
    await chair.locator('#password-form button[type=submit]').click();
    await chair.locator('[data-action=change-password]').waitFor();
    await chair.locator('[data-action=change-password]').click();
    await chair.getByRole('heading',{name:'Alterar palavra-passe',exact:true}).waitFor();
    await chair.setViewportSize({width:320,height:740});
    assert.equal(await chair.evaluate(()=>document.documentElement.scrollWidth<=innerWidth && document.querySelector('#modal').scrollWidth<=document.querySelector('#modal').clientWidth),true,'Password change fits a narrow phone');
    await chair.keyboard.press('Escape');
    assert.equal(await chair.locator('[data-action=change-password]').evaluate(element=>element===document.activeElement),true,'Closing password change restores focus');
    await chair.setViewportSize({width:1365,height:1000});
    await chair.locator('[data-action=change-password]').click();
    await chair.locator('#modal').screenshot({path:'test-results/mesa-password-change.png'});
    await chair.locator('#current-password').fill('fictional-wrong-current-passphrase');
    await chair.locator('#new-password').fill('fictional-updated-chosen-passphrase');
    await chair.locator('#confirm-password').fill('fictional-updated-chosen-passphrase');
    await chair.locator('#password-form button[type=submit]').click();
    await chair.getByText('A palavra-passe atual está incorreta.',{exact:true}).waitFor();
    assert.equal(await chair.locator('#current-password').evaluate(element=>element===document.activeElement),true,'Wrong current password receives keyboard focus');
    await chair.locator('#current-password').fill('fictional-initial-chosen-passphrase');
    await chair.locator('#password-form button[type=submit]').click();
    await chair.waitForFunction(()=>!document.querySelector('#modal').open);
    await chair.locator('[data-action=logout]').click();
    await chair.locator('#login-password').fill(password); await chair.locator('#login-form button[type=submit]').click();
    await chair.getByText('Nome de utilizador ou palavra-passe incorretos.',{exact:true}).waitFor();
    await chair.locator('#login-password').fill('fictional-updated-chosen-passphrase'); await chair.locator('#login-form button[type=submit]').click();
  }
  await chair.getByText('Ainda não há votação aberta.', { exact: true }).waitFor();
  assert.equal(await chair.locator('[data-action=create-room], #desk-room-select').count(), 0, 'Mesa navigation contains proposals only');
  await chair.locator('[data-action=new]').click();
  assert.equal(await chair.locator('[name=category]').count(), 0);
  await chair.locator('#proposal-title').fill('Curto'); await chair.locator('#proposal-form button[type=submit]').click();
  await chair.getByText('Escreve um título entre 8 e 120 caracteres.', { exact: true }).waitFor();
  await chair.keyboard.press('Escape');
  const title = 'Uma oficina aberta de reparação';
  await newProposal(chair, title);
  const proposalId = await chair.locator('#desk-proposal-select').inputValue();
  const proposalCode = await chair.locator('#room-context strong').innerText();
  assert.match(proposalCode, /^[A-Z]{4}$/);
  await entry(participant, proposalCode);
  await participant.getByRole('heading', { name: title, exact: true }).waitFor();
  assert.equal(await participant.locator('#vote-form').count(), 0, 'A proposal is readable before its voting period');
  await participant.getByText('A mesa ainda não abriu a votação.', { exact: true }).waitFor();
  await participant.locator('[data-action=support]').click();
  await participant.getByText('Apoio à discussão acrescentado. Não é um voto de aprovação.', { exact: true }).waitFor();
  await screenshot(participant, 'proposal-before-vote-mobile');
  await screenshot(chair, 'proposal-created-mesa');
  assert.doesNotMatch(await participant.locator('body').innerText(), /sala/i);
  assert.doesNotMatch(await chair.locator('body').innerText(), /sala/i);
  await chair.reload(); await card(chair, title).waitFor();
  await chair.locator('[data-action=new]').click();
  await chair.locator('#proposal-title').fill('Mais sombra para a assembleia');
  await chair.locator('#proposal-description').fill('Montar toldos amovíveis com materiais reutilizados, numa jornada coletiva.');
  await screenshot(chair, 'mesa-proposal-creation'); await chair.keyboard.press('Escape');
  const code = await open(title); assert.equal(code, proposalCode, 'Opening voting keeps the proposal code');
  await screenshot(chair, 'vote-code-mesa');
  assert.equal((await participant.evaluate(async () => (await fetch('/api/votes/session')).json())).voteGranted, true);
  assert.equal(await participant.locator('a[href="/propostas"]').count(), 0);
  assert.equal(await participant.locator('[data-action=new]:visible').count(), 0);
  await participant.locator('#vote-form').waitFor();
  assert.equal(await participant.locator('.proposals-section:visible, a:visible:not(.skip-link), [data-action=leave-room]:visible').count(), 0, 'An active vote has no in-app proposal switching');
  assert.equal(await participant.locator('#room-context strong').innerText(), code);
  await participant.evaluate(() => document.documentElement.style.fontSize = '200%');
  assert.equal(await participant.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await participant.evaluate(() => document.documentElement.style.removeProperty('font-size'));
  await screenshot(participant, 'active-vote-mobile');
  const otherTab = await participantContext.newPage(); await otherTab.goto(origin); await otherTab.locator('#vote-form').waitFor();
  await Promise.all([participant.locator('input[value=favor]').check(), otherTab.locator('input[value=against]').check()]);
  await Promise.all([participant.evaluate(() => document.querySelector('#vote-form').requestSubmit()), otherTab.evaluate(() => document.querySelector('#vote-form').requestSubmit())]);
  for (const page of [participant, otherTab]) await page.getByRole('heading', { name: 'Voto registado', exact: true }).waitFor();
  await participant.reload(); await participant.getByRole('heading', { name: 'Voto registado', exact: true }).waitFor();
  // Expire admission and the old receipt's former TTL, retaining the same browser storage.
  await participantContext.clearCookies({ name: 'votacao' });
  await participant.evaluate(() => { const key = Object.keys(localStorage).find(key => key.startsWith('assembleias-voto-')); const record = JSON.parse(localStorage.getItem(key)); record.expires = 1; record.sent = false; localStorage.setItem(key, JSON.stringify(record)); });
  await participant.goto(origin); await participant.locator('#vote-entry-form').waitFor(); await entry(participant, code);
  await participant.getByRole('heading', { name: 'Voto registado', exact: true }).waitFor();
  const snapshot = await participant.evaluate(async () => (await fetch('/api/votes/session')).json());
  assert.equal(snapshot.proposals.length, 1); assert.equal(snapshot.proposals[0].digital, undefined); assert.equal(snapshot.proposals[0].inPerson, undefined);
  await chair.locator('#count-favor').fill('-1'); await chair.locator('#save-counts').click();
  await chair.getByText('A favor: introduz um número inteiro igual ou superior a zero.', { exact: true }).waitFor();
  for (const [key, value] of Object.entries({ favor: '4', against: '2', abstain: '1' })) await chair.locator('#count-' + key).fill(value);
  await close();
  await participant.getByRole('heading', { name: 'Resultado da contagem', exact: true }).waitFor();
  assert.deepEqual(await participant.locator('tfoot td').allTextContents(), ['1', '7', '8']);
  assert.equal(await participant.locator('#vote-form').count(), 0);
  assert.equal(await participant.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('assembleias-voto-')).length), 0);
  await screenshot(participant, 'closed-result-mobile');
  await participant.reload(); await participant.getByRole('heading', { name: 'Resultado da contagem', exact: true }).waitFor();
  await chair.getByRole('button', { name: 'Volta às propostas', exact: true }).click();
  // A later vote in the same room never replaces the previous participant's final result.
  const retryTitle = 'Partilhar ferramentas na acampada'; await newProposal(chair, retryTitle); const retryCode = await open(retryTitle);
  await participant.reload(); await participant.getByRole('heading', { name: 'Resultado da contagem', exact: true }).waitFor();
  assert.equal(await participant.locator('.result-proposal').innerText(), title);
  await participant.locator('[data-action=leave-vote]').click(); await participant.locator('#vote-entry-form').waitFor();
  await entry(participant, retryCode); await participant.locator('#vote-form').waitFor();
  const voteRoute = '**/api/votes/proposals/*/vote';
  await participant.route(voteRoute, async route => { await route.fetch(); await route.abort('failed'); }, { times: 1 });
  await participant.locator('input[value=favor]').check(); await participant.locator('#vote-form button[type=submit]').click();
  await participant.getByText('A confirmação não chegou. Vê o estado ou confirma com a mesa antes de repetir.', { exact: true }).waitFor();
  await participant.reload(); await participant.getByRole('heading', { name: 'Voto registado', exact: true }).waitFor();
  await otherTab.reload(); await otherTab.getByRole('heading', { name: 'Voto registado', exact: true }).waitFor();
  await otherTab.route('**/api/**', route => route.abort('failed'));
  await close();
  await participant.getByRole('heading', { name: 'Resultado da contagem', exact: true }).waitFor();
  assert.deepEqual(await participant.locator('tfoot td').allTextContents(), ['1', '0', '1']);
  await otherTab.unroute('**/api/**'); await otherTab.reload();
  await otherTab.getByRole('heading', { name: 'Resultado da contagem', exact: true }).waitFor();
  assert.equal(await otherTab.locator('.result-proposal').innerText(), retryTitle, 'Reconnection after closure resumes the correct final result');
  // Let the mesa close before a queued participant submission reaches the server.
  await chair.getByRole('button', { name: 'Volta às propostas', exact: true }).click();
  const raceTitle = 'Uma proposta para verificar o fecho'; await newProposal(chair, raceTitle); const raceCode = await open(raceTitle);
  await participant.locator('[data-action=leave-vote]').click(); await entry(participant, raceCode); await participant.locator('#vote-form').waitFor();
  let pausedRoute, signalPaused; const paused = new Promise(resolve => { signalPaused = resolve; });
  await participant.route(voteRoute, route => { pausedRoute = route; signalPaused(); }, { times: 1 });
  await participant.locator('input[value=abstain]').check(); await participant.locator('#vote-form button[type=submit]').click(); await paused;
  await close(); await pausedRoute.continue();
  await participant.getByRole('heading', { name: 'Resultado da contagem', exact: true }).waitFor();
  assert.deepEqual(await participant.locator('tfoot td').allTextContents(), ['0', '0', '0']);
  const lateStatus = await participant.evaluate(async id => (await fetch(`/api/votes/proposals/${id}/vote`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ choice: 'favor', token: '0'.repeat(64) }) })).status, (await store.mesaProposals('lisboa')).proposalOptions.find(item => item.title === raceTitle).id);
  assert.equal(lateStatus, 409);
  for (const page of [participant]) {
    for (const size of [{ width: 375, height: 812 }, { width: 667, height: 375 }, { width: 320, height: 740 }]) {
      await page.setViewportSize(size); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `No overflow at ${size.width}px`);
    }
    const short = await page.locator('button:visible,select:visible,input:visible,a.text-button:visible').evaluateAll(elements => elements.filter(element => !element.disabled && (element.type === 'radio' ? element.closest('label') : element).getBoundingClientRect().height < 43).map(element => element.textContent));
    assert.deepEqual(short, []); assert.doesNotMatch(await page.locator('body').innerText(), /\b(você|Escolha|Escreva|Introduza|Aguarde|Guarde)\b/);
  }
  await chair.getByRole('button', { name: 'Volta às propostas', exact: true }).click();
  await newProposal(chair, 'Mais sombra no espaço da acampada');
  const secondProposal = await chair.locator('#desk-proposal-select').inputValue(); assert.notEqual(secondProposal, proposalId);
  assert.equal(await chair.getByRole('heading', { name: title, exact: true }).count(), 0);
  await chair.locator('#desk-proposal-select').selectOption(proposalId); await card(chair, title).waitFor();
  await chair.setViewportSize({ width: 375, height: 812 });
  assert.equal(await chair.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Mesa proposal selection fits mobile');
  await chair.locator('#assembly-select').selectOption('porto'); await chair.locator('#login-form').waitFor(); assert.equal(await chair.locator('#desk-proposal-select').isVisible(), false);
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log('Local browser flow passed: password setup/change, mesa-only proposal creation, four-character proposal entry before voting, focused voting, concurrent tabs, code re-entry, refresh/lost response recovery, close-during-submit, reconnect after closure, final combined totals, proposal/city boundaries and accessibility.');
} catch (error) {
  for (const [i, context] of browser?.contexts().entries() || []) for (const [j, page] of context.pages().entries()) {
    console.error(`Context ${i}, page ${j}:`, await page.evaluate(() => ({ action: document.querySelector('#action-error')?.textContent, connection: document.querySelector('#connection-notice')?.textContent })));
    await mkdir('test-results', { recursive: true }); await page.screenshot({ path: `test-results/failure-${i}-${j}.png`, fullPage: true }).catch(() => {});
  }
  throw error;
} finally {
  await browser?.close(); await new Promise(resolve => server.close(resolve)); await store.close();
}
