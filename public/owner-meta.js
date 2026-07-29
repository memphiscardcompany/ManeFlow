const elements = {
  securityStatus: document.querySelector('#security-status'),
  securityMessage: document.querySelector('#security-message'),
  enrollmentPanel: document.querySelector('#enrollment-panel'),
  enrollmentSecret: document.querySelector('#enrollment-secret'),
  enrollForm: document.querySelector('#enroll-form'),
  confirmEnrollmentForm: document.querySelector('#confirm-enrollment-form'),
  reauthPanel: document.querySelector('#reauth-panel'),
  reauthForm: document.querySelector('#reauth-form'),
  recoveryPanel: document.querySelector('#recovery-panel'),
  recoveryForm: document.querySelector('#recovery-form'),
  metaStatus: document.querySelector('#meta-status'),
  metaMessage: document.querySelector('#meta-message'),
  conversationList: document.querySelector('#conversation-list'),
  conversationDetail: document.querySelector('#conversation-detail'),
  loadConversations: document.querySelector('#load-conversations'),
  draftControls: document.querySelector('#draft-controls'),
  draftForm: document.querySelector('#draft-form'),
  generateDraft: document.querySelector('#generate-draft'),
  draftList: document.querySelector('#draft-list'),
  approveForm: document.querySelector('#approve-form'),
  approvedJob: document.querySelector('#approved-job'),
  outboundFilter: document.querySelector('#outbound-filter'),
  outboundCounts: document.querySelector('#outbound-counts'),
  outboundList: document.querySelector('#outbound-list'),
  refreshOutbound: document.querySelector('#refresh-outbound'),
  dispatchBatch: document.querySelector('#dispatch-batch'),
  refreshAll: document.querySelector('#refresh-all'),
  globalMessage: document.querySelector('#global-message'),
};

const state = {
  auth: null,
  security: null,
  meta: null,
  conversations: [],
  selectedConversationId: null,
  conversation: null,
  selectedDraft: null,
  approvedJob: null,
};

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[character]));
}

function formatDate(value) {
  const date = new Date(value || '');
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : 'Not recorded';
}

function setMessage(target, text, tone = '') {
  target.innerHTML = text ? `<div class="notice-owner ${escapeHtml(tone)}">${escapeHtml(text)}</div>` : '';
}

function metric(label, value, tone = '') {
  return `<div class="status-card"><small>${escapeHtml(label)}</small><strong class="${escapeHtml(tone)}">${escapeHtml(value)}</strong></div>`;
}

async function api(path, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const headers = { ...(options.headers || {}) };
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && state.auth?.csrfToken) {
    headers['x-maneflow-csrf'] = state.auth.csrfToken;
  }
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(path, {
    credentials: 'include',
    cache: 'no-store',
    redirect: 'error',
    ...options,
    headers,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || data.error || `Request failed: ${response.status}`);
    error.status = response.status;
    error.code = data.error;
    throw error;
  }
  return data;
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function renderRecoveryCodes(codes, message) {
  const values = Array.isArray(codes) ? codes : [];
  elements.enrollmentSecret.classList.remove('hidden');
  elements.enrollmentSecret.innerHTML = `
    <div class="notice-owner success"><strong>${escapeHtml(message || 'Recovery codes created.')}</strong><br>Store these offline. They are shown only once.</div>
    <div class="recovery-list">${values.map((code) => `<code>${escapeHtml(code)}</code>`).join('')}</div>
    <div class="actions" style="margin-top:9px"><button id="copy-recovery" class="button" type="button">Copy codes</button><button id="print-recovery" class="button ghost" type="button">Print</button></div>`;
  document.querySelector('#copy-recovery')?.addEventListener('click', async () => {
    await navigator.clipboard.writeText(values.join('\n'));
    setMessage(elements.globalMessage, 'Recovery codes copied. Remove them from clipboard after storing them safely.', 'success');
  });
  document.querySelector('#print-recovery')?.addEventListener('click', () => window.print());
}

function renderSecurity() {
  const security = state.security;
  if (!security) {
    elements.securityStatus.innerHTML = metric('Owner status', 'Unavailable', 'status-bad');
    return;
  }
  elements.securityStatus.innerHTML = [
    metric('Allowlist', security.allowlisted ? 'Joshua verified' : 'Denied', security.allowlisted ? 'status-good' : 'status-bad'),
    metric('MFA enrollment', security.enrolled ? 'Enabled' : 'Required', security.enrolled ? 'status-good' : 'status-warn'),
    metric('Session MFA', security.mfaVerifiedAt ? formatDate(security.mfaVerifiedAt) : 'Not verified', security.mfaVerifiedAt ? 'status-good' : 'status-warn'),
    metric('Recent reauth', security.recentReauthentication ? 'Current' : 'Required', security.recentReauthentication ? 'status-good' : 'status-warn'),
    metric('Recovery codes', String(security.recoveryCodesRemaining || 0), security.recoveryCodesRemaining ? 'status-good' : 'status-warn'),
    metric('Reauth window', `${security.recentReauthenticationMinutes || 15} minutes`),
  ].join('');
  elements.enrollmentPanel.classList.toggle('hidden', security.enrolled);
  elements.reauthPanel.classList.toggle('hidden', !security.enrolled);
  elements.recoveryPanel.classList.toggle('hidden', !security.enrolled || !security.recentReauthentication);
}

function renderMetaStatus() {
  const meta = state.meta;
  if (!meta) {
    elements.metaStatus.innerHTML = metric('Meta status', state.security?.mfaVerifiedAt ? 'Unavailable' : 'MFA required', 'status-warn');
    elements.dispatchBatch.disabled = true;
    return;
  }
  const configuration = meta.configuration || {};
  elements.metaStatus.innerHTML = [
    metric('Operation mode', meta.operationMode || 'Unknown', meta.operationMode === 'OWNER_APPROVAL_REQUIRED' ? 'status-good' : 'status-warn'),
    metric('Kill switch', configuration.killSwitch ? 'Enabled' : 'Disabled', configuration.killSwitch ? 'status-warn' : 'status-good'),
    metric('Inbound intake', configuration.intakeEnabled ? 'Enabled' : 'Disabled', configuration.intakeEnabled ? 'status-good' : 'status-warn'),
    metric('Outbound', configuration.outboundEnabled ? 'Enabled' : 'Disabled', configuration.outboundEnabled ? 'status-good' : 'status-warn'),
    metric('Provider config', meta.provider?.ready ? 'Ready' : 'Incomplete', meta.provider?.ready ? 'status-good' : 'status-warn'),
    metric('Database', meta.database?.ok ? 'Ready' : 'Unavailable', meta.database?.ok ? 'status-good' : 'status-bad'),
    metric('Graph version', configuration.graphApiVersion || 'Not pinned', configuration.graphApiVersion ? 'status-good' : 'status-warn'),
    metric('Draft model', configuration.draftModelConfigured ? 'Configured' : 'Manual drafts only', configuration.draftModelConfigured ? 'status-good' : ''),
  ].join('');
  const missing = meta.provider?.missing || [];
  setMessage(elements.metaMessage, missing.length ? `Provider configuration still requires: ${missing.join(', ')}` : 'Meta provider configuration reports ready. Live permissions and delivery still require controlled verification.', missing.length ? '' : 'success');
  elements.dispatchBatch.disabled = !(
    meta.operationMode === 'OWNER_APPROVAL_REQUIRED'
    && state.security?.recentReauthentication
    && configuration.outboundEnabled
    && !configuration.killSwitch
  );
}

function renderConversations() {
  if (!state.conversations.length) {
    elements.conversationList.innerHTML = '<div class="notice-owner">No owner-scoped conversations are currently available.</div>';
    return;
  }
  elements.conversationList.innerHTML = state.conversations.map((conversation) => `
    <button class="conversation-button ${conversation.id === state.selectedConversationId ? 'active' : ''}" data-conversation-id="${escapeHtml(conversation.id)}" type="button">
      <strong>${escapeHtml(conversation.latestMessage || 'Attachment or empty message')}</strong>
      <small>${escapeHtml(conversation.channel || 'unknown')} · ${escapeHtml(conversation.intent || 'unclassified')} · ${escapeHtml(formatDate(conversation.updatedAt))}</small>
    </button>`).join('');
  for (const button of elements.conversationList.querySelectorAll('[data-conversation-id]')) {
    button.addEventListener('click', () => selectConversation(button.dataset.conversationId));
  }
}

function renderConversationDetail() {
  const detail = state.conversation;
  if (!detail?.conversation) {
    elements.conversationDetail.innerHTML = '<div class="notice-owner">Select a conversation to review its messages and drafts.</div>';
    elements.draftControls.classList.add('hidden');
    return;
  }
  const conversation = detail.conversation;
  elements.conversationDetail.innerHTML = `
    <div class="split">
      <div class="status-card"><small>Channel</small><strong>${escapeHtml(conversation.channel || 'Unknown')}</strong></div>
      <div class="status-card"><small>Intent</small><strong>${escapeHtml(conversation.intent || 'Unclassified')}</strong></div>
    </div>
    <div class="message-list" style="margin-top:10px">${(detail.messages || []).map((message) => `
      <article class="message ${escapeHtml(message.direction || '')}">
        <small>${escapeHtml(message.direction || 'unknown')} · ${escapeHtml(formatDate(message.receivedAt || message.sentAt || message.createdAt))}</small>
        <div>${escapeHtml(message.body || 'No text body')}</div>
        <div>${(message.attachments || []).map((attachment) => `<span class="attachment-chip">${escapeHtml(attachment.type || attachment.mimeType || 'attachment')} · ${escapeHtml(attachment.storageStatus || 'metadata only')}</span>`).join('')}</div>
      </article>`).join('') || '<div class="notice-owner">No persisted messages.</div>'}</div>`;
  elements.draftControls.classList.remove('hidden');
  state.selectedDraft = null;
  state.approvedJob = null;
  renderDrafts();
  renderApprovedJob();
}

function renderDrafts() {
  const drafts = state.conversation?.drafts || [];
  elements.draftList.innerHTML = drafts.map((draft) => `
    <article class="draft-card ${state.selectedDraft?.id === draft.id ? 'selected' : ''}" data-draft-id="${escapeHtml(draft.id)}">
      <small>${escapeHtml(draft.source || 'unknown')} · version ${escapeHtml(draft.version)} · ${escapeHtml(draft.status || 'DRAFT')}</small>
      <pre>${escapeHtml(draft.body || '')}</pre>
      <div class="actions"><button class="button select-draft" type="button" data-draft-id="${escapeHtml(draft.id)}">Select for exact approval</button></div>
    </article>`).join('') || '<div class="notice-owner">No reply drafts yet.</div>';
  for (const button of elements.draftList.querySelectorAll('.select-draft')) {
    button.addEventListener('click', () => {
      state.selectedDraft = drafts.find((draft) => draft.id === button.dataset.draftId) || null;
      elements.approveForm.classList.toggle('hidden', !state.selectedDraft);
      if (state.selectedDraft) elements.approveForm.elements.approvedText.value = state.selectedDraft.body || '';
      renderDrafts();
    });
  }
  elements.approveForm.classList.toggle('hidden', !state.selectedDraft);
}

function renderApprovedJob() {
  const job = state.approvedJob;
  if (!job) {
    elements.approvedJob.innerHTML = '';
    return;
  }
  const text = elements.approveForm.elements.approvedText.value;
  elements.approvedJob.innerHTML = `
    <article class="job-card">
      <strong>${escapeHtml(job.status || 'HELD_POLICY_REVIEW')}</strong>
      <small>Job ${escapeHtml(job.id)} · ${escapeHtml(job.channel || 'channel pending')}</small>
      <div class="actions" style="margin-top:8px"><button id="queue-approved-job" class="button primary" type="button">Queue this exact approved text</button></div>
    </article>`;
  document.querySelector('#queue-approved-job')?.addEventListener('click', async () => {
    if (!state.security?.recentReauthentication) return setMessage(elements.globalMessage, 'Recent owner reauthentication is required.', 'error');
    if (!window.confirm('Queue this exact approved text? Provider dispatch remains a separate action.')) return;
    try {
      const result = await api(`/api/owner/meta/outbound/${encodeURIComponent(job.id)}/queue`, {
        method: 'POST',
        body: JSON.stringify({ currentText: text }),
      });
      state.approvedJob = result.job;
      setMessage(elements.globalMessage, result.message || 'Approved text queued.', 'success');
      renderApprovedJob();
      await loadOutbound();
    } catch (error) {
      setMessage(elements.globalMessage, error.message, 'error');
    }
  });
}

function renderOutbound(data = {}) {
  const counts = data.counts || {};
  elements.outboundCounts.innerHTML = Object.entries(counts).slice(0, 12).map(([status, count]) => metric(status.replaceAll('_', ' '), String(count))).join('') || metric('Queue', 'Empty');
  const jobs = data.jobs || [];
  elements.outboundList.innerHTML = jobs.map((job) => `
    <article class="job-card">
      <strong>${escapeHtml(job.status || 'Unknown')}</strong>
      <small>${escapeHtml(job.channel || 'unknown')} · attempts ${escapeHtml(job.attempts)}/${escapeHtml(job.maxAttempts)} · ${escapeHtml(formatDate(job.updatedAt))}</small>
      <small>Certainty: ${escapeHtml(job.deliveryCertainty || 'not established')} · provider echo: ${escapeHtml(job.providerEchoAt ? formatDate(job.providerEchoAt) : 'not observed')}</small>
      ${job.lastErrorCode ? `<small class="status-bad">${escapeHtml(job.lastErrorCode)}</small>` : ''}
    </article>`).join('') || '<div class="notice-owner">No outbound jobs match this filter.</div>';
}

async function loadSecurity() {
  state.security = await api('/api/auth/owner/security-status');
  renderSecurity();
}

async function loadMetaStatus() {
  if (!state.security?.mfaVerifiedAt) {
    state.meta = null;
    renderMetaStatus();
    return;
  }
  try {
    state.meta = await api('/api/owner/meta/status');
  } catch (error) {
    state.meta = null;
    setMessage(elements.metaMessage, error.message, 'error');
  }
  renderMetaStatus();
}

async function loadConversations() {
  if (!state.security?.mfaVerifiedAt) return setMessage(elements.globalMessage, 'Complete owner MFA verification first.', 'error');
  try {
    const result = await api('/api/owner/meta/conversations?limit=100');
    state.conversations = result.conversations || [];
    renderConversations();
  } catch (error) {
    setMessage(elements.globalMessage, error.message, 'error');
  }
}

async function selectConversation(id) {
  state.selectedConversationId = id;
  renderConversations();
  try {
    state.conversation = await api(`/api/owner/meta/conversations/${encodeURIComponent(id)}`);
    renderConversationDetail();
  } catch (error) {
    setMessage(elements.globalMessage, error.message, 'error');
  }
}

async function loadOutbound() {
  if (!state.security?.mfaVerifiedAt) return;
  const filter = elements.outboundFilter.value;
  try {
    const result = await api(`/api/owner/meta/outbound?limit=100${filter ? `&status=${encodeURIComponent(filter)}` : ''}`);
    renderOutbound(result);
  } catch (error) {
    setMessage(elements.globalMessage, error.message, 'error');
  }
}

async function refreshEverything() {
  setMessage(elements.globalMessage, 'Refreshing owner security and Meta evidence…');
  try {
    await loadSecurity();
    await loadMetaStatus();
    if (state.security?.mfaVerifiedAt) await Promise.all([loadConversations(), loadOutbound()]);
    setMessage(elements.globalMessage, 'Owner console refreshed.', 'success');
  } catch (error) {
    setMessage(elements.globalMessage, error.message, 'error');
  }
}

elements.enrollForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const result = await api('/api/auth/owner/mfa/enroll', {
      method: 'POST', body: JSON.stringify(formData(elements.enrollForm)),
    });
    elements.enrollmentSecret.classList.remove('hidden');
    elements.enrollmentSecret.innerHTML = `
      <div class="notice-owner"><strong>Authenticator secret</strong><br><code>${escapeHtml(result.secret)}</code><br><small>Enrollment expires ${escapeHtml(formatDate(result.expiresAt))}. This secret will not be shown after confirmation.</small></div>
      <label class="owner-form" style="margin-top:9px">Authenticator setup URI<textarea readonly>${escapeHtml(result.otpauthUri)}</textarea></label>`;
    elements.confirmEnrollmentForm.classList.remove('hidden');
    elements.enrollForm.reset();
    setMessage(elements.securityMessage, result.message || 'Enrollment started.', 'success');
  } catch (error) {
    setMessage(elements.securityMessage, error.message, 'error');
  }
});

elements.confirmEnrollmentForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const result = await api('/api/auth/owner/mfa/confirm', {
      method: 'POST', body: JSON.stringify(formData(elements.confirmEnrollmentForm)),
    });
    state.security = result.status;
    renderSecurity();
    renderRecoveryCodes(result.recoveryCodes, result.message);
    elements.confirmEnrollmentForm.reset();
    elements.confirmEnrollmentForm.classList.add('hidden');
    await loadMetaStatus();
    await Promise.all([loadConversations(), loadOutbound()]);
  } catch (error) {
    setMessage(elements.securityMessage, error.message, 'error');
  }
});

elements.reauthForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const result = await api('/api/auth/owner/reauthenticate', {
      method: 'POST', body: JSON.stringify(formData(elements.reauthForm)),
    });
    state.security = result.status;
    elements.reauthForm.reset();
    renderSecurity();
    await loadMetaStatus();
    setMessage(elements.securityMessage, result.recoveryCodeUsed ? 'Owner reauthenticated with a one-time recovery code.' : 'Owner reauthenticated.', 'success');
  } catch (error) {
    setMessage(elements.securityMessage, error.message, 'error');
  }
});

elements.recoveryForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!window.confirm('Invalidate every existing recovery code and generate a new set?')) return;
  try {
    const result = await api('/api/auth/owner/recovery-codes/regenerate', {
      method: 'POST', body: JSON.stringify(formData(elements.recoveryForm)),
    });
    state.security = result.status;
    elements.recoveryForm.reset();
    renderSecurity();
    renderRecoveryCodes(result.recoveryCodes, result.message);
  } catch (error) {
    setMessage(elements.securityMessage, error.message, 'error');
  }
});

elements.draftForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.selectedConversationId) return;
  try {
    const input = formData(elements.draftForm);
    await api(`/api/owner/meta/conversations/${encodeURIComponent(state.selectedConversationId)}/drafts`, {
      method: 'POST',
      body: JSON.stringify({ text: input.text, source: 'owner_manual' }),
    });
    elements.draftForm.reset();
    await selectConversation(state.selectedConversationId);
    setMessage(elements.globalMessage, 'Manual draft saved. Nothing was approved, queued, or sent.', 'success');
  } catch (error) {
    setMessage(elements.globalMessage, error.message, 'error');
  }
});

elements.generateDraft.addEventListener('click', async () => {
  if (!state.selectedConversationId) return;
  if (!window.confirm('Generate a draft for review? This does not approve, queue, or send it.')) return;
  try {
    await api(`/api/owner/meta/conversations/${encodeURIComponent(state.selectedConversationId)}/drafts`, {
      method: 'POST', body: JSON.stringify({ generate: true }),
    });
    await selectConversation(state.selectedConversationId);
    setMessage(elements.globalMessage, 'Evidence-bounded draft generated for owner review.', 'success');
  } catch (error) {
    setMessage(elements.globalMessage, error.message, 'error');
  }
});

elements.approveForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.selectedDraft) return;
  const input = formData(elements.approveForm);
  if (!window.confirm('Approve this exact text and hold it? Queueing and dispatch remain separate actions.')) return;
  try {
    const result = await api(`/api/owner/meta/drafts/${encodeURIComponent(state.selectedDraft.id)}/approve`, {
      method: 'POST', body: JSON.stringify({ approvedText: input.approvedText, maxAttempts: 3 }),
    });
    state.approvedJob = result.job;
    renderApprovedJob();
    setMessage(elements.globalMessage, result.message || 'Exact text approved and held.', 'success');
    await loadOutbound();
  } catch (error) {
    setMessage(elements.globalMessage, error.message, 'error');
  }
});

elements.dispatchBatch.addEventListener('click', async () => {
  if (elements.dispatchBatch.disabled) return;
  if (!window.confirm('Dispatch only owner-approved queued replies now? This is the final provider-send action.')) return;
  try {
    const result = await api('/api/owner/meta/dispatch/run', {
      method: 'POST', body: JSON.stringify({ limit: 10 }),
    });
    setMessage(elements.globalMessage, `Dispatch completed: ${result.sent || 0} sent, ${result.failed || 0} failed, ${result.unknown || 0} delivery unknown.`, result.failed || result.unknown ? '' : 'success');
    await loadOutbound();
  } catch (error) {
    setMessage(elements.globalMessage, error.message, 'error');
  }
});

elements.loadConversations.addEventListener('click', loadConversations);
elements.refreshOutbound.addEventListener('click', loadOutbound);
elements.outboundFilter.addEventListener('change', loadOutbound);
elements.refreshAll.addEventListener('click', refreshEverything);

(async function initialize() {
  try {
    state.auth = await api('/api/auth/me');
    if (!state.auth.authenticated) {
      location.href = '/#/account';
      return;
    }
    await refreshEverything();
  } catch (error) {
    if (error.status === 401) location.href = '/#/account';
    else setMessage(elements.globalMessage, error.message, 'error');
  }
}());
