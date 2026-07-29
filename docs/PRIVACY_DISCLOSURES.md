# Privacy Disclosures Draft

This file is a practical disclosure draft for App Store Connect, Google Play Console, Microsoft Store, and the public privacy policy. Final answers must be reviewed against the production build, third-party SDKs, hosting setup, billing setup, and legal counsel.

## Data ManeFlow May Collect

- Account data: name, email address, password hash, verification state, session records.
- Collection data: saved cards, quantities, cost basis, notes, locations, cert numbers, watchlist targets, listing drafts, consignment/intake requests.
- Shop data: organization membership, roles, inventory, pricing rules, invite records, audit logs.
- Uploaded media: card, slab, cert, barcode, and QR photos only when the user chooses to scan or upload them.
- Usage data: scans, valuation views, exports, widget usage, provider imports, and plan entitlement usage.
- Payment/subscription metadata when billing is enabled.

## Data ManeFlow Should Not Collect By Default

- Precise location.
- Contacts.
- Calendar.
- Health data.
- SMS/MMS.
- Microphone/audio.
- Broad device photo library contents.
- Full local image catalog.
- Provider credentials in app clients.

## Camera And Photos

ManeFlow uses the camera only when the user chooses to scan a trading card, slab label, barcode, QR code, or cert label. ManeFlow uses selected photos only when the user chooses card/cert images for identification, collection logging, inventory logging, intake, or consignment review.

Android broad media/storage permissions are intentionally blocked in the Expo config. If a future build introduces broad photo/video permissions, Google Play's photo/video policy must be reviewed before submission.

## Image Retention

Images should be processed only for the requested scan/intake workflow unless image retention is explicitly enabled by the owner/user for support, audit, intake, or consignment review. Image retention settings must be reflected in the privacy policy and store declarations.

## Third-Party Processing

Possible third-party processors depending on production configuration:

- OpenAI or another AI vision provider for card/cert image understanding.
- Hosting/database/storage providers.
- Transactional email provider.
- Stripe for web billing, if enabled.
- Apple/Google billing systems, if native subscriptions are enabled.
- Authorized marketplace/provider APIs.

Do not list a processor as active in store disclosures unless it is actually configured in the production build.

## App Store Connect Privacy Notes

Apple requires app privacy details for data collected by the app and third-party partners. For ManeFlow, likely categories to review include:

- Contact info: email address and name.
- User content: card images, collection notes, inventory records, consignment details.
- Identifiers: account/user IDs and session identifiers.
- Purchases: subscription or billing records if enabled.
- Usage data: app interaction and feature usage if tracked.
- Diagnostics: crashes/logs if production monitoring is enabled.

## Google Play Data Safety Notes

Google Play requires developers to declare collection, sharing, security practices, and deletion options. ManeFlow should be declared based on the final production build and configured SDKs. Because ManeFlow allows account creation, account deletion must be available in-app and documented in Play Console.

## Microsoft Store Notes

Microsoft Store submission needs a privacy policy URL and accurate declarations for account data, user content, camera/photo usage, billing, diagnostics, and third-party services.

## Required Public Policy Statements

The public privacy policy should clearly state:

- Values are estimates and not appraisals.
- Card scans are submitted only when the user starts a scan or upload.
- Uploaded images are not retained unless the relevant retention setting/workflow requires it.
- Personal Vault data is private.
- Shop inventory is visible only to authorized organization members.
- Public widgets expose only public-safe fields.
- Users can export and delete account data.
- Provider credentials are stored server-side only and are never shipped in mobile or desktop clients.
