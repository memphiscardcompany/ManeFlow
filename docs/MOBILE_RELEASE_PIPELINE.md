# Mobile Release Pipeline

ManeFlow's mobile app lives in `apps/mobile-expo` and is prepared for iOS and Android production builds through Expo EAS.

## Current Mobile Configuration

- App name: `ManeFlow`
- iOS bundle identifier: `com.memphiscardcompany.maneflow`
- Android package: `com.memphiscardcompany.maneflow`
- App version: `2.5.0`
- EAS version source: remote
- Production API URL: `https://mane.memphiscardcompany.com`
- Staging API URL: `https://staging-mane.memphiscardcompany.com`
- Local API URL: `http://127.0.0.1:4321`
- Camera permission: card/cert scanning only
- Photo permission: user-selected card/cert images only
- Broad Android photo/video/storage permissions: blocked

## Build Profiles

`apps/mobile-expo/eas.json` defines:

- `development`: internal dev client pointing at local API.
- `preview`: internal distribution pointing at staging API.
- `production`: store build pointing at production HTTPS API with auto-increment enabled.

## Commands

Run from `apps/mobile-expo` after installing dependencies and logging into the owner Expo account:

```bash
eas login
eas build:configure
eas build:version:set
eas build --platform ios --profile production
eas build --platform android --profile production
eas submit --platform ios --profile production
eas submit --platform android --profile production
```

Use `eas build:version:set` only when syncing the first production build number or after an existing store build has already been published.

## App Store Connect Setup

- Create the app record under the Memphis Card Company Apple Developer account.
- Bundle ID: `com.memphiscardcompany.maneflow`.
- Category: Sports, Utilities, or Business depending on launch positioning.
- Add privacy policy URL.
- Add support URL.
- Complete App Privacy details.
- Complete export compliance.
- Add screenshots.
- Add reviewer notes and demo account.

## Google Play Console Setup

- Create the app record under the Memphis Card Company Play Console account.
- Package name: `com.memphiscardcompany.maneflow`.
- Upload Android App Bundle from EAS.
- Start with internal testing, then closed testing.
- Complete Data Safety.
- Complete app access instructions.
- Complete account deletion declaration.
- Add privacy policy URL.
- Confirm broad photo/video/storage permissions are absent.
- Add screenshots and feature graphic.

## Store Review Notes Draft

ManeFlow is a card-scanning and collection intelligence app. Reviewers can use the provided demo account to scan sample cards, search the catalog, add cards to the Vault, review comp quality, and inspect portfolio/shop decision screens. Bundled data is demonstration data unless approved production data feeds are connected. Values are estimates and not appraisals, guarantees, authentication, grading opinions, tax advice, legal advice, or investment advice.

## What Not To Claim

- Do not claim universal real-time pricing unless authorized live completed-sale feeds are connected and monitored.
- Do not claim official cert verification unless an official grader verification source is connected.
- Do not claim active listings are market value.
- Do not claim card images are universally available or owned.
- Do not claim in-app subscriptions are live until Stripe/Apple/Google billing is configured.
