# ManeFlow Live Provider Release Gate

This release overlay makes the locally stored PSA partner credential part of the **runtime validation path**, without embedding the secret in source or distributable packages.

## Installed behavior

- Reads `PSA_API_TOKEN` from the private project-root `.env` at runtime.
- Validates three PSA slabs represented by included owner-supplied images.
- Confirms cert identity, year, subject, card description/card number, and grade.
- Runs ManeFlow's existing full beta verification.
- Runs the existing recognition-folder benchmark against the included PSA images.
- Writes provider reports under `.runtime/provider-validation/`.
- Adds `npm run verify:ship` as the final local release gate.

## Security boundary

The credential itself is never copied into `.env.example`, source ZIPs, installers, logs, screenshots, or release manifests. A ready-to-ship product includes the PSA integration and secure credential storage—not Memphis Card Company's private token.

## Run

Double-click `Test-ManeFlow-Ready-To-Ship.cmd` or run:

```bash
npm run verify:ship
```
