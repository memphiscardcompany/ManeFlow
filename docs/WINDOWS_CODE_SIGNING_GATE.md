# Windows Code-Signing Gate

Unsigned beta executables can trigger Microsoft Defender SmartScreen because Windows cannot verify the publisher and the file has no established reputation. Production Windows releases must therefore pass this gate.

## Required identity

- A code-signing certificate issued to **Memphis Card Company LLC**, or an approved Azure Trusted Signing identity
- A stable publisher name across every release
- A timestamped Authenticode signature
- Microsoft Partner Center publisher identity for Store packages

## GitHub secrets for certificate-file signing

The signed workflow uses electron-builder's standard signing variables:

- `WINDOWS_CSC_LINK`: encrypted GitHub secret containing a base64-encoded PFX or a protected certificate URL
- `WINDOWS_CSC_KEY_PASSWORD`: certificate password
- `MICROSOFT_STORE_PUBLISHER`: exact Partner Center publisher subject for AppX/MSIX builds

Never commit the certificate or password to the repository.

## Build

Run the GitHub Actions workflow:

`Build Signed ManeFlow Windows Release`

The workflow:

1. Runs the complete test gate.
2. Builds the embedded runtime.
3. Enables electron-builder `forceCodeSigning`.
4. Builds the installer and portable executable.
5. Verifies every Authenticode signature with `Get-AuthenticodeSignature`.
6. Rejects a mismatched publisher.
7. Produces SHA-256 checksums.

A signed artifact is not accepted merely because electron-builder exits successfully. `scripts/verify-windows-signature.ps1` must report `Valid` and a matching publisher.

## Azure Trusted Signing option

Azure Trusted Signing can replace a local PFX once the identity and certificate profile are approved. Configure electron-builder's Azure signing fields only through protected CI environment variables. Maintain the same post-build Authenticode verification.

## SmartScreen boundary

Code signing establishes identity; it does not guarantee immediate SmartScreen reputation for every new certificate or application. Microsoft Store distribution and consistent, timestamped releases provide the strongest user experience. Do not bypass or disable SmartScreen in ManeFlow instructions.
