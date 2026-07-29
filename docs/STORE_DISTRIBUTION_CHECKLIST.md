# ManeFlow Store Distribution Checklist

Release: ManeFlow v2.5 State-of-the-Art Recognition Final

This checklist prepares ManeFlow for real store distribution. It does not claim that the app is already published. Apple, Google, Microsoft, Expo, Stripe, DNS, legal, and provider-data steps require Memphis Card Company owner accounts and final approvals.

## Technical Readiness

- [x] Expo app name, slug, icon, splash, iOS bundle id, Android package id, and production API domain are configured.
- [x] EAS build profiles exist for development, preview, and production.
- [x] Production EAS builds use remote app version source and auto-increment build numbers.
- [x] Camera permission copy explains card/cert scanning.
- [x] Selected-photo permission copy explains user-chosen card/cert photos.
- [x] Android config explicitly avoids broad photo/video/storage permissions.
- [x] Desktop Electron identity is set to `ManeFlow` by Memphis Card Company.
- [x] Desktop security defaults are enabled: context isolation, disabled Node renderer integration, sandboxing, and external-link handling.
- [x] Store-readiness validator exists: `npm run store:check`.
- [x] Scene-aware scan response supports single card, multi-card table, binder page, mixed raw/slab, cert-label, and manual fallback workflows.
- [ ] Production backend deployed at `https://mane.memphiscardcompany.com`.
- [ ] `/readyz` passes against production dependencies.
- [ ] Production `ALLOWED_ORIGINS` and widget origins are locked down.
- [ ] Transactional email is configured for verification, password reset, account export, and account deletion.
- [ ] Production monitoring, backups, restore test, and incident runbook are complete.

## Required Developer Accounts

- [ ] Apple Developer Program membership for Memphis Card Company.
- [ ] App Store Connect app record for `com.memphiscardcompany.maneflow`.
- [ ] Google Play Console developer account.
- [ ] Google Play app record for `com.memphiscardcompany.maneflow`.
- [ ] Expo account and EAS project connected to the app.
- [ ] Microsoft Partner Center account for Store distribution.
- [ ] Code-signing certificate for Windows installer/MSIX if distributing outside the Store or submitting Win32 installer packages.
- [ ] Stripe account if web subscriptions are launched.
- [ ] Apple/Google in-app purchase configuration if native subscriptions are sold inside the mobile apps.

## Listing Assets Still Needed

- [ ] Final app icon exports reviewed by a designer.
- [ ] iOS screenshots for required device sizes.
- [ ] Android phone screenshots and optional tablet screenshots.
- [ ] Microsoft Store screenshots.
- [ ] Feature graphic for Google Play.
- [ ] Microsoft Store logo/tile assets.
- [ ] Final short description, full description, subtitle, keywords, category, and support URL.
- [ ] Privacy policy URL hosted on the production website.
- [ ] Terms of service URL hosted on the production website.
- [ ] Support/contact URL or email.
- [ ] Demo/test account credentials for app review, with only synthetic/demo data.

## Legal, Privacy, and Claims

- [ ] Attorney review of privacy policy, terms, subscription language, valuation disclaimers, data-rights language, and consumer-protection language.
- [ ] Apple App Privacy details completed in App Store Connect.
- [ ] Google Play Data Safety form completed in Play Console.
- [ ] Google account deletion/deletion URL requirements completed.
- [ ] Microsoft Store privacy policy and compliance declarations completed.
- [ ] Image source rights reviewed.
- [ ] Real pricing source agreements reviewed.
- [ ] App copy avoids unsupported live-market claims.
- [ ] App copy states: Values are estimates, not appraisals, guarantees, authentication, grading opinions, tax advice, legal advice, or investment advice.
- [ ] Active BIN/asking prices are described as listing context only.
- [ ] Demo data is never described as public market value.

## Data And Billing Launch Gates

- [ ] authorized live completed-sale feeds are configured and observed healthy before any public real-time pricing claim.
- [ ] eBay Marketplace Insights remains disabled unless approved access is actually granted.
- [ ] Seller-order imports are labeled seller-authorized, not market-wide sold data.
- [ ] Authorized CSV imports are dry-run validated before production import.
- [ ] Comp Quality dashboard shows enough included, source-authorized completed sales for launch categories.
- [ ] Stripe is configured only when billing policies, taxes, refunds, and support process are ready.
- [ ] Native in-app purchases are configured only if Apple/Google policy review confirms they are required for the purchased features.

## Apple App Store Steps

1. Create or confirm the Apple Developer Program account.
2. Create the App Store Connect app record for `com.memphiscardcompany.maneflow`.
3. In `apps/mobile-expo`, run `eas login`.
4. Run `eas build:version:set` if an existing store build number must be synced to EAS.
5. Run `eas build --platform ios --profile production`.
6. Test the build through TestFlight.
7. Complete App Privacy, age rating, export compliance, review notes, screenshots, description, support URL, privacy URL, and terms URL.
8. Submit for review only after production backend, demo account, privacy disclosures, and claims language are ready.

## Google Play Steps

1. Create or confirm the Google Play Console developer account.
2. Create the Android app record for `com.memphiscardcompany.maneflow`.
3. In `apps/mobile-expo`, run `eas build --platform android --profile production`.
4. Upload to internal testing or closed testing.
5. Complete Data Safety, app access instructions, content rating, target audience, privacy policy, screenshots, feature graphic, and store listing.
6. Confirm broad photo/video permissions are not present in the generated manifest unless policy-reviewed and justified.
7. Move from testing to production only after review, legal, support, and live-data claims are ready.

## Microsoft Store / Windows Steps

1. Create or confirm the Microsoft Partner Center account.
2. Decide distribution type:
   - Preferred Store path: MSIX package with Microsoft Store identity.
   - Alternative Win32 path: signed MSI/EXE hosted at a versioned HTTPS URL.
3. Export final Windows icon assets: `.ico`, StoreLogo, Square44x44Logo, Square150x150Logo, and other Partner Center requested sizes.
4. Package the Electron app on Windows.
5. Sign the package/installer with an owner-controlled certificate when required.
6. If using MSIX, validate the AppxManifest identity, publisher, version, capabilities, visual assets, and signing.
7. If using MSI/EXE Store submission, host a versioned, signed, standalone installer at an HTTPS URL that will not mutate after submission.
8. Complete Microsoft Store listing, privacy policy, support URL, screenshots, age rating, and certification notes.

## Final Pre-Submission Commands

Run these from the ManeFlow project root on the release machine:

```bash
npm run check
npm test
npm run smoke
npm run mobile:check
npm run desktop:check
npm run store:check
npm run package
npm run verify:release
```

## Official References

- Expo EAS distribution: https://docs.expo.dev/distribution/introduction/
- Expo app version management: https://docs.expo.dev/build-reference/app-versions/
- Expo submit config: https://docs.expo.dev/submit/eas-json/
- Apple app privacy details: https://developer.apple.com/app-store/app-privacy-details/
- Google Play Data Safety: https://support.google.com/googleplay/android-developer/answer/10787469
- Google Play account deletion: https://support.google.com/googleplay/android-developer/answer/13327111
- Google Play photo/video permission policy: https://support.google.com/googleplay/android-developer/answer/15800983
- Microsoft MSIX overview: https://learn.microsoft.com/en-us/windows/msix/overview
- Microsoft Win32 package requirements: https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msi/app-package-requirements
