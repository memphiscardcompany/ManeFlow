# ManeFlow 2.8.1-beta.2

This release converts the prior browser-style bootstrap into a real Electron desktop launch after installation and hardens the beta startup path.

## Desktop improvements

- Branded startup screen with service progress.
- Automatic fallback ports when 4321 or 8741 are already occupied.
- Core and vision process recovery with bounded restart attempts.
- Windows process-tree shutdown to prevent orphaned services.
- Encrypted provider-key storage through Electron `safeStorage`.
- In-app provider settings for PSA, OpenAI vision, and eBay.
- In-app service status, restart controls, data/log folder access, and diagnostics ZIP creation.
- Public signups and development-token exposure disabled in the desktop beta.
- Add/Remove Programs registration and an uninstall path that preserves user data by default.
- Installer upgrades an existing ManeFlow installation instead of accidentally launching the prior version.
- Desktop shortcut now starts the Electron application, not a browser tab.

## Existing systems retained

- Single-card and multi-card recognition.
- eBay lot-image economics.
- Ricoh duplex folder intake and front/back pairing.
- Vault, grading, pricing, catalog, comp-quality, and dealer-decision systems.
- Opt-in correction and recognition-learning workflow.
- Conservative unresolved-card and unverifiable-price behavior.

## Verification

- 157 Node tests.
- 40 Python vision tests.
- Integrated core + vision + Ricoh + consent + curation smoke test.
- JavaScript syntax and release-manifest validation.
- Credential-pattern scan.
- Desktop and mobile configuration checks.

## Distribution note

This private beta is not Authenticode-signed. Browser download reputation and Windows SmartScreen may still show an unfamiliar-app warning until a trusted code-signing certificate and sufficient reputation are established.
