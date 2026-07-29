# ManeFlow 2.9.0 Release Candidate 1

## Primary upgrade

This release consolidates the existing ManeFlow business platform and the newer recognition worker into one product line. It restores the full Vault, pricing, grading, selling, source-management, and administrative experience while adding dedicated lot-analysis workflows on desktop and mobile.

## New capabilities

- Dedicated **Lot Analysis** workspace in the desktop app.
- Dedicated **Lot** tab in the Expo mobile app.
- Analyze downloaded eBay listing images or an authorized eBay listing URL.
- Detect and reconcile cards appearing across multiple listing photographs.
- Compare acquisition cost with expected resale value, fees, shipping, ROI, and a target purchase ceiling.
- Preserve separate confidence for detection, identity, variant, duplicate grouping, and pricing.
- Route lot corrections back into the permissioned recognition-learning workflow.
- Microsoft Store AppX build target added alongside NSIS and portable Windows targets.
- Android build properties updated to compile and target SDK 36.
- Store-readiness checks updated for the 2.9 release line.

## Safety and trust

- No PSA, eBay, OpenAI, Supabase, or other provider credentials are embedded.
- No value is produced when verified pricing evidence is missing.
- Active listings remain separate from completed-sale evidence.
- Unresolved cards remain unresolved instead of receiving filename-based guesses.
- User-contributed learning records remain opt-in and exclude private costs, seller data, and inventory notes.

## Release boundary

This source release is application-store ready at the code and metadata level, but signed binaries and actual submissions require the owner's Microsoft Partner Center, Apple Developer, Google Play Console, and build-signing credentials.
