# Checklist Data Acquisition

Release: **ManeFlow v2.2 Checklist Intelligence**

ManeFlow can become much stronger when it has deep checklist coverage, but checklist data must be collected and stored through defensible channels.

## Approved Lanes

- Owner-owned exports from Memphis Card Company inventory, collection, eBay listings, and seller-order records.
- User-uploaded catalog/checklist CSV files when the user has rights to use them.
- Official manufacturer checklist pages that source policy allows for identity autocomplete only.
- Pokemon TCG API exports after accepting account/API terms.
- Scryfall bulk exports for Magic catalog identity, using bulk data rather than excessive live requests.
- Written-license or partner feeds.

## Review-Only Or Blocked Lanes

- Beckett checklist articles require legal/source review or written permission before commercial extraction.
- Trading Card Database is blocked unless written permission is obtained.
- Yu-Gi-Oh/Konami website content should require written permission or an approved API/export source before automated collection.
- Any login-only, paywalled, CAPTCHA-protected, or private account pages are blocked.

## What Gets Stored

Checklist imports store normalized identity fields only:

```text
year
brand
set
player/subject
cardNumber
parallel/variant/rarity
serialNumber
sport/category
image URL when permitted
catalogSource
aliases
externalId
```

They must not store private buyer/customer fields, payment data, tracking, order numbers, credentials, or raw private payloads.

## What Does Not Happen

- Checklist rows do not become completed-sale comps.
- Active listings do not become completed-sale comps.
- API price fields from catalog APIs are not treated as verified sales.
- Demo data is never public market value.
- ManeFlow does not bypass robots.txt, CAPTCHA, access controls, rate limits, or source terms.

## Quality Targets

Before claiming broad checklist coverage, sample-check high-volume and high-variance sets:

- recent Topps Chrome, Topps Series/Update, Bowman Chrome
- Panini Prizm, Select, Donruss Optic, Mosaic
- Pokemon Scarlet & Violet and modern special sets
- Magic sets from Scryfall bulk data
- vintage flagship sets
- inserts, parallels, short prints, promos, printing plates, 1/1s, and error variants

The Owner Control Room should make coverage gaps visible instead of implying the catalog is complete.
