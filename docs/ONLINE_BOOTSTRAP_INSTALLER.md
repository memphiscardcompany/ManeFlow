# ManeFlow Online Beta Bootstrap Installer

## Purpose

The online bootstrap is the immediate install path for private Windows beta testing while the final Electron NSIS and portable artifacts are produced on a Windows build runner. It packages the verified unified ManeFlow source inside a small Windows launcher.

## First-run behavior

On first launch, the bootstrap:

1. Extracts the embedded ManeFlow source archive to a temporary folder.
2. Copies the application to `%LOCALAPPDATA%\ManeFlowBeta\app`.
3. Downloads pinned Windows x64 Node.js and Python runtimes.
4. Installs the runtime-only Python dependencies for the FastAPI vision worker.
5. Creates local launch and stop scripts.
6. Creates a desktop shortcut.
7. Starts the Node core on `127.0.0.1:4321`.
8. Starts the vision worker on `127.0.0.1:8741`.
9. Opens the ManeFlow Bulk intake interface in the default browser.

Later launches reuse the installed files and start the local services directly.

## Requirements

- Windows 10 or Windows 11, x64
- Internet access during the first installation
- Permission to write under the current user's `%LOCALAPPDATA%` directory
- A trusted private-beta computer

No separate Node.js or Python installation is required. The bootstrap installs private application-local runtimes.

## Files and data

Installation root:

```text
%LOCALAPPDATA%\ManeFlowBeta
```

Important paths:

```text
app\                         unified ManeFlow source
runtime\node\               local Node runtime
runtime\python\             local Python runtime
data\                         core state, vision SQLite database, consent data
logs\                         core and vision-worker logs
provider.env.cmd              optional provider credentials
Start-ManeFlow.ps1            starts local services
Stop-ManeFlow.ps1             stops local services
Configure-ManeFlow-Providers.cmd
```

## Credential warning

The online bootstrap fallback stores optional provider credentials in the local `provider.env.cmd` file. That file is not distributed in the source archive and begins with empty values, but it is plain local configuration. Use only rotated beta credentials on trusted computers.

The final Electron desktop application uses Electron `safeStorage` for Windows-protected credential storage and is the preferred long-term distribution.

## Ricoh tester workflow

The tester can scan duplex card images to a Windows folder, launch ManeFlow, open **Bulk**, paste or choose the absolute scan folder, import the batch, review pairings, correct identities, and export a consent-scoped learning pack. Financial data, seller details, inventory location, and private notes are excluded from the recognition dataset.

## Beta limitations

- The bootstrap executable is unsigned. Windows may display a SmartScreen warning.
- The first installation depends on the pinned runtime download endpoints being available.
- The interface opens in the default browser rather than an Electron window.
- Provider keys are stored in a local plain-text command file in this fallback path.
- The installer still requires a clean Windows-machine acceptance test before broad beta distribution.

## Troubleshooting

Logs are located in:

```text
%LOCALAPPDATA%\ManeFlowBeta\logs
```

Use `Stop-ManeFlow.ps1`, then run `ManeFlow.exe` again. If startup still fails, send the log folder to the ManeFlow owner without including provider credentials.

## Diagnostics package

Run `%LOCALAPPDATA%\ManeFlowBeta\Collect-ManeFlow-Diagnostics.cmd` after a failed install, scan, or batch. It creates a ZIP on the Desktop containing application logs, version metadata, and local health/readiness responses. It deliberately excludes provider credentials, databases, card images, costs, values, and private notes. Review the ZIP before sending it.
