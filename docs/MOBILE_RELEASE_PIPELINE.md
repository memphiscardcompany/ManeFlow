# Mobile Release Pipeline

ManeFlow's mobile app lives in `apps/mobile-expo` and is prepared for iOS and Android production builds through Expo EAS.

## Current Mobile Configuration

- App name: `ManeFlow`
- iOS bundle identifier: `com.memphiscardcompany.maneflow`
- Android package: `com.memphiscardcompany.maneflow`
- App version: the root release's public `major.minor.patch`, enforced by `npm run mobile:check`
- EAS version source: remote
- EAS source policy: committed Git state required
- EAS CLI: `16.32.0`, pinned in workflow and project policy
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

## GitHub release promotion

The `Build ManeFlow iOS and Android Store Release` workflow has two independent phases:

1. `verify_and_build_mobile` verifies the repository, waits for both signed production builds, validates that EAS reports exactly one finished Store build per platform with the expected commit, app version, profile, and channel, and retains `mobile-release-evidence.json`.
2. `submit-mobile` runs only when `submit_after_build` is selected. It references the exact validated build IDs, is serialized with the `maneflow-mobile-store-production` concurrency group, and waits on the `mobile-store-production` GitHub environment before it can access the submission step.

Configure `mobile-store-production` in GitHub with required reviewers, prevent self-review, and restrict deployment branches or tags to the protected release policy. Environment protection is repository configuration; naming the environment in the workflow does not create those protection rules. Approval authorizes upload of the exact binaries to App Store Connect and Google Play; it does not authorize public rollout.

Never replace the ID-bound submit commands with `--latest`. “Latest” is mutable when another actor or workflow creates a build.

After upload, validate the iOS build through TestFlight and the Android build through the Play internal/closed-testing track before store review or production promotion. If one platform upload fails after the other succeeds, retain the evidence artifact and retry only the failed platform with its recorded ID; do not start a new `--latest` submission.

## Manual commands

Run from `apps/mobile-expo` after installing dependencies and logging into the owner Expo account:

```bash
eas login
eas build:configure
eas build:version:set
eas build --platform all --profile production --non-interactive --wait --json > eas-builds.json
node ../../scripts/capture-eas-build-evidence.mjs \
  --input eas-builds.json \
  --output ../../reports/mobile-release-evidence.json \
  --expected-commit "$(git rev-parse HEAD)" \
  --expected-profile production \
  --expected-app-version "$(node -p "JSON.parse(require('node:fs').readFileSync('app.json', 'utf8')).expo.version")"
eas submit --platform ios --profile production --id "<validated-ios-build-id>" --non-interactive --wait
eas submit --platform android --profile production --id "<validated-android-build-id>" --non-interactive --wait
```

Use `eas build:version:set` only when syncing the first production build number or after an existing store build has already been published. Review the generated evidence file and use only the two IDs it contains.

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
