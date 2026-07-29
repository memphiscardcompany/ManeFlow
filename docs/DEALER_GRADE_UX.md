# Dealer-Grade UX

ManeFlow v1.9 makes the core pricing flow more useful at a card show, shop counter, or collection intake table.

## Scan Result

The scan result now surfaces:

- scan confidence score
- image/identity quality context
- field-level confidence
- graded cert evidence when a slab, barcode, QR payload, or cert number is detected
- warnings such as missing back image, unclear parallel, unclear cert, or multiple similar matches
- recommended next step before the user adds the card to a Vault, shop inventory, listing draft, or intake batch

Low-confidence scans stay visible but are presented as review work, not final pricing truth.

## Value Result

Card detail now combines valuation and action:

- estimated value and expected range
- confidence, liquidity, trend, volume, and comp-quality summary
- included/excluded comp reasoning through the existing Comp Quality Engine
- Merchant Pricing Center guidance for eligible plans
- shop-ready action buttons for intake, inventory, and review workflows

Dealer guidance is conservative when confidence is low. Suggested prices are decision aids, not appraisals or guarantees.

## Native App Source

The Expo app includes:

- `ScanTrustCard`
- `ValueTrustCard`
- dealer-decision route integration
- graded cert and scan-confidence display
- v1.9 release metadata
- production/staging/local API endpoint configuration

The native app still requires owner-controlled Apple, Google, Expo, signing, and production API setup before public distribution.
