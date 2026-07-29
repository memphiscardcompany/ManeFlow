const view = document.querySelector('#view');
const toast = document.querySelector('#toast');
const installButton = document.querySelector('#install-button');
const accountLabel = document.querySelector('#account-label');
const modalRoot = document.querySelector('#modal-root');
const desktopStatus = document.querySelector('#desktop-status');
const desktopSettingsButton = document.querySelector('#desktop-settings');
const CARD_IMAGE_PLACEHOLDER = '/assets/card-placeholder.svg';

const state = {
  config: null,
  auth: null,
  stream: null,
  installPrompt: null,
  scan: { front: '', back: '', cert: '', frontName: '', backName: '', certName: '' },
};

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
const dateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

async function api(path, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const csrfHeaders = !['GET', 'HEAD', 'OPTIONS'].includes(method) && state.auth?.csrfToken
    ? { 'x-maneflow-csrf': state.auth.csrfToken }
    : {};
  const response = await fetch(path, {
    credentials: 'include',
    ...options,
    headers: options.body instanceof FormData
      ? { ...csrfHeaders, ...(options.headers || {}) }
      : { 'content-type': 'application/json', ...csrfHeaders, ...(options.headers || {}) },
  });
  if (options.raw) {
    if (!response.ok) throw new Error(`Request failed: ${response.status}`);
    return response;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || `Request failed: ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch { return ''; }
}

function cardImage(card = {}) {
  return String(card.image || card.imageUrl || '').trim() || CARD_IMAGE_PLACEHOLDER;
}

function cardImageTag(card = {}, className = 'card-thumb') {
  const alt = card.imageAlt || [card.year, card.brand, card.set, card.player, card.cardNumber ? `#${card.cardNumber}` : 'card'].filter(Boolean).join(' ');
  return `<img class="${escapeHtml(className)}" src="${escapeHtml(cardImage(card))}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='${CARD_IMAGE_PLACEHOLDER}'">`;
}

function formatMoney(value) {
  return Number.isFinite(Number(value)) ? money.format(Number(value)) : '—';
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown date' : dateFmt.format(date);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 2800);
}

function setBusy(button, busy, text = 'Working…') {
  if (!button) return;
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.textContent = text;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
    button.disabled = false;
  }
}

function stopCamera() {
  if (state.stream) state.stream.getTracks().forEach((track) => track.stop());
  state.stream = null;
}

function routeParts() {
  const path = location.hash.replace(/^#\/?/, '').split('?')[0];
  return path.split('/').filter(Boolean);
}

function routeQuery() {
  const query = location.hash.includes('?') ? location.hash.split('?').slice(1).join('?') : '';
  return new URLSearchParams(query);
}

function routeName() {
  return (routeParts()[0] || 'home').toLowerCase();
}

function setActiveNav(route) {
  document.querySelectorAll('.bottom-nav a').forEach((item) => item.classList.toggle('active', item.dataset.route === route));
}

function updateDesktopServiceStatus(status = {}) {
  if (!desktopStatus) return;
  const coreReady = Boolean(status.core?.ready);
  const visionReady = Boolean(status.vision?.ready);
  const tone = coreReady && visionReady ? 'ready' : coreReady || visionReady ? 'degraded' : 'offline';
  const label = tone === 'ready' ? 'Ready' : tone === 'degraded' ? 'Limited' : 'Offline';
  desktopStatus.classList.remove('ready', 'degraded', 'offline');
  desktopStatus.classList.add(tone);
  desktopStatus.querySelector('.service-label').textContent = label;
  desktopStatus.title = `Core: ${coreReady ? 'ready' : 'offline'} · Vision: ${visionReady ? 'ready' : 'offline'}`;
}

async function initializeDesktopBridge() {
  if (!window.maneFlowDesktop) return;
  desktopSettingsButton?.classList.remove('hidden');
  desktopStatus?.classList.remove('hidden');
  window.maneFlowDesktop.onServiceStatus?.(updateDesktopServiceStatus);
  try { updateDesktopServiceStatus(await window.maneFlowDesktop.serviceStatus()); } catch { updateDesktopServiceStatus({}); }
}

function skeletonRows(rows = 4) {
  return `<div class="card-list">${Array.from({ length: rows }, () => '<div class="skeleton skeleton-row"><div></div><div></div><div></div></div>').join('')}</div>`;
}

function loading(rows = 4, title = 'Loading ManeFlow', message = 'Preparing the latest card intelligence...') {
  view.innerHTML = `<section class="panel loading-panel"><div class="eyebrow">Please wait</div><h2>${escapeHtml(title)}</h2><p class="subtle">${escapeHtml(message)}</p>${skeletonRows(rows)}</section>`;
}

function emptyState(title, message, actionHtml = '') {
  return `<div class="empty polished-empty"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(message)}</p>${actionHtml}</div>`;
}

function modeLabel(mode) {
  return mode === 'production' ? 'Approved live data' : mode === 'mixed' ? 'Mixed demo + approved data' : 'Demonstration data';
}

function modeBanner(mode) {
  const text = mode === 'production'
    ? 'Values are calculated from currently connected approved sources. Always confirm card identity, condition, and source details.'
    : mode === 'mixed'
      ? 'Approved imports are mixed with synthetic demonstration comps. Do not present the combined figures as verified market values.'
      : 'The product is fully interactive, but bundled comps are synthetic until approved marketplace feeds or user exports are connected.';
  return `<div class="notice ${mode === 'production' ? 'success' : 'warning'} mode-banner"><span>${escapeHtml(text)}</span><strong class="status ${escapeHtml(mode)}">${escapeHtml(modeLabel(mode))}</strong></div>`;
}

function imageSourceLabel(card = {}) {
  const meta = card.imageMeta || {};
  if (meta.placeholder) return 'No image source';
  if (meta.source) return String(meta.source).replaceAll('_', ' ');
  if (meta.rightsStatus) return String(meta.rightsStatus).replaceAll('_', ' ');
  return card.image ? 'Image available' : 'No image source';
}

function imageSourceBadge(card = {}) {
  const meta = card.imageMeta || {};
  return `<span class="image-source-chip ${meta.placeholder ? 'placeholder' : 'available'}">Image: ${escapeHtml(imageSourceLabel(card))}</span>`;
}

function imageSourcePanel(card = {}) {
  const meta = card.imageMeta || {};
  return `<section class="panel"><h3>Image source</h3>
    <div class="source-row"><span>Status</span><strong>${escapeHtml(meta.placeholder ? 'Fallback placeholder' : 'Image available')}</strong></div>
    <div class="source-row"><span>Source</span><strong>${escapeHtml(imageSourceLabel(card))}</strong></div>
    <div class="source-row"><span>Rights</span><strong>${escapeHtml(String(meta.rightsStatus || 'unknown').replaceAll('_', ' '))}</strong></div>
    <small class="subtle">${escapeHtml(meta.rightsNotes || 'ManeFlow keeps catalog identity separate from image rights and falls back safely when no approved image source exists.')}</small>
  </section>`;
}


function compStatusLabel(status = 'included') {
  if (status === 'included') return 'Included';
  if (status === 'needs_review') return 'Needs review';
  return `Excluded: ${String(status).replace(/^excluded_/, '').replaceAll('_', ' ')}`;
}

function compQualityRow(sale) {
  const url = safeUrl(sale.url);
  const status = sale.inclusionStatus || 'included';
  return `<div class="comp-row comp-quality-row ${escapeHtml(status)}"><div><strong>${escapeHtml(sale.provider || 'Unknown source')}</strong><small>${formatDate(sale.soldAt)} · ${escapeHtml(String(sale.saleType || '').replaceAll('_', ' '))}${sale.verified ? ' · verified' : ''}</small><small><span class="status ${escapeHtml(status)}">${escapeHtml(compStatusLabel(status))}</span> ${escapeHtml((sale.reasons || []).slice(0, 2).join(' · ') || 'Quality scored')}</small></div><div style="text-align:right"><strong>${formatMoney(sale.allInPrice)}</strong><small>Q ${sale.qualityScore ?? '—'} · Match ${sale.matchScore ?? '—'} · Trust ${sale.sourceTrustScore ?? '—'}</small>${url ? `<small><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" style="color:var(--gold-2)">Open source ↗</a></small>` : ''}</div></div>`;
}

function scoreLabel(value) {
  const score = Math.round(Number(value) || 0);
  if (score >= 78) return { score, label: 'High', tone: 'high' };
  if (score >= 55) return { score, label: 'Review', tone: 'medium' };
  return { score, label: 'Low', tone: 'low' };
}

function scoreBadge(label, value, suffix = '%') {
  const state = scoreLabel(value);
  return `<span class="score-badge ${state.tone}"><strong>${escapeHtml(label)}</strong><span>${state.score}${suffix}</span><small>${state.label}</small></span>`;
}

function formatPct(value) {
  return Number.isFinite(Number(value)) ? `${Number(value) >= 0 ? '+' : ''}${Math.round(Number(value) * 10) / 10}%` : 'No trend';
}

function actionTone(action = '') {
  if (action === 'sell_now' || action === 'reprice') return 'negative';
  if (action === 'buy_more' || action === 'list') return 'positive';
  if (action === 'wait' || action === 'review') return 'needs_review';
  return 'configured';
}

function decisionRow(signal = {}) {
  const rec = signal.recommendation || {};
  const movement = signal.movement || {};
  const confidence = signal.valuationConfidence || {};
  const liquidity = signal.liquidity || {};
  const momentum = signal.momentum || {};
  return `<div class="decision-row">
    <div>
      <strong>${escapeHtml(signal.name || 'Card')}</strong>
      <small>${escapeHtml((rec.reasons || [])[0] || 'Completed-sale decision support')} ${signal.askingPriceContext ? ' Asking prices shown only as context.' : ''}</small>
      <div class="decision-mini">
        <span>30d ${escapeHtml(formatPct(movement.trend30Pct))}</span>
        <span>Conf ${confidence.score ?? 0}%</span>
        <span>Liq ${liquidity.score ?? 0}%</span>
        <span>Mom ${momentum.score ?? 0}%</span>
      </div>
    </div>
    <div class="decision-price">
      <span class="status ${escapeHtml(actionTone(rec.action))}">${escapeHtml(rec.label || 'Review')}</span>
      <strong>${formatMoney(signal.currentValue)}</strong>
      <small>${rec.conviction ?? 0}% conviction</small>
    </div>
  </div>`;
}

function portfolioDecisionPanel(decision = null) {
  if (!decision?.summary) return '<section class="panel"><h3>Decision Center</h3><div class="empty">Add valued cards to generate market movement and action signals.</div></section>';
  const summary = decision.summary;
  const actions = summary.actionCounts || {};
  const queue = [
    ...(decision.actionBuckets?.sellNow || []).slice(0, 3),
    ...(decision.actionBuckets?.buyMore || []).slice(0, 3),
    ...(decision.actionBuckets?.wait || []).slice(0, 2),
  ].slice(0, 6);
  return `<section class="panel decision-panel">
    <div class="panel-title"><div><div class="eyebrow">Decision Center</div><h3>Portfolio movement and actions</h3></div><span class="status configured">Completed sales only</span></div>
    <div class="decision-score-grid">
      <div><small>30d movement</small><strong class="${summary.estimated30DayChange >= 0 ? 'positive' : 'negative'}">${formatMoney(summary.estimated30DayChange)}</strong><span>${formatPct(summary.estimated30DayChangePct)}</span></div>
      <div><small>Value confidence</small><strong>${summary.averageValuationConfidence ?? 0}%</strong><span>${summary.thinDataCount ?? 0} thin-data cards</span></div>
      <div><small>Liquidity</small><strong>${summary.averageLiquidityScore ?? 0}%</strong><span>portfolio average</span></div>
      <div><small>Momentum</small><strong>${summary.averageMomentumScore ?? 0}%</strong><span>relative strength blend</span></div>
    </div>
    <div class="action-buckets">
      <span class="status negative">Sell now ${actions.sell_now || 0}</span>
      <span class="status configured">Hold ${actions.hold || 0}</span>
      <span class="status positive">Buy more ${actions.buy_more || 0}</span>
      <span class="status needs_review">Wait ${actions.wait || 0}</span>
    </div>
    <div class="decision-list">${queue.length ? queue.map(decisionRow).join('') : '<div class="empty">No action signals yet.</div>'}</div>
    <small class="subtle">${escapeHtml(decision.disclaimer || 'Completed sales drive value. Asking prices are context only.')}</small>
  </section>`;
}

function cardDecisionPanel(signal = null) {
  if (!signal) return '<section class="panel"><h3>Portfolio decision</h3><div class="empty">Add this card to your Vault to track action recommendations.</div></section>';
  const rec = signal.recommendation || {};
  const confidence = signal.valuationConfidence || {};
  const liquidity = signal.liquidity || {};
  const momentum = signal.momentum || {};
  return `<section class="panel decision-panel">
    <div class="panel-title"><div><div class="eyebrow">Portfolio decision</div><h3>${escapeHtml(rec.label || 'Review')}</h3></div><span class="status ${escapeHtml(actionTone(rec.action))}">${escapeHtml(rec.label || 'Review')}</span></div>
    <div class="decision-score-grid">
      <div><small>30d</small><strong class="${(signal.movement?.trend30Pct || 0) >= 0 ? 'positive' : 'negative'}">${escapeHtml(formatPct(signal.movement?.trend30Pct))}</strong><span>${formatMoney(signal.movement?.change30Value)} change</span></div>
      <div><small>Valuation confidence</small><strong>${confidence.score ?? 0}%</strong><span>${escapeHtml(String(confidence.label || '').replaceAll('_', ' '))}</span></div>
      <div><small>Liquidity</small><strong>${liquidity.score ?? 0}%</strong><span>${escapeHtml(liquidity.label || 'unknown')}</span></div>
      <div><small>Momentum</small><strong>${momentum.score ?? 0}%</strong><span>${escapeHtml(momentum.summary || '')}</span></div>
    </div>
    ${(rec.reasons || []).length ? `<div class="notice compact-notice">${rec.reasons.map(escapeHtml).join('<br>')}</div>` : ''}
    ${(rec.risks || []).length ? `<div class="notice warning compact-notice">${rec.risks.slice(0, 4).map(escapeHtml).join('<br>')}</div>` : ''}
    ${signal.askingPriceContext ? `<small class="subtle">${escapeHtml(signal.askingPriceContext.note)}</small>` : '<small class="subtle">Only included completed-sale comps drive this recommendation.</small>'}
  </section>`;
}

function inventoryDecisionPanel(inventory = {}) {
  const decision = inventory.decisionSupport || {};
  const rows = [
    ...(inventory.listCandidates || []).slice(0, 4),
    ...(inventory.repriceCandidates || []).slice(0, 4),
    ...(inventory.reviewCandidates || []).slice(0, 4),
  ].slice(0, 8);
  return `<section class="panel decision-panel">
    <div class="panel-title"><div><div class="eyebrow">Shop action queue</div><h3>List, hold, reprice, review</h3></div><span class="status configured">Completed sales only</span></div>
    <div class="action-buckets">
      <span class="status positive">List ${inventory.listCandidates?.length || 0}</span>
      <span class="status configured">Hold ${inventory.holdCandidates?.length || 0}</span>
      <span class="status negative">Reprice ${inventory.repriceCandidates?.length || 0}</span>
      <span class="status needs_review">Review ${inventory.reviewCandidates?.length || 0}</span>
    </div>
    <div class="decision-list">${rows.length ? rows.map((item) => {
      const action = item.shopAction || {};
      return `<div class="decision-row"><div><strong>${escapeHtml(item.name || 'Inventory item')}</strong><small>${escapeHtml((action.reasons || [])[0] || 'Inventory action signal')}</small></div><div class="decision-price"><span class="status ${escapeHtml(actionTone(action.action))}">${escapeHtml(action.label || 'Review')}</span><strong>${formatMoney(action.suggestedListPrice)}</strong><small>${escapeHtml(action.priority || 'medium')}</small></div></div>`;
    }).join('') : '<div class="empty">No shop action signals yet.</div>'}</div>
    <small class="subtle">${escapeHtml(decision.disclaimer || inventory.disclaimer || 'Inventory actions are decision support only.')}</small>
  </section>`;
}

function qualityRibbon(items = []) {
  return `<div class="quality-ribbon">${items.filter(Boolean).join('')}</div>`;
}

function fieldConfidenceGrid(fields = {}) {
  const labels = {
    player: 'Player', year: 'Year', set: 'Set', cardNumber: 'Number', parallel: 'Parallel',
    serialNumber: 'Serial', gradeCompany: 'Grader', grade: 'Grade', certNumber: 'Cert',
  };
  return `<div class="field-grid">${Object.entries(labels).map(([key, label]) => {
    const value = Math.round((Number(fields[key]) || 0) * 100);
    return `<div class="field-chip ${scoreLabel(value).tone}"><small>${label}</small><strong>${value}%</strong></div>`;
  }).join('')}</div>`;
}

function gradedCertPanel(cert = null) {
  if (!cert || !cert.slabbed) return '';
  const url = safeUrl(cert.certUrl);
  const warnings = cert.warnings || [];
  const title = cert.gradeLabel || [cert.grader, cert.grade].filter(Boolean).join(' ') || 'Slab detected';
  const facts = [cert.player, cert.year, cert.set, cert.cardNumber ? `#${cert.cardNumber}` : '', cert.parallel].filter(Boolean);
  const conflicts = cert.certEvidence?.conflicts || [];
  const candidates = cert.certEvidence?.candidates || [];
  return `<section class="panel trust-panel">
    <div class="panel-title"><div><div class="eyebrow">Graded cert intelligence</div><h3>${escapeHtml(title)}</h3></div>${scoreBadge('Cert', cert.certConfidence || 0)}</div>
    <div class="source-row"><span>Certification</span><strong>${escapeHtml(cert.certNumber || 'Not confirmed')}</strong></div>
    <div class="source-row"><span>Verification status</span><strong>${escapeHtml(String(cert.verificationStatus || 'unknown').replaceAll('_', ' '))}</strong></div>
    <div class="source-row"><span>Extraction tier</span><strong>${escapeHtml(String(cert.extractionTier || 'unknown').replaceAll('_', ' '))} - ${Number(cert.extractionCompletenessScore || 0)}%</strong></div>
    <div class="source-row"><span>Scan agreement</span><strong>${Number(cert.matchAgreementScore || 0)}%</strong></div>
    ${facts.length ? `<p class="subtle">${facts.map(escapeHtml).join(' - ')}</p>` : ''}
    ${conflicts.length ? `<div class="notice warning compact-notice"><strong>Evidence conflict</strong><br>${conflicts.map((conflict) => `${escapeHtml(conflict.field)}: ${conflict.values.map(escapeHtml).join(', ')}`).join('<br>')}</div>` : ''}
    ${candidates.length ? `<details class="compact-notice"><summary>Cert evidence candidates</summary><div class="tight-list">${candidates.slice(0, 5).map((item) => `<div class="source-row"><span>${escapeHtml(item.source)}</span><strong>${escapeHtml([item.grader, item.certNumber].filter(Boolean).join(' ') || 'unconfirmed')}</strong></div>`).join('')}</div></details>` : ''}
    ${url ? `<a class="button small" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Open cert page</a>` : '<div class="notice warning">No official cert URL was confirmed. Use the cert number manually before relying on a graded-card value.</div>'}
    ${warnings.length ? `<div class="notice warning compact-notice">${warnings.slice(0, 5).map(escapeHtml).join('<br>')}</div>` : ''}
    <small class="subtle">Cert evidence improves identity confidence. It is not card authentication or a grade guarantee.</small>
  </section>`;
}

function scanConfidencePanel(scan = null) {
  if (!scan) return '';
  return `<section class="panel trust-panel">
    <div class="panel-title"><div><div class="eyebrow">Scan confidence</div><h3>${escapeHtml(scan.needsManualConfirmation ? 'Confirm before acting' : 'Ready for review')}</h3></div>${scoreBadge('Scan', scan.scanConfidenceScore || 0)}</div>
    ${qualityRibbon([
      scoreBadge('Image', scan.imageQualityScore || 0),
      scoreBadge('Identity', scan.scanConfidenceScore || 0),
      scan.needsBackImage ? '<span class="status needs_review">Back image needed</span>' : '<span class="status included">Front/back usable</span>',
    ])}
    ${fieldConfidenceGrid(scan.fieldConfidence || {})}
    <div class="notice ${scan.needsManualConfirmation ? 'warning' : 'success'} compact-notice">${escapeHtml(scan.recommendedNextStep || 'Confirm identity and condition before transacting.')}</div>
    ${(scan.warnings || []).length ? `<ul class="tight-list">${scan.warnings.slice(0, 6).map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}</ul>` : ''}
  </section>`;
}

function recognitionScenePanel(recognition = null) {
  if (!recognition?.items?.length) return '';
  const scene = recognition.scene || {};
  const summary = recognition.summary || {};
  const sceneLabel = String(scene.type || 'single_card').replaceAll('_', ' ');
  const regionCards = recognition.items.slice(0, 30).map((item) => {
    const best = item.matches?.[0];
    const score = Math.round(Number(item.scanConfidence?.scanConfidenceScore || 0));
    const path = String(item.path || 'review').replaceAll('_', ' ');
    const uncertain = item.explanation?.uncertain || item.scanConfidence?.explanation?.uncertainFields || [];
    const guidance = item.explanation?.photoGuidance || [];
    return `<div class="recognition-region">
      <div class="recognition-region-head">
        ${best ? cardImageTag(best, 'recognition-thumb') : '<div class="recognition-thumb camera-placeholder"><strong>?</strong></div>'}
        <div>
          <div class="eyebrow">Region ${escapeHtml(String(item.index + 1))} · ${escapeHtml(path)}</div>
          <h3>${escapeHtml(best ? cardTitle(best) : 'Unmatched visible card')}</h3>
          <p>${best ? cardSubtitle(best) : 'ManeFlow detected a card-shaped region but did not find a safe catalog match.'}</p>
          <div class="row-meta-stack">
            <span class="status ${item.requiresManualConfirmation ? 'needs_review' : 'included'}">${item.requiresManualConfirmation ? 'Confirm' : 'Ready'}</span>
            <span class="status">${escapeHtml(item.cardType || 'card')}</span>
            ${item.slabbed ? '<span class="status configured">Slab</span>' : ''}
            ${scoreBadge('Scan', score)}
          </div>
        </div>
      </div>
      <div class="recognition-region-body">
        <div class="source-row"><span>Bounding box</span><strong>${Math.round((item.boundingBox?.x || 0) * 100)}%, ${Math.round((item.boundingBox?.y || 0) * 100)}% / ${Math.round((item.boundingBox?.width || 0) * 100)}% x ${Math.round((item.boundingBox?.height || 0) * 100)}%</strong></div>
        ${item.explanation?.whyMatched?.length ? `<div class="notice compact-notice"><strong>Why this matched</strong><br>${item.explanation.whyMatched.slice(0, 5).map(escapeHtml).join(', ')}</div>` : ''}
        ${uncertain.length ? `<div class="notice warning compact-notice"><strong>Uncertain</strong><br>${uncertain.slice(0, 5).map(escapeHtml).join(', ')}</div>` : ''}
        ${guidance.length ? `<div class="notice compact-notice"><strong>Better scan guidance</strong><br>${guidance.slice(0, 4).map(escapeHtml).join(' ')}</div>` : ''}
      </div>
    </div>`;
  }).join('');
  return `<section class="panel recognition-panel">
    <div class="panel-title"><div><div class="eyebrow">State-of-the-art recognition</div><h3>${escapeHtml(sceneLabel)}</h3></div><span class="status ${summary.needsConfirmation ? 'needs_review' : 'included'}">${Number(summary.detectedCards || 0)} detected</span></div>
    <div class="decision-score-grid">
      <div><small>Matched cards</small><strong>${Number(summary.matchedCards || 0)}</strong><span>Catalog-backed results</span></div>
      <div><small>Needs confirmation</small><strong>${Number(summary.needsConfirmation || 0)}</strong><span>Low confidence or high value</span></div>
      <div><small>Avg scan confidence</small><strong>${Number(summary.averageScanConfidence || 0)}%</strong><span>Scene calibrated</span></div>
      <div><small>Strategy</small><strong>${escapeHtml(Object.keys(summary.pathCounts || {}).join(', ') || 'review')}</strong><span>Fast + accurate paths</span></div>
    </div>
    ${scene.warnings?.length ? `<div class="notice warning compact-notice">${scene.warnings.map(escapeHtml).join(' ')}</div>` : ''}
    <div class="recognition-grid">${regionCards}</div>
  </section>`;
}

function dealerDecisionPanel(decision = null, marketMode = 'demo') {
  if (!decision) {
    return `<section class="panel action-panel"><div class="eyebrow">Merchant pricing center</div><h3>Dealer tools locked</h3><p class="subtle">Merchant and Enterprise accounts get buy targets, list prices, consignment guidance, offer sheets, and shop inventory actions.</p><a class="button small" href="#/plans">View plans</a></section>`;
  }
  const buy = decision.dealerBuyRange || {};
  const asks = decision.askingPriceContext || {};
  return `<section class="panel action-panel">
    <div class="panel-title"><div><div class="eyebrow">Merchant pricing center</div><h3>${escapeHtml(decision.suggestedAction || 'Review before buying')}</h3></div><span class="status ${escapeHtml(marketMode)}">${escapeHtml(modeLabel(marketMode))}</span></div>
    <div class="dealer-grid">
      <div><small>Dealer buy target</small><strong>${formatMoney(buy.low)}-${formatMoney(buy.high)}</strong></div>
      <div><small>Quick sale</small><strong>${formatMoney(decision.quickSalePrice)}</strong></div>
      <div><small>Fair list</small><strong>${formatMoney(decision.fairListPrice)}</strong></div>
      <div><small>Patient list</small><strong>${formatMoney(decision.patientListPrice)}</strong></div>
    </div>
    <div class="source-row"><span>Confidence</span><strong>${decision.confidenceScore || 0}%</strong></div>
    <div class="source-row"><span>Pricing confidence</span><strong>${decision.pricingConfidenceScore ?? decision.confidenceScore ?? 0}%</strong></div>
    <div class="source-row"><span>Liquidity</span><strong>${decision.liquidityScore || 0}%</strong></div>
    ${asks.count ? `<div class="source-row"><span>Current BIN median</span><strong>${formatMoney(asks.medianAsk)}</strong></div><div class="source-row"><span>BIN rating</span><strong>${escapeHtml(String(decision.pricingRating || asks.rating || '').replaceAll('_', ' '))}</strong></div>` : ''}
    <div class="source-row"><span>Consignment</span><strong>${escapeHtml(decision.consignmentRecommendation || 'Review needed')}</strong></div>
    <div class="source-row"><span>Grading</span><strong>${escapeHtml(decision.gradingReviewRecommendation || 'Review needed')}</strong></div>
    ${(decision.riskWarnings || []).length ? `<div class="notice warning compact-notice"><strong>Risk notes</strong><br>${decision.riskWarnings.map(escapeHtml).join('<br>')}</div>` : ''}
    <small class="subtle">${escapeHtml(decision.disclaimer || 'Dealer pricing is a decision aid, not an appraisal or guarantee.')}</small>
  </section>`;
}

function askingContextPanel(context = {}, activeListingError = null) {
  if (!context?.count) {
    return `<section class="panel"><h3>Current BIN context</h3>${activeListingError ? `<div class="notice warning">${escapeHtml(activeListingError)}</div>` : '<div class="empty">No active Buy It Now context is available. Completed-sale comps remain the value source.</div>'}</section>`;
  }
  return `<section class="panel">
    <div class="panel-title"><div><div class="eyebrow">Asking context</div><h3>Current BIN prices</h3></div><span class="status needs_review">Not comps</span></div>
    <div class="source-row"><span>Median ask</span><strong>${formatMoney(context.medianAsk)}</strong></div>
    <div class="source-row"><span>Ask range</span><strong>${formatMoney(context.p25)}-${formatMoney(context.p75)}</strong></div>
    <div class="source-row"><span>Listings used</span><strong>${context.count}</strong></div>
    <div class="source-row"><span>Pricing confidence</span><strong>${context.pricingConfidence}%</strong></div>
    <div class="source-row"><span>Rating</span><strong>${escapeHtml(String(context.rating || '').replaceAll('_', ' '))}</strong></div>
    <div class="notice compact-notice">BIN listings are active asking prices for listing strategy and new-release context. They never set market value.</div>
    ${(context.warnings || []).length ? `<small class="subtle">${context.warnings.map(escapeHtml).join(' ')}</small>` : ''}
  </section>`;
}

function sourcePolicyRow(source) {
  const readiness = source.valuationEligible ? 'Valuation eligible' : 'Not for valuation';
  return `<div class="source-row source-policy-row">
    <div><strong>${escapeHtml(source.provider)}</strong><small>${escapeHtml(source.sourceType)} · ${escapeHtml(source.authorizationBasis)} · ${escapeHtml(source.dataRightsStatus)}</small><small>${escapeHtml(source.notes || 'No notes')}</small></div>
    <div style="text-align:right"><span class="status ${source.valuationEligible ? 'included' : 'needs_review'}">${readiness}</span><small>${escapeHtml(source.legalReviewStatus || 'unknown')} / ${escapeHtml(source.ownerApprovalStatus || 'unknown')}</small></div>
  </div>`;
}

function manualCompRow(comp) {
  const extracted = comp.extracted || {};
  return `<div class="source-row manual-comp-row">
    <div><strong>${escapeHtml(comp.title || extracted.title || comp.provider || 'Manual evidence')}</strong><small>${escapeHtml(comp.provider || extracted.provider || 'Manual Comp Evidence')} · ${formatMoney(extracted.price ?? comp.price)} · ${formatDate(extracted.soldAt || comp.soldAt)}</small><small>${(extracted.warnings || []).map(escapeHtml).join(' · ') || escapeHtml(comp.rightsNotes || 'Review required before valuation use.')}</small></div>
    <div class="actions compact"><span class="status ${escapeHtml(comp.reviewStatus)}">${escapeHtml(String(comp.reviewStatus || 'needs_review').replaceAll('_', ' '))}</span><button class="button small review-manual-comp" data-id="${escapeHtml(comp.id)}">Review</button>${comp.reviewStatus === 'approved' && comp.valuationUse ? `<button class="button small primary promote-manual-comp" data-id="${escapeHtml(comp.id)}">Promote</button>` : ''}</div>
  </div>`;
}

function dataOpsWorkbench(dataSources = { sources: [], acquisition: {} }, manualComps = { manualComps: [] }) {
  const acquisition = dataSources.acquisition || {};
  const sources = dataSources.sources || [];
  const comps = manualComps.manualComps || [];
  return `<div class="section-head"><div><div class="eyebrow">Data Ops Workbench</div><h2>Rights, evidence, and acquisition</h2></div><span class="subtle">${sources.length} source policies · ${acquisition.manualNeedsReview || 0} manual comps need review</span></div>
    <section class="panel">
      <div class="grid metrics"><div class="metric"><small>Approved sources</small><strong>${sources.filter((source) => source.legalReviewStatus === 'approved' && source.ownerApprovalStatus === 'approved').length}</strong><p>${sources.filter((source) => source.valuationEligible).length} valuation eligible</p></div><div class="metric"><small>Acquisition checks</small><strong>${acquisition.totalRuns || 0}</strong><p>${acquisition.blockedRuns || 0} blocked</p></div><div class="metric"><small>Manual evidence</small><strong>${comps.length}</strong><p>${comps.filter((comp) => comp.reviewStatus === 'needs_review').length} pending</p></div><div class="metric"><small>Review trail</small><strong>${(acquisition.recentRuns || []).length}</strong><p>recent acquisition records</p></div></div>
      <div class="tabs data-ops-tabs"><button class="active" data-dataops="sources">Source Rights</button><button data-dataops="authorize">Acquisition Gate</button><button data-dataops="evidence">Evidence Parser</button><button data-dataops="manual">Manual Review</button></div>
      <div id="dataops-sources" class="dataops-panel">${sources.map(sourcePolicyRow).join('')}</div>
      <div id="dataops-authorize" class="dataops-panel hidden"><form id="acquisition-form" class="form-grid"><div class="form-grid two"><div><label>Provider/source</label><input id="acquisition-provider" placeholder="Manual Comp Evidence"></div><div><label>Purpose</label><input id="acquisition-purpose" value="admin_authorization_check"></div></div><div><label>Target URL or source page</label><input id="acquisition-url" placeholder="https://approved.example/sales/123"></div><button class="button primary">Check acquisition rights</button><div id="acquisition-result"></div></form>${(acquisition.recentRuns || []).length ? acquisition.recentRuns.slice(0, 8).map((run) => `<div class="source-row"><div><strong>${escapeHtml(run.provider)}</strong><small>${escapeHtml(run.purpose)} · ${formatDate(run.createdAt)} · ${escapeHtml(run.targetUrl || 'no URL')}</small></div><span class="status ${run.allowed ? 'included' : 'excluded_data_rights'}">${run.allowed ? 'Allowed' : 'Blocked'}</span></div>`).join('') : '<div class="empty">No acquisition checks yet.</div>'}</div>
      <div id="dataops-evidence" class="dataops-panel hidden"><form id="evidence-form" class="form-grid"><div><label>Legally obtained sale evidence</label><textarea id="evidence-text" rows="5" placeholder="Paste visible sale evidence from a source you are allowed to use. Include sold price, date, provider, card details, cert, and URL when allowed."></textarea></div><div class="form-grid two"><div><label>Provider</label><input id="evidence-provider" placeholder="Manual Comp Evidence"></div><div><label>Evidence type</label><select id="evidence-type"><option>manual_evidence</option><option>screenshot_evidence</option><option>receipt_or_invoice</option><option>user_uploaded_export</option></select></div></div><div class="actions" style="margin:0"><button class="button">Parse only</button><button id="capture-evidence" type="button" class="button primary">Capture for review</button></div><div id="evidence-result"></div></form></div>
      <div id="dataops-manual" class="dataops-panel hidden">${comps.length ? comps.slice(0, 80).map(manualCompRow).join('') : '<div class="empty">No manual evidence has been captured.</div>'}</div>
    </section>`;
}

function wireDataOpsWorkbench(refresh) {
  document.querySelectorAll('[data-dataops]').forEach((button) => button.addEventListener('click', () => {
    document.querySelectorAll('[data-dataops]').forEach((item) => item.classList.toggle('active', item === button));
    document.querySelectorAll('.dataops-panel').forEach((panel) => panel.classList.add('hidden'));
    document.querySelector(`#dataops-${button.dataset.dataops}`)?.classList.remove('hidden');
  }));
  document.querySelector('#acquisition-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button');
    setBusy(button, true, 'Checking...');
    try {
      const result = await api('/api/admin/acquisition/authorize', { method: 'POST', body: JSON.stringify({ provider: document.querySelector('#acquisition-provider').value, purpose: document.querySelector('#acquisition-purpose').value, url: document.querySelector('#acquisition-url').value, dryRun: true }) });
      document.querySelector('#acquisition-result').innerHTML = `<div class="notice ${result.decision.allowed ? 'success' : 'warning'}"><strong>${result.decision.allowed ? 'Allowed' : 'Blocked'}</strong><br>${escapeHtml(result.decision.blockedReason || 'This source/action passed the configured acquisition policy.')}<br><small>${escapeHtml(result.decision.maxFreshnessClaim || '')}</small></div>`;
    } catch (error) {
      document.querySelector('#acquisition-result').innerHTML = `<div class="notice warning">${escapeHtml(error.message)}</div>`;
    } finally { setBusy(button, false); }
  });
  document.querySelector('#evidence-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button');
    setBusy(button, true, 'Parsing...');
    try {
      const evidence = await api('/api/admin/evidence/parse', { method: 'POST', body: JSON.stringify({ text: document.querySelector('#evidence-text').value, provider: document.querySelector('#evidence-provider').value }) });
      const row = evidence.evidence;
      document.querySelector('#evidence-result').innerHTML = `<div class="notice"><strong>${escapeHtml(row.provider)}</strong><br>${escapeHtml(row.title || 'Untitled evidence')}<br>Price ${formatMoney(row.price)} · Sold ${formatDate(row.soldAt)} · Confidence ${Math.round((row.confidence || 0) * 100)}%${row.warnings?.length ? `<br><span class="negative">${row.warnings.map(escapeHtml).join('<br>')}</span>` : ''}</div>`;
    } catch (error) {
      document.querySelector('#evidence-result').innerHTML = `<div class="notice warning">${escapeHtml(error.message)}</div>`;
    } finally { setBusy(button, false); }
  });
  document.querySelector('#capture-evidence')?.addEventListener('click', async (event) => {
    setBusy(event.currentTarget, true, 'Capturing...');
    try {
      const result = await api('/api/admin/manual-comps', { method: 'POST', body: JSON.stringify({ text: document.querySelector('#evidence-text').value, provider: document.querySelector('#evidence-provider').value, evidenceType: document.querySelector('#evidence-type').value, notes: 'Captured in Owner Data Ops Workbench' }) });
      document.querySelector('#evidence-result').innerHTML = `<div class="notice success">${escapeHtml(result.message)}</div>`;
      showToast('Manual evidence captured for review');
    } catch (error) { showToast(error.message); }
    finally { setBusy(event.currentTarget, false); }
  });
  document.querySelectorAll('.review-manual-comp').forEach((button) => button.addEventListener('click', () => {
    const modal = openModal('Review manual comp', `<form id="manual-review-form" class="form-grid"><div><label>Decision</label><select id="manual-decision"><option value="approved">Approve</option><option value="rejected">Reject</option><option value="needs_review">Needs review</option><option value="private_research">Private research</option></select></div><label><input id="manual-valuation" type="checkbox" checked style="width:auto;min-height:auto"> Eligible for valuation after promotion</label><label><input id="manual-public" type="checkbox" style="width:auto;min-height:auto"> Public display eligible</label><div><label>Notes</label><textarea id="manual-notes" rows="3">Reviewed in Owner Data Ops Workbench.</textarea></div><button class="button primary">Save review</button></form>`);
    modal.root.querySelector('#manual-review-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      await api(`/api/admin/manual-comps/${encodeURIComponent(button.dataset.id)}/review`, { method: 'POST', body: JSON.stringify({ decision: modal.root.querySelector('#manual-decision').value, valuationUse: modal.root.querySelector('#manual-valuation').checked, publicDisplayEligible: modal.root.querySelector('#manual-public').checked, notes: modal.root.querySelector('#manual-notes').value }) });
      modal.close(); showToast('Manual comp reviewed'); refresh();
    });
  }));
  document.querySelectorAll('.promote-manual-comp').forEach((button) => button.addEventListener('click', async () => {
    try {
      const result = await api(`/api/admin/manual-comps/${encodeURIComponent(button.dataset.id)}/promote`, { method: 'POST', body: JSON.stringify({ dryRun: false }) });
      showToast(`Promoted: ${result.ingest?.salesAdded || 0} added, ${result.ingest?.salesUpdated || 0} updated`);
      refresh();
    } catch (error) { showToast(error.message); }
  }));
}

function trendHtml(market) {
  const pct = market?.trend30Pct;
  const text = pct === null || pct === undefined ? 'New data' : `${pct > 0 ? '↑' : pct < 0 ? '↓' : '→'} ${Math.abs(pct).toFixed(1)}%`;
  return `<span class="trend ${escapeHtml(market?.direction || 'insufficient_data')}">${text}</span>`;
}

function cardTitle(card) {
  return [card.year, card.brand, card.player].filter(Boolean).join(' ');
}

function cardSubtitle(card) {
  const line1 = [card.set, card.cardNumber ? `#${card.cardNumber}` : '', card.parallel].filter(Boolean).join(' · ');
  const line2 = [card.grade?.company, card.grade?.grade].filter(Boolean).join(' ');
  return [line1, line2].filter(Boolean).join('<br>');
}

function cardRow(card, options = {}) {
  if (!card) return '';
  const extra = options.extra || '';
  return `<a class="card-row" href="#/card/${encodeURIComponent(card.id)}">
    ${cardImageTag(card)}
    <div><h3>${escapeHtml(cardTitle(card))}</h3><p>${cardSubtitle(card)}</p><div class="row-meta-stack">${imageSourceBadge(card)}${extra}</div></div>
    <div class="card-price"><strong>${formatMoney(card.market?.value)}</strong><small>${card.market?.volume90 || 0} comps / 90d</small>${trendHtml(card.market)}</div>
  </a>`;
}

function chartSvg(sales) {
  const points = [...sales].filter((sale) => Number.isFinite(Number(sale.allInPrice))).sort((a, b) => new Date(a.soldAt) - new Date(b.soldAt));
  if (points.length < 2) return '<div class="empty">Not enough completed sales to chart.</div>';
  const prices = points.map((point) => Number(point.allInPrice));
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const width = 760;
  const height = 180;
  const spread = max - min || 1;
  const path = points.map((point, index) => {
    const x = 8 + (index / (points.length - 1)) * (width - 16);
    const y = height - 8 - ((Number(point.allInPrice) - min) / spread) * (height - 16);
    return `${index ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `<div class="chart"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Completed sale price history">
    <defs><linearGradient id="lineFill" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#f4d983" stop-opacity=".35"/><stop offset="1" stop-color="#f4d983" stop-opacity="0"/></linearGradient></defs>
    <path d="${path} L${width - 8},${height - 8} L8,${height - 8} Z" fill="url(#lineFill)"/>
    <path d="${path}" fill="none" stroke="#f4d983" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  </svg></div>`;
}

function openModal(title, bodyHtml) {
  modalRoot.innerHTML = `<div class="modal-backdrop" role="presentation"><section class="modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}"><div class="modal-head"><h2>${escapeHtml(title)}</h2><button class="modal-close" aria-label="Close">×</button></div>${bodyHtml}</section></div>`;
  const close = () => { modalRoot.innerHTML = ''; };
  modalRoot.querySelector('.modal-close').addEventListener('click', close);
  modalRoot.querySelector('.modal-backdrop').addEventListener('click', (event) => { if (event.target === event.currentTarget) close(); });
  return { root: modalRoot.querySelector('.modal'), close };
}

async function refreshIdentity() {
  try {
    state.auth = await api('/api/auth/me');
    accountLabel.textContent = state.auth.user?.name || 'Guest';
  } catch {
    state.auth = { authenticated: false, user: null, guestMode: false };
    accountLabel.textContent = 'Account';
  }
}

async function ensureConfig() {
  if (!state.config) state.config = await api('/api/config');
  return state.config;
}

async function imageFileToDataUrl(file, maxEdge = 1800, quality = 0.88) {
  if (!file.type.startsWith('image/')) throw new Error('Choose a JPEG, PNG, or WebP image.');
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.filter = 'contrast(1.08) saturate(1.03) brightness(1.02)';
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', quality);
}

function videoFrameToDataUrl(video, maxEdge = 1800, quality = 0.88) {
  if (!video.videoWidth || !video.videoHeight) throw new Error('Camera frame is not ready.');
  const scale = Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.filter = 'contrast(1.08) saturate(1.03) brightness(1.02)';
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

async function renderHome() {
  await Promise.all([ensureConfig(), refreshIdentity()]);
  if (state.config.requireAuthentication && !state.auth.authenticated) {
    view.innerHTML = `
      <section class="hero">
        <div class="eyebrow">Private, evidence-first card intelligence</div>
        <h1>Scan cards.<br>Keep control.</h1>
        <p>Create a ManeFlow account to photograph or upload cards, review conservative draft identifications and valuations, and save confirmed results to your private Vault.</p>
        <div class="actions"><a class="button primary" href="#/account">Create account</a><a class="button" href="#/account">Sign in</a><a class="button ghost" href="/privacy.html">Privacy</a><a class="button ghost" href="/terms.html">Terms</a></div>
      </section>
      <div class="grid three">
        <section class="panel"><div class="eyebrow">1. Upload</div><h3>Phone or desktop</h3><p class="subtle">Take a photo or choose card images from a supported browser.</p></section>
        <section class="panel"><div class="eyebrow">2. Review</div><h3>Evidence, not guesses</h3><p class="subtle">ManeFlow may identify, price, or explicitly abstain when evidence is insufficient.</p></section>
        <section class="panel"><div class="eyebrow">3. Save</div><h3>Your private Vault</h3><p class="subtle">Only confirmed records are saved to the authenticated account.</p></section>
      </div>
      <div class="notice warning" style="margin-top:16px">Beta results require human confirmation. ManeFlow does not authenticate cards, assign official grades, or guarantee market value.</div>`;
    return;
  }
  loading();
  const [config, dashboard, pulse] = await Promise.all([ensureConfig(), api('/api/dashboard'), api('/api/market/pulse')]);
  const alerts = dashboard.watchlist.filter((item) => item.triggered).length;
  const decision = dashboard.intelligence?.decisionSupport || null;
  view.innerHTML = `
    ${modeBanner(config.marketMode)}
    <section class="hero">
      <div class="eyebrow">The card decision engine</div>
      <h1>Scan it.<br>Know it. Act.</h1>
      <p>ManeFlow combines card identification, completed-sale intelligence, valuation confidence, collection performance, alerts, and selling workflows in one fast mobile experience.</p>
      <div class="actions"><a class="button primary" href="#/scan">Scan a card</a><a class="button" href="#/cert">Extract a cert</a><a class="button" href="#/search">Search the market</a><a class="button" href="#/lots">Analyze an eBay lot</a><a class="button" href="#/bulk">Ricoh bulk intake</a><a class="button ghost" href="#/sources">View data sources</a></div>
    </section>
    <div class="grid metrics">
      <div class="metric"><small>Collection value</small><strong>${formatMoney(dashboard.portfolio.totalValue)}</strong><p class="subtle">${dashboard.collection.reduce((sum, item) => sum + item.quantity, 0)} cards tracked</p></div>
      <div class="metric"><small>Total gain</small><strong class="${dashboard.portfolio.totalGain >= 0 ? 'positive' : 'negative'}">${formatMoney(dashboard.portfolio.totalGain)}</strong><p class="subtle">${dashboard.portfolio.totalGainPct === null ? 'Add cost basis for ROI' : `${dashboard.portfolio.totalGainPct}% return`}</p></div>
      <div class="metric"><small>Estimated liquid value</small><strong>${formatMoney(dashboard.portfolio.estimatedLiquidValue)}</strong><p class="subtle">Liquidity-adjusted estimate</p></div>
      <div class="metric"><small>Triggered alerts</small><strong>${alerts}</strong><p class="subtle">${dashboard.watchlist.length} cards watched</p></div>
    </div>
    <div style="margin-top:16px">${portfolioDecisionPanel(decision)}</div>
    <div class="section-head"><div><div class="eyebrow">Market pulse</div><h2>Cards moving now</h2></div><a href="#/search">Search all</a></div>
    <div class="card-list">${pulse.hot.slice(0, 6).map((card) => cardRow(card)).join('') || '<div class="empty">Connect approved sales data to populate the market pulse.</div>'}</div>
    <div class="grid two" style="margin-top:24px">
      <section class="panel"><div class="eyebrow">Fast workflow</div><h3>At a card show</h3><p class="subtle">Scan front and back, confirm the exact variant, inspect completed sales and confidence, then add, watch, price, or prepare a listing without leaving the screen.</p><a class="button small" href="#/scan">Open scanner</a></section>
      <section class="panel"><div class="eyebrow">Transparent by design</div><h3>Every value has context</h3><p class="subtle">ManeFlow shows comp count, source diversity, freshness, trend, outliers, liquidity, and an expected range instead of pretending one number is absolute.</p><a class="button small" href="#/sources">Review sources</a></section>
    </div>`;
}

async function renderSearch() {
  view.innerHTML = `
    <div class="section-head"><div><div class="eyebrow">Universal lookup</div><h2>Search cards</h2></div><a href="#/scan">Use camera</a></div>
    <form id="search-form" class="search-bar"><input id="search-input" type="search" autocomplete="off" placeholder="Player, year, set, number, parallel, grade…" aria-label="Search cards"><button class="button primary" type="submit">Search</button></form>
    <div class="filters"><select id="sport-filter" aria-label="Sport"><option value="">All categories</option><option>Baseball</option><option>Basketball</option><option>Football</option><option>Pokemon</option><option>Hockey</option><option>Soccer</option></select><select id="grader-filter" aria-label="Grader"><option value="">All grades</option><option>PSA</option><option>BGS</option><option>SGC</option><option>CGC</option><option>RAW</option></select><input id="year-filter" inputmode="numeric" placeholder="Year" aria-label="Year"></div>
    <div id="search-summary" class="subtle" style="font-size:12px;margin-bottom:10px"></div>
    <div id="search-results">${skeletonRows(3)}</div>`;
  const form = document.querySelector('#search-form');
  const input = document.querySelector('#search-input');
  const sport = document.querySelector('#sport-filter');
  const grader = document.querySelector('#grader-filter');
  const year = document.querySelector('#year-filter');
  const results = document.querySelector('#search-results');
  const summary = document.querySelector('#search-summary');
  let runId = 0;
  async function run() {
    const currentRun = ++runId;
    const query = input.value.trim();
    results.innerHTML = skeletonRows(3);
    summary.innerHTML = `<span class="status configured">Searching</span> ${escapeHtml(query || 'recent catalog cards')}`;
    const params = new URLSearchParams({ q: input.value.trim(), sport: sport.value, grader: grader.value, year: year.value.trim(), limit: '50' });
    let data;
    try {
      data = await api(`/api/cards?${params}`);
    } catch (error) {
      if (currentRun !== runId) return;
      summary.textContent = 'Search is temporarily unavailable.';
      results.innerHTML = emptyState('Search could not finish', error.message || 'Try again, or use the scan screen as a fallback.');
      return;
    }
    if (currentRun !== runId) return;
    summary.textContent = `${data.total} result${data.total === 1 ? '' : 's'} · ${modeLabel(data.marketMode)}`;
    results.innerHTML = data.cards.length ? `<div class="card-list">${data.cards.map((card) => cardRow(card)).join('')}</div>` : emptyState('No exact catalog match', 'Try fewer details, scan the card, or import more checklist/catalog data. Unmatched cards can still be saved safely.');
  }
  form.addEventListener('submit', (event) => { event.preventDefault(); run().catch((error) => showToast(error.message)); });
  input.addEventListener('input', debounce(() => run().catch((error) => showToast(error.message)), 180));
  [sport, grader, year].forEach((element) => element.addEventListener('change', () => run().catch((error) => showToast(error.message))));
  await run();
  input.focus();
}

function scanThumb(label, dataUrl) {
  return `<div class="scan-thumb ${dataUrl ? 'ready' : 'missing'}">${dataUrl ? `<img src="${dataUrl}" alt="${label} card image">` : '<div class="camera-placeholder" style="aspect-ratio:3/4"><div><strong>Needed</strong><p>Add when visible</p></div></div>'}<small>${escapeHtml(label)} ${dataUrl ? '<span class="status included">Ready</span>' : '<span class="status needs_review">Missing</span>'}</small></div>`;
}

function scanCaptureChecklist() {
  return `<div class="capture-checklist">
    <span class="status ${state.scan.front ? 'included' : 'needs_review'}">Front ${state.scan.front ? 'ready' : 'needed'}</span>
    <span class="status ${state.scan.back ? 'included' : 'needs_review'}">Back ${state.scan.back ? 'ready' : 'recommended'}</span>
    <span class="status ${state.scan.cert ? 'included' : 'needs_review'}">Cert ${state.scan.cert ? 'ready' : 'if graded'}</span>
  </div>`;
}

function imagingAssessmentPanel(workerScan = null) {
  if (!workerScan) return '';
  const surface = workerScan.surface_analysis || null;
  const centering = workerScan.centering_assessment || null;
  if (!surface && !centering) return '';
  const surfaceConfidence = Math.round(Number(workerScan.refractor_confidence ?? surface?.refractor_confidence ?? 0) * 100);
  const surfaceType = String(workerScan.detected_surface_type || surface?.detected_surface_type || 'UNRESOLVED').replaceAll('_', ' ');
  const warnings = [...(surface?.warnings || []), ...(centering?.warnings || [])].slice(0, 5);
  return `<section class="panel imaging-assessment-panel">
    <div class="panel-title"><div><div class="eyebrow">Parallel & pre-grading analysis</div><h3>${escapeHtml(surfaceType)}</h3></div><span class="status ${surfaceConfidence >= 70 ? 'included' : 'needs_review'}">Surface ${surfaceConfidence}%</span></div>
    ${surface ? `<div class="grid three">
      <div class="metric"><small>Surface family</small><strong>${escapeHtml(surfaceType)}</strong><p>Heuristic evidence only</p></div>
      <div class="metric"><small>Rainbow variance</small><strong>${Math.round(Number(surface.rainbow_variance || 0) * 100)}%</strong><p>Color-gradient shift</p></div>
      <div class="metric"><small>Reflectivity</small><strong>${Math.round(Number(surface.reflectivity_score || 0) * 100)}%</strong><p>${Number(surface.high_reflectivity_patches || 0)} micro-patches</p></div>
    </div>` : ''}
    ${centering ? `<div class="grid three">
      <div class="metric"><small>Left / right</small><strong>${escapeHtml(centering.centering_lr || '—')}</strong><p>${Number(centering.left_border_px || 0)}px / ${Number(centering.right_border_px || 0)}px</p></div>
      <div class="metric"><small>Top / bottom</small><strong>${escapeHtml(centering.centering_tb || '—')}</strong><p>${Number(centering.top_border_px || 0)}px / ${Number(centering.bottom_border_px || 0)}px</p></div>
      <div class="metric"><small>Centering estimate</small><strong>${Number(centering.estimated_centering_score || 0).toFixed(1)}/10</strong><p>Corner estimate ${Number(centering.corner_wear_score || 0).toFixed(1)}/10</p></div>
    </div><div class="source-row"><span>Visible edge wear signal</span><strong>${centering.edge_wear_detected ? 'Detected — inspect manually' : 'Not detected'}</strong></div>` : ''}
    ${warnings.length ? `<div class="notice warning compact-notice">${warnings.map(escapeHtml).join('<br>')}</div>` : ''}
    <small class="subtle">Computer-vision estimate only. Foil family, centering, corners, edges, surface condition, authenticity, and professional grade must be confirmed from high-resolution multi-angle images.</small>
  </section>`;
}

function marketContextPanel(context = {}) {
  if (!context || !context.provider) return '';
  if (!context.available) {
    const copy = context.reason === 'credentials_required'
      ? `${context.provider} is ready to connect in Desktop Settings.`
      : `${context.provider} market context is unavailable for this scan.`;
    return `<section class="panel market-context-panel"><div class="panel-title"><div><h3>${escapeHtml(context.provider)} context</h3><p class="subtle">${escapeHtml(copy)}</p></div><span class="status needs_review">Optional</span></div></section>`;
  }
  if (context.provider === 'JustTCG') {
    const card = context.cards?.[0];
    const variants = (card?.variants || []).filter((variant) => variant.price != null).slice(0, 6);
    return `<section class="panel market-context-panel"><div class="panel-title"><div><h3>JustTCG market context</h3><p class="subtle">${escapeHtml(card ? `${card.name} · ${card.setName || card.setId || ''}` : 'TCG variant context')}</p></div><span class="status configured">Current context</span></div>${variants.length ? `<div class="grid three">${variants.map((variant) => `<div class="metric"><small>${escapeHtml([variant.condition, variant.printing, variant.language].filter(Boolean).join(' · '))}</small><strong>${formatCurrency(variant.price)}</strong><p>${variant.lastUpdated ? `Updated ${escapeHtml(formatDate(variant.lastUpdated))}` : 'Current provider snapshot'}</p></div>`).join('')}</div>` : '<div class="empty">No priced variants returned.</div>'}<div class="notice compact-notice">${escapeHtml(context.explanation || '')}</div></section>`;
  }
  const product = context.product || {};
  const prices = product.prices || {};
  const rows = [['Raw', prices.raw], ['Grade 9', prices.graded9], ['PSA 10', prices.psa10], ['BGS 10', prices.bgs10], ['CGC 10', prices.cgc10], ['SGC 10', prices.sgc10]].filter(([, value]) => value != null);
  return `<section class="panel market-context-panel"><div class="panel-title"><div><h3>SportsCardsPro guide context</h3><p class="subtle">${escapeHtml(product.productName || '')} · ${escapeHtml(product.setName || '')}</p></div><span class="status configured">Guide context</span></div>${rows.length ? `<div class="grid three">${rows.map(([label, value]) => `<div class="metric"><small>${escapeHtml(label)}</small><strong>${formatCurrency(value)}</strong></div>`).join('')}</div>` : '<div class="empty">No current guide values returned.</div>'}<div class="notice compact-notice">${escapeHtml(context.explanation || '')}</div></section>`;
}

async function renderScan() {
  stopCamera();
  const config = await ensureConfig();
  view.innerHTML = `
    <div class="section-head"><div><div class="eyebrow">Instant identification</div><h2>Scan a card</h2></div><span class="status ${config.visionEnabled ? 'configured' : 'demo'}">${config.visionEnabled ? 'AI vision enabled' : 'Text fallback'}</span></div>
    <div class="grid two">
      <div>
        <div class="camera-shell" id="camera-shell"><div class="camera-placeholder" id="camera-placeholder"><div><strong>Camera ready when you are</strong><p>Use the rear camera, fill the frame, avoid glare, and capture both sides for the strongest match.</p></div></div><video id="camera" autoplay playsinline muted class="hidden"></video><div class="scan-frame"></div></div>
        <div class="capture-strip"><button id="start-camera" class="button primary">Start camera</button><button id="capture-front" class="button hidden">Capture front</button><button id="capture-back" class="button hidden">Capture back</button><button id="capture-cert" class="button hidden">Capture cert</button></div>
        <div id="scan-capture-checklist">${scanCaptureChecklist()}</div>
        <div class="scan-thumbs" id="scan-thumbs">${scanThumb('Front', state.scan.front)}${scanThumb('Back', state.scan.back)}${scanThumb('Cert label', state.scan.cert)}</div>
      </div>
      <section class="panel">
        <h3>Photo or manual fallback</h3>
        <p class="subtle">Front, back, and a close cert-label image improve card-number, parallel, barcode, QR, and certification recognition. Images are processed remotely only when AI vision is configured and you submit the scan.</p>
        <div class="form-grid two"><div><label>Front image</label><input id="front-file" type="file" accept="image/jpeg,image/png,image/webp" capture="environment"></div><div><label>Back image</label><input id="back-file" type="file" accept="image/jpeg,image/png,image/webp" capture="environment"></div><div><label>Cert/slab label image</label><input id="cert-file" type="file" accept="image/jpeg,image/png,image/webp" capture="environment"></div><div><label>Barcode / QR payload</label><input id="cert-payload" placeholder="Paste decoded QR/barcode or cert URL"></div></div>
        <div style="margin-top:12px"><label>Visible cert label text</label><textarea id="cert-text" rows="3" placeholder="Example: PSA GEM MT 10 Cert #12345678 2018 Topps Update Shohei Ohtani #US1"></textarea></div>
        <div style="margin-top:12px"><label>Visible details</label><textarea id="manual-scan" rows="4" placeholder="Example: 2018 Topps Update Shohei Ohtani US1 PSA 10"></textarea></div>
        <button id="identify-button" class="button primary" style="width:100%;margin-top:13px">Identify and price</button>
        <div id="scan-status" style="margin-top:12px"></div>
      </section>
    </div>
    <div id="scan-results" style="margin-top:18px"></div>`;

  const video = document.querySelector('#camera');
  const placeholder = document.querySelector('#camera-placeholder');
  const startButton = document.querySelector('#start-camera');
  const captureFront = document.querySelector('#capture-front');
  const captureBack = document.querySelector('#capture-back');
  const captureCert = document.querySelector('#capture-cert');
  const thumbs = document.querySelector('#scan-thumbs');
  const checklist = document.querySelector('#scan-capture-checklist');
  const status = document.querySelector('#scan-status');
  const results = document.querySelector('#scan-results');
  const updateThumbs = () => {
    checklist.innerHTML = scanCaptureChecklist();
    thumbs.innerHTML = `${scanThumb('Front', state.scan.front)}${scanThumb('Back', state.scan.back)}${scanThumb('Cert label', state.scan.cert)}`;
  };

  startButton.addEventListener('click', async () => {
    try {
      stopCamera();
      state.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 2560 } }, audio: false });
      video.srcObject = state.stream;
      video.classList.remove('hidden');
      placeholder.classList.add('hidden');
      startButton.textContent = 'Restart camera';
      captureFront.classList.remove('hidden');
      captureBack.classList.remove('hidden');
      captureCert.classList.remove('hidden');
    } catch (error) {
      status.innerHTML = `<div class="notice warning">Camera access failed: ${escapeHtml(error.message)}. Use photo upload instead.</div>`;
    }
  });

  captureFront.addEventListener('click', () => {
    try { state.scan.front = videoFrameToDataUrl(video); state.scan.frontName = 'camera-front.jpg'; updateThumbs(); showToast('Front captured'); }
    catch (error) { showToast(error.message); }
  });
  captureBack.addEventListener('click', () => {
    try { state.scan.back = videoFrameToDataUrl(video); state.scan.backName = 'camera-back.jpg'; updateThumbs(); showToast('Back captured'); }
    catch (error) { showToast(error.message); }
  });
  captureCert.addEventListener('click', () => {
    try { state.scan.cert = videoFrameToDataUrl(video); state.scan.certName = 'camera-cert-label.jpg'; updateThumbs(); showToast('Cert label captured'); }
    catch (error) { showToast(error.message); }
  });

  async function loadFile(input, side) {
    const file = input.files?.[0];
    if (!file) return;
    status.innerHTML = '<div class="notice">Optimizing image on this device…</div>';
    try {
      state.scan[side] = await imageFileToDataUrl(file);
      state.scan[`${side}Name`] = file.name;
      updateThumbs();
      status.innerHTML = '';
    } catch (error) { status.innerHTML = `<div class="notice warning">${escapeHtml(error.message)}</div>`; }
  }
  document.querySelector('#front-file').addEventListener('change', (event) => loadFile(event.currentTarget, 'front'));
  document.querySelector('#back-file').addEventListener('change', (event) => loadFile(event.currentTarget, 'back'));
  document.querySelector('#cert-file').addEventListener('change', (event) => loadFile(event.currentTarget, 'cert'));

  document.querySelector('#identify-button').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const manualText = document.querySelector('#manual-scan').value.trim();
    const certText = document.querySelector('#cert-text').value.trim();
    const certPayload = document.querySelector('#cert-payload').value.trim();
    if (!state.scan.front && !state.scan.cert && !manualText && !certText && !certPayload) return showToast('Capture/upload a card or cert label, or enter visible details.');
    setBusy(button, true, 'Analyzing…');
    status.innerHTML = '<div class="notice"><strong>Analyzing scan evidence...</strong><br>Checking image quality, visible text, cert/barcode evidence, catalog candidates, and completed-sale value.</div>';
    results.innerHTML = skeletonRows(2);
    try {
      const data = await api('/api/scan', { method: 'POST', body: JSON.stringify({
        frontDataUrl: state.scan.front, backDataUrl: state.scan.back, certDataUrl: state.scan.cert,
        imageName: state.scan.frontName || state.scan.certName, manualText, certText, barcodeText: certPayload, qrText: certPayload,
      }) });
      const warnings = Array.isArray(data.vision?.warnings) ? data.vision.warnings : [];
      const needsConfirmation = data.scanConfidence?.needsManualConfirmation;
      const parallelWarning = (data.scanConfidence?.warnings || []).some((item) => String(item).toLowerCase().includes('parallel'));
      const scene = data.recognition?.scene;
      const sceneCopy = scene ? `<br><strong>Scene:</strong> ${escapeHtml(String(scene.type || 'single_card').replaceAll('_', ' '))} · ${Number(data.recognition?.summary?.detectedCards || 0)} visible card region(s)` : '';
      status.innerHTML = `<div class="notice ${data.exact && !needsConfirmation ? 'success' : 'warning'}"><strong>${needsConfirmation ? 'Confirm before acting' : 'Scan result ready'}</strong><br>${escapeHtml(data.message)}${sceneCopy}${warnings.length ? `<br><strong>Image notes:</strong> ${warnings.map(escapeHtml).join(', ')}` : ''}<div class="match-stack"><span class="status ${needsConfirmation ? 'needs_review' : 'included'}">${needsConfirmation ? 'Needs better scan or confirmation' : 'Ready for review'}</span>${parallelWarning ? '<span class="status needs_review">Parallel uncertain</span>' : ''}${data.gradedCert?.slabbed ? '<span class="status configured">Cert evidence parsed</span>' : ''}</div></div>`;
      results.innerHTML = `<div class="section-head"><div><div class="eyebrow">Candidate matches</div><h2>${data.exact && !data.scanConfidence?.needsManualConfirmation ? 'High-confidence result' : 'Confirm the exact card'}</h2></div><span class="status ${escapeHtml(data.marketMode)}">${escapeHtml(modeLabel(data.marketMode))}</span></div>
        <div class="notice compact-notice"><strong>Why this match?</strong><br>ManeFlow blends image facts, visible text, cert/barcode evidence, and catalog ranking. Low confidence, uncertain parallels, missing back photos, or cert conflicts require manual confirmation.</div>
        <div class="grid two">${scanConfidencePanel(data.scanConfidence)}${gradedCertPanel(data.gradedCert)}</div>
        ${recognitionScenePanel(data.recognition)}
        ${imagingAssessmentPanel(data.workerScan)}
        ${marketContextPanel(data.marketContext)}
        <div class="card-list" style="margin-top:14px">${data.matches.length ? data.matches.map((card, index) => cardRow(card, { extra: `<div class="match-stack"><span class="trend ${index === 0 ? 'rising' : ''}">${Math.round((card.confidence || 0) * 100)}% identity match</span>${index === 0 && data.scanConfidence?.needsManualConfirmation ? '<span class="status needs_review">Needs confirmation</span>' : ''}</div>` })).join('') : emptyState('No catalog match yet', 'Search manually, add visible back/cert text, or import a larger checklist catalog. ManeFlow will not invent a card identity.')}</div>`;
    } catch (error) {
      status.innerHTML = `<div class="notice warning">${escapeHtml(error.message)}</div>`;
      results.innerHTML = '';
    } finally { setBusy(button, false); }
  });
}

async function renderCert() {
  stopCamera();
  const config = await ensureConfig();
  let certImage = '';
  let certImageName = '';
  view.innerHTML = `
    <div class="section-head"><div><div class="eyebrow">Cert accuracy system</div><h2>Extract slab data</h2></div><span class="status ${config.visionEnabled ? 'configured' : 'demo'}">${config.visionEnabled ? 'AI label vision enabled' : 'Text + barcode mode'}</span></div>
    <div class="grid two">
      <section class="panel">
        <div class="scan-thumbs" id="cert-thumb">${scanThumb('Cert label', certImage)}</div>
        <div class="form-grid" style="margin-top:14px">
          <div><label>Cert/slab label image</label><input id="cert-only-file" type="file" accept="image/jpeg,image/png,image/webp" capture="environment"></div>
          <div><label>Decoded barcode, QR text, or official cert URL</label><input id="cert-only-payload" placeholder="https://www.psacard.com/cert/12345678"></div>
          <div><label>Visible slab text</label><textarea id="cert-only-text" rows="5" placeholder="PSA GEM MT 10&#10;Cert #12345678&#10;2018 Topps Update Series&#10;Shohei Ohtani&#10;#US1 Base Rookie Debut"></textarea></div>
          <div><label>Optional card details</label><textarea id="cert-only-manual" rows="3" placeholder="Add player, set, card number, grade, or parallel when visible"></textarea></div>
          <button id="cert-extract-button" class="button primary">Extract cert intelligence</button>
        </div>
      </section>
      <section class="panel">
        <h3>What ManeFlow checks</h3>
        <div class="source-row"><span>Barcode / QR evidence</span><strong>Parsed separately</strong></div>
        <div class="source-row"><span>Visible label text</span><strong>OCR-normalized</strong></div>
        <div class="source-row"><span>Cert conflicts</span><strong>Forced review</strong></div>
        <div class="source-row"><span>Official cert link</span><strong>Public-safe</strong></div>
        <div class="notice warning compact-notice">Cert extraction improves card identity confidence. It is not authentication, grading, or a guarantee. Always confirm high-value cards on the official grading-company page.</div>
      </section>
    </div>
    <div id="cert-status" style="margin-top:14px"></div>
    <div id="cert-results" style="margin-top:14px"></div>`;

  const thumb = document.querySelector('#cert-thumb');
  const status = document.querySelector('#cert-status');
  const results = document.querySelector('#cert-results');
  document.querySelector('#cert-only-file').addEventListener('change', async (event) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    status.innerHTML = '<div class="notice">Optimizing cert label image on this device...</div>';
    try {
      certImage = await imageFileToDataUrl(file);
      certImageName = file.name;
      thumb.innerHTML = scanThumb('Cert label', certImage);
      status.innerHTML = '';
    } catch (error) {
      status.innerHTML = `<div class="notice warning">${escapeHtml(error.message)}</div>`;
    }
  });
  document.querySelector('#cert-extract-button').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const certText = document.querySelector('#cert-only-text').value.trim();
    const certPayload = document.querySelector('#cert-only-payload').value.trim();
    const manualText = document.querySelector('#cert-only-manual').value.trim();
    if (!certImage && !certText && !certPayload && !manualText) return showToast('Upload a slab label or enter cert details first.');
    setBusy(button, true, 'Extracting...');
    status.innerHTML = '<div class="notice">Reading cert evidence and checking for conflicts...</div>';
    results.innerHTML = '<div class="skeleton"></div>';
    try {
      const data = await api('/api/cert/extract', {
        method: 'POST',
        body: JSON.stringify({ certDataUrl: certImage, imageName: certImageName || 'cert-label', certText, manualText, barcodeText: certPayload, qrText: certPayload }),
      });
      status.innerHTML = `<div class="notice ${data.gradedCert?.extractionTier === 'cert_locked' ? 'success' : 'warning'}">${escapeHtml(data.message)}</div>`;
      results.innerHTML = `
        <div class="grid two">${gradedCertPanel(data.gradedCert)}${scanConfidencePanel(data.scanConfidence)}</div>
        <div class="section-head"><div><div class="eyebrow">Likely card matches</div><h2>${data.exact && !data.scanConfidence?.needsManualConfirmation ? 'Cert-locked candidate' : 'Confirm the exact card'}</h2></div><span class="status ${escapeHtml(data.marketMode)}">${escapeHtml(modeLabel(data.marketMode))}</span></div>
        <div class="card-list">${data.matches.length ? data.matches.map((card, index) => cardRow(card, { extra: `<span class="trend ${index === 0 ? 'rising' : ''}">${Math.round((card.confidence || 0) * 100)}% identity match</span>` })).join('') : '<div class="empty">No catalog match yet. Add more visible label text or search manually.</div>'}</div>`;
    } catch (error) {
      status.innerHTML = `<div class="notice warning">${escapeHtml(error.message)}</div>`;
      results.innerHTML = '';
    } finally {
      setBusy(button, false);
    }
  });
}



function lotIdentityTitle(card = {}) {
  const title = [card.year, card.brand, card.set_name, card.player_name].filter(Boolean).join(' ');
  const detail = [card.card_number ? `#${card.card_number}` : '', card.parallel, card.grader, card.grade].filter(Boolean).join(' · ');
  return { title: title || 'Unresolved card', detail: detail || 'Exact card/variant needs confirmation' };
}

function lotRepresentativeItems(result = {}) {
  const representatives = new Map();
  for (const source of result.images || []) {
    for (const item of source.detections || []) {
      const key = item.physical_item_group || item.item_id;
      const current = representatives.get(key);
      if (!current || Number(item.detection_confidence || 0) > Number(current.detection_confidence || 0)) representatives.set(key, item);
    }
  }
  return [...representatives.values()].filter((item) => item.evidence?.is_trading_card !== false);
}

function lotItemRow(item, index) {
  const identity = lotIdentityTitle(item.predicted_card || {});
  const identityPct = Math.round(Number(item.identity_confidence || 0) * 100);
  const variantPct = Math.round(Number(item.variant_confidence || 0) * 100);
  const pricingPct = Math.round(Number(item.pricing_confidence || 0) * 100);
  const warnings = (item.warnings || []).slice(0, 3);
  const surface = item.surface_analysis || null;
  const centering = item.centering_assessment || null;
  const surfaceLabel = surface?.detected_surface_type ? String(surface.detected_surface_type).replaceAll('_', ' ') : null;
  return `<article class="lot-item-row">
    <div class="lot-index">${index + 1}</div>
    <div class="lot-item-copy">
      <div class="lot-item-head"><div><strong>${escapeHtml(identity.title)}</strong><small>${escapeHtml(identity.detail)}</small></div><span class="status ${item.pricing_status === 'verified' ? 'included' : 'needs_review'}">${escapeHtml(String(item.pricing_status || 'unpriced').replaceAll('_', ' '))}</span></div>
      <div class="lot-confidence-grid"><span>Detect <b>${Math.round(Number(item.detection_confidence || 0) * 100)}%</b></span><span>Identity <b>${identityPct}%</b></span><span>Variant <b>${variantPct}%</b></span><span>Price <b>${pricingPct}%</b></span></div>
      ${(surfaceLabel || centering) ? `<div class="row-meta-stack">${surfaceLabel ? `<span class="status ${Number(surface.refractor_confidence || 0) >= 0.7 ? 'included' : 'needs_review'}">${escapeHtml(surfaceLabel)} ${Math.round(Number(surface.refractor_confidence || 0) * 100)}%</span>` : ''}${centering ? `<span class="status">Center ${escapeHtml(centering.centering_lr || '—')} / ${escapeHtml(centering.centering_tb || '—')}</span>` : ''}</div>` : ''}
      ${warnings.length ? `<p class="lot-warning">${warnings.map(escapeHtml).join(' · ')}</p>` : ''}
    </div>
    <div class="lot-value"><strong>${formatMoney(item.value_mid)}</strong><small>${item.value_low != null || item.value_high != null ? `${formatMoney(item.value_low)}–${formatMoney(item.value_high)}` : 'No verified comps'}</small></div>
  </article>`;
}

function renderLotResult(result) {
  const economics = result.economics || {};
  const items = lotRepresentativeItems(result);
  const decisionClass = String(economics.decision || '').toLowerCase().includes('buy') || Number(economics.expected_profit || 0) > 0 ? 'success' : 'warning';
  return `<section class="panel lot-summary-panel">
      <div class="section-head"><div><div class="eyebrow">Lot opportunity result</div><h2>${escapeHtml(String(economics.decision || 'Review required').replaceAll('_', ' '))}</h2></div><span class="status ${economics.pricing_status === 'priced' ? 'included' : 'needs_review'}">${escapeHtml(String(economics.pricing_status || 'unpriced').replaceAll('_', ' '))}</span></div>
      <div class="notice ${decisionClass}">${escapeHtml(economics.explanation || 'Review item identities and pricing confidence before buying.')}</div>
      <div class="grid metrics lot-metrics">
        <div class="metric"><small>Total acquisition</small><strong>${formatMoney(economics.acquisition_total)}</strong><p class="subtle">BIN + shipping + tax</p></div>
        <div class="metric"><small>Expected gross value</small><strong>${formatMoney(economics.expected_gross_value)}</strong><p class="subtle">Conservative ${formatMoney(economics.conservative_gross_value)}</p></div>
        <div class="metric"><small>Expected profit</small><strong class="${Number(economics.expected_profit || 0) >= 0 ? 'positive' : 'negative'}">${formatMoney(economics.expected_profit)}</strong><p class="subtle">ROI ${economics.expected_roi == null ? '—' : `${Number(economics.expected_roi).toFixed(1)}%`}</p></div>
        <div class="metric"><small>Recommended max buy</small><strong>${formatMoney(economics.recommended_max_purchase)}</strong><p class="subtle">At target ROI</p></div>
      </div>
      <div class="source-row"><span>Detected physical cards</span><strong>${Number(result.physical_item_count || items.length)}</strong></div>
      <div class="source-row"><span>Priced / unresolved</span><strong>${Number(economics.priced_items || 0)} / ${Number(economics.unresolved_items || 0)}</strong></div>
      <div class="source-row"><span>Analysis job</span><strong>${escapeHtml(result.job_id || 'local')}</strong></div>
    </section>
    <div class="section-head"><div><div class="eyebrow">Card-by-card review</div><h2>${items.length} physical item${items.length === 1 ? '' : 's'}</h2></div><small>Repeated listing photos are reconciled before counting.</small></div>
    <div class="lot-item-list">${items.length ? items.map(lotItemRow).join('') : emptyState('No countable cards detected', 'Add clearer images or use individual screenshots. ManeFlow will not invent hidden cards.')}</div>
    ${(result.warnings || []).length ? `<section class="panel" style="margin-top:14px"><h3>Analysis warnings</h3><ul class="warning-list">${result.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}</ul></section>` : ''}`;
}


async function renderSurvey() {
  const session = await api('/api/auth/session').catch(() => ({ authenticated: false }));
  const saved = session.authenticated ? await api('/api/collection-surveys').catch(() => ({ surveys: [] })) : { surveys: [] };
  view.innerHTML = `<section class="hero compact"><div><div class="eyebrow">ManeFlow Collection Survey</div><h1>Photograph the room.<br>Understand the collection.</h1><p>Build a conservative, explainable collection-size and value survey from wide scenes, overlapping photos, containers, stacks, binders, slabs, and sealed products.</p></div><div class="notice warning"><strong>Evidence-bounded estimates</strong><br>ManeFlow reports low, expected, and high ranges. Closed or hidden contents remain unknown until sampled.</div></section>
  <section class="panel"><div class="section-head"><div><div class="eyebrow">Guided capture</div><h2>Start a survey</h2></div><span class="status needs_review">Human review built in</span></div>
    <form id="survey-form" class="form-grid">
      <div class="form-grid two"><div><label>Survey title</label><input id="survey-title" value="Collection survey"></div><div><label>Survey type</label><select id="survey-type"><option value="collection_purchase">Collection purchase</option><option value="personal_collection">Personal collection</option><option value="storage_unit">Storage unit</option><option value="card_room">Card room</option><option value="store_inventory">Store inventory</option><option value="card_show_case">Card-show case</option><option value="breaker_inventory">Breaker inventory</option><option value="estate">Estate</option><option value="insurance_documentation">Insurance documentation</option><option value="other">Other</option></select></div></div>
      <div><label>Wide and overlapping photographs</label><input id="survey-images" type="file" accept="image/jpeg,image/png,image/webp" multiple><small class="subtle">Add establishing and close-up images. Image files remain local in this workflow; only dimensions and quality metadata are submitted.</small></div>
      <div id="survey-image-quality" class="grid cards"></div>
      <div class="section-head"><div><div class="eyebrow">Object evidence</div><h3>Containers and visible items</h3></div><button type="button" class="button" id="add-survey-object">Add object</button></div>
      <div id="survey-objects"></div>
      <div class="form-grid two"><div><label>Hidden or unscanned areas</label><textarea id="survey-hidden" placeholder="Behind shelf, unopened tote, back wall..."></textarea></div><div><label>Location label</label><input id="survey-location" placeholder="Storage room, Memphis"></div></div>
      <div class="actions"><button type="button" class="button" id="estimate-survey">Generate estimate</button><button class="button primary">Save survey</button></div>
    </form>
    <div id="survey-result"></div>
  </section>
  <section class="panel"><div class="section-head"><div><div class="eyebrow">Saved work</div><h2>Recent surveys</h2></div></div>${(saved.surveys || []).length ? saved.surveys.slice(0,10).map((survey) => `<div class="source-row"><div><strong>${escapeHtml(survey.title)}</strong><small>${formatDate(survey.updatedAt)} · ${survey.scene.uniqueObjects} unique objects · ${survey.countEstimate.confidence} confidence</small></div><span>${survey.countEstimate.low.toLocaleString()}–${survey.countEstimate.high.toLocaleString()}</span></div>`).join('') : '<div class="empty">No saved surveys yet.</div>'}</section>`;

  const objectsRoot = document.querySelector('#survey-objects');
  const objectTypes = ['one_row_box','two_row_box','three_row_box','four_row_box','five_row_box','shoe_box','graded_card_box','toploader_box','tcg_box','plastic_tote','card_drawer','drawer_tower','shelf','display_case','card_case','binder','binder_page','slab_case','raw_card','penny_sleeved_card','toploaded_card','one_touch','graded_slab','loose_stack','protected_stack','pack','hanger','blaster','mega_box','hobby_box','retail_box','sealed_case','tin','empty_storage_box','furniture','electronics','books','paperwork','clothing','people','animals','unknown_card_container'];
  function addObject(seed = {}) {
    const row = document.createElement('div'); row.className = 'panel inset survey-object-row';
    row.innerHTML = `<div class="form-grid two"><div><label>Object type</label><select class="survey-kind">${objectTypes.map((type) => `<option value="${type}" ${seed.kind===type?'selected':''}>${type.replaceAll('_',' ')}</option>`).join('')}</select></div><div><label>Label / stable scene key</label><input class="survey-label" placeholder="Shelf A · box 1" value="${escapeHtml(seed.label || '')}"></div></div><div class="form-grid four"><div><label>Quantity</label><input class="survey-quantity" type="number" min="1" max="10000" value="${seed.quantity || 1}"></div><div><label>Contents</label><select class="survey-content"><option>raw</option><option>penny sleeves</option><option>top loaders</option><option>slabs</option><option>mixed</option><option>unknown</option></select></div><div><label>Fullness %</label><input class="survey-fullness" type="number" min="0" max="100" value="${seed.fullness ?? 65}"></div><div><label>Visible direct count</label><input class="survey-direct" type="number" min="0" value="${seed.directCount || 0}"></div></div><div class="actions"><label><input class="survey-confirmed" type="checkbox"> User confirmed</label><button type="button" class="button ghost survey-remove">Remove</button></div>`;
    row.querySelector('.survey-remove').addEventListener('click', () => row.remove()); objectsRoot.append(row);
  }
  addObject({ kind: 'five_row_box', label: 'Shelf A · box 1' });
  document.querySelector('#add-survey-object').addEventListener('click', () => addObject());

  const imageMeta = [];
  document.querySelector('#survey-images').addEventListener('change', async (event) => {
    imageMeta.length = 0; const qualityRoot = document.querySelector('#survey-image-quality'); qualityRoot.innerHTML = '';
    for (const [index,file] of [...event.target.files].slice(0,100).entries()) {
      const url = URL.createObjectURL(file); const image = new Image(); image.src = url; await image.decode().catch(()=>{});
      const canvas = document.createElement('canvas'); const scale = Math.min(1, 320 / Math.max(image.naturalWidth || 1, image.naturalHeight || 1)); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale)); const ctx = canvas.getContext('2d'); ctx.drawImage(image,0,0,canvas.width,canvas.height);
      const pixels = ctx.getImageData(0,0,canvas.width,canvas.height).data; let brightness=0, edges=0, last=0; for(let i=0;i<pixels.length;i+=16){const lum=(pixels[i]+pixels[i+1]+pixels[i+2])/765; brightness+=lum; edges+=Math.abs(lum-last); last=lum;} const n=Math.max(1,pixels.length/16); const brightnessScore=brightness/n; const blurScore=Math.min(1,(edges/n)*8);
      const warnings=[]; if(brightnessScore<.2) warnings.push('Scene may be too dark'); if(blurScore<.18) warnings.push('Possible motion blur or low detail'); if(image.naturalWidth<900 || image.naturalHeight<700) warnings.push('Low resolution');
      imageMeta.push({ id:`image-${index+1}`, name:file.name, width:image.naturalWidth, height:image.naturalHeight, brightnessScore, blurScore });
      qualityRoot.insertAdjacentHTML('beforeend', `<article class="card"><img src="${url}" alt="${escapeHtml(file.name)}" style="width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:12px"><strong>${escapeHtml(file.name)}</strong><small>${image.naturalWidth}×${image.naturalHeight}</small>${warnings.length?`<div class="notice warning">${warnings.join('<br>')}</div>`:'<div class="notice success">Capture quality looks usable.</div>'}</article>`);
    }
  });

  function payload() {
    const objects = [...document.querySelectorAll('.survey-object-row')].map((row) => { const label=row.querySelector('.survey-label').value.trim(); return { kind:row.querySelector('.survey-kind').value, label:label || row.querySelector('.survey-kind').value, stableKey:label.toLowerCase(), quantity:Number(row.querySelector('.survey-quantity').value||1), contentType:row.querySelector('.survey-content').value, fullness:Number(row.querySelector('.survey-fullness').value||0)/100, directCount:Number(row.querySelector('.survey-direct').value||0), confidence:row.querySelector('.survey-confirmed').checked?.85:.55, userConfirmed:row.querySelector('.survey-confirmed').checked, sourceImageIds:imageMeta.map((image)=>image.id) }; });
    return { title:document.querySelector('#survey-title').value, surveyType:document.querySelector('#survey-type').value, locationLabel:document.querySelector('#survey-location').value, images:imageMeta, hiddenAreas:document.querySelector('#survey-hidden').value.split('\n').map(v=>v.trim()).filter(Boolean), objects };
  }
  function show(result) { const survey=result.survey; document.querySelector('#survey-result').innerHTML = `<section class="panel inset"><div class="section-head"><div><div class="eyebrow">Survey result</div><h2>${escapeHtml(survey.title)}</h2></div><span class="status ${survey.review.humanReviewRequired?'needs_review':'included'}">${survey.review.humanReviewRequired?'Review required':'Draft complete'}</span></div><div class="grid metrics"><div class="metric"><small>Low estimate</small><strong>${survey.countEstimate.low.toLocaleString()}</strong></div><div class="metric"><small>Expected</small><strong>${survey.countEstimate.expected.toLocaleString()}</strong></div><div class="metric"><small>High estimate</small><strong>${survey.countEstimate.high.toLocaleString()}</strong></div><div class="metric"><small>Confidence</small><strong>${survey.countEstimate.confidence}</strong></div></div><div class="grid two"><div><h3>Scene map</h3><p>${survey.scene.uniqueObjects} confirmed unique objects · ${survey.scene.possibleDuplicates.length} possible duplicates · ${survey.scene.unmatchedObjects.length} unresolved</p>${survey.scene.possibleDuplicates.map(d=>`<div class="notice warning">Possible duplicate: ${escapeHtml(d.objectId)} and ${escapeHtml(d.duplicateOf)}</div>`).join('')}</div><div><h3>Suggested next scan</h3><div class="notice">${escapeHtml(survey.countEstimate.suggestedNextScan)}</div></div></div><h3>Assumptions</h3><ul>${survey.countEstimate.assumptions.map(a=>`<li>${escapeHtml(a)}</li>`).join('')}</ul><div class="notice warning">${escapeHtml(survey.valuation.disclaimer)}</div></section>`; }
  document.querySelector('#estimate-survey').addEventListener('click', async () => show(await api('/api/collection-surveys/estimate',{method:'POST',body:JSON.stringify(payload())})));
  document.querySelector('#survey-form').addEventListener('submit', async (event) => { event.preventDefault(); const result=await api('/api/collection-surveys',{method:'POST',body:JSON.stringify(payload())}); show(result); showToast('Collection Survey saved'); });
}

async function renderLots() {
  stopCamera();
  let lotImages = [];
  view.innerHTML = `
    <div class="section-head"><div><div class="eyebrow">Marketplace opportunity scanner</div><h2>Analyze a card lot</h2></div><span class="status configured">Single + multi-card</span></div>
    <div class="grid two lot-workbench">
      <section class="panel">
        <h3>eBay listing or saved screenshots</h3>
        <p class="subtle">Paste an eBay URL when official eBay access is configured, or upload all listing photos/screenshots. ManeFlow detects visible cards, reconciles repeated views, prices verified identities, and compares the lot to the BIN.</p>
        <div class="form-grid">
          <div><label>eBay listing URL (optional)</label><input id="lot-url" type="url" placeholder="https://www.ebay.com/itm/..."></div>
          <div><label>Listing photos / screenshots</label><input id="lot-images" type="file" accept="image/jpeg,image/png,image/webp" multiple></div>
          <div id="lot-preview" class="lot-image-grid"></div>
          <div class="form-grid two"><div><label>BIN / asking price</label><input id="lot-price" inputmode="decimal" placeholder="425.00"></div><div><label>Inbound shipping</label><input id="lot-shipping" inputmode="decimal" value="0"></div></div>
          <div class="form-grid two"><div><label>Sales tax</label><input id="lot-tax" inputmode="decimal" value="0"></div><div><label>Target ROI %</label><input id="lot-roi" inputmode="decimal" value="25"></div></div>
          <div class="form-grid two"><div><label>Marketplace fee %</label><input id="lot-fee" inputmode="decimal" value="13.25"></div><div><label>Outbound shipping per card</label><input id="lot-outbound" inputmode="decimal" value="0"></div></div>
          <button id="lot-analyze" class="button primary">Analyze lot opportunity</button>
        </div>
      </section>
      <section class="panel">
        <div class="eyebrow">How ManeFlow counts</div><h3>One physical card, not one photo</h3>
        <div class="source-row"><span>Single card photos</span><strong>Supported</strong></div>
        <div class="source-row"><span>Table spreads</span><strong>Multi-detection</strong></div>
        <div class="source-row"><span>Raw + slabs + holders</span><strong>Mixed scenes</strong></div>
        <div class="source-row"><span>Repeated listing angles</span><strong>Deduplicated</strong></div>
        <div class="source-row"><span>Partly hidden cards</span><strong>Marked unresolved</strong></div>
        <div class="source-row"><span>Missing verified comps</span><strong>No invented price</strong></div>
        <div class="notice warning compact-notice">A listing photo cannot prove condition, authenticity, exact parallel, or every hidden card. ManeFlow separates detection, identity, variant, and pricing confidence so uncertain items stay visible instead of being overstated.</div>
      </section>
    </div>
    <div id="lot-status" style="margin-top:14px"></div>
    <div id="lot-results" style="margin-top:14px"></div>`;

  const preview = document.querySelector('#lot-preview');
  const status = document.querySelector('#lot-status');
  const results = document.querySelector('#lot-results');
  document.querySelector('#lot-images').addEventListener('change', async (event) => {
    const files = [...(event.currentTarget.files || [])].slice(0, 30);
    if (!files.length) { lotImages = []; preview.innerHTML = ''; return; }
    status.innerHTML = `<div class="notice">Optimizing ${files.length} listing image${files.length === 1 ? '' : 's'} on this device...</div>`;
    try {
      lotImages = [];
      for (const file of files) lotImages.push({ filename: file.name, dataUrl: await imageFileToDataUrl(file, 2200, 0.86) });
      preview.innerHTML = lotImages.map((image, index) => `<figure><img src="${image.dataUrl}" alt="Lot image ${index + 1}"><figcaption>${escapeHtml(image.filename)}</figcaption></figure>`).join('');
      status.innerHTML = `<div class="notice success">${lotImages.length} image${lotImages.length === 1 ? '' : 's'} ready. Include every listing angle for the best duplicate reconciliation.</div>`;
    } catch (error) { status.innerHTML = `<div class="notice warning">${escapeHtml(error.message)}</div>`; }
  });

  document.querySelector('#lot-analyze').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const sourceUrl = document.querySelector('#lot-url').value.trim();
    const listingPrice = Number(document.querySelector('#lot-price').value || 0);
    const inboundShipping = Number(document.querySelector('#lot-shipping').value || 0);
    const salesTax = Number(document.querySelector('#lot-tax').value || 0);
    const targetRoi = Number(document.querySelector('#lot-roi').value || 25) / 100;
    const marketplaceFeeRate = Number(document.querySelector('#lot-fee').value || 13.25) / 100;
    const outboundShippingPerItem = Number(document.querySelector('#lot-outbound').value || 0);
    if (!lotImages.length && !sourceUrl) return showToast('Paste an eBay URL or upload listing photos.');
    if (listingPrice < 0 || inboundShipping < 0 || salesTax < 0) return showToast('Lot costs cannot be negative.');
    setBusy(button, true, 'Detecting cards...');
    status.innerHTML = '<div class="notice"><strong>Analyzing the lot...</strong><br>Separating card objects, reconciling repeated views, identifying visible cards, checking verified pricing, and calculating the buy decision.</div>';
    results.innerHTML = skeletonRows(4);
    try {
      const payload = lotImages.length
        ? await api('/api/vision/lot-analyze', { method: 'POST', body: JSON.stringify({ images: lotImages, listingPrice, inboundShipping, salesTax, sourceType: sourceUrl ? 'ebay_listing_upload' : 'desktop_upload', sourceUrl: sourceUrl || null, marketplaceFeeRate, outboundShippingPerItem, targetRoi }) })
        : await api('/api/vision/lot-analyze-ebay', { method: 'POST', body: JSON.stringify({ sourceUrl, listingPriceOverride: document.querySelector('#lot-price').value ? listingPrice : null, inboundShippingOverride: document.querySelector('#lot-shipping').value ? inboundShipping : null, salesTax, marketplaceFeeRate, outboundShippingPerItem, targetRoi }) });
      status.innerHTML = '<div class="notice success">Lot analysis complete. Confirm unresolved identities and exact variants before purchasing.</div>';
      results.innerHTML = renderLotResult(payload);
      localStorage.setItem('maneflow:lastLotJob', payload.job_id || '');
    } catch (error) {
      status.innerHTML = `<div class="notice warning">${escapeHtml(error.message)}</div>`;
      results.innerHTML = '';
    } finally { setBusy(button, false); }
  });
}

function bulkCardFields(identity = {}) {
  return {
    player_name: identity.player_name || '',
    year: identity.year || '',
    brand: identity.brand || '',
    set_name: identity.set_name || '',
    card_number: identity.card_number || '',
    parallel: identity.parallel || '',
    serial_number: identity.serial_number || '',
    grader: identity.grader || '',
    grade: identity.grade || '',
    cert_number: identity.cert_number || '',
  };
}

function bulkItemCard(item, batchId) {
  const identity = bulkCardFields(Object.keys(item.confirmed || {}).length ? item.confirmed : item.predicted);
  const workerBase = 'http://127.0.0.1:8741';
  const frontUrl = `${workerBase}/v1/intake/items/${encodeURIComponent(item.id)}/image/front`;
  const backUrl = item.back_image_path ? `${workerBase}/v1/intake/items/${encodeURIComponent(item.id)}/image/back` : '';
  return `<article class="bulk-review-card" data-item-id="${escapeHtml(item.id)}">
    <div>
      <div class="bulk-images">
        <img src="${frontUrl}" alt="Bulk scan front ${item.sequence_no}" loading="lazy">
        ${backUrl ? `<img src="${backUrl}" alt="Bulk scan back ${item.sequence_no}" loading="lazy">` : '<div class="camera-placeholder"><small>No back image</small></div>'}
      </div>
      <div class="row-meta-stack">
        <span class="status ${item.review_status === 'unreviewed' ? 'needs_review' : 'included'}">${escapeHtml(item.review_status)}</span>
        <span class="status">ID ${Math.round(Number(item.identity_confidence || 0) * 100)}%</span>
        <span class="status">Item ${item.sequence_no}</span>
      </div>
    </div>
    <form class="bulk-review-form" data-item-id="${escapeHtml(item.id)}" data-batch-id="${escapeHtml(batchId)}">
      <div class="bulk-fields">
        <div class="wide"><label>Player / subject</label><input name="player_name" value="${escapeHtml(identity.player_name)}" placeholder="Player name"></div>
        <div><label>Year</label><input name="year" value="${escapeHtml(identity.year)}" inputmode="numeric"></div>
        <div><label>Brand</label><input name="brand" value="${escapeHtml(identity.brand)}"></div>
        <div class="wide"><label>Set</label><input name="set_name" value="${escapeHtml(identity.set_name)}"></div>
        <div><label>Card #</label><input name="card_number" value="${escapeHtml(identity.card_number)}"></div>
        <div><label>Parallel</label><input name="parallel" value="${escapeHtml(identity.parallel)}"></div>
        <div><label>Serial #</label><input name="serial_number" value="${escapeHtml(identity.serial_number)}"></div>
        <div><label>Grader</label><input name="grader" value="${escapeHtml(identity.grader)}"></div>
        <div><label>Grade</label><input name="grade" value="${escapeHtml(identity.grade)}"></div>
        <div class="wide"><label>Cert #</label><input name="cert_number" value="${escapeHtml(identity.cert_number)}"></div>
      </div>
      <div class="bulk-review-actions">
        <button class="button primary" type="submit">Save correction</button>
        <button class="button small bulk-confirm" type="button">Confirm shown identity</button>
        <small class="subtle">Only confirmed/corrected labels enter the learning queue, and only under the contributor's consent scope.</small>
      </div>
    </form>
  </article>`;
}

function contributionReviewCard(example) {
  const label = example.label || {};
  const title = [label.year, label.brand, label.player_name, label.set_name, label.card_number ? `#${label.card_number}` : null].filter(Boolean).join(' · ') || 'Unlabeled contribution';
  const imageBase = `http://127.0.0.1:8741/v1/contributions/examples/${encodeURIComponent(example.id)}/image`;
  const canShowFront = Boolean(example.front_image_path);
  const canShowBack = Boolean(example.back_image_path);
  return `<article class="bulk-review-card contribution-review-card" data-example-id="${escapeHtml(example.id)}">
    <div class="bulk-images">
      ${canShowFront ? `<img src="${imageBase}/front" alt="Contributed card front">` : '<div class="empty">Labels-only consent</div>'}
      ${canShowBack ? `<img src="${imageBase}/back" alt="Contributed card back">` : ''}
    </div>
    <div class="bulk-review-main">
      <div class="bulk-review-head"><div><small>${escapeHtml(example.display_name || 'Imported contributor')} · ${escapeHtml(example.consent_scope)}</small><strong>${escapeHtml(title)}</strong></div><span class="status needs_review">Pending owner review</span></div>
      <div class="source-grid compact">
        <div><small>Player</small><strong>${escapeHtml(label.player_name || '—')}</strong></div>
        <div><small>Year / brand</small><strong>${escapeHtml([label.year, label.brand].filter(Boolean).join(' ') || '—')}</strong></div>
        <div><small>Set / card</small><strong>${escapeHtml([label.set_name, label.card_number ? `#${label.card_number}` : null].filter(Boolean).join(' ') || '—')}</strong></div>
        <div><small>Parallel</small><strong>${escapeHtml(label.parallel || '—')}</strong></div>
      </div>
      <label>Owner curation note</label><input class="contribution-note" placeholder="What was verified, or why this should be rejected">
      <div class="actions"><button class="button primary curate-example" data-status="approved">Approve example</button><button class="button ghost curate-example" data-status="rejected">Reject</button></div>
      <small class="subtle">Approval makes the example available to the in-house learning set. Only reference-catalog consent can make an image eligible for exact local matching.</small>
    </div>
  </article>`;
}

async function renderBulk() {
  stopCamera();
  const parts = routeParts();
  if (parts[1]) return renderBulkBatch(parts[1]);

  const desktopAvailable = Boolean(window.maneFlowDesktop?.selectRicohFolder);
  const [status, contributorsData, batchesData, contributionStats, pendingContributionData] = await Promise.all([
    api('/api/vision/status').catch((error) => ({ connected: false, error: error.message })),
    api('/api/bulk-intake/contributors').catch(() => ({ contributors: [] })),
    api('/api/bulk-intake/batches').catch(() => ({ batches: [] })),
    api('/api/contributions/stats').catch(() => ({ approved_examples: 0, with_images: 0, labels_only: 0, reference_eligible: 0, curation_pending: 0, curation_approved: 0, curation_rejected: 0, dataset_train: 0, dataset_validation: 0, dataset_test: 0 })),
    api('/api/contributions/examples?curation_status=pending&limit=20').catch(() => ({ examples: [] })),
  ]);
  const contributors = contributorsData.contributors || [];
  const batches = batchesData.batches || [];
  const pendingExamples = pendingContributionData.examples || [];
  view.innerHTML = `
    <div class="section-head"><div><div class="eyebrow">Desktop high-volume intake</div><h2>Any-order card photo intake</h2></div><span class="status ${status.connected ? 'configured' : 'needs_review'}">${status.connected ? 'Vision worker ready' : 'Vision worker offline'}</span></div>
    <div class="notice ${status.connected ? 'success' : 'warning'}">Import one folder of single-card photos in any order. ManeFlow analyzes every image independently, groups repeated views of the same physical card, selects primary front/back views, and identifies the card without filenames or user-entered labels. Ricoh duplex mode remains available for scanner batches. Owner-authorized card photos are added to ManeFlow's rights-cleared learning queue automatically. Cost basis, market values, seller notes, customer data, and marketplace images are never included.</div>
    <div class="grid metrics">
      <div class="metric"><small>Bulk batches</small><strong>${batches.length}</strong><p>Imported on this PC.</p></div>
      <div class="metric"><small>Owner-approved examples</small><strong>${contributionStats.approved_examples || 0}</strong><p>Cleared for in-house learning.</p></div>
      <div class="metric"><small>Image examples</small><strong>${contributionStats.with_images || 0}</strong><p>Consent permits image use.</p></div>
      <div class="metric"><small>Reference candidates</small><strong>${contributionStats.reference_eligible || 0}</strong><p>Consent permits catalog consideration.</p></div>
      <div class="metric"><small>Owner review queue</small><strong>${contributionStats.curation_pending || 0}</strong><p>Must be approved before model/reference use.</p></div>
      <div class="metric"><small>Dataset split</small><strong style="font-size:18px">${contributionStats.dataset_train || 0} / ${contributionStats.dataset_validation || 0} / ${contributionStats.dataset_test || 0}</strong><p>Train / validation / locked test.</p></div>
    </div>

    <div class="grid two" style="margin-top:14px">
      <section class="panel">
        <div class="eyebrow">Step 1</div><h3>Contributor consent</h3>
        <form id="contributor-form" class="form-grid two">
          <div><label>Name shown locally</label><input id="contributor-name" placeholder="Example: Bulk beta tester"></div>
          <div><label>Learning permission</label><select id="contributor-scope">
            <option value="private">Private — do not contribute</option>
            <option value="labels_only">Confirmed labels only</option>
            <option value="images_and_labels">Images + confirmed labels</option>
            <option value="reference_catalog">Images + labels + reference catalog candidate</option>
          </select></div>
          <div style="grid-column:1/-1"><small class="subtle">Consent can be revoked. Revocation removes that contributor's examples from approved training/reference use while preserving their private local inventory records.</small></div>
          <div><button class="button" type="submit">Create consent record</button></div>
        </form>
      </section>

      <section class="panel">
        <div class="eyebrow">Step 2</div><h3>Import photo folder</h3>
        <form id="ricoh-import-form" class="form-grid">
          <div><label>Card photo folder</label><div class="search-bar"><input id="ricoh-folder" ${desktopAvailable ? 'readonly' : ''} placeholder="${desktopAvailable ? 'Select the folder containing card photos' : 'Paste the full Windows folder path, such as C:\\CardPhotos\\July'}"><button class="button" id="select-ricoh-folder" type="button" ${desktopAvailable ? '' : 'hidden'}>Choose folder</button></div>${desktopAvailable ? '' : '<small class="subtle">Browser/local bootstrap mode: paste the full folder path. The folder stays on this PC.</small>'}</div>
          <div class="form-grid two"><div><label>Batch name</label><input id="ricoh-batch-name" placeholder="July bulk intake"></div><div><label>Capture device</label><input id="ricoh-model" value="Phone / camera folder"></div></div>
          <div class="form-grid two"><div><label>Contributor</label><select id="ricoh-contributor"><option value="">Private / no contributor</option>${contributors.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.display_name || c.id)} — ${escapeHtml(c.consent_scope)}</option>`).join('')}</select></div><div><label>Import mode</label><select id="ricoh-import-mode"><option value="unordered">Any order — auto group and identify</option><option value="ricoh">Ricoh duplex / ordered scans</option></select></div></div><div id="ricoh-pairing-row" hidden><label>Ricoh pairing</label><select id="ricoh-pairing"><option value="auto">Auto detect</option><option value="filename">Filename front/back markers</option><option value="alternating">Sequential front, back</option></select></div>
          <label><input id="ricoh-process" type="checkbox" checked style="width:auto;min-height:0"> Analyze and identify every image during import</label>
          <button class="button primary" type="submit">Import, group, and identify</button>
        </form>
      </section>
    </div>

    <section class="panel" style="margin-top:14px">
      <div class="section-head"><div><div class="eyebrow">In-house recognition database</div><h3>Contribution packs</h3></div></div>
      <p class="subtle">A beta tester can export confirmed examples allowed by their consent record, including items awaiting owner review. Import the ZIP on the owner PC, then approve or reject every example before it is used. The pack excludes acquisition cost, appraised value, seller information, and private inventory notes.</p>
      <div class="actions"><button id="export-contributions" class="button">Export consented review pack</button><label class="button ghost" style="display:inline-flex;align-items:center;cursor:pointer">Import learning pack<input id="import-contributions" type="file" accept=".zip,application/zip" hidden></label><button id="export-dataset-manifest" class="button ghost">Export approved dataset manifest</button></div>
      <div id="contribution-import-result"></div>
    </section>

    <section class="panel" style="margin-top:14px">
      <div class="section-head"><div><div class="eyebrow">Owner quality gate</div><h3>Learning-data review queue</h3></div><span class="status ${pendingExamples.length ? 'needs_review' : 'included'}">${pendingExamples.length} shown</span></div>
      <p class="subtle">Confirmed tester corrections enter this queue first. Nothing becomes an approved training/reference example until you review it. Rejected records remain auditable but are excluded from matching and training.</p>
      <div class="bulk-review-list contribution-review-list">${pendingExamples.length ? pendingExamples.map(contributionReviewCard).join('') : '<div class="empty">No contributed examples are waiting for owner review.</div>'}</div>
      ${(contributionStats.curation_pending || 0) > pendingExamples.length ? `<div class="notice warning" style="margin-top:12px">Showing the first ${pendingExamples.length} pending examples. Approve or reject these, then refresh to load the next group.</div>` : ''}
    </section>

    <div class="section-head"><h2>Recent bulk batches</h2><button id="bulk-refresh" class="button small">Refresh</button></div>
    <section class="panel bulk-batch-list">${batches.length ? batches.map((batch) => `<a class="bulk-batch-row" href="#/bulk/${encodeURIComponent(batch.id)}"><div><strong>${escapeHtml(batch.batch_name || batch.id)}</strong><small>${escapeHtml(batch.scanner_model || 'Scanner')} · ${batch.item_count} items · ${escapeHtml(batch.pairing_strategy)}${batch.contributor_name ? ` · ${escapeHtml(batch.contributor_name)}` : ''}</small></div><div style="text-align:right"><span class="status ${batch.status === 'complete' ? 'included' : 'needs_review'}">${escapeHtml(batch.status)}</span><small>${formatDate(batch.updated_at)}</small></div></a>`).join('') : emptyState('No photo batches yet', 'Choose a folder of single-card photos. File order is not required.')}</section>`;

  document.querySelector('#select-ricoh-folder')?.addEventListener('click', async () => {
    const selected = await window.maneFlowDesktop.selectRicohFolder();
    if (selected) document.querySelector('#ricoh-folder').value = selected;
  });
  document.querySelector('#ricoh-import-mode')?.addEventListener('change', (event) => {
    const isRicoh = event.currentTarget.value === 'ricoh';
    document.querySelector('#ricoh-pairing-row').hidden = !isRicoh;
    document.querySelector('#ricoh-model').value = isRicoh ? 'Ricoh fi/Ricoh duplex scanner' : 'Phone / camera folder';
  });
  document.querySelector('#contributor-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button');
    setBusy(button, true, 'Saving…');
    try {
      await api('/api/bulk-intake/contributors', { method: 'POST', body: JSON.stringify({ display_name: document.querySelector('#contributor-name').value, consent_scope: document.querySelector('#contributor-scope').value }) });
      showToast('Contributor consent saved');
      await renderBulk();
    } finally { setBusy(button, false); }
  });
  document.querySelector('#ricoh-import-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const folder = document.querySelector('#ricoh-folder').value;
    if (!folder) return showToast('Choose the card photo folder first');
    const button = event.currentTarget.querySelector('button[type="submit"]');
    setBusy(button, true, 'Analyzing photos…');
    try {
      const mode = document.querySelector('#ricoh-import-mode').value;
      const endpoint = mode === 'ricoh' ? '/api/bulk-intake/ricoh/import-folder' : '/api/bulk-intake/photos/import-folder';
      const payload = mode === 'ricoh' ? {
        folder_path: folder,
        batch_name: document.querySelector('#ricoh-batch-name').value || null,
        contributor_id: document.querySelector('#ricoh-contributor').value || null,
        scanner_model: document.querySelector('#ricoh-model').value,
        pairing_strategy: document.querySelector('#ricoh-pairing').value,
        copy_into_maneflow: true,
        process_immediately: document.querySelector('#ricoh-process').checked,
      } : {
        folder_path: folder,
        batch_name: document.querySelector('#ricoh-batch-name').value || null,
        contributor_id: document.querySelector('#ricoh-contributor').value || null,
        capture_device: document.querySelector('#ricoh-model').value || 'Phone / camera folder',
        copy_into_maneflow: true,
        owner_authorized_learning: true,
      };
      const result = await api(endpoint, { method: 'POST', body: JSON.stringify(payload) });
      showToast(`Imported ${result.batch.item_count} physical card group${result.batch.item_count === 1 ? '' : 's'}`);
      location.hash = `#/bulk/${result.batch.id}`;
    } finally { setBusy(button, false); }
  });
  document.querySelector('#export-contributions')?.addEventListener('click', async (event) => {
    setBusy(event.currentTarget, true, 'Exporting…');
    try {
      const response = await fetch('http://127.0.0.1:8741/v1/contributions/export.zip?mode=review_queue');
      if (!response.ok) throw new Error('Contribution export failed');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `maneflow-contribution-${new Date().toISOString().slice(0,10)}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      showToast('Learning pack exported');
    } catch (error) { showToast(error.message); }
    finally { setBusy(event.currentTarget, false); }
  });
  document.querySelector('#export-dataset-manifest')?.addEventListener('click', async (event) => {
    setBusy(event.currentTarget, true, 'Building manifest…');
    try {
      const manifest = await api('/api/contributions/dataset-manifest');
      const data = JSON.stringify(manifest, null, 2);
      if (window.maneFlowDesktop?.saveFile) {
        await window.maneFlowDesktop.saveFile({ defaultName: `maneflow-approved-dataset-${new Date().toISOString().slice(0,10)}.json`, data });
      } else {
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `maneflow-approved-dataset-${new Date().toISOString().slice(0,10)}.json`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      }
      showToast('Approved dataset manifest exported');
    } catch (error) { showToast(error.message); }
    finally { setBusy(event.currentTarget, false); }
  });
  document.querySelector('#import-contributions')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const form = new FormData();
      form.append('pack', file, file.name);
      const response = await fetch('http://127.0.0.1:8741/v1/contributions/import', { method: 'POST', body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || 'Contribution import failed');
      document.querySelector('#contribution-import-result').innerHTML = `<div class="notice success" style="margin-top:12px">Imported ${result.imported_examples} examples · ${result.duplicates_skipped} duplicates skipped · ${result.rejected_examples} rejected.</div>`;
      showToast('Learning pack imported');
    } catch (error) { showToast(error.message); }
    finally { event.target.value = ''; }
  });
  document.querySelectorAll('.curate-example').forEach((button) => {
    button.addEventListener('click', async () => {
      const card = button.closest('.contribution-review-card');
      const exampleId = card?.dataset.exampleId;
      if (!exampleId) return;
      const status = button.dataset.status;
      const note = card.querySelector('.contribution-note')?.value || null;
      setBusy(button, true, status === 'approved' ? 'Approving…' : 'Rejecting…');
      try {
        await api(`/api/contributions/examples/${encodeURIComponent(exampleId)}/curate`, {
          method: 'POST',
          body: JSON.stringify({ curation_status: status, notes: note }),
        });
        showToast(status === 'approved' ? 'Learning example approved' : 'Learning example rejected');
        await renderBulk();
      } finally { setBusy(button, false); }
    });
  });
  document.querySelector('#bulk-refresh')?.addEventListener('click', renderBulk);
}

async function renderBulkBatch(batchId) {
  const data = await api(`/api/bulk-intake/batches/${encodeURIComponent(batchId)}`);
  const batch = data.batch;
  const items = batch.items || [];
  const pageSize = 100;
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const requestedPage = Number(routeQuery().get('page') || 1);
  const page = Math.max(1, Math.min(Number.isFinite(requestedPage) ? requestedPage : 1, pageCount));
  const pageStart = (page - 1) * pageSize;
  const visibleItems = items.slice(pageStart, pageStart + pageSize);
  const pageHref = (target) => `#/bulk/${encodeURIComponent(batchId)}?page=${target}`;
  view.innerHTML = `
    <div class="section-head"><div><div class="eyebrow">Ricoh batch review</div><h2>${escapeHtml(batch.batch_name || 'Bulk intake')}</h2></div><a href="#/bulk">All batches</a></div>
    <div class="grid metrics">
      <div class="metric"><small>Physical items</small><strong>${batch.item_count}</strong><p>${batch.file_count} source image files.</p></div>
      <div class="metric"><small>Reviewed</small><strong>${items.filter((i) => i.review_status !== 'unreviewed').length}</strong><p>Confirmed or corrected.</p></div>
      <div class="metric"><small>Needs review</small><strong>${items.filter((i) => i.review_status === 'unreviewed').length}</strong><p>Identity is not training data yet.</p></div>
      <div class="metric"><small>Consent</small><strong style="font-size:18px">${escapeHtml(batch.consent_scope || 'private')}</strong><p>${escapeHtml(batch.contributor_name || 'No contributor')}</p></div>
    </div>
    ${batch.warnings?.length ? `<div class="notice warning" style="margin-top:14px">${batch.warnings.map(escapeHtml).join('<br>')}</div>` : ''}
    <section class="panel" style="margin-top:14px"><div class="bulk-toolbar"><div><label>Status</label><span class="status">${escapeHtml(batch.status)}</span></div><div><label>Pairing</label><strong>${escapeHtml(batch.pairing_strategy)}</strong></div><div><button id="process-batch" class="button">Run/re-run identity</button></div><div><button id="export-batch" class="button">Save review CSV</button></div></div></section>
    <div class="section-head"><h2>Card-by-card review</h2><span class="subtle">Items ${items.length ? pageStart + 1 : 0}–${Math.min(pageStart + visibleItems.length, items.length)} of ${items.length} · Page ${page} of ${pageCount}</span></div>
    ${pageCount > 1 ? `<div class="bulk-pagination"><a class="button small ${page <= 1 ? 'disabled' : ''}" ${page > 1 ? `href="${pageHref(page - 1)}"` : ''}>Previous 100</a><span class="subtle">Review progress is saved immediately.</span><a class="button small ${page >= pageCount ? 'disabled' : ''}" ${page < pageCount ? `href="${pageHref(page + 1)}"` : ''}>Next 100</a></div>` : ''}
    <div class="bulk-review-list">${visibleItems.map((item) => bulkItemCard(item, batchId)).join('')}</div>
    ${pageCount > 1 ? `<div class="bulk-pagination"><a class="button small ${page <= 1 ? 'disabled' : ''}" ${page > 1 ? `href="${pageHref(page - 1)}"` : ''}>Previous 100</a><strong>Page ${page} of ${pageCount}</strong><a class="button small ${page >= pageCount ? 'disabled' : ''}" ${page < pageCount ? `href="${pageHref(page + 1)}"` : ''}>Next 100</a></div>` : ''}`;

  document.querySelector('#process-batch')?.addEventListener('click', async (event) => {
    setBusy(event.currentTarget, true, 'Processing…');
    try { await api(`/api/bulk-intake/batches/${encodeURIComponent(batchId)}/process`, { method: 'POST', body: '{}' }); showToast('Batch processing complete'); await renderBulkBatch(batchId); }
    finally { setBusy(event.currentTarget, false); }
  });
  document.querySelector('#export-batch')?.addEventListener('click', async (event) => {
    setBusy(event.currentTarget, true, 'Preparing…');
    try {
      const response = await fetch(`http://127.0.0.1:8741/v1/intake/batches/${encodeURIComponent(batchId)}/export.csv`);
      if (!response.ok) throw new Error('CSV export failed');
      const text = await response.text();
      const saved = window.maneFlowDesktop?.saveFile ? await window.maneFlowDesktop.saveFile({ defaultName: `${batch.batch_name || 'maneflow-bulk'}.csv`, data: text }) : null;
      showToast(saved?.saved ? 'CSV saved' : 'CSV prepared');
    } catch (error) { showToast(error.message); }
    finally { setBusy(event.currentTarget, false); }
  });
  document.querySelectorAll('.bulk-review-form').forEach((form) => {
    const save = async (reviewStatus) => {
      const fields = Object.fromEntries(new FormData(form).entries());
      if (fields.year) fields.year = Number(fields.year);
      for (const key of Object.keys(fields)) if (fields[key] === '') delete fields[key];
      const button = reviewStatus === 'confirmed' ? form.querySelector('.bulk-confirm') : form.querySelector('button[type="submit"]');
      setBusy(button, true, 'Saving…');
      try {
        await api(`/api/bulk-intake/items/${encodeURIComponent(form.dataset.itemId)}/review`, { method: 'POST', body: JSON.stringify({ confirmed_fields: fields, review_status: reviewStatus }) });
        showToast(reviewStatus === 'confirmed' ? 'Identity confirmed' : 'Correction saved');
        await renderBulkBatch(batchId);
      } finally { setBusy(button, false); }
    };
    form.addEventListener('submit', (event) => { event.preventDefault(); save('corrected').catch((error) => showToast(error.message)); });
    form.querySelector('.bulk-confirm')?.addEventListener('click', () => save('confirmed').catch((error) => showToast(error.message)));
  });
}

async function renderCard(id) {
  loading();
  const [data, dashboard, dealer, orgData] = await Promise.all([
    api(`/api/cards/${encodeURIComponent(id)}/market?window=365d&active=1`),
    api('/api/dashboard').catch(() => null),
    api(`/api/cards/${encodeURIComponent(id)}/dealer-decision?active=1`).catch(() => null),
    api('/api/organizations').catch(() => ({ organizations: [] })),
  ]);
  const { card, valuation, sales } = data;
  const organizations = orgData?.organizations || [];
  const cardHoldings = (dashboard?.collection || []).filter((item) => item.cardId === card.id);
  const cardContribution = { quantity: cardHoldings.reduce((sum, item) => sum + item.quantity, 0), value: cardHoldings.reduce((sum, item) => sum + item.currentValue, 0), gain: cardHoldings.reduce((sum, item) => sum + item.gain, 0) };
  const portfolioValue = dashboard?.portfolio?.totalValue || 0;
  cardContribution.pct = portfolioValue > 0 ? Math.round((cardContribution.value / portfolioValue) * 1000) / 10 : 0;
  const cardDecision = (dashboard?.intelligence?.decisionSupport?.cards || []).find((item) => item.cardId === card.id) || null;
  const windows = valuation.windows;
  const compDetails = valuation.compDetails || { included: [], excluded: [], needsReview: [] };
  const includedComps = compDetails.included || [];
  const excludedComps = compDetails.excluded || [];
  const needsReviewComps = compDetails.needsReview || [];
  const chartSales = includedComps.length ? includedComps : sales;
  const quality = valuation.compQuality || {};
  view.innerHTML = `
    ${modeBanner(data.marketMode)}
    ${data.marketMode !== 'production' ? '<div class="notice warning" style="margin-bottom:14px">Demo comps are not public market values.</div>' : ''}
    <div class="market-layout">
      <section class="panel">
        <div class="card-hero">
          ${cardImageTag(card, 'card-detail-image')}
          <div><div class="eyebrow">${escapeHtml(card.sport || 'Trading card')}</div><h2>${escapeHtml(cardTitle(card))}</h2><p class="subtle">${cardSubtitle(card)}</p><div class="price-big">${formatMoney(valuation.value)}</div><div class="range">Expected range ${formatMoney(valuation.range.low)}–${formatMoney(valuation.range.high)}</div>${trendHtml(valuation)}
            <div class="confidence"><span class="subtle">Confidence</span><div class="confidence-track"><div class="confidence-fill" style="width:${valuation.confidence}%"></div></div><strong>${valuation.confidence}%</strong></div>
          </div>
        </div>
        <div class="grid metrics" style="grid-template-columns:repeat(4,minmax(0,1fr))">
          <div class="metric"><small>7-day median</small><strong>${formatMoney(windows.d7.median)}</strong><p>${windows.d7.count} included sales</p></div>
          <div class="metric"><small>30-day weighted</small><strong>${formatMoney(windows.d30.weighted)}</strong><p>${windows.d30.count} quality comps</p></div>
          <div class="metric"><small>90-day volume</small><strong>${valuation.volume90}</strong><p>${valuation.monthlyVelocity}/month</p></div>
          <div class="metric"><small>Comp quality</small><strong>${quality.averageQualityScore ?? 0}</strong><p>${quality.includedCount ?? 0} in · ${quality.excludedCount ?? 0} out · ${quality.needsReviewCount ?? 0} review</p></div>
        </div>
        <div class="section-head"><h3>Completed-sale history</h3><span class="subtle">${valuation.providerCount} sources · ${valuation.freshnessHours === null ? 'no fresh data' : `${valuation.freshnessHours}h freshness`}</span></div>
        ${chartSvg(chartSales)}
        <p class="subtle" style="font-size:11px;line-height:1.55">${escapeHtml(valuation.contextualPricingMethodology || valuation.methodology)}</p>
      </section>
      <div class="grid">
        <section class="panel"><h3>Take action</h3><div class="form-grid"><button id="add-vault" class="button primary">Add to Vault</button><button id="watch-card" class="button">Create price alert</button><button id="draft-listing" class="button">Prepare listing</button><button id="consign-card" class="button ghost">Consignment review</button></div><div id="action-result" style="margin-top:12px"></div></section>
        ${dealerDecisionPanel(dealer?.decision, dealer?.marketMode || data.marketMode)}
        ${askingContextPanel(valuation.askingPriceContext, data.activeListingError)}
        ${imageSourcePanel(card)}
        <section class="panel"><h3>Decision context</h3><div class="notice compact-notice"><strong>Value source:</strong> included completed sales only. Active BIN listings are context, not comps.</div><div class="source-row"><span>30-day movement</span><strong class="${valuation.trend30Pct >= 0 ? 'positive' : 'negative'}">${valuation.trend30Pct === null ? 'No trend' : `${valuation.trend30Pct}%`}</strong></div><div class="source-row"><span>Outliers excluded</span><strong>${valuation.outlierCount}</strong></div><div class="source-row"><span>Duplicates excluded</span><strong>${valuation.duplicateCount}</strong></div><div class="source-row"><span>Source trust</span><strong>${quality.averageSourceTrust ?? 0}</strong></div><div class="source-row"><span>Identity match score</span><strong>${quality.averageMatchScore ?? 0}</strong></div></section>
        ${cardDecisionPanel(cardDecision)}
        <section class="panel"><h3>Portfolio contribution</h3>${cardHoldings.length ? `<div class="source-row"><span>Quantity owned</span><strong>${cardContribution.quantity}</strong></div><div class="source-row"><span>Vault value</span><strong>${formatMoney(cardContribution.value)}</strong></div><div class="source-row"><span>Gain/loss</span><strong class="${cardContribution.gain >= 0 ? 'positive' : 'negative'}">${formatMoney(cardContribution.gain)}</strong></div><div class="source-row"><span>Portfolio weight</span><strong>${cardContribution.pct}%</strong></div>` : '<div class="empty">This card is not in your Vault yet.</div>'}</section>
        <section class="panel"><h3>Comp Quality</h3><div class="notice">ManeFlow shows why each comp was included or excluded. Values are estimates, not appraisals.</div><div class="source-row"><span>Included</span><strong>${quality.includedCount ?? 0}</strong></div><div class="source-row"><span>Excluded</span><strong>${quality.excludedCount ?? 0}</strong></div><div class="source-row"><span>Needs review</span><strong>${quality.needsReviewCount ?? 0}</strong></div>${(quality.topWarnings || []).length ? `<small class="subtle">Warnings: ${(quality.topWarnings || []).map((item) => escapeHtml(item.warning)).join(', ')}</small>` : ''}</section>
        <section class="panel"><h3>Shop-ready actions</h3><div class="form-grid"><button id="add-intake" class="button">Add to intake batch</button><button id="add-shop-inventory" class="button" ${organizations.length ? '' : 'disabled'}>Add to shop inventory</button><button id="needs-review" class="button ghost">Mark needs review</button></div><p class="subtle">${organizations.length ? `${organizations.length} shop workspace(s) available.` : 'Shop inventory requires a Merchant/Enterprise organization.'}</p></section>
      </div>
    </div>
    <div class="section-head"><div><div class="eyebrow">Evidence</div><h2>Included comparable sales</h2></div><span class="subtle">All-in prices · valuation-use comps only</span></div>
    <section class="panel">${includedComps.length ? includedComps.slice(0, 30).map(compQualityRow).join('') : '<div class="empty">No quality-approved completed sales in this window.</div>'}</section>
    <div class="section-head"><div><div class="eyebrow">Transparency</div><h2>Excluded and review comps</h2></div><span class="subtle">Duplicates, active listings, outliers, uncertain matches</span></div>
    <section class="panel">${[...needsReviewComps, ...excludedComps].length ? [...needsReviewComps, ...excludedComps].slice(0, 40).map(compQualityRow).join('') : '<div class="empty">No excluded or review comps in this window.</div>'}</section>
    <div class="notice warning" style="margin-top:14px">${escapeHtml(valuation.disclaimer)}</div>`;

  const actionResult = document.querySelector('#action-result');
  document.querySelector('#add-vault').addEventListener('click', async (event) => {
    setBusy(event.currentTarget, true);
    try {
      await api('/api/collection', { method: 'POST', body: JSON.stringify({ cardId: card.id, name: cardTitle(card), quantity: 1 }) });
      actionResult.innerHTML = '<div class="notice success">Added to your Vault.</div>';
    } catch (error) { handleActionError(error); }
    finally { setBusy(event.currentTarget, false); }
  });
  document.querySelector('#watch-card').addEventListener('click', () => {
    const modal = openModal('Create price alert', `<form id="watch-form" class="form-grid"><div><label>Alert price</label><input id="watch-price" type="number" min="0" step="0.01" value="${valuation.value || ''}" required></div><div><label>Notify when value moves</label><select id="watch-direction"><option value="below">At or below</option><option value="above">At or above</option></select></div><button class="button primary">Save alert</button></form>`);
    modal.root.querySelector('#watch-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        await api('/api/watchlist', { method: 'POST', body: JSON.stringify({ cardId: card.id, targetPrice: Number(modal.root.querySelector('#watch-price').value), direction: modal.root.querySelector('#watch-direction').value }) });
        modal.close(); showToast('Price alert saved');
      } catch (error) { handleActionError(error); }
    });
  });
  document.querySelector('#draft-listing').addEventListener('click', async () => {
    const suggestion = await api(`/api/cards/${encodeURIComponent(card.id)}/listing-suggestion`);
    if (!suggestion.suggestion) return showToast('More completed-sale data is needed.');
    const modal = openModal('Prepare listing', `<form id="listing-form" class="form-grid"><div><label>Marketplace</label><select id="listing-market"><option>eBay</option><option>COMC</option><option>Whatnot</option><option>Fanatics Live</option><option>Shopify</option><option>In-store</option></select></div><div><label>Title</label><input id="listing-title" maxlength="160" value="${escapeHtml(`${cardTitle(card)} ${card.set || ''} #${card.cardNumber || ''} ${card.parallel || ''} ${card.grade?.company || ''} ${card.grade?.grade || ''}`.trim())}"></div><div><label>Price</label><input id="listing-price" type="number" min="0" step="0.01" value="${suggestion.suggestion.patientAsk}"></div><div class="notice">Market ${formatMoney(suggestion.suggestion.market)} · Quick sale ${formatMoney(suggestion.suggestion.quickSale)} · Est. net ${formatMoney(suggestion.suggestion.estimatedNetAtMarket)}</div><button class="button primary">Save draft</button></form>`);
    modal.root.querySelector('#listing-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        await api('/api/listings', { method: 'POST', body: JSON.stringify({ cardId: card.id, marketplace: modal.root.querySelector('#listing-market').value, title: modal.root.querySelector('#listing-title').value, price: Number(modal.root.querySelector('#listing-price').value), quantity: 1 }) });
        modal.close(); showToast('Listing draft created');
      } catch (error) { handleActionError(error); }
    });
  });
  document.querySelector('#consign-card').addEventListener('click', () => {
    const modal = openModal('Consignment review', `<form id="consign-form" class="form-grid"><div><label>Email</label><input id="consign-email" type="email" value="${escapeHtml(state.auth?.user?.email || '')}" required></div><div><label>Notes</label><textarea id="consign-notes" rows="4" placeholder="Condition, timeline, minimum expectations…"></textarea></div><button class="button primary">Request human review</button></form>`);
    modal.root.querySelector('#consign-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        await api('/api/consignment-review', { method: 'POST', body: JSON.stringify({ cardId: card.id, email: modal.root.querySelector('#consign-email').value, notes: modal.root.querySelector('#consign-notes').value }) });
        modal.close(); showToast('Review request submitted');
      } catch (error) { handleActionError(error); }
    });
  });
  document.querySelector('#add-intake')?.addEventListener('click', async (event) => {
    setBusy(event.currentTarget, true, 'Adding...');
    try {
      const batch = await api('/api/intake-batches', { method: 'POST', body: JSON.stringify({ title: `${cardTitle(card)} review`, source: 'walk-in' }) });
      await api(`/api/intake-batches/${encodeURIComponent(batch.batch.id)}/items`, { method: 'POST', body: JSON.stringify({ cardId: card.id, quantity: 1, reviewStatus: quality.includedCount ? 'priced' : 'needs_review' }) });
      showToast('Added to a new intake batch');
    } catch (error) { handleActionError(error); }
    finally { setBusy(event.currentTarget, false); }
  });
  document.querySelector('#add-shop-inventory')?.addEventListener('click', () => {
    if (!organizations.length) return showToast('Create a Merchant shop organization first.');
    const orgOptions = organizations.map((org) => `<option value="${escapeHtml(org.id)}">${escapeHtml(org.name)}</option>`).join('');
    const modal = openModal('Add to shop inventory', `<form id="shop-inventory-form" class="form-grid"><div><label>Shop</label><select id="shop-org">${orgOptions}</select></div><div class="form-grid two"><div><label>Quantity</label><input id="shop-qty" type="number" min="1" step="1" value="1"></div><div><label>Cost basis per card</label><input id="shop-cost" type="number" min="0" step="0.01" value=""></div></div><div><label>List price</label><input id="shop-list" type="number" min="0" step="0.01" value="${dealer?.decision?.fairListPrice || valuation.value || ''}"></div><button class="button primary">Add inventory item</button></form>`);
    modal.root.querySelector('#shop-inventory-form').addEventListener('submit', async (submitEvent) => {
      submitEvent.preventDefault();
      try {
        await api(`/api/organizations/${encodeURIComponent(modal.root.querySelector('#shop-org').value)}/inventory`, { method: 'POST', body: JSON.stringify({ cardId: card.id, name: cardTitle(card), quantity: Number(modal.root.querySelector('#shop-qty').value || 1), costBasis: Number(modal.root.querySelector('#shop-cost').value || 0), listPrice: Number(modal.root.querySelector('#shop-list').value || 0), source: 'ManeFlow card detail' }) });
        modal.close(); showToast('Added to shop inventory');
      } catch (error) { handleActionError(error); }
    });
  });
  document.querySelector('#needs-review')?.addEventListener('click', () => {
    showToast('Marked for human review. Use Owner Data Ops for comp corrections and source-rights review.');
  });
}

function handleActionError(error) {
  if (error.status === 401) {
    showToast('Create or sign in to an account to save this action.');
    location.hash = '#/account';
    return;
  }
  showToast(error.message);
}

function manualCatalogInput(root) {
  return {
    q: root.querySelector('#manual-catalog-query')?.value || '',
    sport: root.querySelector('#manual-sport')?.value || '',
    year: root.querySelector('#manual-year')?.value || '',
    brand: root.querySelector('#manual-brand')?.value || '',
    set: root.querySelector('#manual-set')?.value || '',
    cardNumber: root.querySelector('#manual-card-number')?.value || '',
    player: root.querySelector('#manual-player')?.value || '',
    parallel: root.querySelector('#manual-parallel')?.value || '',
    gradeCompany: root.querySelector('#manual-grade-company')?.value || '',
    grade: root.querySelector('#manual-grade')?.value || '',
    serialNumber: root.querySelector('#manual-serial')?.value || '',
    name: root.querySelector('#manual-name')?.value || '',
  };
}

function manualCatalogName(input) {
  return [input.year, input.brand, input.set, input.player || input.name, input.cardNumber ? `#${input.cardNumber}` : '', input.parallel, input.gradeCompany, input.grade].filter(Boolean).join(' ') || 'Unmatched card';
}

function fillManualCatalogFields(root, payload = {}) {
  const fields = {
    '#manual-card-id': payload.cardId,
    '#manual-name': payload.name,
    '#manual-sport': payload.sport,
    '#manual-year': payload.year,
    '#manual-brand': payload.brand,
    '#manual-set': payload.set,
    '#manual-player': payload.player,
    '#manual-card-number': payload.cardNumber,
    '#manual-parallel': payload.parallel,
    '#manual-serial': payload.serialNumber,
    '#manual-grade-company': payload.gradeCompany,
    '#manual-grade': payload.grade,
  };
  Object.entries(fields).forEach(([selector, value]) => {
    const field = root.querySelector(selector);
    if (field && value !== undefined && value !== null) field.value = value;
  });
}

function catalogSuggestionGroup(title, field, values = []) {
  if (!values.length) return '';
  return `<div class="catalog-suggestion-group"><small>${escapeHtml(title)}</small><div>${values.slice(0, 8).map((item) => `<button type="button" class="catalog-chip" data-catalog-field="${escapeHtml(field)}" data-catalog-value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</button>`).join('')}</div></div>`;
}

function renderManualCatalogResults(root, data) {
  const box = root.querySelector('#manual-catalog-result');
  const likelyCards = data.likelyCards || [];
  const suggestions = data.suggestions || {};
  box.innerHTML = `
    <div class="notice ${data.exactCard ? 'success' : 'warning'}">
      ${data.exactCard ? 'Exact catalog row found. Select it to auto-fill the card.' : 'No exact catalog row yet. Use suggestions below or save as unmatched until a checklist row is imported.'}
      <br><span class="subtle">${escapeHtml(data.coverage?.cardCount || 0)} loaded catalog cards across ${escapeHtml(data.coverage?.setCount || 0)} sets.</span>
    </div>
    <div class="catalog-suggestions">
      ${catalogSuggestionGroup('Sports', 'sport', suggestions.sports)}
      ${catalogSuggestionGroup('Years', 'year', suggestions.years)}
      ${catalogSuggestionGroup('Brands', 'brand', suggestions.brands)}
      ${catalogSuggestionGroup('Sets', 'set', suggestions.sets)}
      ${catalogSuggestionGroup('Card numbers', 'cardNumber', suggestions.cardNumbers)}
      ${catalogSuggestionGroup('Players', 'player', suggestions.players)}
      ${catalogSuggestionGroup('Parallels', 'parallel', suggestions.parallels)}
      ${catalogSuggestionGroup('Graders', 'gradeCompany', suggestions.gradeCompanies)}
    </div>
    <div class="card-list" style="margin-top:12px">
      ${likelyCards.length ? likelyCards.slice(0, 6).map((card) => `<div class="card-row catalog-card-choice">${cardImageTag(card)}<div><h3>${escapeHtml(card.title)}</h3><p>${escapeHtml([card.sport, card.year, card.brand, card.set, card.cardNumber ? `#${card.cardNumber}` : '', card.parallel].filter(Boolean).join(' · '))}<br>${escapeHtml(card.catalogSource || 'catalog')}</p></div><div class="card-price"><button type="button" class="button small primary select-catalog-card" data-card='${escapeHtml(JSON.stringify(card))}'>Use</button></div></div>`).join('') : '<div class="empty">No loaded catalog candidates match yet. Import an authorized checklist CSV for fuller auto-fill.</div>'}
    </div>
    <p class="subtle" style="margin-top:12px">${escapeHtml(data.disclaimer || 'Autocomplete depends on loaded catalog data.')}</p>`;

  box.querySelectorAll('[data-catalog-field]').forEach((button) => button.addEventListener('click', () => {
    const field = root.querySelector(`#manual-${button.dataset.catalogField.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`);
    if (field) field.value = button.dataset.catalogValue;
  }));
  box.querySelectorAll('.select-catalog-card').forEach((button) => button.addEventListener('click', () => {
    const card = JSON.parse(button.dataset.card);
    fillManualCatalogFields(root, {
      cardId: card.id,
      name: card.title,
      sport: card.sport,
      year: card.year,
      brand: card.brand,
      set: card.set,
      player: card.player,
      cardNumber: card.cardNumber,
      parallel: card.parallel,
      serialNumber: card.serialNumber,
      gradeCompany: card.grade?.company,
      grade: card.grade?.grade,
    });
    showToast('Catalog card selected');
  }));
}

function renderSmartCatalogAutocomplete(root, data) {
  const box = root.querySelector('#manual-smart-candidates');
  const candidates = data.candidates || [];
  box.innerHTML = candidates.length ? candidates.map((card) => `<button type="button" class="smart-catalog-candidate" data-card='${escapeHtml(JSON.stringify(card))}'><strong>${escapeHtml(card.lookupTitle || card.title)}</strong><small>${escapeHtml([card.sport, card.parallel, card.grade?.company, card.grade?.grade, card.catalogSource].filter(Boolean).join(' · '))}</small></button>`).join('') : '';
  box.querySelectorAll('.smart-catalog-candidate').forEach((button) => button.addEventListener('click', () => {
    const card = JSON.parse(button.dataset.card);
    fillManualCatalogFields(root, {
      ...(card.autofill || {}),
      name: card.title,
      gradeCompany: card.grade?.company,
      grade: card.grade?.grade,
    });
    box.innerHTML = '';
    showToast('Card match selected');
  }));
}

function debounce(fn, delay = 240) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

async function renderVault() {
  loading();
  const [data, orgData] = await Promise.all([
    api('/api/dashboard'),
    api('/api/organizations').catch(() => ({ organizations: [] })),
  ]);
  const organizations = orgData?.organizations || [];
  const allocation = data.portfolio.allocation;
  const intelligence = data.intelligence || {};
  const metrics = intelligence.metrics || data.portfolio.intelligence || {};
  const tax = intelligence.taxEstimate || {};
  const inventory = intelligence.inventoryHealth || {};
  const decision = intelligence.decisionSupport || null;
  const recommendations = intelligence.recommendations?.recommendations || [];
  const isShopUser = Boolean(state.auth?.entitlements?.merchantTools || state.auth?.user?.role === 'admin' || state.auth?.user?.role === 'merchant');
  view.innerHTML = `
    ${modeBanner(data.marketMode)}
    <div class="section-head"><div><div class="eyebrow">My collection</div><h2>Vault and portfolio</h2></div><div class="actions" style="margin:0"><button id="manual-add-card" class="button small primary">Add manually</button><button id="import-menu" class="button small">Import</button><a class="button small" href="/api/collection/export.csv">Export CSV</a></div></div>
    <div class="grid metrics"><div class="metric"><small>Current value</small><strong>${formatMoney(data.portfolio.totalValue)}</strong></div><div class="metric"><small>Cost basis</small><strong>${formatMoney(data.portfolio.totalCost)}</strong></div><div class="metric"><small>Total gain</small><strong class="${data.portfolio.totalGain >= 0 ? 'positive' : 'negative'}">${formatMoney(data.portfolio.totalGain)}</strong><p>${data.portfolio.totalGainPct === null ? '—' : `${data.portfolio.totalGainPct}%`}</p></div><div class="metric"><small>Liquid estimate</small><strong>${formatMoney(data.portfolio.estimatedLiquidValue)}</strong></div></div>
    <div class="grid two" style="margin-top:16px">
      <section class="panel"><h3>Allocation</h3>${allocation.length ? allocation.map((item) => `<div class="allocation-row"><span>${escapeHtml(item.label)}</span><div class="allocation-track"><div class="allocation-fill" style="width:${Math.min(100, item.pct || item.pctOfValue || 0)}%"></div></div><strong>${item.pct ?? item.pctOfValue ?? 0}%</strong></div>`).join('') : '<div class="empty">Add cards to see allocation.</div>'}</section>
      <section class="panel"><h3>Watchlist</h3>${data.watchlist.length ? data.watchlist.slice(0, 6).map((watch) => `<div class="source-row"><div><a href="#/card/${encodeURIComponent(watch.card?.id || '')}"><strong>${escapeHtml(watch.card?.player || 'Unknown')}</strong></a><small>${watch.direction} ${formatMoney(watch.targetPrice)}</small></div><div style="text-align:right"><strong>${formatMoney(watch.market?.value)}</strong>${watch.triggered ? '<small class="positive">Alert triggered</small>' : '<small>Watching</small>'}</div></div>`).join('') : '<div class="empty">No price alerts yet.</div>'}</section>
    </div>
    <div class="section-head"><div><div class="eyebrow">Portfolio Intelligence</div><h2>Performance and risk</h2></div><div class="actions" style="margin:0"><a class="button small" href="/api/portfolio/tax-report.csv">Tax CSV</a><button id="scenario-button" class="button small">Run scenario</button></div></div>
    <div class="grid metrics"><div class="metric"><small>Avg confidence</small><strong>${metrics.averageConfidence ?? 0}%</strong><p>${metrics.lowConfidenceCount ?? 0} low-confidence values</p></div><div class="metric"><small>Concentration risk</small><strong>${escapeHtml(metrics.concentrationRisk || '—')}</strong><p>${escapeHtml(metrics.topConcentration?.label || 'No concentration')}</p></div><div class="metric"><small>Tax estimate if liquidated</small><strong>${formatMoney(tax.ifLiquidatedTaxEstimate)}</strong><p>Estimate only — not tax advice</p></div><div class="metric"><small>Stale values</small><strong>${metrics.staleValueCount ?? 0}</strong><p>Need fresh comps/review</p></div></div>
    <div style="margin-top:16px">${portfolioDecisionPanel(decision)}</div>
    <div class="grid two" style="margin-top:16px"><section class="panel"><h3>Smart recommendations</h3>${recommendations.length ? recommendations.slice(0, 6).map((rec) => `<div class="source-row"><div><strong>${escapeHtml(rec.title)}</strong><small>${escapeHtml(rec.message)}</small></div><span class="status ${escapeHtml(rec.priority || 'medium')}">${escapeHtml(rec.priority || 'medium')}</span></div>`).join('') : '<div class="empty">No recommendations yet. Add more valued cards to generate insights.</div>'}</section><section class="panel"><h3>ROI leaders</h3>${(intelligence.roi?.groups?.byPlayer || []).slice(0, 6).map((row) => `<div class="source-row"><span>${escapeHtml(row.label)}</span><strong class="${row.gain >= 0 ? 'positive' : 'negative'}">${formatMoney(row.gain)}</strong></div>`).join('') || '<div class="empty">No ROI data yet.</div>'}</section></div>
    ${isShopUser ? `<div class="section-head"><div><div class="eyebrow">Inventory Intelligence</div><h2>Shop health</h2></div><a class="button small" href="/api/portfolio/inventory-report.csv">Inventory CSV</a></div><div class="grid metrics"><div class="metric"><small>Inventory value</small><strong>${formatMoney(inventory.inventoryValue)}</strong></div><div class="metric"><small>Average age</small><strong>${inventory.averageAgeDays ?? 0}d</strong></div><div class="metric"><small>List candidates</small><strong>${inventory.listCandidates?.length || 0}</strong></div><div class="metric"><small>Reprice/review</small><strong>${(inventory.repriceCandidates?.length || 0) + (inventory.reviewCandidates?.length || 0)}</strong></div></div><div style="margin-top:16px">${inventoryDecisionPanel(inventory)}</div>` : ''}
    <div class="section-head"><h2>Holdings</h2><span class="subtle">${data.collection.length} records · ${data.collection.reduce((sum, item) => sum + item.quantity, 0)} cards</span></div>
    <div class="card-list">${data.collection.length ? data.collection.map((item) => item.card ? `<div class="card-row">${cardImageTag(item.card)}<div><h3><a href="#/card/${encodeURIComponent(item.card.id)}">${escapeHtml(cardTitle(item.card))}</a></h3><p>Qty ${item.quantity} · ${escapeHtml(item.status)} · Cost ${formatMoney(item.costBasis)}<br>${escapeHtml(item.location || item.notes || 'No location or notes')}</p><div class="row-meta-stack">${imageSourceBadge(item.card)}<span class="status ${item.market?.confidence >= 65 ? 'included' : 'needs_review'}">Value confidence ${item.market?.confidence ?? 0}%</span></div></div><div class="card-price"><strong>${formatMoney(item.currentValue)}</strong><small class="${item.gain >= 0 ? 'positive' : 'negative'}">${item.gain >= 0 ? '+' : ''}${formatMoney(item.gain)}</small><button class="button small edit-holding" data-id="${escapeHtml(item.id)}">Edit</button></div></div>` : `<div class="card-row"><div class="card-thumb" style="display:grid;place-items:center">?</div><div><h3>${escapeHtml(item.name || 'Unmatched card')}</h3><p>Qty ${item.quantity} · ${escapeHtml(item.status)}<br>Needs catalog match</p><span class="status needs_review">Manual review</span></div><div class="card-price"><strong>—</strong><button class="button small edit-holding" data-id="${escapeHtml(item.id)}">Edit</button></div></div>`).join('') : emptyState('Your Vault is empty', 'Scan or search for a card, then add it to begin tracking value, liquidity, confidence, and portfolio movement.', '<a class="button primary" href="#/scan">Scan first card</a>')}</div>
    <div class="section-head"><h2>Recent scans</h2><a href="#/scan">Scan another</a></div>
    <section class="panel">${data.scanHistory.length ? data.scanHistory.slice(0, 8).map((scan) => `<div class="source-row"><div><strong>${escapeHtml(scan.query || scan.mode)}</strong><small>${dateTimeFmt.format(new Date(scan.createdAt))} · ${scan.frontBack ? 'front + back' : 'single image/text'}</small></div><span class="status">${escapeHtml(scan.mode)}</span></div>`).join('') : emptyState('No scans recorded', 'Scan front, back, and cert label images to build a review history and improve future matches.', '<a class="button small" href="#/scan">Open scanner</a>')}</section>`;

  document.querySelector('#scenario-button')?.addEventListener('click', () => {
    const modal = openModal('Portfolio scenario', `<form id="scenario-form" class="form-grid"><div class="form-grid two"><div><label>Market drop %</label><input id="scenario-drop" type="number" step="0.1" value="10"></div><div><label>Market gain %</label><input id="scenario-gain" type="number" step="0.1" value="0"></div></div><div><label>Estimated selling fee %</label><input id="scenario-fee" type="number" step="0.1" value="13"></div><button class="button primary">Run scenario</button><div id="scenario-result"></div></form>`);
    modal.root.querySelector('#scenario-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = event.currentTarget.querySelector('button');
      setBusy(button, true, 'Modeling…');
      try {
        const result = await api('/api/portfolio/scenario', { method: 'POST', body: JSON.stringify({ scenario: { marketDropPct: Number(modal.root.querySelector('#scenario-drop').value), marketGainPct: Number(modal.root.querySelector('#scenario-gain').value), sellFeePct: Number(modal.root.querySelector('#scenario-fee').value) / 100 } }) });
        const scenario = result.scenario;
        modal.root.querySelector('#scenario-result').innerHTML = `<div class="notice"><strong>Projected portfolio value:</strong> ${formatMoney(scenario.valueAfterMarketMove)}<br><strong>Projected change:</strong> ${formatMoney(scenario.projectedChange)}<br><strong>Estimated proceeds if selected set sold:</strong> ${formatMoney(scenario.estimatedSellProceeds)}</div>`;
      } catch (error) { modal.root.querySelector('#scenario-result').innerHTML = `<div class="notice warning">${escapeHtml(error.message)}</div>`; }
      finally { setBusy(button, false); }
    });
  });

  document.querySelector('#manual-add-card')?.addEventListener('click', () => {
    const orgOptions = organizations.map((org) => `<option value="${escapeHtml(org.id)}">${escapeHtml(org.name)}</option>`).join('');
    const modal = openModal('Add card with catalog assist', `<form id="manual-card-form" class="form-grid">
      <div class="notice">Type what you know, then find a catalog match. ManeFlow auto-fills from loaded catalog/checklist rows and saves unmatched cards safely when coverage is missing.</div>
      <input id="manual-card-id" type="hidden"><input id="manual-name" type="hidden">
      <div class="form-grid two"><div><label>Save to</label><select id="manual-destination"><option value="vault">Personal Vault</option>${organizations.length ? '<option value="shop">Shop inventory</option>' : ''}</select></div><div id="manual-org-wrap" class="${organizations.length ? '' : 'hidden'}"><label>Shop</label><select id="manual-org">${orgOptions}</select></div></div>
      <div><label>Smart card lookup</label><div class="search-bar"><input id="manual-catalog-query" autocomplete="off" placeholder="Start typing: 2018 Topps Ohtani US1"><button id="manual-find-match" type="button" class="button">Find match</button></div><div id="manual-smart-candidates" class="smart-catalog-candidates"></div></div>
      <div class="form-grid two"><div><label>Sport</label><input id="manual-sport" placeholder="Baseball"></div><div><label>Year</label><input id="manual-year" inputmode="numeric" placeholder="2018"></div></div>
      <div class="form-grid two"><div><label>Brand</label><input id="manual-brand" placeholder="Topps"></div><div><label>Set</label><input id="manual-set" placeholder="Update Series"></div></div>
      <div class="form-grid two"><div><label>Player / subject</label><input id="manual-player" placeholder="Shohei Ohtani"></div><div><label>Card number</label><input id="manual-card-number" placeholder="US1"></div></div>
      <div class="form-grid two"><div><label>Parallel / variation</label><input id="manual-parallel" placeholder="Base Rookie Debut"></div><div><label>Serial number</label><input id="manual-serial" placeholder="/99"></div></div>
      <div class="form-grid two"><div><label>Grading company</label><input id="manual-grade-company" placeholder="PSA"></div><div><label>Grade</label><input id="manual-grade" placeholder="10"></div></div>
      <div class="form-grid two"><div><label>Quantity</label><input id="manual-qty" type="number" min="1" step="1" value="1"></div><div><label>Cost basis per card</label><input id="manual-cost" type="number" min="0" step="0.01" value="0"></div></div>
      <div class="form-grid two"><div><label>Cert number</label><input id="manual-cert" placeholder="Optional"></div><div><label>Location</label><input id="manual-location" placeholder="Box, showcase, row"></div></div>
      <div><label>Notes</label><textarea id="manual-notes" rows="3" placeholder="Condition, source, checklist uncertainty, or intake notes"></textarea></div>
      <div id="manual-catalog-result"></div>
      <button class="button primary">Save card</button>
    </form>`);

    const refreshDestination = () => {
      modal.root.querySelector('#manual-org-wrap')?.classList.toggle('hidden', modal.root.querySelector('#manual-destination').value !== 'shop');
    };
    modal.root.querySelector('#manual-destination')?.addEventListener('change', refreshDestination);
    refreshDestination();

    const runSmartCatalogSearch = debounce(async () => {
      const query = modal.root.querySelector('#manual-catalog-query').value.trim();
      if (query.length < 3) {
        modal.root.querySelector('#manual-smart-candidates').innerHTML = '';
        return;
      }
      try {
        const params = new URLSearchParams({ ...manualCatalogInput(modal.root), q: query, limit: 8 });
        renderSmartCatalogAutocomplete(modal.root, await api(`/api/catalog/smart-autocomplete?${params.toString()}`));
      } catch {
        modal.root.querySelector('#manual-smart-candidates').innerHTML = '';
      }
    }, 220);
    modal.root.querySelector('#manual-catalog-query').addEventListener('input', runSmartCatalogSearch);

    modal.root.querySelector('#manual-find-match').addEventListener('click', async (event) => {
      setBusy(event.currentTarget, true, 'Searching...');
      try {
        const params = new URLSearchParams(manualCatalogInput(modal.root));
        renderManualCatalogResults(modal.root, await api(`/api/catalog/autocomplete?${params.toString()}`));
      } catch (error) {
        modal.root.querySelector('#manual-catalog-result').innerHTML = `<div class="notice warning">${escapeHtml(error.message)}</div>`;
      } finally {
        setBusy(event.currentTarget, false);
      }
    });

    modal.root.querySelector('#manual-card-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = event.currentTarget.querySelector('button[type="submit"], .button.primary:last-child');
      setBusy(button, true, 'Saving...');
      try {
        const input = manualCatalogInput(modal.root);
        const completion = await api('/api/catalog/complete', { method: 'POST', body: JSON.stringify(input) });
        const selectedCardId = modal.root.querySelector('#manual-card-id').value || completion.autopopulate?.cardId || '';
        const selectedName = modal.root.querySelector('#manual-name').value || completion.autopopulate?.name || manualCatalogName(input);
        const destination = modal.root.querySelector('#manual-destination').value;
        const quantity = Number(modal.root.querySelector('#manual-qty').value || 1);
        const cost = Number(modal.root.querySelector('#manual-cost').value || 0);
        const notes = [modal.root.querySelector('#manual-notes').value, completion.accepted ? 'Matched by ManeFlow catalog autocomplete.' : 'Saved unmatched; import checklist data to improve auto-fill.'].filter(Boolean).join('\n');
        if (destination === 'shop') {
          const orgId = modal.root.querySelector('#manual-org')?.value;
          if (!orgId) throw new Error('Choose a shop workspace.');
          const saved = await api(`/api/organizations/${encodeURIComponent(orgId)}/inventory`, { method: 'POST', body: JSON.stringify({ cardId: selectedCardId || null, name: selectedName, quantity, costBasis: cost, location: modal.root.querySelector('#manual-location').value, source: completion.accepted ? 'catalog autocomplete' : 'manual unmatched', notes }) });
          showToast(saved.merged ? 'Updated shop inventory quantity' : (completion.accepted ? 'Added matched card to shop inventory' : 'Added unmatched card to shop inventory'));
        } else {
          const saved = await api('/api/collection', { method: 'POST', body: JSON.stringify({ cardId: selectedCardId || null, name: selectedName, quantity, purchasePrice: cost, location: modal.root.querySelector('#manual-location').value, certNumber: modal.root.querySelector('#manual-cert').value, notes }) });
          showToast(saved.merged ? 'Updated Vault quantity' : (completion.accepted ? 'Added matched card to Vault' : 'Added unmatched card to Vault'));
        }
        modal.close();
        renderVault();
      } catch (error) {
        handleActionError(error);
      } finally {
        setBusy(button, false);
      }
    });
  });

  document.querySelector('#import-menu').addEventListener('click', () => {
    const modal = openModal('Import data', `<div class="tabs"><button class="active" data-import="collection">Collection</button><button data-import="catalog">Catalog</button><button data-import="sales">Sales</button></div><div id="import-copy" class="notice" style="margin-top:13px">Import card holdings. ManeFlow will smart-match rows to the catalog and flag uncertain records.</div><div style="margin-top:13px"><input id="import-file" type="file" accept=".csv,text/csv"></div><button id="run-import" class="button primary" style="width:100%;margin-top:13px">Import CSV</button><div id="import-result" style="margin-top:12px"></div>`);
    let type = 'collection';
    const copy = {
      collection: 'Import card holdings. ManeFlow will smart-match rows to the catalog and flag uncertain records.',
      catalog: 'Import a custom catalog with year, brand, set, player, cardNumber, parallel, grade, sport, and image fields.',
      sales: 'Import user-authorized completed-sale exports. Asking prices must not be labeled as sold comps.',
    };
    modal.root.querySelectorAll('[data-import]').forEach((button) => button.addEventListener('click', () => {
      type = button.dataset.import;
      modal.root.querySelectorAll('[data-import]').forEach((item) => item.classList.toggle('active', item === button));
      modal.root.querySelector('#import-copy').textContent = copy[type];
    }));
    modal.root.querySelector('#run-import').addEventListener('click', async (event) => {
      const file = modal.root.querySelector('#import-file').files?.[0];
      if (!file) return showToast('Choose a CSV file.');
      setBusy(event.currentTarget, true, 'Importing…');
      const resultBox = modal.root.querySelector('#import-result');
      try {
        const result = await api(`/api/import/${type}-csv`, { method: 'POST', body: JSON.stringify({ csv: await file.text() }) });
        resultBox.innerHTML = `<div class="notice success">Imported ${result.summary.imported} of ${result.summary.rows} rows. ${result.summary.errors || 0} errors; ${result.summary.review || 0} need review.</div>`;
        setTimeout(() => { modal.close(); renderVault(); }, 900);
      } catch (error) { resultBox.innerHTML = `<div class="notice warning">${escapeHtml(error.message)}</div>`; }
      finally { setBusy(event.currentTarget, false); }
    });
  });

  document.querySelectorAll('.edit-holding').forEach((button) => button.addEventListener('click', () => {
    const item = data.collection.find((entry) => entry.id === button.dataset.id);
    const modal = openModal('Edit holding', `<form id="holding-form" class="form-grid"><div class="form-grid two"><div><label>Quantity</label><input id="holding-qty" type="number" min="1" step="1" value="${item.quantity}"></div><div><label>Purchase price per card</label><input id="holding-price" type="number" min="0" step="0.01" value="${item.purchasePrice}"></div></div><div class="form-grid two"><div><label>Status</label><select id="holding-status">${['owned','listed','consigned','sold','grading'].map((status) => `<option ${status === item.status ? 'selected' : ''}>${status}</option>`).join('')}</select></div><div><label>Storage location</label><input id="holding-location" value="${escapeHtml(item.location || '')}" placeholder="Vault row, box, showcase…"></div></div><div><label>Certification number</label><input id="holding-cert" value="${escapeHtml(item.certNumber || '')}"></div><div><label>Notes</label><textarea id="holding-notes" rows="3">${escapeHtml(item.notes || '')}</textarea></div><div class="actions" style="margin:0"><button class="button primary" type="submit">Save changes</button><button class="button danger" type="button" id="delete-holding">Remove</button></div></form>`);
    modal.root.querySelector('#holding-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        await api(`/api/collection/${encodeURIComponent(item.id)}`, { method: 'PATCH', body: JSON.stringify({ quantity: Number(modal.root.querySelector('#holding-qty').value), purchasePrice: Number(modal.root.querySelector('#holding-price').value), status: modal.root.querySelector('#holding-status').value, location: modal.root.querySelector('#holding-location').value, certNumber: modal.root.querySelector('#holding-cert').value, notes: modal.root.querySelector('#holding-notes').value }) });
        modal.close(); renderVault();
      } catch (error) { handleActionError(error); }
    });
    modal.root.querySelector('#delete-holding').addEventListener('click', async () => {
      if (!confirm('Remove this holding from your Vault?')) return;
      await api(`/api/collection/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
      modal.close(); renderVault();
    });
  }));
}

async function renderSell() {
  loading();
  const [data, listingsData] = await Promise.all([api('/api/dashboard'), api('/api/listings')]);
  const listings = listingsData.listings;
  view.innerHTML = `
    <div class="section-head"><div><div class="eyebrow">From intelligence to revenue</div><h2>Selling workspace</h2></div><a href="#/search">Find a card</a></div>
    <div class="grid metrics"><div class="metric"><small>Draft listings</small><strong>${listings.filter((item) => item.status === 'draft').length}</strong></div><div class="metric"><small>Ready to submit</small><strong>${listings.filter((item) => item.status === 'ready').length}</strong></div><div class="metric"><small>Currently listed</small><strong>${listings.filter((item) => item.status === 'listed').length}</strong></div><div class="metric"><small>Collection at market</small><strong>${formatMoney(data.portfolio.totalValue)}</strong></div></div>
    <div class="notice" style="margin-top:14px">ManeFlow prepares pricing and listing drafts. Actual marketplace submission happens only through an authorized account connection and is never performed without the user’s explicit action.</div>
    <div class="section-head"><h2>Listing drafts</h2><span class="subtle">${listings.length} total</span></div>
    <section class="panel">${listings.length ? listings.map((item) => `<div class="listing-row"><div><strong>${escapeHtml(item.title || 'Untitled listing')}</strong><small>${escapeHtml(item.marketplace)} · ${escapeHtml(item.status)} · updated ${formatDate(item.updatedAt)}</small></div><div style="text-align:right"><strong>${formatMoney(item.price)}</strong><small><button class="button small edit-listing" data-id="${escapeHtml(item.id)}">Manage</button></small></div></div>`).join('') : '<div class="empty"><h3>No drafts yet</h3><p>Open a card’s market page and choose Prepare listing. ManeFlow will carry the identity and suggested price into this workspace.</p><a class="button primary" href="#/search">Search cards</a></div>'}</section>
    <div class="section-head"><h2>Best selling candidates</h2><span class="subtle">Ranked by liquidity</span></div>
    <div class="card-list">${data.portfolio.mostLiquid.filter((item) => item.card).slice(0, 6).map((item) => cardRow(item.card, { extra: `<span class="trend">Liquidity ${Math.round(item.liquidity * 100)}</span>` })).join('') || '<div class="empty">Add valued cards to your Vault to generate candidates.</div>'}</div>`;

  document.querySelectorAll('.edit-listing').forEach((button) => button.addEventListener('click', () => {
    const item = listings.find((entry) => entry.id === button.dataset.id);
    const modal = openModal('Manage listing draft', `<form id="listing-edit" class="form-grid"><div><label>Marketplace</label><input id="edit-market" value="${escapeHtml(item.marketplace)}"></div><div><label>Title</label><input id="edit-title" value="${escapeHtml(item.title)}"></div><div class="form-grid two"><div><label>Price</label><input id="edit-price" type="number" min="0" step="0.01" value="${item.price ?? ''}"></div><div><label>Status</label><select id="edit-status">${['draft','ready','submitted','listed','sold','cancelled'].map((status) => `<option ${status === item.status ? 'selected' : ''}>${status}</option>`).join('')}</select></div></div><div><label>Description</label><textarea id="edit-description" rows="4">${escapeHtml(item.description || '')}</textarea></div><div class="actions" style="margin:0"><button class="button primary">Save</button><button id="delete-listing" type="button" class="button danger">Delete</button></div></form>`);
    modal.root.querySelector('#listing-edit').addEventListener('submit', async (event) => {
      event.preventDefault();
      await api(`/api/listings/${encodeURIComponent(item.id)}`, { method: 'PATCH', body: JSON.stringify({ marketplace: modal.root.querySelector('#edit-market').value, title: modal.root.querySelector('#edit-title').value, price: Number(modal.root.querySelector('#edit-price').value), status: modal.root.querySelector('#edit-status').value, description: modal.root.querySelector('#edit-description').value }) });
      modal.close(); renderSell();
    });
    modal.root.querySelector('#delete-listing').addEventListener('click', async () => {
      if (!confirm('Delete this listing draft?')) return;
      await api(`/api/listings/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
      modal.close(); renderSell();
    });
  }));
}

async function renderSources() {
  loading();
  const [config, data, images] = await Promise.all([ensureConfig(), api('/api/providers'), api('/api/card-images/sources')]);
  view.innerHTML = `
    ${modeBanner(config.marketMode)}
    <div class="section-head"><div><div class="eyebrow">Trust and transparency</div><h2>Data sources</h2></div></div>
    <div class="notice">${escapeHtml(data.policy)}</div>
    <section class="panel" style="margin-top:14px">${data.providers.map((source) => `<div class="source-row"><div><strong>${escapeHtml(source.name)}</strong><small>${escapeHtml(source.notes)}</small><small>Capabilities: ${source.capabilities?.length ? source.capabilities.map(escapeHtml).join(', ') : 'none enabled'}</small><small>Rights: ${escapeHtml(source.dataRightsStatus || 'unknown')} · Auth: ${escapeHtml(source.authorizationBasis || 'unknown')} · Refresh: ${escapeHtml(source.refreshPolicy || 'manual')}</small></div><span class="status ${escapeHtml(source.mode)}">${escapeHtml(String(source.mode).replaceAll('_', ' '))}</span></div>`).join('')}</section>
    <div class="section-head"><h2>Card image sources</h2></div>
    <section class="panel"><div class="notice">${escapeHtml(images.policy)}</div>${images.builtInSources.map((source) => `<div class="source-row"><div><strong>${escapeHtml(source.label)}</strong><small>${escapeHtml(source.hosts.join(', '))}</small><small>${escapeHtml(source.rightsNotes)}</small></div><span class="status ${source.enabled ? 'included' : 'needs_review'}">${source.enabled ? 'enabled' : 'disabled'}</span></div>`).join('')}</section>
    <div class="section-head"><h2>Approved ingestion model</h2></div>
    <div class="grid three"><div class="metric"><small>Official APIs</small><strong>Direct</strong><p>Authenticated, rate-limited provider integrations.</p></div><div class="metric"><small>Licensed feeds</small><strong>Partner</strong><p>Commercial data with explicit usage rights.</p></div><div class="metric"><small>User-authorized</small><strong>Import</strong><p>Account exports and CSVs supplied by the user.</p></div></div>
    <div class="section-head"><h2>Recent provider ingests</h2></div>
    <section class="panel">${data.recentIngests?.length ? data.recentIngests.map((item) => `<div class="source-row"><div><strong>${escapeHtml(item.provider)}</strong><small>${escapeHtml(item.authorizationBasis)} · ${formatDate(item.createdAt)}</small></div><strong>${item.salesAdded || 0} sales</strong></div>`).join('') : '<div class="empty">No approved provider feed has been ingested yet.</div>'}</section>
    <div class="section-head"><h2>Valuation rules</h2></div>
    <section class="panel"><div class="source-row"><div><strong>Completed sales only</strong><small>Active listings are shown separately and never treated as sold comps.</small></div></div><div class="source-row"><div><strong>All-in transaction price</strong><small>Shipping and buyer premium are included when supplied.</small></div></div><div class="source-row"><div><strong>Outlier and duplicate controls</strong><small>Duplicate sales are removed; IQR filtering flags extreme results.</small></div></div><div class="source-row"><div><strong>Confidence over false precision</strong><small>Volume, source diversity, verification, recency, and dispersion shape confidence and range.</small></div></div></section>`;
}

async function renderPlans() {
  loading();
  const data = await api('/api/plans');
  view.innerHTML = `
    <div class="section-head"><div><div class="eyebrow">Choose your workflow</div><h2>ManeFlow plans</h2></div></div>
    <div class="grid four">${Object.entries(data.plans).map(([key, plan]) => `<section class="panel plan-card"><div class="eyebrow">${escapeHtml(plan.name)}</div><h2>${plan.monthlyPrice === null ? 'Custom' : plan.monthlyPrice === 0 ? 'Free' : `${formatMoney(plan.monthlyPrice)}/mo`}</h2><p>${escapeHtml(plan.description)}</p><div class="source-row"><span>Vault capacity</span><strong>${plan.vaultItems === null ? 'Custom' : plan.vaultItems.toLocaleString()}</strong></div><div class="source-row"><span>Scans per day</span><strong>${plan.scansPerDay === null ? 'Custom' : plan.scansPerDay.toLocaleString()}</strong></div><div class="source-row"><span>History</span><strong>${plan.historyDays >= 3650 ? '10 years' : `${plan.historyDays} days`}</strong></div><div class="source-row"><span>Merchant tools</span><strong>${plan.merchantTools ? 'Included' : '—'}</strong></div><div class="source-row"><span>API access</span><strong>${plan.apiAccess ? 'Included' : '—'}</strong></div>${key === 'free' ? '<a class="button" href="#/account">Start free</a>' : '<a class="button primary" href="mailto:memphiscardcompany@gmail.com?subject=ManeFlow%20plan">Request access</a>'}</section>`).join('')}</div>
    <div class="notice" style="margin-top:14px">Plan entitlements are active in the product. Public checkout is intentionally not enabled until the Memphis Card Company billing account, taxes, refund rules, and Apple/Google purchase policies are configured.</div>`;
}

async function renderSettings() {
  if (!window.maneFlowDesktop) {
    view.innerHTML = `<section class="panel"><div class="eyebrow">Desktop settings</div><h2>Available in the installed PC app</h2><p class="subtle">Provider credentials and local-service controls are stored through the ManeFlow Windows desktop shell.</p></section>`;
    return;
  }
  loading(3, 'Loading desktop settings', 'Checking the local recognition and pricing services...');
  const [settings, services, version] = await Promise.all([
    window.maneFlowDesktop.getSettings(),
    window.maneFlowDesktop.serviceStatus(),
    window.maneFlowDesktop.version(),
  ]);
  updateDesktopServiceStatus(services);
  const configured = (value) => value ? '<span class="status included">Configured</span>' : '<span class="status needs_review">Not configured</span>';
  const serviceCard = (name, service, note) => `<div class="service-card"><div><strong>${escapeHtml(name)}</strong><small>${escapeHtml(note)}</small></div><span class="status ${service?.ready ? 'included' : 'needs_review'}">${service?.ready ? 'Ready' : 'Needs attention'}</span></div>`;
  view.innerHTML = `
    <div class="section-head"><div><div class="eyebrow">ManeFlow Desktop ${escapeHtml(version)}</div><h2>Local app settings</h2></div></div>
    <div class="desktop-settings-grid">
      <section class="panel"><div class="panel-title"><div><h3>System status</h3><p class="subtle">ManeFlow runs the card engine locally on this PC.</p></div></div>
        ${serviceCard('ManeFlow core', services.core, services.core?.base || settings.coreBase)}
        ${serviceCard('Imaging and recognition', services.vision, services.vision?.base || settings.visionBase)}
        <div class="actions"><button class="button" id="restart-services">Restart services</button><button class="button ghost" id="create-diagnostics">Save diagnostics</button></div>
      </section>
      <section class="panel"><h3>Local files</h3><p class="subtle">Inventory, images, corrections, and logs remain in your Windows user profile.</p>
        <div class="source-row"><span>Data</span><strong>${escapeHtml(settings.dataDirectory || 'Local app data')}</strong></div>
        <div class="source-row"><span>Logs</span><strong>${escapeHtml(settings.logsDirectory || 'Local logs')}</strong></div>
        <div class="actions"><button class="button" id="open-data-folder">Open data</button><button class="button ghost" id="open-logs-folder">Open logs</button></div>
      </section>
      <section class="panel full"><div class="panel-title"><div><h3>Connected data services</h3><p class="subtle">Keys are encrypted using Windows secure credential storage and are never shown again after saving.</p></div><span class="status ${settings.secureStorageAvailable ? 'included' : 'excluded_unverified'}">${settings.secureStorageAvailable ? 'Encrypted storage ready' : 'Secure storage unavailable'}</span></div>
        <form id="desktop-provider-form" class="form-grid two">
          <label class="secret-field"><span>PSA partner API key · ${configured(settings.psaConfigured)}</span><input id="desktop-psa-key" type="password" autocomplete="off" placeholder="${settings.psaConfigured ? 'Leave blank to keep saved key' : 'Paste PSA partner key'}"><small>Encrypted with Windows secure storage and used only by the local cert-verification backend.</small></label>
          <div class="provider-connect-box"><label><span>Test PSA cert number</span><input id="desktop-psa-test-cert" inputmode="numeric" placeholder="Enter a cert from one of your slabs"></label><button class="button" id="desktop-psa-test" type="button">Test PSA connection</button><div id="desktop-psa-test-result" class="subtle"></div></div>
          <label class="secret-field"><span>OpenAI API key · ${configured(settings.openaiConfigured)}</span><input id="desktop-openai-key" type="password" autocomplete="off" placeholder="${settings.openaiConfigured ? 'Leave blank to keep saved key' : 'Optional vision key'}"><small>Optional evidence extraction when enabled.</small></label>
          <label><span>Vision model</span><input id="desktop-openai-model" value="${escapeHtml(settings.openaiVisionModel || 'gpt-4.1-mini')}"></label>
          <label><span>eBay marketplace</span><select id="desktop-ebay-marketplace"><option value="EBAY_US" ${settings.ebayMarketplaceId === 'EBAY_US' ? 'selected' : ''}>United States</option><option value="EBAY_CA" ${settings.ebayMarketplaceId === 'EBAY_CA' ? 'selected' : ''}>Canada</option><option value="EBAY_GB" ${settings.ebayMarketplaceId === 'EBAY_GB' ? 'selected' : ''}>United Kingdom</option></select></label>
          <label><span>eBay environment</span><select id="desktop-ebay-environment"><option value="production" ${settings.ebayEnvironment !== 'sandbox' ? 'selected' : ''}>Production</option><option value="sandbox" ${settings.ebayEnvironment === 'sandbox' ? 'selected' : ''}>Sandbox</option></select><small>Use Production for your live application keys.</small></label>
          <label class="secret-field"><span>eBay client ID · ${configured(settings.ebayConfigured)}</span><input id="desktop-ebay-client" type="password" autocomplete="off" placeholder="${settings.ebayConfigured ? 'Leave blank to keep saved client ID' : 'Production eBay client ID'}"></label>
          <label class="secret-field"><span>eBay client secret</span><input id="desktop-ebay-secret" type="password" autocomplete="off" placeholder="${settings.ebayConfigured ? 'Leave blank to keep saved secret' : 'Production eBay client secret'}"></label>
          <label class="secret-field"><span>eBay RuName / redirect URI name · ${configured(settings.ebayRedirectUriNameConfigured)}</span><input id="desktop-ebay-runame" type="password" autocomplete="off" placeholder="${settings.ebayRedirectUriNameConfigured ? 'Leave blank to keep saved RuName' : 'Production OAuth RuName'}"><small>Found under eBay User Tokens / OAuth redirect configuration. This is the RuName, not the web URL.</small></label>
          <label class="secret-field"><span>eBay seller user token · ${configured(settings.ebaySellerOrdersConfigured)}</span><input id="desktop-ebay-user-token" type="password" autocomplete="off" placeholder="${settings.ebaySellerOrdersConfigured ? 'Leave blank to keep saved token' : 'Optional temporary OAuth user access token'}"><small>ManeFlow can now connect with OAuth and store the refresh token automatically. Manual token entry remains available for beta testing.</small></label>
          <div class="full-row provider-connect-box"><div><strong>Connect your eBay seller account</strong><p class="subtle">Save the client ID, secret, and RuName first. Then authorize ManeFlow in eBay and paste the complete returned redirect URL below so ManeFlow can validate the one-time security state.</p></div><div class="actions"><button class="button" id="desktop-ebay-authorize" type="button">Open eBay authorization</button>${settings.ebaySellerOrdersConfigured ? '<button class="button ghost" id="desktop-ebay-disconnect" type="button">Disconnect seller</button>' : ''}</div><label class="secret-field"><span>Complete eBay redirect URL</span><input id="desktop-ebay-auth-code" type="password" autocomplete="off" placeholder="Paste the full eBay redirect URL including code and state"></label><button class="button primary" id="desktop-ebay-exchange" type="button">Finish eBay connection</button></div>
          <label class="secret-field"><span>JustTCG API key · ${configured(settings.justTcgConfigured)}</span><input id="desktop-justtcg-key" type="password" autocomplete="off" placeholder="${settings.justTcgConfigured ? 'Leave blank to keep saved key' : 'TCG market-data key'}"><small>Used server-side for TCG identity variants and current market context.</small></label>
          <label class="secret-field"><span>SportsCardsPro token · ${configured(settings.sportsCardsProConfigured)}</span><input id="desktop-scp-key" type="password" autocomplete="off" placeholder="${settings.sportsCardsProConfigured ? 'Leave blank to keep saved token' : 'SportsCardsPro API token'}"><small>Used for sports-card guide values and catalog context, never labeled as sold comps.</small></label>
          <label class="full-row checkbox-row"><input id="desktop-ebay-insights" type="checkbox" ${settings.ebayMarketplaceInsightsEnabled ? 'checked' : ''}><span>eBay has explicitly approved Marketplace Insights sold-history access for this app</span><small>Leave off for normal developer/Browse API access. Turning this on without approval will not create sold-comp access.</small></label>
          <div class="full-row actions"><button class="button primary" type="submit">Save and restart ManeFlow</button></div>
        </form>
        <div class="notice warning compact-notice">Do not reuse any key that has been exposed in screenshots or chat. Rotate it with the provider first, then save the replacement here.</div>
      </section>
    </div>`;

  document.querySelector('#restart-services')?.addEventListener('click', async (event) => {
    setBusy(event.currentTarget, true, 'Restarting…');
    try { const result = await window.maneFlowDesktop.restartServices(); updateDesktopServiceStatus(result); showToast('ManeFlow services restarted'); }
    catch (error) { showToast(error.message); }
    finally { setBusy(event.currentTarget, false); }
  });
  document.querySelector('#create-diagnostics')?.addEventListener('click', async (event) => {
    setBusy(event.currentTarget, true, 'Collecting…');
    try { const result = await window.maneFlowDesktop.createDiagnostics(); if (result.saved) showToast('Diagnostics ZIP saved'); }
    catch (error) { showToast(error.message); }
    finally { setBusy(event.currentTarget, false); }
  });
  document.querySelector('#open-data-folder')?.addEventListener('click', () => window.maneFlowDesktop.openDataFolder());
  document.querySelector('#open-logs-folder')?.addEventListener('click', () => window.maneFlowDesktop.openLogs());

  document.querySelector('#desktop-psa-test')?.addEventListener('click', async (event) => {
    const cert = document.querySelector('#desktop-psa-test-cert')?.value || '';
    const output = document.querySelector('#desktop-psa-test-result');
    setBusy(event.currentTarget, true, 'Testing PSA…');
    try {
      const result = await window.maneFlowDesktop.testPsaConnection(cert);
      if (output) output.textContent = result.verified ? `Connected — PSA verified cert ${result.cert_number}.` : `PSA responded but did not verify cert ${result.cert_number}.`;
      showToast(result.verified ? 'PSA connection verified' : 'PSA returned no verified cert');
    } catch (error) {
      if (output) output.textContent = error.message;
      showToast(error.message);
    } finally { setBusy(event.currentTarget, false); }
  });

  document.querySelector('#desktop-ebay-authorize')?.addEventListener('click', async (event) => {
    setBusy(event.currentTarget, true, 'Opening eBay…');
    try { await window.maneFlowDesktop.openEbayAuthorization(); showToast('eBay authorization opened in your browser'); }
    catch (error) { showToast(error.message); }
    finally { setBusy(event.currentTarget, false); }
  });
  document.querySelector('#desktop-ebay-exchange')?.addEventListener('click', async (event) => {
    const code = document.querySelector('#desktop-ebay-auth-code')?.value || '';
    setBusy(event.currentTarget, true, 'Connecting…');
    try { await window.maneFlowDesktop.exchangeEbayAuthorizationCode(code); showToast('eBay seller account connected'); await renderSettings(); }
    catch (error) { showToast(error.message); }
    finally { setBusy(event.currentTarget, false); }
  });
  document.querySelector('#desktop-ebay-disconnect')?.addEventListener('click', async (event) => {
    setBusy(event.currentTarget, true, 'Disconnecting…');
    try { await window.maneFlowDesktop.disconnectEbaySeller(); showToast('eBay seller account disconnected'); await renderSettings(); }
    catch (error) { showToast(error.message); }
    finally { setBusy(event.currentTarget, false); }
  });

  document.querySelector('#desktop-provider-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type="submit"]');
    const payload = {
      psaApiKey: document.querySelector('#desktop-psa-key').value,
      openaiApiKey: document.querySelector('#desktop-openai-key').value,
      openaiVisionModel: document.querySelector('#desktop-openai-model').value,
      ebayClientId: document.querySelector('#desktop-ebay-client').value,
      ebayClientSecret: document.querySelector('#desktop-ebay-secret').value,
      ebayUserAccessToken: document.querySelector('#desktop-ebay-user-token').value,
      ebayRedirectUriName: document.querySelector('#desktop-ebay-runame').value,
      ebayEnvironment: document.querySelector('#desktop-ebay-environment').value,
      ebayMarketplaceId: document.querySelector('#desktop-ebay-marketplace').value,
      ebayMarketplaceInsightsEnabled: document.querySelector('#desktop-ebay-insights').checked,
      justTcgApiKey: document.querySelector('#desktop-justtcg-key').value,
      sportsCardsProApiToken: document.querySelector('#desktop-scp-key').value,
    };
    setBusy(button, true, 'Saving and restarting…');
    try { await window.maneFlowDesktop.saveSettings(payload); showToast('Settings saved securely'); await renderSettings(); }
    catch (error) { showToast(error.message); }
    finally { setBusy(button, false); }
  });
}

async function renderAccount() {
  await refreshIdentity();
  const config = await ensureConfig();
  const query = routeQuery();
  if (state.auth.authenticated && query.get('verify')) {
    try { await api('/api/auth/verify-email', { method: 'POST', body: JSON.stringify({ token: query.get('verify') }) }); await refreshIdentity(); history.replaceState(null, '', '#/account'); showToast('Email verified'); }
    catch (error) { showToast(error.message); }
  }

  if (!state.auth.authenticated) {
    const verifyToken = query.get('verify') || '';
    const resetToken = query.get('reset') || '';
    view.innerHTML = `
      <div class="section-head"><div><div class="eyebrow">Save and sync</div><h2>Your ManeFlow account</h2></div></div>
      ${state.auth.guestMode ? '<div class="notice warning">Guest mode is enabled. Create an account so your Vault remains private and syncs across devices.</div>' : ''}
      ${verifyToken ? `<section class="panel" style="margin-top:14px"><h3>Verify email</h3><p class="subtle">Complete your ManeFlow email verification.</p><button id="verify-email-button" class="button primary">Verify my email</button><div id="verify-result"></div></section>` : ''}
      ${resetToken ? `<section class="panel" style="margin-top:14px"><h3>Choose a new password</h3><form id="reset-password-form" class="form-grid"><div><label>New password</label><input id="reset-password" type="password" minlength="10" autocomplete="new-password" required></div><button class="button primary">Reset password</button><div id="reset-result"></div></form></section>` : ''}
      <div class="grid two" style="margin-top:14px">
        <section class="panel"><h3>Sign in</h3><form id="login-form" class="form-grid"><div><label>Email</label><input id="login-email" type="email" autocomplete="email" required></div><div><label>Password</label><input id="login-password" type="password" autocomplete="current-password" required></div><button class="button primary">Sign in</button><button id="forgot-password-button" class="button ghost" type="button">Forgot password</button><div id="login-result"></div></form></section>
        <section class="panel"><h3>Create account</h3>${config.allowPublicSignups ? `<form id="register-form" class="form-grid"><div><label>Name</label><input id="register-name" autocomplete="name" required></div><div><label>Email</label><input id="register-email" type="email" autocomplete="email" required></div><div><label>Password</label><input id="register-password" type="password" minlength="10" autocomplete="new-password" required><small class="subtle">At least 10 characters.</small></div><button class="button primary">Create account</button><div id="register-result"></div></form>` : '<div class="notice">Public registration is disabled. Contact the ManeFlow administrator for access.</div>'}</section>
      </div>
      <div class="section-head"><h2>What an account unlocks</h2></div><div class="grid three"><div class="metric"><small>Private Vault</small><strong>Track</strong><p>Collection value, cost, gain, storage, and grading status.</p></div><div class="metric"><small>Live watchlist</small><strong>Alert</strong><p>Price targets and market movement in one place.</p></div><div class="metric"><small>Selling workspace</small><strong>Act</strong><p>Suggested pricing, drafts, and consignment review.</p></div></div>`;

    document.querySelector('#verify-email-button')?.addEventListener('click', async (event) => {
      setBusy(event.currentTarget, true, 'Verifying…');
      try { await api('/api/auth/verify-email', { method: 'POST', body: JSON.stringify({ token: verifyToken }) }); document.querySelector('#verify-result').innerHTML = '<div class="notice success">Email verified. You can sign in now.</div>'; }
      catch (error) { document.querySelector('#verify-result').innerHTML = `<div class="notice warning">${escapeHtml(error.message)}</div>`; }
      finally { setBusy(event.currentTarget, false); }
    });
    document.querySelector('#reset-password-form')?.addEventListener('submit', async (event) => {
      event.preventDefault(); const button = event.currentTarget.querySelector('button'); setBusy(button, true, 'Resetting…');
      try { await api('/api/auth/reset-password', { method: 'POST', body: JSON.stringify({ token: resetToken, password: document.querySelector('#reset-password').value }) }); document.querySelector('#reset-result').innerHTML = '<div class="notice success">Password updated. Sign in with your new password.</div>'; }
      catch (error) { document.querySelector('#reset-result').innerHTML = `<div class="notice warning">${escapeHtml(error.message)}</div>`; }
      finally { setBusy(button, false); }
    });
    document.querySelector('#forgot-password-button').addEventListener('click', async () => {
      const email = document.querySelector('#login-email').value;
      if (!email) return showToast('Enter your email first');
      try { const result = await api('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }); document.querySelector('#login-result').innerHTML = `<div class="notice success">${escapeHtml(result.message)}${result.reset?.actionUrl ? `<br><a href="${escapeHtml(result.reset.actionUrl)}">Open development reset link</a>` : ''}</div>`; }
      catch (error) { document.querySelector('#login-result').innerHTML = `<div class="notice warning">${escapeHtml(error.message)}</div>`; }
    });
    document.querySelector('#login-form').addEventListener('submit', async (event) => {
      event.preventDefault(); const button = event.currentTarget.querySelector('button'); setBusy(button, true, 'Signing in…');
      try {
        await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: document.querySelector('#login-email').value, password: document.querySelector('#login-password').value }) });
        await refreshIdentity();
        const requested = query.get('return') || 'home';
        location.hash = `#/${/^[a-z0-9/_-]+$/i.test(requested) ? requested : 'home'}`;
        showToast('Welcome back');
      }
      catch (error) { document.querySelector('#login-result').innerHTML = `<div class="notice warning">${escapeHtml(error.message)}</div>`; }
      finally { setBusy(button, false); }
    });
    document.querySelector('#register-form')?.addEventListener('submit', async (event) => {
      event.preventDefault(); const button = event.currentTarget.querySelector('button'); setBusy(button, true, 'Creating…');
      try {
        const result = await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ name: document.querySelector('#register-name').value, email: document.querySelector('#register-email').value, password: document.querySelector('#register-password').value }) });
        await refreshIdentity();
        if (result.verification?.actionUrl) {
          location.href = result.verification.actionUrl;
        } else if (result.authenticated) {
          showToast('Account created');
          location.hash = '#/home';
        } else {
          document.querySelector('#register-result').innerHTML = `<div class="notice success">${escapeHtml(result.message || 'Account created. Check your email to verify the account before signing in.')}</div>`;
        }
      } catch (error) { document.querySelector('#register-result').innerHTML = `<div class="notice warning">${escapeHtml(error.message)}</div>`; }
      finally { setBusy(button, false); }
    });
    return;
  }

  const [dashboard, sessions] = await Promise.all([api('/api/dashboard'), api('/api/auth/sessions')]);
  const user = state.auth.user;
  const alerts = dashboard.alerts || [];
  view.innerHTML = `
    <div class="section-head"><div><div class="eyebrow">Account</div><h2>${escapeHtml(user.name)}</h2></div><span class="status configured">${escapeHtml(user.plan || 'free')} plan</span></div>
    ${!user.emailVerifiedAt ? '<div class="notice warning"><span>Your email is not verified.</span> <button id="resend-verification" class="button small">Send verification</button></div>' : '<div class="notice success">Email verified.</div>'}
    <div class="grid two" style="margin-top:14px">
      <section class="panel"><h3>Profile</h3><form id="profile-form" class="form-grid"><div><label>Name</label><input id="profile-name" value="${escapeHtml(user.name)}" required></div><div><label>Email</label><input value="${escapeHtml(user.email)}" disabled></div><div class="source-row"><span>Role</span><strong>${escapeHtml(user.role)}</strong></div><div class="source-row"><span>Member since</span><strong>${formatDate(user.createdAt)}</strong></div><button class="button primary">Save profile</button></form><div class="actions"><button id="logout-button" class="button danger">Sign out</button>${user.role === 'admin' ? '<a class="button" href="#/admin">Owner control room</a>' : ''}</div></section>
      <section class="panel"><h3>Preferences</h3><form id="preferences-form" class="form-grid"><div><label>Default market window</label><select id="pref-window">${['7d','30d','90d','180d','365d'].map((window) => `<option ${dashboard.preferences.defaultMarketWindow === window ? 'selected' : ''}>${window}</option>`).join('')}</select></div><label style="display:flex;gap:9px;align-items:center"><input id="pref-private" type="checkbox" style="width:auto;min-height:auto" ${dashboard.preferences.includePrivateSalesInValuation ? 'checked' : ''}> Include my authorized private sales in valuations</label><label style="display:flex;gap:9px;align-items:center"><input id="pref-compact" type="checkbox" style="width:auto;min-height:auto" ${dashboard.preferences.compactMode ? 'checked' : ''}> Compact collection view</label><button class="button primary">Save preferences</button></form></section>
    </div>
    <div class="section-head"><h2>Price alerts</h2><span class="status">${dashboard.unreadAlerts || 0} unread</span></div>
    <section class="panel">${alerts.length ? alerts.map((alert) => `<div class="source-row"><div><strong>${escapeHtml(alert.title)}</strong><small>${escapeHtml(alert.message)} · ${dateTimeFmt.format(new Date(alert.createdAt))}</small></div><button class="button small alert-read" data-id="${escapeHtml(alert.id)}">${alert.readAt ? 'Resolve' : 'Mark read'}</button></div>`).join('') : '<div class="empty">No price targets have triggered.</div>'}</section>
    <div class="section-head"><h2>Security</h2></div>
    <div class="grid two"><section class="panel"><h3>Change password</h3><form id="change-password-form" class="form-grid"><div><label>Current password</label><input id="current-password" type="password" autocomplete="current-password" required></div><div><label>New password</label><input id="new-password" type="password" minlength="10" autocomplete="new-password" required></div><button class="button primary">Change password</button><div id="password-result"></div></form></section>
    <section class="panel"><h3>Signed-in devices</h3>${sessions.sessions.length ? sessions.sessions.map((session) => `<div class="source-row"><div><strong>${escapeHtml(session.userAgent || 'Unknown device')}</strong><small>${escapeHtml(session.ip || '')} · ${formatDate(session.createdAt)}</small></div><button class="button small revoke-session" data-id="${escapeHtml(session.id)}">Revoke</button></div>`).join('') : '<div class="empty">No active sessions.</div>'}</section></div>
    <section class="panel" style="margin-top:14px"><div class="panel-title"><div><h3>Emergency session control</h3><p class="subtle">Immediately revoke every ManeFlow browser and device session.</p></div><button id="revoke-all-sessions" class="button danger">Sign out all devices</button></div></section>
    <div class="section-head"><h2>Privacy and data</h2></div><section class="panel"><p class="subtle">Card images are sent to the configured vision provider only when you explicitly submit a scan. Credentials remain server-side. Marketplace connections require your authorization.</p><div class="actions"><a class="button" href="/api/collection/export.csv">Export collection CSV</a><a class="button" href="/api/auth/export">Export all account data</a><a class="button ghost" href="#/plans">View plans</a><a class="button ghost" href="#/sources">Review data sources</a><a class="button ghost" href="/privacy.html">Privacy</a><a class="button ghost" href="/terms.html">Terms</a><button id="delete-account" class="button danger">Delete account</button></div></section>`;

  document.querySelector('#resend-verification')?.addEventListener('click', async (event) => { setBusy(event.currentTarget, true, 'Sending…'); try { const result = await api('/api/auth/request-verification', { method: 'POST', body: '{}' }); if (result.verification?.actionUrl) location.href = result.verification.actionUrl; else showToast('Verification queued'); } catch (error) { showToast(error.message); } finally { setBusy(event.currentTarget, false); } });
  document.querySelector('#profile-form').addEventListener('submit', async (event) => { event.preventDefault(); const result = await api('/api/auth/account', { method: 'PATCH', body: JSON.stringify({ name: document.querySelector('#profile-name').value }) }); state.auth.user = result.user; accountLabel.textContent = result.user.name; showToast('Profile saved'); });
  document.querySelector('#logout-button').addEventListener('click', async () => { await api('/api/auth/logout', { method: 'POST', body: '{}' }); await refreshIdentity(); location.hash = '#/home'; showToast('Signed out'); });
  document.querySelector('#preferences-form').addEventListener('submit', async (event) => { event.preventDefault(); await api('/api/preferences', { method: 'PATCH', body: JSON.stringify({ defaultMarketWindow: document.querySelector('#pref-window').value, includePrivateSalesInValuation: document.querySelector('#pref-private').checked, compactMode: document.querySelector('#pref-compact').checked }) }); showToast('Preferences saved'); });
  document.querySelectorAll('.alert-read').forEach((button) => button.addEventListener('click', async () => { const alert = alerts.find((item) => item.id === button.dataset.id); await api(`/api/alerts/${encodeURIComponent(button.dataset.id)}`, { method: 'PATCH', body: JSON.stringify(alert?.readAt ? { resolved: true } : { read: true }) }); renderAccount(); }));
  document.querySelector('#change-password-form').addEventListener('submit', async (event) => { event.preventDefault(); const button = event.currentTarget.querySelector('button'); setBusy(button, true, 'Updating…'); try { await api('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: document.querySelector('#current-password').value, newPassword: document.querySelector('#new-password').value }) }); document.querySelector('#password-result').innerHTML = '<div class="notice success">Password changed. Sign in again.</div>'; setTimeout(async () => { await refreshIdentity(); location.hash = '#/account'; }, 700); } catch (error) { document.querySelector('#password-result').innerHTML = `<div class="notice warning">${escapeHtml(error.message)}</div>`; } finally { setBusy(button, false); } });
  document.querySelectorAll('.revoke-session').forEach((button) => button.addEventListener('click', async () => { await api(`/api/auth/sessions/${encodeURIComponent(button.dataset.id)}`, { method: 'DELETE' }); await refreshIdentity(); renderAccount(); }));
  document.querySelector('#revoke-all-sessions')?.addEventListener('click', async () => {
    if (!confirm('Sign out every ManeFlow session, including this device?')) return;
    await api('/api/auth/sessions/revoke-all', { method: 'POST', body: '{}' });
    await refreshIdentity();
    location.hash = '#/account';
    showToast('All devices signed out');
  });
  document.querySelector('#delete-account').addEventListener('click', () => {
    const modal = openModal('Delete account', `<form id="delete-account-form" class="form-grid"><div class="notice warning">This permanently deletes your account, Vault, watchlist, scans, drafts, and settings.</div><div><label>Enter your password</label><input id="delete-password" type="password" autocomplete="current-password" required></div><button class="button danger">Permanently delete account</button></form>`);
    modal.root.querySelector('#delete-account-form').addEventListener('submit', async (event) => { event.preventDefault(); if (!confirm('Permanently delete your ManeFlow account?')) return; try { await api('/api/auth/account', { method: 'DELETE', body: JSON.stringify({ password: modal.root.querySelector('#delete-password').value }) }); modal.close(); await refreshIdentity(); location.hash = '#/home'; showToast('Account deleted'); } catch (error) { showToast(error.message); } });
  });
}

async function renderAdmin() {
  await refreshIdentity();
  if (state.auth.user?.role !== 'admin') { view.innerHTML = '<div class="empty"><h2>Administrator access required</h2><a class="button" href="#/account">Return to account</a></div>'; return; }
  loading();
  const [status, health, users, consignments, outbox, compReview, portfolioAdmin, inventoryAdmin, pricingAdmin, ebayAdmin, dataSources, recognitionBenchmarks, manualComps] = await Promise.all([api('/api/admin/status'), api('/api/admin/data-health'), api('/api/admin/users'), api('/api/admin/consignments'), api('/api/admin/outbox'), api('/api/admin/comps/review'), api('/api/admin/portfolio-intelligence'), api('/api/admin/inventory-intelligence'), api('/api/admin/pricing-data/report'), api('/api/admin/ebay/status'), api('/api/admin/data-sources'), api('/api/admin/recognition-benchmarks'), api('/api/admin/manual-comps')]);
  view.innerHTML = `
    <div class="section-head"><div><div class="eyebrow">Owner operations</div><h2>ManeFlow control room</h2></div><button id="evaluate-alerts" class="button">Evaluate alerts</button></div>
    <div class="grid metrics"><div class="metric"><small>Users</small><strong>${status.counts.users}</strong><p>${status.counts.sessions} active sessions</p></div><div class="metric"><small>Total comps</small><strong>${health.totalComps}</strong><p>${health.authorizedComps} authorized · ${health.demoComps} demo</p></div><div class="metric"><small>Comp review</small><strong>${health.compsNeedingReview}</strong><p>${health.activeListingsPresent} active-listing exclusions</p></div><div class="metric"><small>Market readiness</small><strong>${health.readyForPublicValueClaims ? 'Ready' : 'Blocked'}</strong><p>${health.blockers.length} launch blockers</p></div></div>
    ${health.blockers.length ? `<div class="notice warning"><strong>Public value claims are blocked:</strong><br>${health.blockers.map(escapeHtml).join('<br>')}</div>` : '<div class="notice success">Production data, comp quality, and configuration checks passed.</div>'}
    ${dataOpsWorkbench(dataSources, manualComps)}
    <div class="section-head"><h2>Recognition Benchmark Lab</h2><span class="subtle">${(recognitionBenchmarks.benchmarks || []).length} runs saved</span></div><section class="panel"><div class="grid three"><div class="metric"><small>Latest top-1</small><strong>${recognitionBenchmarks.benchmarks?.[0]?.metrics?.top1Accuracy ?? 'n/a'}${recognitionBenchmarks.benchmarks?.[0] ? '%' : ''}</strong><p>Best single match</p></div><div class="metric"><small>Latest top-3</small><strong>${recognitionBenchmarks.benchmarks?.[0]?.metrics?.top3Accuracy ?? 'n/a'}${recognitionBenchmarks.benchmarks?.[0] ? '%' : ''}</strong><p>Correct card in choices</p></div><div class="metric"><small>False confident</small><strong>${recognitionBenchmarks.benchmarks?.[0]?.metrics?.falseConfidentRate ?? 'n/a'}${recognitionBenchmarks.benchmarks?.[0] ? '%' : ''}</strong><p>Wrong but too sure</p></div></div><form id="recognition-benchmark-form" class="form-grid"><div class="form-grid two"><div><label>Dataset/source</label><input id="benchmark-source" value="Owner Phone Photos"></div><div><label>Output</label><select id="benchmark-details"><option value="0">Summary only</option><option value="1">Include row details</option></select></div></div><div><label>Benchmark JSON or CSV</label><textarea id="benchmark-input" rows="5" placeholder='{"cases":[{"imageName":"single-ohtani.jpg","player":"Shohei Ohtani","year":2018,"brand":"Topps","set":"Update Series","cardNumber":"US1"}]}'></textarea></div><button class="button primary">Run recognition benchmark</button><small class="subtle">Use lawful owner photos, approved/open datasets, or exported labels. Benchmark data improves scan accuracy only and never creates market values.</small><div id="recognition-benchmark-result"></div></form>${(recognitionBenchmarks.benchmarks || []).slice(0, 5).map((run) => `<div class="source-row"><div><strong>${escapeHtml(run.sourceName)}</strong><small>${run.caseCount} cases · ${formatDate(run.createdAt)} · ${escapeHtml((run.recommendations || []).slice(0, 1).join(' ') || 'No recommendation')}</small></div><div style="text-align:right"><strong>${run.metrics?.top1Accuracy ?? 0}% / ${run.metrics?.top3Accuracy ?? 0}%</strong><small>top-1 / top-3</small></div></div>`).join('') || '<div class="empty">No recognition benchmarks have been run yet.</div>'}</section>
    <div class="section-head"><h2>Data Health Workbench</h2></div><section class="panel"><div class="grid three"><div class="metric"><small>Avg comp quality</small><strong>${health.compQuality.averageQualityScore}</strong><p>Trust ${health.compQuality.averageSourceTrust} · match ${health.compQuality.averageMatchScore}</p></div><div class="metric"><small>Missing data</small><strong>${health.compsMissingSaleDates + health.compsMissingAllInPrice}</strong><p>${health.compsMissingSaleDates} dates · ${health.compsMissingAllInPrice} prices</p></div><div class="metric"><small>Catalog gaps</small><strong>${health.cardsWithNoComps.length}</strong><p>${health.cardsWithOnlyDemoComps.length} demo-only cards</p></div></div>${health.byProvider.map(([provider, count]) => `<div class="source-row"><span>${escapeHtml(provider)}</span><strong>${count}</strong></div>`).join('')}</section>
    <div class="section-head"><h2>Pricing Data Pipeline</h2><a class="button small" href="/api/pricing-data/template.csv">CSV template</a></div><section class="panel"><div class="grid three"><div class="metric"><small>Valuation-eligible comps</small><strong>${pricingAdmin.report.totals.valuationEligible}</strong><p>${pricingAdmin.report.totals.authorizedComps} authorized comps</p></div><div class="metric"><small>Needs review</small><strong>${pricingAdmin.report.totals.needsReview}</strong><p>${pricingAdmin.report.totals.unauthorizedComps} unauthorized</p></div><div class="metric"><small>Public pricing</small><strong>${pricingAdmin.report.readyForPublicValueClaims ? 'Ready' : 'Blocked'}</strong><p>${pricingAdmin.report.blockers.length} blockers</p></div></div>${pricingAdmin.report.providerQuality.length ? pricingAdmin.report.providerQuality.map((provider) => `<div class="source-row"><div><strong>${escapeHtml(provider.provider)}</strong><small>${provider.inclusionRate}% included · avg Q ${provider.averageQualityScore}</small></div><div style="text-align:right"><strong>${provider.included}/${provider.total}</strong><small>${formatMoney(provider.totalValue)}</small></div></div>`).join('') : '<div class="empty">No production pricing imports yet.</div>'}</section>
    <div class="section-head"><h2>eBay Pricing Data</h2></div><section class="panel"><div class="grid three"><div class="metric"><small>Provider mode</small><strong>${escapeHtml(ebayAdmin.provider.mode)}</strong><p>${escapeHtml(ebayAdmin.provider.dataRightsStatus || 'unknown')}</p></div><div class="metric"><small>Completed sales</small><strong>${ebayAdmin.provider.supportsCompletedSales ? 'Enabled' : 'Not enabled'}</strong><p>${ebayAdmin.provider.marketplaceInsightsEnabled ? 'Marketplace Insights configured' : 'Requires approved access'}</p></div><div class="metric"><small>Seller orders</small><strong>${ebayAdmin.provider.sellerOrdersEnabled ? 'Enabled' : 'Not configured'}</strong><p>${ebayAdmin.recentIngests.length} recent eBay ingests</p></div></div><form id="ebay-import-form" class="form-grid"><div><label>eBay completed-sale search</label><input id="ebay-query" placeholder="2018 Topps Update Shohei Ohtani US1 PSA 10"></div><div><label>Category IDs</label><input id="ebay-category" placeholder="optional, comma-separated"></div><div><label>Limit</label><input id="ebay-limit" type="number" min="1" max="200" value="50"></div><button class="button primary">Import completed eBay comps</button><small class="subtle">Uses eBay Marketplace Insights only when approved API access is configured. Active Browse listings are not used as sold comps.</small></form><form id="ebay-orders-form" class="form-grid" style="margin-top:14px"><div><label>Seller orders from</label><input id="ebay-orders-from" type="date"></div><div><label>Seller orders to</label><input id="ebay-orders-to" type="date"></div><div><label>Limit</label><input id="ebay-orders-limit" type="number" min="1" max="200" value="100"></div><button class="button">Import seller orders</button><small class="subtle">Uses a configured server-side EBAY_USER_ACCESS_TOKEN or a token supplied only for this request; tokens are not persisted or displayed.</small></form>${ebayAdmin.recentIngests.length ? ebayAdmin.recentIngests.slice(0, 8).map((ingest) => `<div class="source-row"><div><strong>${escapeHtml(ingest.provider)}</strong><small>${escapeHtml(ingest.authorizationBasis || '')} · ${escapeHtml(ingest.dataRightsStatus || '')} · ${formatDate(ingest.createdAt)}</small></div><div style="text-align:right"><strong>${ingest.salesAdded || 0}+ / ${ingest.salesUpdated || 0} upd</strong><small>${ingest.valuationEligible || 0} valuation-ready</small></div></div>`).join('') : '<div class="empty">No eBay imports yet.</div>'}</section>
    <div class="section-head"><h2>Comp Review Queue</h2></div><section class="panel">${compReview.review.length ? compReview.review.slice(0, 60).map((sale) => `<div class="source-row"><div><strong>${escapeHtml(sale.provider)} · ${formatMoney(sale.allInPrice)}</strong><small>${escapeHtml(compStatusLabel(sale.inclusionStatus))} · ${formatDate(sale.soldAt)} · ${(sale.reasons || []).map(escapeHtml).join(' · ')}</small></div><div class="actions compact"><button class="button small approve-comp" data-id="${escapeHtml(sale.id)}">Approve</button><button class="button small danger reject-comp" data-id="${escapeHtml(sale.id)}">Reject</button></div></div>`).join('') : '<div class="empty">No comps need review.</div>'}</section>
    <div class="section-head"><h2>Provider Trust</h2></div><section class="panel">${health.providerCoverage.map((provider) => `<div class="source-row"><div><strong>${escapeHtml(provider.name)}</strong><small>${escapeHtml(provider.dataRightsStatus || 'unknown')} · ${escapeHtml(provider.authorizationBasis || 'unknown')} · ${escapeHtml(provider.refreshPolicy || 'manual')}</small></div><div style="text-align:right"><strong>${provider.compCount}</strong><small>${provider.supportsCompletedSales ? 'completed sales supported' : 'no completed-sales feed'}</small></div></div>`).join('')}</section>
    <div class="section-head"><h2>Portfolio Intelligence</h2></div><section class="panel">${portfolioAdmin.portfolios.length ? portfolioAdmin.portfolios.slice(0, 50).map((row) => `<div class="source-row"><div><strong>${escapeHtml(row.name)} · ${escapeHtml(row.email)}</strong><small>${escapeHtml(row.plan)} · ${row.itemCount} holdings · ${escapeHtml(row.concentrationRisk)}</small></div><div style="text-align:right"><strong>${formatMoney(row.currentValue)}</strong><small>${row.averageConfidence}% confidence · ${row.lowConfidenceCount} review</small></div></div>`).join('') : '<div class="empty">No portfolio records yet.</div>'}</section>
    <div class="section-head"><h2>Inventory Intelligence</h2></div><section class="panel">${inventoryAdmin.shops.length ? inventoryAdmin.shops.slice(0, 25).map((shop) => `<div class="source-row"><div><strong>${escapeHtml(shop.name)} · ${escapeHtml(shop.email)}</strong><small>${escapeHtml(shop.plan)} · ${shop.inventory.itemCount} items · ${shop.inventory.lowStockAlerts.length} low-stock alerts</small></div><div style="text-align:right"><strong>${formatMoney(shop.inventory.inventoryValue)}</strong><small>${shop.inventory.averageAgeDays}d avg age</small></div></div>`).join('') : '<div class="empty">No merchant inventory accounts yet.</div>'}</section>
    <div class="section-head"><h2>Users</h2></div><section class="panel">${users.users.map((user) => `<div class="source-row"><div><strong>${escapeHtml(user.name)} · ${escapeHtml(user.email)}</strong><small>${escapeHtml(user.role)} · ${escapeHtml(user.plan)} · ${user.holdings} holdings · ${user.sessions} sessions</small></div><div class="actions compact"><select class="admin-plan" data-id="${escapeHtml(user.id)}">${['free','collector','merchant','enterprise'].map((plan) => `<option ${plan === user.plan ? 'selected' : ''}>${plan}</option>`).join('')}</select><button class="button small admin-disable" data-id="${escapeHtml(user.id)}" data-disabled="${user.disabledAt ? '1' : '0'}">${user.disabledAt ? 'Enable' : 'Disable'}</button></div></div>`).join('')}</section>
    <div class="section-head"><h2>Consignment queue</h2></div><section class="panel">${consignments.requests.length ? consignments.requests.map((request) => `<div class="source-row"><div><strong>${escapeHtml(request.customerName || request.email || 'Customer')}</strong><small>${escapeHtml(request.email)} · ${escapeHtml(request.notes || 'No notes')}</small></div><select class="consignment-status" data-user="${escapeHtml(request.userId)}" data-id="${escapeHtml(request.id)}">${['new','reviewing','contacted','accepted','declined','closed'].map((statusValue) => `<option ${statusValue === request.status ? 'selected' : ''}>${statusValue}</option>`).join('')}</select></div>`).join('') : '<div class="empty">No consignment requests.</div>'}</section>
    <div class="section-head"><h2>Account email queue</h2></div><section class="panel">${outbox.messages.length ? outbox.messages.slice(0, 50).map((message) => `<div class="source-row"><div><strong>${escapeHtml(message.subject)}</strong><small>${escapeHtml(message.to)} · ${formatDate(message.createdAt)}</small></div><span class="status ${escapeHtml(message.status)}">${escapeHtml(message.status)}</span></div>`).join('') : '<div class="empty">No account emails queued.</div>'}</section>`;
  document.querySelector('#evaluate-alerts').addEventListener('click', async (event) => { setBusy(event.currentTarget, true, 'Evaluating…'); try { const result = await api('/api/admin/alerts/evaluate', { method: 'POST', body: '{}' }); showToast(`Evaluated ${result.evaluated} accounts`); } finally { setBusy(event.currentTarget, false); } });
  document.querySelector('#ebay-import-form')?.addEventListener('submit', async (event) => { event.preventDefault(); const button = event.currentTarget.querySelector('button'); setBusy(button, true, 'Importing…'); try { const result = await api('/api/admin/ebay/import-completed', { method: 'POST', body: JSON.stringify({ query: document.querySelector('#ebay-query').value, categoryIds: document.querySelector('#ebay-category').value, limit: Number(document.querySelector('#ebay-limit').value || 50) }) }); showToast(`eBay import queued: ${result.ingest.salesAdded || 0} added, ${result.ingest.salesUpdated || 0} updated`); await renderAdmin(); } catch (error) { showToast(error.message); } finally { setBusy(button, false); } });
  document.querySelector('#ebay-orders-form')?.addEventListener('submit', async (event) => { event.preventDefault(); const button = event.currentTarget.querySelector('button'); setBusy(button, true, 'Importing…'); try { const result = await api('/api/admin/ebay/import-seller-orders', { method: 'POST', body: JSON.stringify({ dateFrom: document.querySelector('#ebay-orders-from').value || null, dateTo: document.querySelector('#ebay-orders-to').value || null, limit: Number(document.querySelector('#ebay-orders-limit').value || 100) }) }); showToast(`Seller orders imported: ${result.ingest.salesAdded || 0} added, ${result.ingest.salesUpdated || 0} updated`); await renderAdmin(); } catch (error) { showToast(error.message); } finally { setBusy(button, false); } });
  document.querySelector('#recognition-benchmark-form')?.addEventListener('submit', async (event) => { event.preventDefault(); const button = event.currentTarget.querySelector('button'); setBusy(button, true, 'Benchmarking…'); try { const result = await api('/api/admin/recognition-benchmarks/run', { method: 'POST', body: JSON.stringify({ sourceName: document.querySelector('#benchmark-source').value || 'Owner Phone Photos', json: document.querySelector('#benchmark-input').value, includeDetails: document.querySelector('#benchmark-details').value === '1' }) }); const metrics = result.report.metrics; document.querySelector('#recognition-benchmark-result').innerHTML = `<div class="notice success">Top-1 ${metrics.top1Accuracy}% · Top-3 ${metrics.top3Accuracy}% · false confident ${metrics.falseConfidentRate}%</div>`; showToast('Recognition benchmark complete'); } catch (error) { showToast(error.message); } finally { setBusy(button, false); } });
  wireDataOpsWorkbench(renderAdmin);
  document.querySelectorAll('.approve-comp').forEach((button) => button.addEventListener('click', async () => { await api(`/api/admin/comps/${encodeURIComponent(button.dataset.id)}/approve`, { method: 'POST', body: JSON.stringify({ notes: 'Approved from Owner Control Room' }) }); renderAdmin(); }));
  document.querySelectorAll('.reject-comp').forEach((button) => button.addEventListener('click', async () => { await api(`/api/admin/comps/${encodeURIComponent(button.dataset.id)}/reject`, { method: 'POST', body: JSON.stringify({ notes: 'Rejected from Owner Control Room', inclusionStatus: 'excluded_wrong_card' }) }); renderAdmin(); }));
  document.querySelectorAll('.admin-plan').forEach((select) => select.addEventListener('change', async () => { await api(`/api/admin/users/${encodeURIComponent(select.dataset.id)}`, { method: 'PATCH', body: JSON.stringify({ plan: select.value }) }); showToast('Plan updated'); }));
  document.querySelectorAll('.admin-disable').forEach((button) => button.addEventListener('click', async () => { const disabled = button.dataset.disabled === '1'; await api(`/api/admin/users/${encodeURIComponent(button.dataset.id)}`, { method: 'PATCH', body: JSON.stringify({ disabledAt: disabled ? null : new Date().toISOString() }) }); renderAdmin(); }));
  document.querySelectorAll('.consignment-status').forEach((select) => select.addEventListener('change', async () => { await api(`/api/admin/consignments/${encodeURIComponent(select.dataset.user)}/${encodeURIComponent(select.dataset.id)}`, { method: 'PATCH', body: JSON.stringify({ status: select.value }) }); showToast('Consignment updated'); }));
}

async function render() {
  stopCamera();
  modalRoot.innerHTML = '';
  await Promise.all([ensureConfig(), refreshIdentity()]);
  const route = routeName();
  const primaryNav = document.querySelector('.bottom-nav');
  if (primaryNav) primaryNav.hidden = Boolean(state.config.requireAuthentication && !state.auth.authenticated);
  if (state.config.requireAuthentication && !state.auth.authenticated && !['home', 'account'].includes(route)) {
    location.hash = `#/account?return=${encodeURIComponent(routeParts().join('/') || 'home')}`;
    return;
  }
  setActiveNav(route);
  loading();
  try {
    const parts = routeParts();
    if (route === 'home') await renderHome();
    else if (route === 'search') await renderSearch();
    else if (route === 'scan') await renderScan();
    else if (route === 'cert') await renderCert();
    else if (route === 'lots') await renderLots();
    else if (route === 'survey') await renderSurvey();
    else if (route === 'bulk') await renderBulk();
    else if (route === 'card' && parts[1]) await renderCard(parts[1]);
    else if (route === 'vault') await renderVault();
    else if (route === 'sell') await renderSell();
    else if (route === 'sources') await renderSources();
    else if (route === 'account') await renderAccount();
    else if (route === 'plans') await renderPlans();
    else if (route === 'settings') await renderSettings();
    else if (route === 'admin') await renderAdmin();
    else location.hash = '#/home';
    view.focus({ preventScroll: true });
  } catch (error) {
    const offline = !navigator.onLine || /offline|unavailable|failed to fetch|vision worker/i.test(String(error?.message || ''));
    view.innerHTML = `<section class="panel" style="max-width:900px;margin:28px auto"><div class="eyebrow">${offline ? 'Local recovery mode' : 'Safe error boundary'}</div><h2>${offline ? 'ManeFlow is open, but a local service is not responding' : 'This workspace could not finish loading'}</h2><p class="subtle">${escapeHtml(error?.message || 'Unknown error')}</p><div class="notice ${offline ? 'warning' : 'needs_review'}">Your cards and local data were not deleted. Start-ManeFlow.cmd launches both the Node app and the vision worker. The scanner can continue after those services reconnect.</div><div class="actions"><button class="button primary" id="retry-route">Retry</button><a class="button" href="#/home">Home</a><a class="button" href="#/bulk">Photo intake</a><a class="button ghost" href="#/settings">Diagnostics</a><button class="button ghost" id="reload-button">Reload app shell</button></div></section>`;
    document.querySelector('#retry-route')?.addEventListener('click', render);
    document.querySelector('#reload-button')?.addEventListener('click', () => location.reload());
  }
}

window.addEventListener('hashchange', render);
window.addEventListener('beforeunload', stopCamera);
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  state.installPrompt = event;
  installButton.classList.remove('hidden');
});
installButton.addEventListener('click', async () => {
  if (!state.installPrompt) return;
  state.installPrompt.prompt();
  await state.installPrompt.userChoice;
  state.installPrompt = null;
  installButton.classList.add('hidden');
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/service-worker.js').catch(console.warn);
await Promise.all([ensureConfig(), refreshIdentity(), initializeDesktopBridge()]);
if (!location.hash) location.hash = '#/home';
else render();
