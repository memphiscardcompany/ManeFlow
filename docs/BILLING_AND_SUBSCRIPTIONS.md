# Billing And Subscriptions

ManeFlow v1.7 adds operational billing entitlements without embedding live payment credentials.

## Supported In Package

- manual billing entitlements
- comped accounts
- manual Enterprise accounts
- Stripe-ready subscription event mapping
- Stripe webhook signature verification
- server-side usage metering
- owner override controls

## Subscription States

- trialing
- active
- past_due
- canceled
- unpaid
- comped
- manual_enterprise

## Usage Events

- scans
- scan sessions
- valuation views
- portfolio snapshots
- exports
- shop seats
- shop inventory items
- API requests
- public widgets
- public value pages
- provider imports
- bulk intake batches

## Live Billing Boundary

No real charges happen in demo mode. Stripe requires `BILLING_PROVIDER=stripe`, `STRIPE_SECRET_KEY`, and `STRIPE_WEBHOOK_SECRET`. Native app purchases require Apple and Google policy review and owner-controlled developer accounts.
