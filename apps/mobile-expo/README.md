# ManeFlow native iOS and Android client

This Expo client uses the same secured ManeFlow API as the included installable PWA.

## Included

- Email registration and login
- Secure device-session storage
- Front and back camera capture
- Photo-library fallback
- Card identification candidates and confidence
- Market details and completed-sale comps
- Private Vault synchronization
- Watchlist actions
- Listing and consignment workspace
- Production bundle IDs, icons, splash art, and EAS profiles

## Local setup

```bash
npm ci
npm run typecheck
EXPO_PUBLIC_API_BASE_URL=https://your-api.example.com npx expo start
```

Use an HTTPS API for physical-device testing. The API URL is set through the EAS build profiles in `eas.json` or through the `EXPO_PUBLIC_API_BASE_URL` environment variable.

## Store build setup

1. Run `npx eas-cli build:configure` to link the project to the owner’s Expo account.
2. Confirm ownership of `com.memphiscardcompany.maneflow` in Apple and Google developer accounts.
3. Set the production API URL in `eas.json`.
4. Configure signing credentials with EAS.
5. Run the preview builds first.

```bash
npm run build:android
npm run build:ios
```

Signed AAB and IPA files are not bundled because they require the publisher's private Apple/Google credentials and store authorization.
