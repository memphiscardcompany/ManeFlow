# Catalog Autocomplete Engine

Release: **ManeFlow v2.5 State-of-the-Art Recognition Final**

The Catalog Autocomplete Engine powers manual inventory and collection logging. Its job is to feel like the best card-entry systems: type what is visible, get ranked card candidates quickly, pick the correct row, and auto-fill the Vault or shop inventory form.

This is not a submission system. PSA-style entry is the UX benchmark only.

## What It Does

- Smart card lookup from loaded catalog/checklist rows.
- Partial set matching such as `2023 Prizm`.
- Player/subject search such as `LeBron`, `Judge`, `Charizard`, or `Pikachu`.
- Set + card-number matching such as `Prizm Basketball #136`.
- Abbreviation support for common TCG and set language, including `SV` for Scarlet & Violet and `MTG`.
- Accent-insensitive matching for names such as `Jose Ramirez`.
- Variant handling for parallels, inserts, serial-numbered cards, 1/1s, printing plates, errors, and promos when those rows are loaded.
- Ambiguity status when multiple rows are close.
- Safe no-match behavior for empty, single-character, or nonsense input.
- Duplicate-aware Vault and shop inventory logging that updates quantity when the same card row is added again.

## APIs

### `GET /api/catalog/smart-autocomplete`

Primary endpoint for inventory and collection logging.

Supported query fields:

```text
q
sport
year
brand
set
cardNumber
player
parallel
limit
```

Response includes:

```text
status
nextStep
ambiguity
candidates[]
coverage
disclaimer
```

Statuses:

```text
needs_input
matched
ambiguous
no_match
```

### `GET /api/catalog/autocomplete`

Returns hierarchical field suggestions: sports, years, brands, sets, card numbers, players/subjects, parallels, and graders.

### `POST /api/catalog/complete`

Completes manual fields into a matched catalog card when ManeFlow has a row loaded. If no exact row exists, it returns a safe unmatched-card payload instead of inventing checklist data.

### `GET /api/catalog/sets`

Returns loaded set coverage.

### `GET /api/catalog/coverage`

Returns coverage by sport/game/year, largest loaded sets, image-ready counts by source, and an explicit reminder that ManeFlow does not claim complete universal catalog coverage until authorized checklist data is loaded and audited.

## Data Boundary

Catalog/checklist rows are identity data only. They help autocomplete, scan matching, cert matching, inventory, and collection logging. They do not create completed-sale comps or public market values.

ManeFlow does not claim complete universal checklist coverage until authorized source data is loaded and audited.

## Logging Behavior

Matched cards save with a `cardId`, so portfolio value, market lookup, inventory reports, and collection search can attach when eligible valuation comps exist.

Unmatched cards can still be saved, but they remain identity-only until a catalog match is added.

When the same card is logged again with the same identity, grade/cert/location/status/cost context, ManeFlow updates quantity instead of creating duplicate noise. Different certs, statuses, or locations remain separate rows.

## Supported Catalog Expansion Paths

- Bundled starter catalog.
- Memphis Card Company owned/export-derived rows.
- Authorized catalog/checklist CSV.
- Authorized sports checklist CSV/JSON imports.
- Approved manufacturer checklist collection for identity only.
- Pokemon TCG API exports when account/API terms are accepted.
- Scryfall bulk exports for Magic catalog identity.
- Lorcast API exports for Lorcana catalog identity.
- Generic authorized TCG CSV for Pokemon, Magic, Yu-Gi-Oh, Lorcana, One Piece, and other popular TCGs.
- Licensed or partner catalog feeds.

Only import catalog/checklist rows that Memphis Card Company or the shop is allowed to use.
