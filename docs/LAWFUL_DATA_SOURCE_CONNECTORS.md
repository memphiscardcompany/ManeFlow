# Lawful Data Source Connectors

ManeFlow can use a lot of real data without turning into an unauthorized scraper. The rule is simple: use official APIs, bulk exports, licensed feeds, seller-authorized exports, owner-owned files, or datasets whose terms allow the intended use. Keep identity, images, benchmark evidence, asking-price context, and completed-sale comps separate.

## Supported Now

| Source | ManeFlow use | Valuation use |
|---|---|---|
| Pokemon TCG API | Pokemon catalog identity and remote image URLs | No |
| TCGdex API | Pokemon catalog identity and remote image URLs | No |
| Scryfall bulk/API exports | Magic catalog identity and remote image URLs | No |
| Lorcast API | Lorcana catalog identity and remote image URLs | No |
| YGOPRODeck API | Yu-Gi-Oh catalog identity and remote image URLs | No |
| Authorized TCG CSV | Any TCG catalog/checklist identity | No |
| Authorized sports checklist CSV/JSON | Sports catalog/checklist identity | No |
| GotThatData sports-cards dataset | Internal recognition benchmarking | No |
| eBay Marketplace Insights | Completed sales when approved access exists | Yes, after Comp Quality |
| eBay Seller Orders | Seller-authorized completed sales | Yes, after Comp Quality |
| eBay Browse | Current BIN/asking context only | No |
| User/owner CSV completed sales | Completed sales when rights are documented | Yes, after Comp Quality |

## Explicitly Blocked Without Written Permission

| Source | Reason |
|---|---|
| Trading Card Database | ManeFlow source policy marks it prohibited unless written permission is obtained. |
| COMC site content/images | ManeFlow source policy marks it prohibited unless written permission, partner access, or seller-authorized exports are recorded. |
| Apify actor output from restricted sites | Apify tooling does not grant rights to the target site data by itself. Target-site permission must be documented first. |

## TCG Catalog Imports

Use `scripts/import-tcg-catalog-data.mjs` for API exports, bulk files, and authorized CSVs:

```bash
node scripts/import-tcg-catalog-data.mjs --file ./pokemon.json --format pokemon-tcg-api --source "Pokemon TCG API"
node scripts/import-tcg-catalog-data.mjs --file ./tcgdex-cards.json --format tcgdex-api --source "TCGdex API"
node scripts/import-tcg-catalog-data.mjs --file ./scryfall-default-cards.json --format scryfall-bulk --source "Scryfall Bulk Data"
node scripts/import-tcg-catalog-data.mjs --file ./ygoprodeck-cardinfo.json --format ygoprodeck-api --source "YGOPRODeck API"
node scripts/import-tcg-catalog-data.mjs --file ./lorcast-cards.json --format lorcast-api --source "Lorcast API"
node scripts/import-tcg-catalog-data.mjs --file ./authorized-tcg.csv --format generic-csv --source "Authorized TCG Catalog CSV"
```

These imports populate catalog identity and approved remote image URLs. They do not create completed-sale pricing comps.

## Recognition Benchmarking

Real-world photo datasets can be used as an internal scanner lab:

```bash
npm run recognition:benchmark -- --file ./benchmarks/sports-cards.json --source "GotThatData Sports Cards Dataset" --out ./reports/recognition.json
```

Input may be JSON, a JSON array, or CSV. Rows can include:

- `expectedCards`, `cards`, or `labels`
- `metadata`, `text`, or `labelJson` containing JSON
- `imageName`, `imagePath`, or `imageUrl`
- optional observed `sceneAnalysis`

Benchmark reports measure scene accuracy, top-1 accuracy, top-3 accuracy, field accuracy, false-confident rate, and confirmation rate.

Benchmark data is internal testing evidence only. It must not be used as public market value, customer-facing catalog redistribution, or completed-sale evidence.

## Owner Controls

Admin routes:

```text
GET  /api/admin/data-sources
POST /api/admin/data-sources
GET  /api/admin/recognition-benchmarks
POST /api/admin/recognition-benchmarks/run
```

Source policies decide whether a source is eligible for catalog identity, images, benchmarking, pricing context, or completed-sale valuation. Unknown or prohibited sources fail closed.
