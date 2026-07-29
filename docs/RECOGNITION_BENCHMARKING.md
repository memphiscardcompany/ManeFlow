# Recognition Benchmarking

ManeFlow now includes an internal benchmark harness for improving card recognition with real-world datasets while keeping data rights and pricing boundaries intact.

## What It Measures

The benchmark runner evaluates:

- scene accuracy
- top-1 card match accuracy
- top-3 candidate accuracy
- extracted field accuracy
- false-confident rate
- manual-confirmation rate

These metrics are designed for practical scanner improvement. A high top-3 score with a weaker top-1 score means the catalog likely contains the right card but ranking or confirmation UX needs work. A high false-confident rate is the most dangerous signal because it means the app is too sure while wrong.

## Command

```bash
npm run recognition:benchmark -- --file ./benchmark.json --source "GotThatData Sports Cards Dataset" --out ./recognition-report.json
```

Optional flags:

```text
--catalog ./extra-catalog.json
--store ./.runtime/state.json
--summary
```

`--catalog` adds extra cards to the bundled catalog for the run.

`--store` includes local custom cards and stored scan corrections.

`--summary` prints only the summary metrics.

## Folder Benchmark Command

Use the folder runner when you have real photos on disk:

```bash
npm run recognition:benchmark:folder -- --images ./card-photos --labels ./card-photos/labels.json --source "Owner Phone Photos" --out ./reports/folder-recognition.json --summary
```

The folder runner:

- walks nested image folders
- supports `.jpg`, `.jpeg`, `.png`, `.webp`, and `.avif`
- pairs photos to `labels.json/csv`, `annotations.json/csv`, `benchmark.json/csv`, `recognition-labels.json/csv`, or same-basename sidecar JSON files
- reports unlabeled images and unmatched labels
- writes both JSON and Markdown reports when `--out` is provided
- breaks results down by scene type, field, and multi-card/binder performance

Use `--vision` to benchmark actual image analysis instead of label/observed-scene matching:

```bash
set MANEFLOW_OPENAI_API_KEY=...
set MANEFLOW_OPENAI_VISION_MODEL=...
npm run recognition:benchmark:folder -- --images ./binder-tests --labels ./binder-tests/labels.json --vision --out ./reports/live-vision-binder.json
```

Live vision benchmarking currently accepts JPEG, PNG, and WebP inputs. Convert AVIF images before using `--vision`.

## eBay Listing Image Discovery

For live-listing-style scanner QA photos, use the official eBay Browse API discovery tool:

```bash
npm run recognition:discover:ebay -- --url "https://www.ebay.com/sch/i.html?_nkw=shohei+lot" --out ./.runtime/recognition-benchmarks/ebay-shohei-lot --limit 50
```

Optional flags:

```text
--query "shohei lot"
--category-ids 212
--include-additional-images
--download
--bin-only
```

The tool creates:

- `manifest.json`
- `labels.scaffold.json`
- `README.md`
- optional downloaded image files when `--download` is supplied

This is not a scraper. It requires `EBAY_CLIENT_ID` and `EBAY_CLIENT_SECRET`, calls eBay's official Browse API, and refuses to treat active listings as completed-sale comps. Images discovered this way are tagged `active_listing_images_internal_benchmark_only`.

Fill `expectedCards` in `labels.scaffold.json` before using the folder as an accuracy benchmark.

## Supported Input Shapes

JSON:

```json
{
  "sourceName": "Owner Phone Photos",
  "cases": [
    {
      "id": "binder-page-001",
      "imageName": "binder-page-001.jpg",
      "sceneType": "binder_page",
      "expectedCards": [
        {
          "player": "Shohei Ohtani",
          "year": 2018,
          "brand": "Topps",
          "set": "Update Series",
          "cardNumber": "US1",
          "parallel": "Base Rookie Debut"
        }
      ]
    }
  ]
}
```

CSV:

```csv
id,imageName,player,year,brand,set,cardNumber,parallel
single-001,ohtani-front.jpg,Shohei Ohtani,2018,Topps,Update Series,US1,Base Rookie Debut
```

Dataset-style rows with JSON labels are also supported through `metadata`, `text`, or `labelJson`.

## Admin API

```text
GET  /api/admin/recognition-benchmarks
POST /api/admin/recognition-benchmarks/run
```

The admin run endpoint stores the benchmark summary, metrics, recommendations, and policy metadata. Detailed rows are returned only when `includeDetails=true` is supplied.

## Data Boundary

Recognition benchmark data:

- improves scan evaluation
- helps prioritize catalog/ranking/vision fixes
- can use lawful local datasets and owner photos
- never creates completed-sale comps
- never creates public market values
- never publishes dataset images
- never bypasses source restrictions

If a source is marked `prohibited` in the data-rights registry, the admin benchmark endpoint blocks it until written permission is recorded.

## Recommended Real-World Benchmark Set

For a serious scanner quality pass, build a labeled folder with:

- 50 single raw card photos
- 50 slabbed cards with visible cert labels
- 50 table/group photos with multiple cards
- 50 binder-page photos
- 25 sealed products: packs, hobby boxes, blasters, retail boxes, tins, ETBs, booster boxes, and sealed TCG products
- difficult cases: glare, sleeves, slabs, angle, low light, refractors, parallels, serial-numbered cards, TCG cards, vintage cards, and partially obscured rows

Run the folder benchmark once without `--vision` to validate labels and once with `--vision` to measure real recognition. The second run is the one that should be used for scanner accuracy claims.
