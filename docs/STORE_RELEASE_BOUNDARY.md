# ManeFlow Store Release Boundary

ManeFlow has one canonical source tree for Windows, iOS, Android, web/PWA, the Node business core, and the Python vision worker.

## Buildable outputs

- Windows NSIS installer and portable executable
- Microsoft Store AppX/MSIX-family package
- Android App Bundle through Expo EAS
- iOS archive through Expo EAS
- Web/PWA deployment

## Owner-controlled requirements

The following cannot be fabricated, embedded, or substituted by the codebase:

- Microsoft Partner Center publisher identity and signing/submission authorization
- Apple Developer Program membership, App Store Connect access, certificates, and provisioning
- Google Play Console account, application signing, and release-track access
- Production API domain and hosting credentials
- Authorized PSA, eBay, pricing-provider, storage, database, and AI credentials
- Final legal, privacy, tax, subscription, age-rating, and store declarations

## Distribution rule

Do not distribute another unsigned online bootstrap executable as the primary beta artifact. Windows beta builds should be produced on a Windows build runner from the canonical source, then Authenticode-signed or distributed through Microsoft Store testing. Mobile builds should be produced through the owner's EAS/App Store/Play accounts.
