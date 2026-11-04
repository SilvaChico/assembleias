// Use local, isolated fixtures by default. CI is never allowed to target a live deployment.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { createApplication } from '../server.mjs';
import { createStore } from '../lib/store.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const remote = Boolean(process.env.APP_URL);
if (process.env.CI && remote) throw new Error('CI browser tests must use isolated local fixtures, not APP_URL.');
const origin = process.env.APP_URL || 'http://127.0.0.1:4186';
const password = remote ? process.env.LISBOA_ADMIN_PASSWORD : randomBytes(24).toString('hex'), code = remote ? process.env.LISBOA_ROOM_CODE : randomBytes(8).toString('hex');
const store = remote ? null : await createStore();
const { server } = remote ? {} : await createApplication({ store, origin, passwords: { lisboa: password, porto: randomBytes(24).toString('hex') }, roomCodes: { lisboa: code, porto: randomBytes(8).toString('hex') } });
if(server) await new Promise((resolve,reject) => { server.once('error',reject); server.listen(4186,'127.0.0.1',resolve); });
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
  const chairContext = await browser.newContext({ viewport: { width: 1365, height: 1000 }, reducedMotion: 'reduce' });
  const participantContext = await browser.newContext({ viewport: { width: 375, height: 812 }, reducedMotion: 'reduce' });
  const chair = await chairContext.newPage(), participant = await participantContext.newPage();
  const errors = [], external = [];
  for (const page of [chair, participant]) {
    page.on('pageerror',error => errors.push(error.message));
    page.on('request',request => { if (!request.url().startsWith(origin)) external.push(request.url()); });
  }
  await participant.goto(origin); await chair.goto(origin+'/#mesa');
  await participant.locator('#room-code').fill(code); await participant.locator('#room-form button[type=submit]').click();
  await chair.locator('#login-password').fill(password); await chair.locator('#login-form button[type=submit]').click();
  await chair.getByText('A conversa vem primeiro.',{exact:true}).waitFor();
  await participant.locator('[data-action=new]').click();
  await participant.locator('#proposal-title').fill('Curto');
  await participant.locator('#proposal-form button[type=submit]').click();
  await participant.getByText('Escreva um título entre 8 e 120 caracteres.',{exact:true}).waitFor();
  const title = 'Uma oficina aberta de reparação · teste '+randomBytes(3).toString('hex');
  const card = (page, name = title) => page.locator('article').filter({has:page.getByRole('heading',{name,exact:true})});
  await participant.locator('#proposal-title').fill(title);
  await participant.locator('#proposal-description').fill('Partilhar ferramentas e aprender a reparar objetos em conjunto, uma tarde por mês.');
  await participant.locator('#proposal-form button[type=submit]').click();
  await card(participant).locator('[data-action=support]').click();
  await chair.getByRole('heading',{name:title,exact:true}).waitFor();
  await card(chair).locator('[data-action=open]').click(); await chair.locator('[data-action=confirm-open]').click();
  await participant.locator('#vote-form').waitFor();
  const otherTab = await participantContext.newPage(); await otherTab.goto(origin); await otherTab.locator('#vote-form').waitFor();
  await Promise.all([
    participant.locator('input[value=favor]').check(),
    otherTab.locator('input[value=against]').check(),
  ]);
  await Promise.all([
    participant.evaluate(()=>document.querySelector('#vote-form')?.requestSubmit()),
    otherTab.evaluate(()=>document.querySelector('#vote-form')?.requestSubmit()),
  ]);
  await participant.getByRole('heading',{name:'Voto registado.',exact:true}).waitFor();
  await otherTab.getByRole('heading',{name:'Voto registado.',exact:true}).waitFor();
  await participant.reload(); await participant.getByRole('heading',{name:'Voto registado.',exact:true}).waitFor();
  const current = await participant.evaluate(async()=> (await fetch('/api/assemblies/lisboa')).json());
  const currentProposal = current.proposals.find(item=>item.title===title);
  assert.equal(currentProposal.digital,undefined); assert.equal(currentProposal.inPerson,undefined); assert.equal(currentProposal.supports,1);
  assert.equal(await participant.locator('#room-form').count(),0);
  await chair.locator('#count-favor').fill('-1'); await chair.locator('#save-counts').click();
  await chair.getByText('A favor: introduza um número inteiro igual ou superior a zero.',{exact:true}).waitFor();
  for(const [key,value]of Object.entries({favor:'4',against:'2',abstain:'1'})) await chair.locator('#count-'+key).fill(value);
  await chair.locator('#save-counts').click(); await chair.getByText('Contagem guardada: 7 votos presenciais.',{exact:true}).waitFor();
  await chair.waitForFunction(()=>!document.querySelector('#save-counts').disabled);
  await chair.locator('#save-counts').click(); await chair.getByText('Contagem guardada: 7 votos presenciais.',{exact:true}).waitFor();
  await chair.waitForFunction(()=>!document.querySelector('#save-counts').disabled);
  await chair.locator('[data-action=close]').click(); await chair.locator('[data-action=confirm-close]').click();
  await chair.getByRole('heading',{name:'Resultado da contagem',exact:true}).waitFor();
  const result = await participant.evaluate(async()=> (await fetch('/api/assemblies/lisboa')).json());
  const closedProposal = result.proposals.find(item=>item.title===title);
  assert.equal(Object.values(closedProposal.digital).reduce((a,b)=>a+b),1);
  assert.deepEqual(closedProposal.inPerson,{favor:4,against:2,abstain:1});
  const lateVoteStatus = await participant.evaluate(async id => (await fetch(`/api/assemblies/lisboa/proposals/${id}/vote`,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({choice:'favor',token:'0'.repeat(64)})
  })).status,closedProposal.id);
  assert.equal(lateVoteStatus,409,'The authenticated participant browser cannot submit a late vote');
  const lateCountStatus = await chair.evaluate(async id => (await fetch(`/api/assemblies/lisboa/admin/proposals/${id}/counts`,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({favor:99,against:0,abstain:0,version:2})
  })).status,closedProposal.id);
  assert.equal(lateCountStatus,409,'The authenticated chair browser cannot change published physical counts');
  assert.deepEqual(await chair.locator('tfoot td').allTextContents(),['1','7','8']);
  await participant.locator('#latest-result [data-action=result]').waitFor();
  await participant.locator('#latest-result [data-action=result]').click();
  await participant.getByRole('heading',{name:'Resultado da contagem',exact:true}).waitFor();
  assert.deepEqual(await participant.locator('tfoot td').allTextContents(),['1','7','8']);
  assert.equal(await participant.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('assembleias-voto-')).length),0);
  await mkdir('test-results',{recursive:true});
  await participant.screenshot({path:'test-results/resultado-mobile.png',fullPage:false});
  await participant.getByRole('button',{name:'Voltar às propostas',exact:true}).click(); await chair.getByRole('button',{name:'Voltar às propostas',exact:true}).click();
  await chair.screenshot({path:'test-results/mesa-desktop.png',fullPage:true});
  // Lose the response after the database commits, then refresh and retry the same receipt.
  const retryTitle = 'Recuperação de ligação · teste '+randomBytes(3).toString('hex');
  await chair.locator('[data-action=new]').click();
  await chair.locator('#proposal-title').fill(retryTitle);
  await chair.locator('#proposal-description').fill('Proposta fictícia para verificar uma confirmação perdida e a retoma da ligação.');
  await chair.locator('#proposal-form button[type=submit]').click();
  await card(chair,retryTitle).locator('[data-action=open]').click(); await chair.locator('[data-action=confirm-open]').click();
  await participant.locator('#vote-form').waitFor();
  const voteRoute='**/api/assemblies/lisboa/proposals/*/vote';
  await participant.route(voteRoute,async route=>{await route.fetch();await route.abort('failed');},{times:1});
  await participant.locator('input[value=favor]').check(); await participant.locator('#vote-form button[type=submit]').click();
  await participant.getByText('A confirmação não chegou. Não repita automaticamente: verifique o estado e confirme com a mesa.',{exact:true}).waitFor();
  await participant.reload(); await participant.locator('#vote-form').waitFor();
  await participant.locator('input[value=against]').check(); await participant.locator('#vote-form button[type=submit]').click();
  await participant.getByRole('heading',{name:'Voto registado.',exact:true}).waitFor();
  await otherTab.route('**/api/**',route=>route.abort('failed'));
  await chair.locator('#save-counts').click(); await chair.waitForFunction(()=>!document.querySelector('#save-counts').disabled);
  await chair.locator('[data-action=close]').click(); await chair.locator('[data-action=confirm-close]').click();
  await chair.getByRole('heading',{name:'Resultado da contagem',exact:true}).waitFor();
  assert.deepEqual(await chair.locator('tfoot td').allTextContents(),['1','0','1']);
  const retryResult=await participant.evaluate(async()=>(await fetch('/api/assemblies/lisboa')).json());
  assert.deepEqual(retryResult.proposals.find(item=>item.title===retryTitle).digital,{favor:1,against:0,abstain:0});
  await otherTab.unroute('**/api/**'); await otherTab.reload();
  await otherTab.getByRole('heading',{name:'A conversa vem primeiro.',exact:true}).waitFor();
  assert.equal(await otherTab.locator('#vote-form').count(),0);
  await chair.getByRole('button',{name:'Voltar às propostas',exact:true}).click();
  for(const size of [{width:375,height:812},{width:667,height:375},{width:320,height:740}]) {
    await participant.setViewportSize(size);
    assert.equal(await participant.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`No overflow at ${size.width}px`);
  }
  const controls=await participant.locator('button:visible,select:visible,input:visible,nav a:visible').evaluateAll(elements=>elements.filter(element=>!element.disabled).map(element=>({name:element.textContent.trim(),height:(element.type==='radio'?element.closest('label'):element).getBoundingClientRect().height})));
  assert.deepEqual(controls.filter(item=>item.height<43),[],'Interactive targets are at least 44px high');
  await participant.locator('#assembly-select').selectOption('porto');
  await participant.locator('#room-form').waitFor();
  assert.equal(await participant.getByRole('heading',{name:title,exact:true}).count(),0);
  await chair.locator('#assembly-select').selectOption('porto'); await chair.locator('#login-form').waitFor();
  assert.deepEqual(errors,[]); assert.deepEqual(external,[]);
  console.log(`${remote?'Hosted':'Local'} browser flow passed: isolated chair/participant contexts, concurrent tabs, refresh, lost response and idempotent retry, reconnect after closure, combined totals, city isolation, network requests and mobile sizes.`);
} catch(error) {
  for(const [index,context]of browser?.contexts().entries()||[]) for(const [pageIndex,page]of context.pages().entries()) {
    console.error(`Context ${index}, page ${pageIndex}:`, await page.evaluate(()=>({action:document.querySelector('#action-error')?.textContent,connection:document.querySelector('#connection-notice')?.textContent})));
    await mkdir('test-results',{recursive:true}); await page.screenshot({path:`test-results/falha-${index}-${pageIndex}.png`,fullPage:true}).catch(()=>{});
  }
  throw error;
} finally {
  await browser?.close(); if(server) await new Promise(resolve=>server.close(resolve)); if(store) await store.close();
}
