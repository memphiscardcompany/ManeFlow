# ManeFlow Unified Desktop App

## Identity

- Product: ManeFlow
- Publisher: Memphis Card Company
- App ID: `com.memphiscardcompany.maneflow.desktop`
- Version: `2.8.1-beta.2`
- Target: Windows 11 x64 private beta

## Process architecture

```text
ManeFlow.exe (Electron)
├── Node ManeFlow core     127.0.0.1:4321
└── FastAPI vision worker  127.0.0.1:8741
```

The renderer receives no raw API credentials. Electron stores credentials with Windows-backed `safeStorage` and passes them only to local service processes through environment variables.

## Security defaults

- context isolation enabled
- Node integration disabled
- renderer sandbox enabled
- web security enabled
- external navigation denied and opened in system browser
- local services bound to loopback
- one application instance
- application data and logs kept under the Electron user-data directory
- uninstall does not delete user data by default

## Build

Requirements:

- Windows 11 x64
- Node.js 22
- Python 3.12
- PowerShell

Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-windows-beta.ps1
```

The script performs full beta verification, builds the Python worker, builds the installer and portable target, and writes SHA-256 checksums.

## Unsigned beta

Until Memphis Card Company obtains a Windows code-signing certificate, SmartScreen can warn that the private beta publisher is unknown. Testers should only install the checksum-verified artifact directly supplied by the owner.
