async function revealOwnerConsole() {
  try {
    const response = await fetch('/api/auth/owner/security-status', {
      credentials: 'include',
      cache: 'no-store',
    });
    if (!response.ok) return;
    const status = await response.json();
    if (status.allowlisted !== true) return;
    const actions = document.querySelector('.top-actions');
    if (!actions || actions.querySelector('[data-owner-meta-console]')) return;
    const link = document.createElement('a');
    link.href = '/owner-meta.html';
    link.className = 'icon-button';
    link.dataset.ownerMetaConsole = 'true';
    link.setAttribute('aria-label', 'Open private ManeBrain Meta console');
    link.title = 'ManeBrain Meta';
    link.textContent = 'MB';
    actions.prepend(link);
  } catch {
    // The owner entry point is optional UI. Authorization remains server-enforced.
  }
}

revealOwnerConsole();
