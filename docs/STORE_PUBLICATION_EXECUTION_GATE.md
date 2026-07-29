# Store Publication Execution Gate

ManeFlow source and build configurations can be prepared in the repository, but publication requires external developer identities, signed artifacts, production HTTPS infrastructure, legal disclosures, and platform review.

## Shared production prerequisites

- Production API and database deployed under the final HTTPS domain
- Health, authentication, upload, deletion, export, and account-recovery workflows validated
- Privacy policy, terms, and support pages published
- Provider keys stored server-side
- Data retention and account deletion behavior tested
- Production monitoring, backups, incident contacts, and rollback plan active

Copy `config/external-release-gates.example.json` to `config/external-release-gates.json`, update it only with verified status, and run:

```bash
npm run store:external-gates
```

The real status file is intentionally ignored by source control because it can contain account metadata.

## Microsoft Store

1. Activate Microsoft Partner Center.
2. Reserve the ManeFlow product identity.
3. Set `MICROSOFT_STORE_PUBLISHER` to the exact Partner Center publisher subject.
4. Complete the Windows code-signing gate.
5. Run the signed Windows workflow with `build_store_package=true`.
6. Test install, upgrade, uninstall, protocol handling, and local-data preservation.
7. Upload the AppX/MSIX package and complete privacy, age-rating, and listing fields.

## Apple App Store

1. Activate the Apple Developer Program and App Store Connect access.
2. Register `com.memphiscardcompany.maneflow`.
3. Configure EAS-managed or approved Apple distribution credentials.
4. Create the App Store Connect application record.
5. Complete App Privacy answers from the actual production data flows.
6. Configure the `mobile-store-production` GitHub environment with required reviewers, prevented self-review, and protected release refs.
7. Run `Build ManeFlow iOS and Android Store Release` with submission enabled. Inspect the retained evidence, EAS logs, signing state, commit, and versions while the submit job waits for environment approval.
8. Approve the environment only to upload those commit-bound builds. Use submission disabled for build-only rehearsals.
9. Test the uploaded iOS binary through TestFlight before requesting App Store review or public release.

## Google Play

1. Activate the Play Console account.
2. Create the ManeFlow application record for `com.memphiscardcompany.maneflow`.
3. Enable Play App Signing.
4. Configure EAS/Google Play service-account submission access.
5. Complete the Data safety form from actual production behavior.
6. Upload to internal testing, then complete the required closed-testing process for the account.
7. Promote only after crash, ANR, camera, upload, authentication, and account-deletion tests pass.

## Release rule

A build is not described as "available in stores" until the platform reports it approved and publicly available. A successful EAS or electron-builder command produces an artifact; it does not constitute store approval.
