# ManeFlow Meta dashboard owner-only steps

These actions require Joshua's authenticated Meta browser session. Do not paste tokens or secrets into GitHub, chat, screenshots, or documentation.

## Before changing Meta

Confirm the source pull request is green and the first-party staging deployment reports the same commit SHA and migration version `008`.

Keep the deployment fail closed:

```text
MANEBRAIN_META_KILL_SWITCH=true
MANEBRAIN_META_INTAKE_ENABLED=false
MANEBRAIN_META_OUTBOUND_ENABLED=false
```

## Meta dashboard sequence

1. Confirm the ManeFlow app is owned by the correct Memphis Card Company business portfolio.
2. Confirm the exact Memphis Card Company Facebook Page is linked to that portfolio.
3. Confirm the exact Instagram professional account is linked to the Page and portfolio.
4. Record only the non-secret app, business, Page, and Instagram account IDs in the deployment configuration.
5. Add the exact first-party HTTPS callback:

   ```text
   https://<first-party-staging-host>/api/webhooks/meta
   ```

6. Enter the verification token from the deployment secret manager and complete the callback challenge.
7. Select only the messaging products and webhook fields required for the controlled staging test.
8. Subscribe only the verified Page and Instagram professional account.
9. Configure the exact OAuth redirect URI, application domain, Privacy Policy, Terms, and data-deletion URL required by the chosen Meta login model.
10. Complete Business Verification and App Review only for the minimum permissions actually required.
11. Create or rotate the correct Page and Instagram access tokens; store them only in the deployment secret manager.
12. Keep the app in development mode until signed inbound tests, owner isolation, MFA, exactly-once approval, provider acceptance, signed echo reconciliation, and kill-switch rollback all pass.

## Controlled activation

### Signed intake only

```text
MANEBRAIN_META_KILL_SWITCH=false
MANEBRAIN_META_INTAKE_ENABLED=true
MANEBRAIN_META_OUTBOUND_ENABLED=false
```

Send one permitted Messenger test event and one permitted Instagram test event. Verify signature acceptance, exact asset allowlisting, replay deduplication, owner-only visibility, and zero outbound calls.

### One direct-message send

After owner MFA and recent reauthentication are proven, enable only the channel under test:

```text
MANEBRAIN_META_OUTBOUND_CHANNELS=messenger
MANEBRAIN_META_OUTBOUND_ENABLED=true
```

Create a draft, approve the exact text, queue it separately, dispatch once, and record the provider message ID and signed echo timestamp. Repeat later for `instagram_dm` only after Messenger passes.

Do not enable `facebook_comment` or `instagram_comment` until their exact provider contracts and permissions are separately reviewed and tested.

## Rollback

Immediately restore:

```text
MANEBRAIN_META_KILL_SWITCH=true
MANEBRAIN_META_OUTBOUND_ENABLED=false
MANEBRAIN_META_INTAKE_ENABLED=false
```

Stop the dispatcher, preserve audit evidence, and inspect `DEAD_LETTER` and `DELIVERY_UNKNOWN` jobs before any manual retry.
