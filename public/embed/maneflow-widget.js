(() => {
  const script = document.currentScript;
  const baseUrl = (script?.dataset.maneflowBase || 'https://mane.memphiscardcompany.com').replace(/\/$/, '');
  const mode = script?.dataset.mode || 'valuation';
  const mountId = script?.dataset.mount || 'maneflow-widget';
  const cardSlug = script?.dataset.cardSlug || script?.dataset.cardId || '';
  const theme = script?.dataset.theme || 'dark';
  const mount = document.getElementById(mountId) || document.body.appendChild(Object.assign(document.createElement('div'), { id: mountId }));
  const shadow = mount.shadowRoot || (mount.attachShadow ? mount.attachShadow({ mode: 'open' }) : mount);
  const dark = theme !== 'light';

  const styles = `
    :host, .mf-widget { font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .mf-widget { max-width: 460px; border: 1px solid ${dark ? '#3a4555' : '#d7dee9'}; border-radius: 16px; padding: 16px; background: ${dark ? '#0d1118' : '#fff'}; color: ${dark ? '#f8f5ee' : '#111827'}; box-shadow: 0 12px 36px rgba(0,0,0,.18); }
    .mf-eyebrow { color: #d4af37; font-size: 10px; text-transform: uppercase; letter-spacing: .14em; font-weight: 900; }
    .mf-title { margin: 8px 0 4px; font-weight: 900; font-size: 18px; line-height: 1.2; }
    .mf-value { margin: 8px 0; font-size: 36px; line-height: 1; font-weight: 950; letter-spacing: -.04em; }
    .mf-row { display:flex; justify-content:space-between; gap:10px; padding:9px 0; border-top:1px solid ${dark ? '#242d3a' : '#e7edf5'}; font-size:12px; }
    .mf-row strong { text-align:right; }
    .mf-badge { display:inline-flex; border:1px solid #8b6e2d; color:#f4d983; border-radius:999px; padding:4px 7px; font-size:9px; text-transform:uppercase; letter-spacing:.07em; font-weight:900; }
    .mf-note { margin-top:12px; color:${dark ? '#99a4b4' : '#5f6b7a'}; font-size:11px; line-height:1.5; }
    .mf-error { color:#ff7b82; }
    .mf-form input, .mf-form textarea { width:100%; box-sizing:border-box; margin-top:8px; padding:10px; border-radius:10px; border:1px solid ${dark ? '#303947' : '#d7dee9'}; background:${dark ? '#090d13' : '#fff'}; color:inherit; }
    .mf-button { margin-top:10px; min-height:40px; border:0; border-radius:999px; padding:0 14px; background:#d4af37; color:#141008; font-weight:900; cursor:pointer; }
  `;
  const shell = (body) => { shadow.innerHTML = `<style>${styles}</style>${body}`; };
  const money = (value) => Number.isFinite(Number(value)) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value)) : 'Review needed';
  const safe = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));

  async function renderValuation() {
    shell('<div class="mf-widget"><div class="mf-eyebrow">ManeFlow value</div><p class="mf-note">Loading pricing intelligence...</p></div>');
    if (!cardSlug) {
      shadow.querySelector('.mf-note').textContent = 'Add data-card-slug to show a public valuation.';
      return;
    }
    const response = await fetch(`${baseUrl}/api/public/cards/${encodeURIComponent(cardSlug)}/value`, { credentials: 'omit' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Unable to load value');
    const quality = data.compQuality || {};
    shell(`<div class="mf-widget">
      <div class="mf-eyebrow">ManeFlow value</div>
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:start"><h3 class="mf-title">${safe([data.card.year, data.card.brand, data.card.player, data.card.cardNumber ? '#' + data.card.cardNumber : ''].filter(Boolean).join(' '))}</h3><span class="mf-badge">${safe(data.marketMode || 'demo')}</span></div>
      <div class="mf-value">${money(data.value)}</div>
      <div class="mf-row"><span>Expected range</span><strong>${money(data.range?.low)} to ${money(data.range?.high)}</strong></div>
      <div class="mf-row"><span>Confidence</span><strong>${safe(data.confidence || 0)}%</strong></div>
      <div class="mf-row"><span>Liquidity</span><strong>${safe(data.liquidityScore || 0)}%</strong></div>
      <div class="mf-row"><span>Included comps</span><strong>${safe(quality.includedCount || 0)}</strong></div>
      <p class="mf-note">Values are estimates based only on included source-labeled comps. Active listings and demo-only production data are not completed-sale comps.</p>
    </div>`);
  }

  async function renderIntake() {
    shell(`<form class="mf-widget mf-form"><div class="mf-eyebrow">ManeFlow intake</div><h3 class="mf-title">${mode === 'consignment' ? 'Consign with Memphis Card Company' : 'Check a card with ManeFlow'}</h3><input name="customerName" placeholder="Name"><input name="email" placeholder="Email"><textarea name="notes" placeholder="Card details"></textarea><button class="mf-button">Send to ManeFlow</button><p class="mf-note" data-status>Public widget sends only intake details. No private Vault data is exposed.</p></form>`);
    shadow.querySelector('form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const endpoint = mode === 'consignment' ? '/api/embed/consignment-intake' : '/api/embed/scan-intake';
      const response = await fetch(`${baseUrl}${endpoint}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(Object.fromEntries(form.entries())), credentials: 'omit' });
      shadow.querySelector('[data-status]').textContent = response.ok ? 'Sent. Memphis Card Company can review it in ManeFlow.' : 'Unable to send from this site origin.';
    });
  }

  (mode === 'valuation' ? renderValuation() : renderIntake()).catch((error) => {
    shell(`<div class="mf-widget"><div class="mf-eyebrow">ManeFlow</div><p class="mf-note mf-error">${safe(error.message)}</p></div>`);
  });
})();
