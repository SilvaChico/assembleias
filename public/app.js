import { t, translateDocument, locale } from './i18n.js';
import { icon, applyIcons } from './icons.js';
translateDocument();
applyIcons();
const choices = [{ key: 'favor', label: t('a_favor') }, { key: 'against', label: t('contra') }, { key: 'abstain', label: t('abstencao') }];
const $ = selector => document.querySelector(selector);
const number = value => new Intl.NumberFormat(locale).format(value);
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const countTotal = counts => choices.reduce((sum, { key }) => sum + (counts?.[key] || 0), 0);
const modal = $('#modal');
let slug = new URLSearchParams(location.search).get('assembleia') === 'porto' ? 'porto' : 'lisboa';
let view = location.hash === '#mesa' ? 'desk' : 'participant';
let state = { assembly: { name: t('assembleia_de_lisboa'), revision: -1 }, proposals: [], testMode: false };
let admin = { authenticated: false, configured: false };
let sort = 'arrival', lastFocus, toastTimer, pollTimer, epoch = 0, panelKey = '', dirtyCounts = false, sentVoteId = null;
let loading = true, inFlight = false;
let browserStorageAvailable = true;
const VOTE_TTL = 24 * 60 * 60 * 1000;
const voteKey = (id, city = slug) => `assembleias-voto-${city}-${id}`;
function readVoteRecord(id, city = slug) {
  try {
    const value = JSON.parse(localStorage.getItem(voteKey(id, city)) || 'null');
    if (value && value.expires > Date.now() && /^[a-f0-9]{64}$/.test(value.token)) return value;
    if (value) localStorage.removeItem(voteKey(id, city));
  } catch { browserStorageAvailable = false; }
  return null;
}
function cleanVoteRecords() {
  try {
    for (const key of Object.keys(localStorage).filter(key => key.startsWith('assembleias-voto-'))) {
      let value; try { value = JSON.parse(localStorage.getItem(key)); } catch {}
      if (!value || value.expires <= Date.now() || (key.startsWith(`assembleias-voto-${slug}-`) && key !== voteKey(active()?.id))) localStorage.removeItem(key);
    }
    const key = 'assembleias-storage-check'; localStorage.setItem(key, '1'); localStorage.removeItem(key);
  } catch { browserStorageAvailable = false; }
}
const grants = new Map();
// Room entry uses the SAME session cookie for everyone in the room, without individual identities.
const find = id => state.proposals.find(proposal => proposal.id === Number(id));
const active = () => state.proposals.find(proposal => proposal.status === 'open');
const statusText = { waiting: t('por_discutir'), open: t('votacao_aberta'), closed: t('votacao_encerrada') };
const isDesk = () => view === 'desk' && admin.authenticated;

async function api(route = '', { method = 'GET', body, admin: needsAdmin = false, city = slug } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let response;
  try { response = await fetch(`/api/assemblies/${city}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin', signal: AbortSignal.timeout(10000) }); }
  catch { throw new Error(method === 'POST' ? t('a_confirmacao_nao_chegou_nao') : t('ligacao_ao_servidor_interrompida_os')); }
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && !needsAdmin && route !== '/room/enter') grants.delete(city);
    const error = new Error(data.error || t('nao_foi_possivel_concluir_o')); error.status = response.status; throw error;
  }
  return data;
}
const post = (route, body = {}, admin = false) => api(route, { method: 'POST', body, admin });
async function sendBrowserVote(id, choice) {
  if (!choices.some(item => item.key === choice)) throw new Error(t('escolha_a_favor_contra_ou'));
  const city = slug;
  const send = async () => {
    let record = readVoteRecord(id, city);
    if (!record) {
      const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
      record = { token, expires: Date.now() + VOTE_TTL, sent: false };
      try { localStorage.setItem(voteKey(id, city), JSON.stringify(record)); } catch { throw new Error(t('nao_foi_possivel_guardar_o')); }
      // Best-effort coordination where Web Locks are unavailable, such as HTTP over a LAN.
      if (!navigator.locks) { await new Promise(resolve => setTimeout(resolve, 80)); record = readVoteRecord(id, city); }
    }
    if (!record) throw new Error(t('o_estado_temporario_do_navegador'));
    if (record.sent) return { alreadyRecorded: true };
    const result = await api(`/proposals/${id}/vote`, { method: 'POST', city, body: { choice, token: record.token } });
    try { localStorage.setItem(voteKey(id, city), JSON.stringify({ ...record, sent: true })); } catch { /* The server consumed this token; never generate a replacement for this submission. */ }
    return result;
  };
  return navigator.locks ? navigator.locks.request(`assembleias-voto-${city}-${id}`, send) : send();
}
function announce(message) {
  clearTimeout(toastTimer);
  $('#announcement').textContent = message; $('#announcement').classList.add('visible');
  toastTimer = setTimeout(() => $('#announcement').classList.remove('visible'), 6000);
}
function openModal(content) {
  lastFocus = document.activeElement;
  $('#modal-content').innerHTML = `<button type="button" class="close-button" data-action="dismiss" aria-label="${t('fechar_janela')}">${t('texto')}</button>${content}`;
  modal.showModal();
}
modal.addEventListener('close', () => { if (modal.open) return; $('#modal-content').replaceChildren(); if (lastFocus?.isConnected) lastFocus.focus(); });

async function refresh(force = false) {
  const currentEpoch = epoch, city = slug;
  try {
    const results = await Promise.allSettled([api('', { city }), ...(view === 'desk' ? [api('/admin/session', { admin: true, city })] : [])]);
    if (currentEpoch !== epoch) return;
    if (results[0].status === 'rejected') throw results[0].reason;
    const incoming = results[0].value;
    const hadRoom = grants.has(city);
    if (incoming.roomGranted) grants.set(city, true); else grants.delete(city);
    let nextAdmin = { ...admin };
    if (results[1]) {
      if (results[1].status === 'rejected') throw results[1].reason;
      nextAdmin = results[1].value;
      if (nextAdmin.authenticated) { incoming.proposals = nextAdmin.proposals; incoming.assembly = nextAdmin.assembly; }
    }
    if (incoming.assembly.revision < state.assembly.revision) return;
    const changed = force || loading || hadRoom !== grants.has(city) || incoming.assembly.revision !== state.assembly.revision || nextAdmin.authenticated !== admin.authenticated;
    const previousActive = active()?.id;
    state = incoming; admin = nextAdmin; loading = false;
    cleanVoteRecords();
    if (active() && readVoteRecord(active().id)?.sent) sentVoteId = active().id;
    if (sentVoteId && sentVoteId !== active()?.id) sentVoteId = null;
    $('#connection-notice').hidden = true;
    if (changed) render(force);
    if (previousActive !== active()?.id) announce(active() ? t('a_mesa_abriu_a_votacao', { v0: active().title }) : t('a_votacao_foi_encerrada_consulte'));
  } catch (error) {
    if (currentEpoch !== epoch) return;
    $('#connection-notice').hidden = false; $('#connection-notice').textContent = error.message;
  }
}

function render(force = false) {
  document.querySelectorAll('[data-view]').forEach(link => link.dataset.view === view ? link.setAttribute('aria-current', 'page') : link.removeAttribute('aria-current'));
  $('#assembly-select').value = slug; $('#assembly-name').textContent = state.assembly.name;
  $('#mode-label').textContent = state.testMode ? t('modo_de_teste_dados_ficticios') : t('versao_local_em_desenvolvimento');
  $('#mode-detail').textContent = t('restricao_de_repeticao_limitada_ao');
  $('#desk-notice').hidden = view !== 'desk';
  $('#desk-notice').innerHTML = isDesk() ? `<strong>${t('mesa_de')} ${slug === 'lisboa' ? t('lisboa') : t('porto')}</strong> ${t('as_acoes_sao_verificadas_pelo')} <button class="text-button" type="button" data-action="logout">${t('terminar_sessao')}</button>` : t('entre_com_a_palavra_passe');
  $('#proposal-count').textContent = state.proposals.length;
  const proposals = [...state.proposals].sort(sort === 'recent' ? (a, b) => b.id - a.id : (a, b) => a.id - b.id);
  $('#proposals').innerHTML = proposals.length ? proposals.map(proposal => `<article class="proposal-card ${proposal.status === 'open' ? 'is-open' : ''}" aria-labelledby="proposal-${proposal.id}"><div class="card-top"><span class="category">${escape(proposal.category)}</span><span class="status ${proposal.status}">${statusText[proposal.status]}</span></div><div class="proposal-body"><span class="proposal-number" aria-hidden="true">${String(proposal.id).padStart(2, '0')}</span><div><h3 id="proposal-${proposal.id}">${escape(proposal.title)}</h3><p>${escape(proposal.description)}</p></div></div><div class="card-footer"><span class="support-count"><strong>${number(proposal.supports)}</strong> ${t('apoios_a_discussao')}</span>${cardAction(proposal)}</div></article>`).join('') : `<div class="notice"><strong>${t('a_primeira_proposta_pode_ser')}</strong><br>${t('esta_assembleia_ainda_nao_tem')}</div>`;
  const proposal = active();
  const nextKey = `${view}:${slug}:${admin.authenticated}:${grants.has(slug)}:${proposal?.id}:${sentVoteId}:${state.testMode}:${admin.configured}:${state.roomConfigured}:${proposal?.countVersion}`;
  if (force || (nextKey !== panelKey && !(dirtyCounts && proposal?.id === Number($('#count-form')?.dataset.id) && isDesk()))) {
    panelKey = nextKey; dirtyCounts = false; renderVotingPanel();
  }
  const latest = state.proposals.filter(item => item.status === 'closed').sort((a, b) => b.closedOrder - a.closedOrder)[0];
  $('#latest-result').hidden = !latest;
  $('#latest-result').innerHTML = latest ? `<p class="eyebrow">${t('ultimo_resultado')}${state.testMode ? t('ficticio') : ''}</p><h2>${escape(latest.title)}</h2><div class="result-preview"><strong>${number(countTotal(latest.digital) + countTotal(latest.inPerson))}</strong><span>${t('votos_no_total')}<br>${t('digital_presencial')}</span></div><button class="text-button" type="button" data-action="result" data-id="${latest.id}">${t('consultar_contagem')} <span aria-hidden="true">→</span></button>` : '';
}
function cardAction(proposal) {
  if (proposal.status === 'closed') return `<button class="text-button" type="button" data-action="result" data-id="${proposal.id}">${t('ver_resultado')} <span aria-hidden="true">↗</span><span class="sr-only"> ${t('de')} ${escape(proposal.title)}</span></button>`;
  if (proposal.status === 'open') return `<button class="text-button" type="button" data-action="focus-voting">${t('ir_para_a_votacao')} <span aria-hidden="true">→</span></button>`;
  if (isDesk()) return `<button class="button small" type="button" data-action="open" data-id="${proposal.id}" ${active() ? 'disabled' : ''}>${t('abrir_votacao')}<span class="sr-only"> ${t('de')} ${escape(proposal.title)}</span></button>`;
  return `<button id="support-${proposal.id}" class="button small" type="button" data-action="support" data-id="${proposal.id}"><span aria-hidden="true">+</span> ${t('apoiar_discussao')}<span class="sr-only"> ${t('de')} ${escape(proposal.title)}</span></button>`;
}
function roomForm() {
  return `<form id="room-form" novalidate><label for="room-code">${t('codigo_anunciado_nesta_sala')}</label><input id="room-code" name="code" type="password" autocomplete="off" required maxlength="128"><p class="form-error on-dark" id="room-error" role="alert"></p><button class="button light full" type="submit">${t('entrar_na_sala')}</button></form><p class="panel-note">${t('apenas_para_participantes_presentes_o')}</p>`;
}
function renderVotingPanel() {
  if (view === 'desk' && !admin.authenticated) {
    $('#voting-panel').innerHTML = `<section class="voting-panel"><p class="eyebrow">${t('acesso_da_mesa')} ${slug === 'lisboa' ? t('lisboa') : t('porto')}</p><h2 id="voting-title" tabindex="-1">${t('gerir_a_assembleia')}</h2><p class="voting-description">${t('cada_assembleia_tem_uma_palavra')}</p><form id="login-form" novalidate><label for="login-username">${t('nome_de_utilizador')}</label><input id="login-username" name="username" value="mesa" readonly autocomplete="username"><label for="login-password">${t('palavra_passe_da_mesa')}</label><input id="login-password" name="password" type="password" autocomplete="current-password" required maxlength="1024"><p id="login-error" class="form-error on-dark" role="alert"></p><button class="button light full" type="submit" ${!admin.configured ? 'disabled' : ''}>${t('entrar_na_mesa')}</button></form>${!admin.configured ? `<p class="panel-note">${t('a_palavra_passe_desta_mesa')}</p>` : ''}</section>`;
    return;
  }
  const proposal = active();
  if (view === 'participant' && !grants.has(slug)) {
    $('#voting-panel').innerHTML = `<section class="voting-panel"><p class="eyebrow">${t('participacao_presencial')}</p><h2 id="voting-title" tabindex="-1">${t('entre_na_sala')}</h2><p class="voting-description">${t('pode_consultar_as_propostas_sem')}</p>${roomForm()}</section>`;
    return;
  }
  if (!proposal) {
    $('#voting-panel').innerHTML = `<section class="voting-panel empty-vote"><p class="eyebrow">${t('o_momento_de_decidir')}</p><div class="empty-symbol" aria-hidden="true">${icon('assembly')}</div><h2 id="voting-title" tabindex="-1">${t('a_conversa_vem_primeiro')}</h2><p>${t('nao_ha_uma_votacao_aberta')} ${isDesk() ? t('escolha_uma_proposta_na_lista') : t('explore_as_propostas_e_apoie')}</p><div class="panel-note">${t('uma_proposta_de_cada_vez')}<br>${t('os_resultados_ficam_visiveis_apos')}</div></section>`;
    return;
  }
  $('#voting-panel').innerHTML = `<section class="voting-panel active-vote"><p class="eyebrow"><span class="live-dot" aria-hidden="true"></span> ${t('votacao_aberta')}${state.testMode ? t('teste') : ''}</p><p class="voting-reference">${t('proposta')} ${String(proposal.id).padStart(2, '0')} / ${escape(proposal.category)}</p><h2 id="voting-title" tabindex="-1">${escape(proposal.title)}</h2><p class="voting-description">${escape(proposal.description)}</p>${isDesk() ? deskVote(proposal) : participantVote(proposal)}</section>`;
}
function participantVote(proposal) {
  if (sentVoteId === proposal.id) return `<div class="vote-received"><span aria-hidden="true">✓</span><h3>${t('voto_registado')}</h3><p>${t('aguarde_o_fecho_pela_mesa')}</p></div><p class="panel-note">${t('restricao_neste_navegador_durante_esta')}</p>`;
  if (!browserStorageAvailable) return `<p class="panel-note">${t('o_armazenamento_local_do_navegador')}</p>`;
  return `<form id="vote-form" data-id="${proposal.id}" novalidate><fieldset><legend>${t('qual_e_o_seu_voto')}${state.testMode ? t('de_teste') : ''}?</legend>${choices.map(({ key, label }, index) => `<label class="vote-option"><input type="radio" name="vote" value="${key}" required><span class="vote-option-label">${label}</span><span class="vote-option-mark" aria-hidden="true">${['+', '−', '○'][index]}</span></label>`).join('')}</fieldset><p class="form-error on-dark" id="vote-error" role="alert"></p><button class="button light full" type="submit">${t('registar_voto')}${state.testMode ? t('de_teste') : ''} <span aria-hidden="true">→</span></button></form><p class="panel-note">${t('o_envio_guarda_um_codigo')}</p>`;
}
function deskVote(proposal) {
  return `<p class="panel-note">${t('os_totais_digitais_so_ficam')}</p><div class="counting-section"><h3>${icon('count')}${t('contagem_presencial_publica')}</h3><p>${t('a_mesa_conta_os_cartoes')}</p><form id="count-form" data-id="${proposal.id}" data-version="${proposal.countVersion}" novalidate><fieldset><legend class="sr-only">${t('totais_de_votos_presenciais')}</legend>${choices.map(({ key, label }) => `<div class="count-field"><label for="count-${key}">${label}</label><input type="number" min="0" max="1000000" step="1" inputmode="numeric" id="count-${key}" name="${key}" value="${proposal.inPerson[key]}" required aria-describedby="count-hint count-error"></div>`).join('')}</fieldset><p class="panel-note" id="count-hint">${t('inteiros_de_0_a_1')}</p><p id="count-error" class="form-error on-dark" role="alert"></p><button class="button outline-light full" id="save-counts" type="submit">${proposal.inPersonRecorded ? t('atualizar_contagem') : t('guardar_contagem')}</button><p class="count-status" id="count-status" role="status">${proposal.inPersonRecorded ? t('contagem_guardada_votos_presenciais', { v0: number(countTotal(proposal.inPerson)) }) : t('contagem_por_confirmar_guarde_tambem')}</p><button class="text-button" type="button" data-action="reload-counts">${t('descartar_rascunho_e_reler_contagem')}</button></form></div><button class="button light full" type="button" data-action="close" data-id="${proposal.id}">${t('fechar_votacao_e_publicar')}</button><p class="panel-note">${t('a_publicacao_apresenta_a_contagem')}</p>`;
}
function showNewProposal() {
  if (!isDesk() && !grants.has(slug)) { announce(t('entre_com_o_codigo_de')); $('#voting-title')?.focus(); return; }
  openModal(`<p class="eyebrow">${t('uma_ideia_para')} ${slug === 'lisboa' ? t('lisboa') : t('porto')}</p><h2 id="modal-title">${t('nova_proposta')}</h2><p class="modal-intro">${t('escreva_o_que_propoe_e')}</p><form id="proposal-form" novalidate><label for="proposal-title">${t('titulo')} <span>${t('obrigatorio')}</span></label><input id="proposal-title" name="title" minlength="8" maxlength="120" required aria-describedby="title-hint proposal-error"><p class="field-hint" id="title-hint">${t('de_8_a_120_caracteres')}</p><label for="proposal-description">${t('descricao')} <span>${t('obrigatoria')}</span></label><textarea id="proposal-description" name="description" rows="4" minlength="20" maxlength="1200" required aria-describedby="description-hint proposal-error"></textarea><p class="field-hint" id="description-hint">${t('de_20_a_1200_caracteres')}</p><label for="proposal-category">${t('tema')}</label><select id="proposal-category" name="category"><option>${t('espaco_comum')}</option><option>${t('entreajuda')}</option><option>${t('atividades')}</option><option>${t('outros')}</option></select><p id="proposal-error" class="form-error" role="alert"></p><div class="modal-actions"><button class="button" type="button" data-action="dismiss">${t('cancelar')}</button><button class="button primary" type="submit">${t('submeter_proposta')}</button></div></form>`);
}
function showResult(id) {
  const proposal = find(id);
  if (proposal?.status !== 'closed') return;
  const digital = countTotal(proposal.digital), inPerson = countTotal(proposal.inPerson);
  openModal(`<p class="eyebrow">${t('votacao_encerrada')}${state.testMode ? t('dados_ficticios') : ''}</p><h2 id="modal-title">${t('resultado_da_contagem')}</h2><p class="result-proposal">${escape(proposal.title)}</p><div class="result-total"><strong>${number(digital + inPerson)}</strong><span>${t('votos_no_total')}</span></div><table class="results-table"><caption>${t('votos_por_opcao_e_via')}</caption><thead><tr><th scope="col">${t('opcao')}</th><th scope="col">${t('digital')}</th><th scope="col">${t('presencial')}</th><th scope="col">${t('total')}</th></tr></thead><tbody>${choices.map(({ key, label }) => `<tr><th scope="row">${label}</th><td>${number(proposal.digital[key])}</td><td>${number(proposal.inPerson[key])}</td><td><strong>${number(proposal.digital[key] + proposal.inPerson[key])}</strong></td></tr>`).join('')}</tbody><tfoot><tr><th scope="row">${t('total')}</th><td>${number(digital)}</td><td>${number(inPerson)}</td><td>${number(digital + inPerson)}</td></tr></tfoot></table><p class="field-hint">${t('a_mesa_introduz_a_contagem')}</p><div class="notice">${t('esta_contagem_nao_determina_aprovacao')}</div><div class="modal-actions"><button class="button primary" type="button" data-action="dismiss">${t('voltar_as_propostas')}</button></div>`);
}
function showAbout() {
  openModal(`<p class="eyebrow">${t('versao_local_em_desenvolvimento')}</p><h2 id="modal-title">${t('funcionamento_e_limites')}</h2><div class="about-copy"><p>${t('lisboa_e_porto_tem_propostas')}</p><h3>${t('o_que_fica_guardado')}</h3><p>${t('propostas_apoios_agregados_e_contagens')}</p><p>${t('a_aplicacao_nao_usa_geolocalizacao')}</p>${state.hosted ? `<p>${t('hosting_notice')}</p>` : ''}<h3>${t('acesso_de_participantes')}</h3><p>${t('o_codigo_de_sala_e')}</p><h3>${t('restricao_no_mesmo_navegador')}</h3><p>${t('ao_votar_guarda_se_localmente')}</p><p>${t('outros_navegadores_janelas_privadas_apagar')}</p><h3>${t('acesso_da_mesa_2')}</h3><p>${t('a_palavra_passe_e_verificada')}</p><h3>${t('voto_presencial_publico')}</h3><p>${t('a_assembleia_gere_os_cartoes')}</p><p class="notice">${t('esta_versao_ainda_nao_esta')}</p></div><div class="modal-actions"><button class="button primary" type="button" data-action="dismiss">${t('fechar')}</button></div>`);
}

document.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled || inFlight) return;
  const { action, id } = button.dataset;
  try {
    if (action === 'dismiss') modal.close();
    if (action === 'new') showNewProposal();
    if (action === 'about') showAbout();
    if (action === 'result') showResult(id);
    if (action === 'support') {
      if (!grants.has(slug)) { announce(t('entre_com_o_codigo_de_2')); $('#voting-title')?.focus(); return; }
      inFlight = true; button.disabled = true;
      await post(`/proposals/${id}/support`); await refresh();
      document.getElementById(`support-${id}`)?.focus(); announce(t('apoio_a_discussao_acrescentado_nao'));
    }
    if (action === 'focus-voting') { $('#voting-title')?.scrollIntoView({ block: 'start' }); $('#voting-title')?.focus({ preventScroll: true }); }
    if (action === 'reload-counts') { if (dirtyCounts && !confirm(t('descartar_as_alteracoes_por_guardar'))) return; dirtyCounts = false; await refresh(true); }
    if (action === 'logout') { inFlight = true; await post('/admin/logout', {}, true); admin.authenticated = false; await refresh(true); announce(t('sessao_da_mesa_terminada')); }
    if (action === 'open') {
      const proposal = find(id);
      openModal(`<p class="eyebrow">${t('mesa_abertura_de_votacao')}</p><h2 id="modal-title">${t('abrir_esta_votacao')}</h2><p class="result-proposal">${escape(proposal.title)}</p><p>${escape(proposal.description)}</p><div class="notice">${t('opcoes_a_favor_contra_e')}</div><p class="field-hint">${t('uma_votacao_de_cada_vez')}</p><p id="action-error" class="form-error" role="alert"></p><div class="modal-actions"><button class="button" type="button" data-action="dismiss">${t('cancelar')}</button><button class="button primary" type="button" data-action="confirm-open" data-id="${id}">${t('abrir_votacao_agora')}</button></div>`);
    }
    if (action === 'confirm-open') {
      inFlight = true; button.disabled = true;
      await post(`/admin/proposals/${id}/open`, {}, true); modal.close(); await refresh(true); $('#voting-title')?.focus(); announce(t('votacao_aberta_e_partilhada_com'));
    }
    if (action === 'close') {
      const proposal = active(), form = $('#count-form');
      if (dirtyCounts) { $('#count-error').textContent = t('ha_alteracoes_por_guardar_atualize'); $('#save-counts').focus(); return; }
      if (!proposal?.inPersonRecorded) { $('#count-error').textContent = t('guarde_primeiro_a_contagem_presencial'); $('#count-favor').focus(); return; }
      if (proposal.countVersion !== Number(form.dataset.version)) { $('#count-error').textContent = t('a_contagem_mudou_noutra_vista'); return; }
      openModal(`<p class="eyebrow">${t('mesa_fecho_de_votacao')}</p><h2 id="modal-title">${t('fechar_e_publicar_a_contagem')}</h2><p class="result-proposal">${escape(proposal.title)}</p><div class="notice"><strong>${number(countTotal(proposal.inPerson))} ${t('votos_presenciais_guardados')}</strong><br>${choices.map(({ key, label }) => `${label}: ${number(proposal.inPerson[key])}`).join(' · ')}.</div><p>${t('depois_de_fechar_deixam_de')}</p><p id="action-error" class="form-error" role="alert"></p><div class="modal-actions"><button class="button" type="button" data-action="dismiss">${t('continuar_votacao')}</button><button class="button primary" type="button" data-action="confirm-close" data-id="${id}" data-version="${proposal.countVersion}">${t('fechar_e_publicar')}</button></div>`);
    }
    if (action === 'confirm-close') {
      inFlight = true; button.disabled = true;
      await post(`/admin/proposals/${id}/close`, { version: Number(button.dataset.version) }, true); modal.close(); await refresh(true); $('#voting-title')?.focus(); announce(t('votacao_encerrada_o_resultado_esta')); showResult(id);
    }
  } catch (error) {
    if ($('#action-error')) $('#action-error').textContent = error.message; else announce(error.message);
    if (error.status === 401) await refresh(true);
  } finally { inFlight = false; if (button.isConnected) button.disabled = false; }
});

document.addEventListener('submit', async event => {
  event.preventDefault();
  if (inFlight) return;
  const form = event.target, data = Object.fromEntries(new FormData(form));
  const errors = { 'proposal-form': '#proposal-error', 'login-form': '#login-error', 'room-form': '#room-error', 'vote-form': '#vote-error', 'count-form': '#count-error' };
  const errorTarget = $(errors[form.id]);
  if (!errorTarget) return;
  errorTarget.textContent = '';
  form.querySelectorAll('[aria-invalid]').forEach(input => input.removeAttribute('aria-invalid'));
  if (form.id === 'proposal-form') {
    for (const name of ['title', 'description']) {
      const input = form.elements.namedItem(name);
      if (input.value.trim().length < input.minLength || input.value.trim().length > input.maxLength) {
        errorTarget.textContent = name === 'title' ? t('escreva_um_titulo_entre_8') : t('descreva_a_proposta_com_20');
        input.setAttribute('aria-invalid', 'true'); input.focus(); return;
      }
    }
  }
  const submit = form.querySelector('button[type="submit"]');
  inFlight = true; submit.disabled = true;
  try {
    if (form.id === 'login-form') { await post('/admin/login', data, true); form.elements.password.value = ''; await refresh(true); announce(t('sessao_da_mesa_iniciada_nesta')); $('#voting-title')?.focus(); }
    if (form.id === 'room-form') {
      await post('/room/enter', data); form.elements.code.value = '';
      grants.set(slug, true); await refresh(true); announce(t('entrada_na_sala_confirmada_o')); $('#voting-title')?.focus();
    }
    if (form.id === 'proposal-form') {
      const result = await post(isDesk() ? '/admin/proposals' : '/proposals', data, isDesk());
      modal.close(); await refresh(); const heading = document.getElementById(`proposal-${result.id}`); heading?.setAttribute('tabindex', '-1'); heading?.focus(); announce(t('proposta_submetida_ja_pode_receber'));
    }
    if (form.id === 'vote-form') {
      const votingId = Number(form.dataset.id), votingEpoch = epoch;
      const result = await sendBrowserVote(votingId, data.vote);
      if (votingEpoch === epoch) { sentVoteId = votingId; await refresh(true); $('#voting-title')?.focus(); }
      announce(result.alreadyRecorded ? t('este_navegador_ja_registou_um') : t('voto_registado_aguarde_o_fecho'));
    }
    if (form.id === 'count-form') {
      await post(`/admin/proposals/${form.dataset.id}/counts`, { ...data, version: Number(form.dataset.version) }, true);
      dirtyCounts = false; await refresh(true); $('#save-counts')?.focus(); announce(t('contagem_presencial_guardada_por_substituicao'));
    }
  } catch (error) {
    errorTarget.textContent = error.message;
    if (form.id === 'count-form') {
      const input = [...form.querySelectorAll('input')].find(input => !input.validity.valid || !/^(0|[1-9]\d*)$/.test(input.value));
      input?.setAttribute('aria-invalid', 'true'); input?.focus();
    } else form.querySelector('input:not([readonly])')?.focus();
  } finally { inFlight = false; if (submit.isConnected) submit.disabled = false; }
});

$('#sort').addEventListener('change', event => { sort = event.target.value; render(); });
document.addEventListener('input', event => { if (event.target.closest('#count-form')) { dirtyCounts = true; $('#count-status').textContent = t('alteracoes_por_guardar_guarde_antes'); } });
async function changeContext() {
  epoch++; panelKey = ''; dirtyCounts = false; sentVoteId = null; loading = true;
  admin = { authenticated: false, configured: false }; state = { ...state, proposals: [], assembly: { name: slug === 'lisboa' ? t('assembleia_de_lisboa') : t('assembleia_do_porto'), revision: -1 } };
  render(true); await refresh(true); $('#main').focus();
}
$('#assembly-select').addEventListener('change', async event => {
  if (dirtyCounts && !confirm(t('mudar_de_assembleia_e_descartar'))) { event.target.value = slug; return; }
  slug = event.target.value; const url = new URL(location.href); url.searchParams.set('assembleia', slug); history.replaceState(null, '', url); await changeContext();
});
window.addEventListener('hashchange', async () => {
  const nextView = location.hash === '#mesa' ? 'desk' : 'participant';
  if (nextView !== view) {
    if (dirtyCounts && !confirm(t('mudar_de_vista_e_descartar'))) { history.replaceState(null, '', '#mesa'); return; }
    view = nextView; epoch++; dirtyCounts = false; await refresh(true); $('#main').focus();
  }
});
window.addEventListener('beforeunload', event => { if (dirtyCounts) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('storage', event => { if (event.key?.startsWith(`assembleias-voto-${slug}-`)) { if (active() && readVoteRecord(active().id)?.sent) sentVoteId = active().id; render(); } });
async function poll() { await refresh(); pollTimer = setTimeout(poll, 2000); }
document.addEventListener('visibilitychange', () => { clearTimeout(pollTimer); if (!document.hidden) poll(); });
await refresh(true); pollTimer = setTimeout(poll, 2000);
