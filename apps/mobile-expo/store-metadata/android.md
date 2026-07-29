# Google Play Store Metadata Draft

## App Name

ManeFlow

## Short Description

Scan cards, check transparent comps, and manage collections or shop inventory.

## Full Description

ManeFlow is a card intelligence app for collectors, dealers, and card shops. Scan or search cards, inspect source-labeled completed-sale comps, track Vault and inventory value, review price confidence, set watchlists, and prepare selling or consignment decisions.

ManeFlow separates completed-sale value from active asking-price context. It also shows scan confidence, image-source status, cert parsing status, comp quality, and clear review warnings when a card identity or valuation needs confirmation.

Values are estimates based on included completed-sale comps. Active BIN listings are listing context only. ManeFlow is not an appraisal, authentication service, grading opinion, guarantee, tax advisor, legal advisor, or investment advisor. Public live-market claims require authorized completed-sale data feeds to be connected and healthy.

## Feature Graphic Direction

Use a clean card-show/shop-counter visual: phone scanning a card, value confidence, comp quality, and Vault value. Do not imply guaranteed profit, official grading, or universal live data.

## Screenshots Needed

- Home dashboard
- Scan capture and confirmation
- Search/autocomplete results
- Card detail with value and comp quality
- Vault / portfolio dashboard
- Shop inventory or Merchant Pricing Center

## Data Safety Prep

Likely categories to review in Play Console:

- Personal info: name, email address.
- User content: card images, collection/inventory notes, consignment details.
- App activity: scans, valuation views, usage metering if enabled.
- Purchases: only if subscriptions/billing are live.
- Diagnostics: only if production crash/error monitoring is enabled.

ManeFlow should declare data deletion support because accounts can be created and deleted in-app.

## Permission Notes

The app requests `CAMERA`. It blocks broad photo/video/storage permissions in Expo config and uses user-selected photos for uploads. If a generated Android manifest includes broad photo/video permissions in the future, do not submit until the permission is removed or policy-reviewed.
