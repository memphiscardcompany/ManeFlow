# ManeFlow automatic pricing — 2026-07-29

## Product rule

ManeFlow handles card pricing. The customer confirms the card identity and optional private acquisition details; the customer does not supply comparable sales or choose the card’s current market value.

```text
Exact card identity confirmed
→ check freshness of authorized completed-sale evidence
→ refresh eligible evidence through an approved provider when needed
→ normalize, deduplicate, score, and filter comps
→ calculate a current value and range
→ explain confidence and limitations
→ save or display the result
```

## Automatic triggers

ManeFlow now calculates or refreshes pricing when:

- an authenticated user requests a card’s pricing record;
- a scan session is confirmed with an exact catalog card;
- a confirmed card is added to the private Vault;
- an existing Vault row is merged with another copy.

A rejected scan does not trigger pricing. A result without an exact catalog identity remains `valuation_unavailable` rather than receiving a guessed value.

## Evidence hierarchy

### Value-setting evidence

Only normalized completed sales with an approved authorization basis may set the ManeFlow market value.

The initial automatic provider path is eBay Marketplace Insights and remains disabled unless:

```text
EBAY_CLIENT_ID and EBAY_CLIENT_SECRET are configured
and
EBAY_MARKETPLACE_INSIGHTS_ENABLED=true
and
approved Marketplace Insights access actually exists
```

The automatic query includes the confirmed card context:

- year;
- brand/manufacturer;
- set/product;
- player/subject;
- card number;
- exact parallel or variation when known;
- grading company and grade when applicable.

The default lookback is 730 days. Results pass through the existing ManeFlow pricing ingestion, duplicate detection, card matching, comp-quality scoring, exclusion, outlier, confidence, and valuation logic before they can influence value.

### Context-only evidence

Active listings are retrieved separately where authorized and supported.

They are labeled:

```text
valuationUse: false
```

Active asking prices never set ManeFlow market value.

## Failure behavior

ManeFlow does not ask the customer to fill the gap when a provider is unavailable.

- Fresh authorized stored evidence is reused.
- Stale evidence may be refreshed when authorized access exists.
- Provider failures are recorded with sanitized error metadata.
- No completed-sale evidence produces `valuation_unavailable`.
- Demo evidence remains explicitly demo/nonproduction.
- Active asking prices cannot become a fallback value.
- Missing identity cannot receive a fabricated price.

## Freshness and request control

Default controls:

- completed-sale freshness interval: 6 hours;
- result cache: 15 minutes;
- lookback: 730 days;
- completed-sale request limit: 100;
- active asking-list context limit: 12;
- one in-flight provider refresh per card within a process.

The provider client retains its own bounded request timeout, retry, rate-limit, and token controls.

## API behavior

### Read automatic card pricing

```text
GET /api/pricing/cards/:cardId
```

Requires a real authenticated user session. Service, API, and legacy admin bearer tokens cannot impersonate a customer session for this route.

### Confirm a scan

```text
POST /api/scan-sessions/:sessionId/confirm
```

The response now includes:

```json
{
  "session": {},
  "pricing": {
    "status": "valued_from_authorized_completed_sales",
    "valuation": {},
    "refresh": {},
    "askingPriceContext": {
      "valuationUse": false
    }
  }
}
```

### Add to Vault

```text
POST /api/collection
```

Client-provided fields such as `marketValue`, `estimatedValue`, `comps`, `valuation`, and `suggestedPrice` are ignored. ManeFlow persists only the supported collection fields, then calculates pricing itself.

Private acquisition price remains optional cost-basis data and does not set market value.

## Audit records

Provider refresh attempts record either:

```text
automatic_pricing_refresh_completed
automatic_pricing_refresh_failed
```

Audit data includes the card ID, provider, trigger reason, imported/updated/rejected counts, and sanitized error code. Provider credentials and raw private data are not recorded.

## Current status

### Implemented in source

- automatic provider-gated completed-sale refresh;
- authorized ingestion into canonical pricing evidence;
- valuation recomputation after confirmation and Vault entry;
- active-listing separation;
- freshness caching and single-flight suppression;
- fail-closed unavailable states;
- customer-value injection rejection;
- authenticated route and cross-user scan isolation tests.

### Requires external verification

- live eBay Marketplace Insights access and exact granted scope;
- provider credentials in a real staging secret manager;
- live completed-sale response normalization;
- provider quota and latency behavior;
- physical browser end-to-end confirmation and Vault workflows;
- first-party staging deployment;
- release at `app.memphiscardcompany.com`;
- production monitoring and alert thresholds.

The connected AppDeploy snapshot currently has no configured PSA, eBay, JustTCG, or SportsCardsPro secrets and is not evidence that this canonical automatic-pricing path is live.

## Claims not made

This implementation does not claim that live provider pricing is currently connected, that every card can be valued, that ManeFlow guarantees market value, or that a production deployment has occurred. It establishes the tested source path so ManeFlow—not the customer—owns valuation once authorized completed-sale data is available.
