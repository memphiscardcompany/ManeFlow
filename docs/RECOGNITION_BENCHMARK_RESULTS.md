# Recognition Benchmark Results

Release: **ManeFlow v2.5 State-of-the-Art Recognition Final**

## What Was Added

ManeFlow now includes a folder-based recognition benchmark runner that can evaluate a real photo set instead of only hand-authored benchmark JSON.

Command:

```bash
npm run recognition:benchmark:folder -- --images ./card-photos --labels ./card-photos/labels.json --source "Owner Phone Photos" --out ./reports/folder-recognition.json --summary
```

The runner reports:

- overall scene accuracy
- top-1 card accuracy
- top-3 card accuracy
- field-level accuracy
- false-confident misses
- manual-confirmation rate
- scene breakdown
- multi-card/table/binder performance
- weak fields and failure examples

## Current Local Evaluation

No exact-card labeled real-world photo folder was found inside the shipped app package or the available local Downloads review. Because of that, ManeFlow should not claim a real-world scanner identity-accuracy percentage from this machine yet.

After the owner supplied 12 eBay live-listing Shohei Ohtani lot images, they were copied into the excluded `.runtime` benchmark workspace and processed as an internal scene scaffold:

- images found: 12
- labeled images: 12
- unlabeled images: 0
- labels loaded: 12
- unmatched labels: 0
- multi-card/group cases: 11
- single-card cases: 1
- exact expected card labels: 0

This validates the real folder workflow on actual live-listing-style images: lots, grids, glare, stacks, repeated players, sleeves, and difficult table layouts. It does not measure card-identity accuracy yet because the scaffold intentionally has empty `expectedCards` until exact card labels are filled.

A controlled folder smoke test was run to verify the benchmark workflow itself:

- images found: 3
- labeled images: 2
- unlabeled images: 1
- labels loaded: 2
- expected cards: 3
- multi-card/binder cases: 2
- report formats: JSON and Markdown

That smoke test proves the folder intake, label pairing, multi-card/binder focus, and report generation work. It is not a substitute for a real image-analysis benchmark because it did not run live vision on actual card photos.

## Current Strengths

- The benchmark can measure single-card, binder-page, table/group, mixed raw/slab, and cert-label scenes.
- The report separates top-1 misses from cases where the correct card appears in the top 3.
- Field-level scoring identifies weak extraction fields such as set, card number, parallel, grade, or cert.
- False-confident misses are tracked separately because they are more dangerous than confirmation prompts.
- Unlabeled images and unmatched labels are surfaced so benchmark folders can be cleaned quickly.
- The benchmark is rights-safe: it does not create market values, does not publish dataset images, and does not turn images into a redistributable catalog.

## Failure Patterns To Watch First

When real photos are added, focus on:

- binder pages where cards are partially covered by sleeve glare
- group/table photos with cards touching or overlapping
- slabs where the cert label is small, angled, or reflective
- modern refractors and parallels where visual differences are subtle
- brand-new sets not yet present in the catalog
- cards where the right match is in the top 3 but the first result is a near-duplicate
- high confidence on wrong set, wrong parallel, or wrong card number

## Real Benchmark Protocol

For the next serious scanner quality run, create this folder:

```text
recognition-real-world-benchmark/
  single-raw/
  slabs/
  table-groups/
  binder-pages/
  labels.json
```

Recommended minimum:

- 50 single raw sports cards
- 50 slabbed cards with visible cert labels
- 50 multi-card table/group photos
- 50 binder-page photos
- sports and TCG examples
- at least 25 difficult images with glare, angle, sleeves, slabs, refractors, or low light

Each label should include the image name, scene type, and expected cards:

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

Then run:

```bash
npm run recognition:benchmark:folder -- --images ./recognition-real-world-benchmark --labels ./recognition-real-world-benchmark/labels.json --source "Owner Phone Photos" --out ./reports/recognition-real-world.json --summary
```

With server-side vision credentials configured, run the real image-analysis benchmark:

```bash
npm run recognition:benchmark:folder -- --images ./recognition-real-world-benchmark --labels ./recognition-real-world-benchmark/labels.json --source "Owner Phone Photos" --vision --out ./reports/recognition-live-vision.json
```

The `--vision` run is the one that should drive scanner accuracy claims and product-quality decisions.
