# Desktop Release Pipeline

ManeFlow's desktop app lives in `apps/desktop-electron`. It is a secure Electron shell for the ManeFlow web app with cloud and local modes.

## Current Desktop Identity

- Product name: `ManeFlow`
- Publisher/author: `Memphis Card Company`
- Package id: `com.memphiscardcompany.maneflow.desktop`
- App version: `2.5.0`
- Default cloud URL: `https://mane.memphiscardcompany.com`
- Local URL: `http://127.0.0.1:4321`
- Security: context isolation, disabled Node renderer integration, sandboxing, web security, and external-link handling.

## Desktop Assets

Included:

- `apps/desktop-electron/assets/icon.png`

Still needed before Microsoft Store submission:

- `assets/icon.ico` for Windows installer builds.
- `assets/icon.icns` for macOS builds.
- Microsoft Store tile/logo exports, including Square44x44Logo and Square150x150Logo.
- Final screenshots from Windows 11.

## Packaging Commands

From `apps/desktop-electron`, after installing dependencies on a packaging machine:

```bash
npm install
npm run check
npm run package:windows
npm run package:macos
npm run package:linux
```

Package on the target operating system whenever possible. Windows packages should be built and signed on Windows. macOS packages should be built, signed, and notarized on macOS.

## Microsoft Store Paths

### Preferred: MSIX

MSIX is the modern Windows packaging format and gives the app package identity, clean install/uninstall, and Store update support. This path requires:

- MSIX package creation on Windows.
- Final AppxManifest identity matching Partner Center.
- Publisher identity from Microsoft Partner Center.
- Store tile/logo assets.
- Package signing.
- Validation through Microsoft's MSIX tooling.

### Alternative: Win32 MSI/EXE

Microsoft Store also supports certain MSI/EXE submissions. This path requires:

- A digitally signed standalone installer.
- Silent install behavior.
- A versioned HTTPS download URL.
- A URL that does not mutate after submission.
- Updated URL for every future binary.

## Update Considerations

- Store/MSIX updates should be handled through Microsoft Store package updates.
- Win32 installer updates require a new signed installer at a new versioned HTTPS URL.
- Do not embed ManeFlow provider credentials or user data in the desktop package.
- Keep cloud/local mode configurable through environment variables or future settings UI.

## Final Desktop Submission Steps

1. Export final `.ico`, `.icns`, and Microsoft Store tile images from the ManeFlow brand artwork.
2. Build the Windows package on Windows.
3. Sign the installer/package.
4. Validate package identity, publisher, version, and capabilities.
5. Create Microsoft Partner Center app listing.
6. Upload package or versioned installer URL.
7. Add screenshots, description, privacy policy URL, support URL, age rating, and certification notes.
8. Submit after production backend and legal/privacy docs are live.
