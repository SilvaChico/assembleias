import { t, translateDocument, locale } from './i18n.js';
translateDocument();
const choices = [{ key: 'favor', label: t('a_favor') }, { key: 'against', label: t('contra') }, { key: 'abstain', label: t('abstencao') }];
const $ = selector => document.querySelector(selector);
const number = value => new Intl.NumberFormat(locale).format(value);
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const countTotal = counts => choices.reduce((sum, { key }) => sum + (counts?.[key] || 0), 0);
const modal = $('#modal');
let slug = new URLSearchParams(location.search).get('assembleia') === 'porto' ? 'porto' : 'lisboa';
const view = /^\/mesa\/?$/.test(location.pathname) ? 'desk' : 'participant';
if (location.hash === '#mesa') location.replace(`/mesa${location.search}`);
let roomId = view === 'desk' ? new URLSearchParams(location.search).get('sala') : null;
if (view !== 'desk') $('.assembly-picker').remove();
let state = { assembly: { name: t('assembleia_de_lisboa'), revision: -1 }, proposals: [], testMode: false };
let admin = { authenticated: false, configured: false };
let lastFocus, toastTimer, pollTimer, epoch = 0, panelKey = '', accessKey = '', dirtyCounts = false, sentVoteId = null;
let loading = true, inFlight = false, pendingRender = false;
let browserStorageAvailable = true;
const voteKey = (id, room = roomId) => `assembleias-voto-${room}-${id}`;
function readVoteRecord(id, room = roomId) {
  try {
    const value = JSON.parse(localStorage.getItem(voteKey(id, room)) || 'null');
    if (value && /^[a-f0-9]{64}$/.test(value.token)) return value;
    if (value) localStorage.removeItem(voteKey(id, room));
  } catch { browserStorageAvailable = false; }
  return null;
}
function cleanVoteRecords() {
  try {
    for (const key of Object.keys(localStorage).filter(key => key.startsWith('assembleias-voto-'))) {
      let value; try { value = JSON.parse(localStorage.getItem(key)); } catch {}
      // A receipt survives code re-entry and long open votes, until closure is observed.
      if (!value || (state.proposals.some(proposal => key === voteKey(proposal.id) && proposal.status === 'closed'))) localStorage.removeItem(key);
    }
    const key = 'assembleias-storage-check'; localStorage.setItem(key, '1'); localStorage.removeItem(key);
  } catch { browserStorageAvailable = false; }
}
// Admission cookies are shared; the per-proposal receipt is independent of entry.
const find = id => state.proposals.find(proposal => proposal.id === Number(id));
const active = () => state.proposals.find(proposal => proposal.status === 'open');
const statusText = { waiting: t('por_discutir'), open: t('votacao_aberta'), closed: t('votacao_encerrada') };
const isDesk = () => view === 'desk' && admin.authenticated;

async function api(route = '', { method = 'GET', body, admin: needsAdmin = false, city = slug } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let response;
  let path;
  if (view === 'desk' || needsAdmin) {
    const scoped = route.startsWith('/admin/proposals') ? route.replace('/admin/proposals', `/admin/rooms/${roomId}/proposals`) : route;
    path = `/api/assemblies/${city}${scoped}`;
  } else path = `/api/votes${route || '/session'}`;
  try { response = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin', signal: AbortSignal.timeout(10000) }); }
  catch { throw new Error(method === 'POST' ? t('a_confirmacao_nao_chegou_nao') : t('ligacao_ao_servidor_interrompida_os')); }
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && !needsAdmin && route !== '/enter') state.voteGranted = false;
    const error = new Error(data.error || t('nao_foi_possivel_concluir_o')); error.status = response.status; throw error;
  }
  return data;
}
const post = (route, body = {}, admin = false) => api(route, { method: 'POST', body, admin });
async function sendBrowserVote(id, choice) {
  if (!choices.some(item => item.key === choice)) throw new Error(t('escolha_a_favor_contra_ou'));
  const room = roomId;
  const send = async () => {
    let record = readVoteRecord(id, room);
    if (!record) {
      const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
      record = { token, sent: false };
      try { localStorage.setItem(voteKey(id, room), JSON.stringify(record)); } catch { throw new Error(t('nao_foi_possivel_guardar_o')); }
      // Best-effort coordination where Web Locks are unavailable, such as HTTP over a LAN.
      if (!navigator.locks) { await new Promise(resolve => setTimeout(resolve, 80)); record = readVoteRecord(id, room); }
    }
    if (!record) throw new Error(t('o_estado_temporario_do_navegador'));
    if (record.sent) return { alreadyRecorded: true };
    const result = await api(`/proposals/${id}/vote`, { method: 'POST', body: { choice, token: record.token } });
    try { localStorage.setItem(voteKey(id, room), JSON.stringify({ ...record, sent: true })); } catch { /* The server consumed this token; never generate a replacement for this submission. */ }
    return result;
  };
  return navigator.locks ? navigator.locks.request(`assembleias-voto-${room}-${id}`, send) : send();
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
  const currentEpoch = epoch;
  try {
    const incoming = view === 'desk'
      ? await api(`/admin/session${roomId ? `?room=${encodeURIComponent(roomId)}` : ''}`, { admin: true })
      : await api();
    if (currentEpoch !== epoch) return;
    const nextAdmin = view === 'desk' ? incoming : admin;
    const nextRoom = incoming.room?.id || null;
    const contextChanged = nextRoom !== roomId;
    if (!contextChanged && incoming.assembly && incoming.assembly.revision < state.assembly.revision) return;
    const changed = force || loading || pendingRender || contextChanged || incoming.voteGranted !== state.voteGranted ||
      incoming.assembly?.revision !== state.assembly.revision || nextAdmin.authenticated !== admin.authenticated || nextAdmin.setupRequired !== admin.setupRequired;
    const previousActive = active()?.id;
    const previousStatus = state.proposals[0]?.status, previousSentVoteId = sentVoteId;
    pendingRender = true;
    state = { ...incoming, proposals: incoming.proposals || [], assembly: incoming.assembly || { revision: -1 } };
    admin = nextAdmin; roomId = nextRoom; loading = false;
    if (contextChanged) { panelKey = ''; dirtyCounts = false; sentVoteId = null; if (modal.open) modal.close(); }
    cleanVoteRecords();
    if (view === 'participant' && active()) {
      const proposalId = active().id, record = readVoteRecord(proposalId);
      if (record && !record.sent) {
        try {
          const status = await post(`/proposals/${proposalId}/vote-status`, { token: record.token });
          if (currentEpoch !== epoch) return;
          if (status.recorded) {
            record.sent = true;
            try { localStorage.setItem(voteKey(proposalId), JSON.stringify(record)); } catch { /* Retain the original token for retries. */ }
          }
        } catch (error) { if (error.status === 409) { await refresh(true); return; } throw error; }
      }
      if (record?.sent) sentVoteId = proposalId;
    }
    if (sentVoteId && sentVoteId !== active()?.id) sentVoteId = null;
    $('#connection-notice').hidden = true;
    if (changed || previousSentVoteId !== sentVoteId) render(force);
    pendingRender = false;
    if (view === 'participant' && previousStatus !== 'closed' && state.proposals[0]?.status === 'closed') $('#voting-title')?.focus();
    if (previousActive !== active()?.id) announce(active() ? t('a_mesa_abriu_a_votacao', { v0: active().title }) : t('a_votacao_foi_encerrada_consulte'));
  } catch (error) {
    if (currentEpoch !== epoch) return;
    $('#connection-notice').hidden = false; $('#connection-notice').textContent = error.message;
  }
}

function render(force = false) {
  const locked = view === 'desk' ? !admin.authenticated : !state.voteGranted;
  document.body.classList.toggle('entry-screen', locked);
  if ($('#assembly-select')) { $('#assembly-select').value = slug; $('.assembly-picker').hidden = false; }
  $('#desk-label').hidden = view !== 'desk';
  $('#mode-label').textContent = state.testMode ? t('modo_de_teste_dados_ficticios') : t('versao_local_em_desenvolvimento');
  $('#workspace').hidden = locked;
  $('#access-panel').hidden = !locked;
  $('#desk-notice').hidden = !isDesk();
  $('#desk-notice').innerHTML = isDesk() ? `<strong>${t('mesa_de')} ${slug === 'lisboa' ? t('lisboa') : t('porto')}</strong><div><button class="text-button" type="button" data-action="change-password">${t('password_change_title')}</button><button class="text-button" type="button" data-action="logout">${t('terminar_sessao')}</button></div>` : '';
  $('#room-context').hidden = locked;
  $('#room-context').innerHTML = locked ? '' : view === 'participant' ? `<p>${escape(state.assembly.name)} · ${t('vote_code_label')} <strong>${escape(state.voteCode)}</strong></p>` : `<p>${escape(state.assembly.name)} · ${t('room_label')} <strong>${escape(state.room.code)}</strong></p>`;
  $('#room-management').hidden = !isDesk();
  const roomOptions = (state.rooms || []).map(room => `<option value="${escape(room.id)}" ${room.id === roomId ? 'selected' : ''}>${room.id === room.assembly ? `${t('legacy_room')} · ` : ''}${escape(room.code)}</option>`).join('');
  const roomManagementKey = `${slug}:${roomId}:${roomOptions}`;
  if (isDesk() && $('#room-management').dataset.key !== roomManagementKey) {
    $('#room-management').dataset.key = roomManagementKey;
    $('#room-management').innerHTML = `<div class="room-picker"><label for="desk-room-select">${t('room_label')}</label><select id="desk-room-select">${roomOptions}</select><button class="text-button" type="button" data-action="create-room">${t('create_room')}</button></div><p class="field-hint">${t('share_room_code')}</p>`;
  }
  const nextAccessKey = `${view}:${slug}:${admin.configured}:${admin.setupRequired}:${locked}`;
  if (nextAccessKey !== accessKey) {
    accessKey = nextAccessKey;
    $('#access-panel').innerHTML = locked ? (view === 'desk' ? (admin.setupRequired ? passwordForm(true) : loginForm()) : voteEntryForm()) : '';
  }
  $('.proposals-section').hidden = view === 'participant';
  const proposals = state.proposals.filter(proposal => proposal.status !== 'open').sort((a, b) => a.id - b.id);
  $('#proposal-count').textContent = proposals.length;
  $('#proposals-label').textContent = active() ? t('outras_propostas') : t('propostas');
  $('#proposals').innerHTML = locked ? '' : proposals.length ? proposals.map(proposal => `<article class="proposal-card" aria-labelledby="proposal-${proposal.id}"><div class="card-top"><span class="proposal-number">#${proposal.id}</span><span class="status ${proposal.status}">${statusText[proposal.status]}</span></div><div class="proposal-body"><h3 id="proposal-${proposal.id}">${escape(proposal.title)}</h3><p>${escape(proposal.description)}</p></div><div class="card-footer"><span class="support-count"><strong>${number(proposal.supports)}</strong> ${proposal.supports === 1 ? t('apoio_a_discussao') : t('apoios_a_discussao')}</span>${cardAction(proposal)}</div></article>`).join('') : active() ? '' : `<p class="notice">${t('esta_assembleia_ainda_nao_tem')}</p>`;
  const proposal = view === 'participant' ? state.proposals[0] : active();
  const nextKey = `${view}:${slug}:${roomId}:${locked}:${proposal?.id}:${proposal?.status}:${sentVoteId}:${state.testMode}:${proposal?.countVersion}`;
  if (force || (nextKey !== panelKey && !(dirtyCounts && proposal?.id === Number($('#count-form')?.dataset.id) && isDesk()))) {
    panelKey = nextKey; dirtyCounts = false;
    if (locked) $('#voting-panel').replaceChildren(); else renderVotingPanel();
  }
}
function cardAction(proposal) {
  if (proposal.status === 'closed') return `<button class="text-button" type="button" data-action="result" data-id="${proposal.id}">${t('ver_resultado')} <span class="sr-only"> ${t('de')} ${escape(proposal.title)}</span></button>`;
  if (isDesk()) return `<button class="button small" type="button" data-action="open" data-id="${proposal.id}" ${active() ? 'disabled' : ''}>${t('abrir_votacao')}<span class="sr-only"> ${t('de')} ${escape(proposal.title)}</span></button>`;
  return '';
}
function voteEntryForm() {
  return `<form id="vote-entry-form" novalidate><label for="vote-code">${t('vote_code_label')}</label><input id="vote-code" name="code" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" required minlength="4" maxlength="4" pattern="[A-Za-z]{4}" aria-describedby="vote-code-hint entry-privacy vote-entry-error"><p id="vote-code-hint" class="field-hint">${t('vote_code_hint')}</p><p id="entry-privacy" class="field-hint">${t('entry_privacy')}</p><p class="form-error" id="vote-entry-error" role="alert"></p><button class="button primary full" type="submit">${t('vote_enter')}</button></form>`;
}
function loginForm() {
  return `<form id="login-form" novalidate><input type="hidden" name="username" value="mesa"><label for="login-password">${t('palavra_passe_da_mesa')}</label><input id="login-password" name="password" type="password" autocomplete="current-password" required maxlength="1024" aria-describedby="login-error"><p id="login-error" class="form-error" role="alert"></p><button class="button primary full" type="submit" ${!admin.configured ? 'disabled' : ''}>${t('entrar_na_mesa')}</button></form>${!loading && !admin.configured ? `<p class="panel-note">${t('a_palavra_passe_desta_mesa')}</p>` : ''}`;
}
function passwordForm(setup = false) {
  return `<h2 id="password-title">${t(setup ? 'password_setup_title' : 'password_change_title')}</h2><p class="field-hint">${t(setup ? 'password_setup_hint' : 'password_change_hint')}</p><form id="password-form" data-setup="${setup}" novalidate>${setup ? '' : `<label for="current-password">${t('password_current')}</label><input id="current-password" name="currentPassword" type="password" autocomplete="current-password" required maxlength="1024" aria-describedby="password-error">`}<label for="new-password">${t('password_new')}</label><input id="new-password" name="password" type="password" autocomplete="new-password" required minlength="15" maxlength="1024" aria-describedby="password-hint password-error"><p id="password-hint" class="field-hint">${t('password_length_hint')}</p><label for="confirm-password">${t('password_confirmation')}</label><input id="confirm-password" name="confirmation" type="password" autocomplete="new-password" required maxlength="1024" aria-describedby="password-error"><p id="password-error" class="form-error" role="alert"></p><div class="modal-actions">${setup ? '' : `<button class="button" type="button" data-action="dismiss">${t('cancelar')}</button>`}<button class="button primary" type="submit">${t('password_save')}</button></div></form>${setup ? `<button class="text-button" type="button" data-action="logout">${t('terminar_sessao')}</button>` : ''}`;
}
function renderVotingPanel() {
  const proposal = view === 'participant' ? state.proposals[0] : active();
  if (view === 'participant' && proposal?.status === 'closed') {
    $('#voting-panel').innerHTML = `<div class="voting-panel"><h2 id="voting-title" tabindex="-1">${t('vote_closed_heading')}</h2>${resultContent(proposal)}<button class="button primary" type="button" data-action="leave-vote">${t('vote_back_start')}</button></div>`;
    return;
  }
  if (!proposal) {
    $('#voting-panel').innerHTML = `<div class="voting-panel empty-vote"><h2 id="voting-title" tabindex="-1">${t('nao_ha_uma_votacao_aberta')}</h2></div>`;
    return;
  }
  $('#voting-panel').innerHTML = `<div class="voting-panel active-vote"><p class="eyebrow">${t('votacao_aberta')}${state.testMode ? t('teste') : ''} · #${proposal.id}</p><h2 id="voting-title" tabindex="-1">${escape(proposal.title)}</h2><p class="voting-description">${escape(proposal.description)}</p>${isDesk() ? deskVote(proposal) : participantVote(proposal)}</div>`;
}
function participantVote(proposal) {
  if (sentVoteId === proposal.id) return `<div class="vote-received"><h3>${t('voto_registado')}</h3><p>${t('aguarde_o_fecho_pela_mesa')}</p></div><p class="panel-note">${t('vote_receipt_hint')}</p>`;
  if (!browserStorageAvailable) return `<p class="panel-note">${t('o_armazenamento_local_do_navegador')}</p>`;
  return `<form id="vote-form" data-id="${proposal.id}" novalidate><fieldset><legend>${t('qual_e_o_seu_voto')}?</legend>${choices.map(({ key, label }) => `<label class="vote-option"><input type="radio" name="vote" value="${key}" required><span class="vote-option-label">${label}</span></label>`).join('')}</fieldset><p class="form-error on-dark" id="vote-error" role="alert"></p><button class="button light full" type="submit">${t('registar_voto')} </button></form><p class="panel-note">${t('vote_receipt_hint')}</p>`;
}
function deskVote(proposal) {
  return `<div class="vote-code-notice"><p>${t('vote_code_label')}</p><strong id="announced-vote-code">${escape(proposal.voteCode)}</strong><p class="field-hint">${t('vote_share_code')}</p></div><p class="panel-note">${t('os_totais_digitais_so_ficam')}</p><div class="counting-section"><h3>${t('contagem_presencial_publica')}</h3><p>${t('a_mesa_conta_os_cartoes')}</p><form id="count-form" data-id="${proposal.id}" data-version="${proposal.countVersion}" novalidate><fieldset><legend class="sr-only">${t('totais_de_votos_presenciais')}</legend>${choices.map(({ key, label }) => `<div class="count-field"><label for="count-${key}">${label}</label><input type="number" min="0" max="1000000" step="1" inputmode="numeric" id="count-${key}" name="${key}" value="${proposal.inPerson[key]}" required aria-describedby="count-hint count-error"></div>`).join('')}</fieldset><p class="panel-note" id="count-hint">${t('inteiros_de_0_a_1')}</p><p id="count-error" class="form-error on-dark" role="alert"></p><button class="button outline-light full" id="save-counts" type="submit">${proposal.inPersonRecorded ? t('atualizar_contagem') : t('guardar_contagem')}</button><p class="count-status" id="count-status" role="status">${proposal.inPersonRecorded ? t('contagem_guardada_votos_presenciais', { v0: number(countTotal(proposal.inPerson)) }) : t('contagem_por_confirmar_guarde_tambem')}</p><button class="text-button" type="button" data-action="reload-counts">${t('descartar_rascunho_e_reler_contagem')}</button></form></div><button class="button light full" type="button" data-action="close" data-id="${proposal.id}">${t('fechar_votacao_e_publicar')}</button><p class="panel-note">${t('a_publicacao_apresenta_a_contagem')}</p>`;
}
function showNewProposal() {
  if (!isDesk()) return;
  openModal(`<p class="eyebrow">${t('uma_ideia_para')} ${t('room_label')} ${escape(state.room?.code || '')}</p><h2 id="modal-title">${t('nova_proposta')}</h2><p class="modal-intro">${t('escreva_o_que_propoe_e')}</p><form id="proposal-form" novalidate><label for="proposal-title">${t('titulo')} <span>${t('obrigatorio')}</span></label><input id="proposal-title" name="title" minlength="8" maxlength="120" required aria-describedby="title-hint proposal-error"><p class="field-hint" id="title-hint">${t('de_8_a_120_caracteres')}</p><label for="proposal-description">${t('descricao')} <span>${t('obrigatoria')}</span></label><textarea id="proposal-description" name="description" rows="4" minlength="20" maxlength="1200" required aria-describedby="description-hint proposal-error"></textarea><p class="field-hint" id="description-hint">${t('de_20_a_1200_caracteres')}</p><p id="proposal-error" class="form-error" role="alert"></p><div class="modal-actions"><button class="button" type="button" data-action="dismiss">${t('cancelar')}</button><button class="button primary" type="submit">${t('submeter_proposta')}</button></div></form>`);
}
function resultContent(proposal) {
  const digital = countTotal(proposal.digital), inPerson = countTotal(proposal.inPerson);
  return `<p class="result-proposal">${escape(proposal.title)}</p><div class="result-total"><strong>${number(digital + inPerson)}</strong><span>${t('votos_no_total')}</span></div><table class="results-table"><caption>${t('votos_por_opcao_e_via')}</caption><thead><tr><th scope="col">${t('opcao')}</th><th scope="col">${t('digital')}</th><th scope="col">${t('presencial')}</th><th scope="col">${t('total')}</th></tr></thead><tbody>${choices.map(({ key, label }) => `<tr><th scope="row">${label}</th><td>${number(proposal.digital[key])}</td><td>${number(proposal.inPerson[key])}</td><td><strong>${number(proposal.digital[key] + proposal.inPerson[key])}</strong></td></tr>`).join('')}</tbody><tfoot><tr><th scope="row">${t('total')}</th><td>${number(digital)}</td><td>${number(inPerson)}</td><td>${number(digital + inPerson)}</td></tr></tfoot></table><p class="field-hint">${t('a_mesa_introduz_a_contagem')}</p><div class="notice">${t('esta_contagem_nao_determina_aprovacao')}</div>`;
}
function showResult(id) {
  const proposal = find(id);
  if (proposal?.status !== 'closed') return;
  openModal(`<p class="eyebrow">${t('votacao_encerrada')}${state.testMode ? t('dados_ficticios') : ''}</p><h2 id="modal-title">${t('resultado_da_contagem')}</h2>${resultContent(proposal)}<div class="modal-actions"><button class="button primary" type="button" data-action="dismiss">${t('voltar_as_propostas')}</button></div>`);
}
function showAbout() {
  const hosted = state.hosted || location.hostname.endsWith('.vercel.app');
  openModal(`<h2 id="modal-title">${t('privacidade_e_limites')}</h2><div class="about-copy"><p>${t('privacy_stored')}</p><p>${t('privacy_ip')}</p>${hosted ? `<p>${t('hosting_notice')}</p>` : ''}<p>${t('privacy_room')}</p><p>${t('privacy_repeat')}</p><p class="notice">${t('esta_versao_ainda_nao_esta')}</p></div><div class="modal-actions"><button class="button primary" type="button" data-action="dismiss">${t('fechar')}</button></div>`);
}

document.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled || inFlight) return;
  const { action, id } = button.dataset;
  try {
    if (action === 'dismiss') modal.close();
    if (action === 'new') showNewProposal();
    if (action === 'change-password') { openModal(passwordForm().replace('id="password-title"', 'id="modal-title"')); $('#current-password').focus(); }
    if (action === 'about') showAbout();
    if (action === 'result') showResult(id);
    if (action === 'leave-vote') {
      inFlight = true; await post('/leave'); epoch++; await refresh(true); $('#vote-code')?.focus();
    }
    if (action === 'create-room') {
      if (dirtyCounts && !confirm(t('switch_room_discard_counts'))) return;
      inFlight = true;
      const result = await post('/admin/rooms', {}, true);
      roomId = result.room.id; await changeContext(); announce(t('room_created'));
    }
    if (action === 'reload-counts') { if (dirtyCounts && !confirm(t('descartar_as_alteracoes_por_guardar'))) return; dirtyCounts = false; await refresh(true); }
    if (action === 'logout') { inFlight = true; await post('/admin/logout', {}, true); admin.authenticated = false; await refresh(true); $('#login-password')?.focus(); announce(t('sessao_da_mesa_terminada')); }
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
  const errors = { 'vote-entry-form': '#vote-entry-error', 'password-form': '#password-error', 'proposal-form': '#proposal-error', 'login-form': '#login-error', 'vote-form': '#vote-error', 'count-form': '#count-error' };
  const errorTarget = $(errors[form.id]);
  if (!errorTarget) return;
  errorTarget.textContent = '';
  form.querySelectorAll('[aria-invalid]').forEach(input => input.removeAttribute('aria-invalid'));
  if (form.id === 'vote-entry-form' && !/^[a-zA-Z]{4}$/.test(data.code.trim())) {
    errorTarget.textContent = t('vote_code_incorrect'); form.elements.code.setAttribute('aria-invalid', 'true'); form.elements.code.focus(); return;
  }
  if (form.id === 'proposal-form') {
    for (const name of ['title', 'description']) {
      const input = form.elements.namedItem(name);
      if (input.value.trim().length < input.minLength || input.value.trim().length > input.maxLength) {
        errorTarget.textContent = name === 'title' ? t('escreva_um_titulo_entre_8') : t('descreva_a_proposta_com_20');
        input.setAttribute('aria-invalid', 'true'); input.focus(); return;
      }
    }
  }
  if (form.id === 'password-form') {
    const invalid = [...data.password].length < 15 || new TextEncoder().encode(data.password).length > 1024;
    if (invalid || data.password !== data.confirmation) {
      errorTarget.textContent = t(invalid ? 'password_length' : 'password_mismatch');
      const input = form.elements.namedItem(invalid ? 'password' : 'confirmation');
      input.setAttribute('aria-invalid', 'true'); input.focus(); return;
    }
  }
  const submit = form.querySelector('button[type="submit"]');
  inFlight = true; submit.disabled = true;
  try {
    if (form.id === 'login-form') { await post('/admin/login', data, true); form.elements.password.value = ''; await refresh(true); if (admin.setupRequired) $('#new-password')?.focus(); else { announce(t('sessao_da_mesa_iniciada_nesta')); $('#voting-title')?.focus(); } }
    if (form.id === 'password-form') {
      await post('/admin/password', data, true); form.reset();
      if (modal.open) modal.close();
      await refresh(true); $('#voting-title')?.focus(); announce(t('password_saved'));
    }
    if (form.id === 'vote-entry-form') {
      await post('/enter', data); form.elements.code.value = ''; epoch++;
      await refresh(true); $('#voting-title')?.focus();
    }
    if (form.id === 'proposal-form') {
      const result = await post('/admin/proposals', data, true);
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
    if (form.id === 'vote-form' && error.status === 409) await refresh(true);
    if (form.id === 'count-form') {
      const input = [...form.querySelectorAll('input')].find(input => !input.validity.valid || !/^(0|[1-9]\d*)$/.test(input.value));
      input?.setAttribute('aria-invalid', 'true'); input?.focus();
    } else form.querySelector('input:not([readonly])')?.focus();
  } finally { inFlight = false; if (submit.isConnected) submit.disabled = false; }
});

document.addEventListener('input', event => { if (event.target.closest('#count-form')) { dirtyCounts = true; $('#count-status').textContent = t('alteracoes_por_guardar_guarde_antes'); } });
async function changeContext() {
  if (view === 'desk') {
    const url = new URL(location.href);
    if (roomId) url.searchParams.set('sala', roomId); else url.searchParams.delete('sala');
    history.replaceState(null, '', url);
  }
  epoch++; panelKey = ''; dirtyCounts = false; sentVoteId = null; loading = true;
  admin = { authenticated: false, configured: false }; state = { ...state, proposals: [], assembly: { name: slug === 'lisboa' ? t('assembleia_de_lisboa') : t('assembleia_do_porto'), revision: -1 } };
  render(true); await refresh(true); $('#main').focus();
}
$('#assembly-select')?.addEventListener('change', async event => {
  if (dirtyCounts && !confirm(t('mudar_de_assembleia_e_descartar'))) { event.target.value = slug; return; }
  slug = event.target.value; roomId = null; const url = new URL(location.href); url.searchParams.set('assembleia', slug); url.searchParams.delete('sala'); history.replaceState(null, '', url); await changeContext();
});
document.addEventListener('change', async event => {
  if (event.target.id !== 'desk-room-select') return;
  if (dirtyCounts && !confirm(t('switch_room_discard_counts'))) { event.target.value = roomId; return; }
  roomId = event.target.value; await changeContext();
});
window.addEventListener('beforeunload', event => { if (dirtyCounts) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('storage', event => { if (event.key?.startsWith(`assembleias-voto-${roomId}-`)) { if (active() && readVoteRecord(active().id)?.sent) sentVoteId = active().id; render(); } });
async function poll() { await refresh(); pollTimer = setTimeout(poll, 2000); }
document.addEventListener('visibilitychange', () => { clearTimeout(pollTimer); if (!document.hidden) poll(); });
render(true);
await refresh(true); pollTimer = setTimeout(poll, 2000);
