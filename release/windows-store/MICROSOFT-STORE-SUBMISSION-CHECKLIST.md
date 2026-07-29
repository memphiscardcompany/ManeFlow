# Microsoft Store Submission Checklist

## Product identity

- [ ] Windows Developer Program enrollment completed.
- [ ] Product reserved as **ManeFlow** under **MSIX or PWA app**.
- [ ] Product ID copied from Partner Center.
- [ ] Package ID copied from Product identity.
- [ ] Publisher ID copied exactly.
- [ ] Publisher display name matches Partner Center exactly.

## Package

- [ ] `Build-Store-Package.cmd` produced an MSIX/MSIX bundle.
- [ ] Package version is `2.20.0.0` or higher than any earlier submitted version.
- [ ] Package identity matches the reserved Store product.
- [ ] Package opens `https://142df297558ace9e22.v2.appdeploy.ai/`.
- [ ] Card spread upload, many-file upload, single-card back image, and PSA cert verification were tested.
- [ ] No API tokens, passwords, `.env` files, or customer inventory are inside the package.

## Listing

- [ ] Category: Business or Productivity.
- [ ] At least four desktop screenshots uploaded.
- [ ] 300×300 Store logo uploaded.
- [ ] Short description, full description, and product features added.
- [ ] Support contact and privacy-policy URL are public.
- [ ] Age-rating questionnaire completed accurately.
- [ ] Pricing and availability set.

## Certification notes

- [ ] Explain that ManeFlow is a hosted PWA and requires internet for AI recognition and provider data.
- [ ] Give reviewers a test account only if a protected workflow requires one.
- [ ] Do not place private PSA/eBay credentials in certification notes.
- [ ] State that prices are research estimates and exact card identities require evidence/review.

## Release

- [ ] Run the Windows App Certification Kit if Partner Center or PWABuilder provides a local test package.
- [ ] Review the draft created by `Create-Store-Draft.ps1`.
- [ ] Submit manually for certification.
- [ ] After approval, test Store install, launch, update, uninstall, and reinstall.
