# ManeFlow 2.13.0-beta.1

## Release goal

Restore the complete ManeFlow v2.5 product experience while consolidating the newer card-imaging, lot-analysis, bulk-intake, provider, and correction systems into one beta repository.

## Provider upgrades

- Added the official JustTCG JavaScript SDK integration path (`justtcg-js` 0.2.1) with a production REST fallback.
- Corrected JustTCG card search to use the documented `query` parameter.
- Added type-safe SDK search and batch lookup adapters, stable UUID handling, variant normalization, usage metadata, and explicit separation from verified completed-sale comps.
- Added eBay production OAuth consent URL generation using the application client ID and RuName.
- Added authorization-code exchange, refresh-token renewal, seller-order import, secure Electron storage, and disconnect controls.
- Added support for pasting either the eBay authorization code or the complete redirect URL.
- Kept eBay Browse active-listing context separate from sold comps.
- Kept Marketplace Insights disabled unless eBay separately grants that restricted access.
- Preserved SportsCardsPro as sports-card guide/catalog context rather than verified sold history.

## Imaging and identification retained

- Single-card, slab, raw, toploader, one-touch, pack, and mixed-scene detection.
- Multi-card and eBay-lot image reconciliation.
- Perspective correction, OCR/barcode/cert evidence, and conservative identity abstention.
- Parallel/refractor surface-family estimates using HSV/LAB, LBP, gradients, reflectivity, and micro-patches.
- Centering ratios and visible edge/corner wear estimates.
- Ricoh duplex intake, front/back pairing, batch review, corrections, and permissioned learning-data contribution.

## Deliberately not forced into the beta

- TensorRT/CUDA is an optional production acceleration path, not a required desktop dependency. CPU execution remains the compatibility baseline.
- Face recognition is not used to identify real athletes. ManeFlow uses whole-card visual similarity, printed identity evidence, logos, uniforms, card layout, and catalog consistency.
- No provider key is embedded in the package.

## Verification additions

- eBay OAuth URL, code exchange, refresh-token, and seller-order tests.
- JustTCG official SDK search and batch tests.
- JustTCG REST fallback query/authentication tests.
- Existing core, vision, lot, pricing, Ricoh, learning-data, mobile, desktop, and security gates remain in place.
