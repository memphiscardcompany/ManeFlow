# CSP Style Hardening Plan

ManeFlow production CSP no longer permits the local vision-worker origin, and HTTPS responses emit HSTS. The remaining CSP exception is `style-src 'unsafe-inline'`.

## Current boundary

- `script-src` remains `'self'`; inline script execution is not allowed.
- `frame-ancestors 'none'`, `base-uri 'self'`, and `form-action 'self'` remain enforced.
- The local `127.0.0.1:8741` vision origin is development-only and is excluded from production CSP.
- `style-src 'unsafe-inline'` is retained only for existing inline/style-attribute compatibility.

## Removal sequence

1. Inventory every inline `style=` attribute and generated `<style>` block in the PWA/server-rendered UI.
2. Move static declarations into versioned first-party stylesheets.
3. Convert runtime style values to bounded CSS classes or CSS custom properties set through a reviewed helper.
4. Where an inline style block is unavoidable, use a request-scoped nonce or an explicit build-time hash; do not broaden to `unsafe-inline`.
5. Add browser smoke coverage for scanner, portfolio, inventory, owner console, and authentication surfaces.
6. Change production `style-src` to `'self'` plus only required nonce/hash sources.
7. Change the security-header regression test to fail if production CSP contains `'unsafe-inline'`.

## Release gate

Do not remove `'unsafe-inline'` until the UI smoke suite passes with the stricter policy. Do not describe the style CSP as fully hardened before that gate is met.
