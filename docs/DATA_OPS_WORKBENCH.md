# Owner Data Ops Workbench

ManeFlow v1.9 exposes the data-acquisition workflow inside the Owner Control Room so pricing evidence can be reviewed, explained, and promoted without touching code.

## Panels

### Source Rights

Shows configured source policies, including:

- provider
- source type
- authorization basis
- data-rights status
- legal review status
- owner approval status
- valuation eligibility
- notes

### Acquisition Gate

Lets an admin check whether a source/action is allowed before collecting or importing data. Unknown, prohibited, unapproved, private/login/paywall/CAPTCHA-like, robots-disallowed, or rate-limited sources fail closed.

### Evidence Parser

Parses legally obtained sale evidence such as:

- owner-uploaded exports
- receipts
- invoices
- screenshots the owner is allowed to use
- pasted sale details

Parsed evidence is review-only until captured, approved, and promoted.

### Manual Review

Manual comps start as `needs_review` and `valuationUse=false`. Admins can approve, reject, or keep evidence private. Only approved records with `valuationUse=true` can be promoted into the Pricing Data Engine.

## Promotion Flow

```text
Evidence
-> Parser
-> Manual Comp Capture
-> Admin Review
-> Pricing Data Engine
-> Comp Quality Engine
-> Valuation
-> Portfolio, Dealer, and Public-Safe Views
```

## Safety Rules

- Active listings remain context only.
- Demo comps are never public market values.
- Unauthorized sources cannot affect production valuations.
- Manual evidence cannot affect valuation until admin-approved.
- Public views expose public-safe summaries only.
- Provider credentials and raw private payloads are never returned to public or user-facing routes.

## Live Data Boundary

ManeFlow can operate the workflow for real authorized data, but it does not include marketplace credentials or data licenses. Public live-pricing claims require official APIs, approved eBay access, seller-authorized account data, written licenses, partner feeds, user-owned exports, or validated CSV imports.
