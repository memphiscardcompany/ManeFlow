# eBay Benchmark Image Discovery

ManeFlow includes an internal tool for discovering live-listing-style card photos through eBay's official Browse API.

This tool is for scanner QA and benchmark set creation. It is not a completed-sale data source, not a catalog image importer, and not a web scraper.

## Required Credentials

Set:

```text
EBAY_CLIENT_ID
EBAY_CLIENT_SECRET
EBAY_MARKETPLACE_ID=EBAY_US
EBAY_ENVIRONMENT=production
```

## Example

Using the Shohei lot search:

```bash
npm run recognition:discover:ebay -- --url "https://www.ebay.com/sch/i.html?_nkw=shohei+lot&_sacat=0&_from=R40&_trksid=p2323012.m570.l1312" --out ./.runtime/recognition-benchmarks/ebay-shohei-lot --limit 50
```

To also download returned image files for local internal benchmarking:

```bash
npm run recognition:discover:ebay -- --query "shohei lot" --out ./.runtime/recognition-benchmarks/ebay-shohei-lot --limit 50 --download
```

## Output

The tool creates:

- `manifest.json`
- `labels.scaffold.json`
- `README.md`
- optional local image files when `--download` is provided

The label file starts as a scaffold. Fill `expectedCards` manually before using it for top-1/top-3 or field-level accuracy.

## Benchmark

After labels are filled:

```bash
npm run recognition:benchmark:folder -- --images ./.runtime/recognition-benchmarks/ebay-shohei-lot --labels ./.runtime/recognition-benchmarks/ebay-shohei-lot/labels.scaffold.json --source "eBay Browse Listing Images" --out ./.runtime/recognition-benchmarks/ebay-shohei-lot/report.json --summary
```

With vision credentials:

```bash
npm run recognition:benchmark:folder -- --images ./.runtime/recognition-benchmarks/ebay-shohei-lot --labels ./.runtime/recognition-benchmarks/ebay-shohei-lot/labels.scaffold.json --source "eBay Browse Listing Images" --vision --out ./.runtime/recognition-benchmarks/ebay-shohei-lot/live-vision-report.json
```

## Rights Rules

- Uses official eBay API credentials.
- Does not scrape eBay pages.
- Does not bypass access controls.
- Does not use proxy/evasion tooling.
- Active listings remain context only.
- Listing images are internal scanner QA inputs only.
- Listing images are not completed-sale comps.
- Listing images are not public catalog artwork.
- Listing images should not be shipped inside ManeFlow release packages.

## Packs And Boxes

The discovery and recognition stack can classify sealed product listings such as:

- hobby boxes
- blaster boxes
- retail boxes
- booster boxes
- booster packs
- sealed wax packs
- tins
- ETBs / Elite Trainer Boxes
- sealed cases

Sealed products can be matched for catalog/inventory workflows through product name, product type, set, brand, configuration, SKU, and UPC. Pricing still requires eligible completed-sale records for the sealed product.
