# Data Source Matrix

| Source | Current ManeFlow status | Use |
|---|---|---|
| Demo bundled sales | Included | Demonstration only; not public market value |
| Bundled starter catalog | Included | Starter autocomplete coverage only; not a universal checklist |
| Memphis owned/export-derived checklist rows | Included when generated | Expands inventory/collection lookup from sanitized owner exports |
| Authorized catalog/checklist CSV | Supported | Expands smart lookup and set coverage when rights are documented |
| Authorized sports checklist CSV/JSON | Supported importer | Sports catalog identity, PSA-style autocomplete, image URLs only when rights are documented |
| Pokemon TCG API export | Supported importer | TCG catalog identity and returned card image URLs; prices are not completed-sale comps |
| TCGdex API export | Supported importer | Pokemon catalog identity and returned card image URLs; not completed-sale comps |
| Scryfall bulk export | Supported importer | Magic catalog identity and returned image_uris; use bulk data; prices are not comps |
| Lorcast API export | Supported importer | Lorcana catalog identity and returned image_uris; images stay remote |
| YGOPRODeck API export | Supported importer | Yu-Gi-Oh catalog identity and returned image URLs; prices are context only, not comps |
| Approved TCGplayer media | Supported image source profile | Product media only when access and image rights are approved |
| Authorized TCG CSV | Supported importer | Pokemon, Magic, Yu-Gi-Oh, Lorcana, One Piece, and other TCG catalog identity |
| GotThatData sports-cards dataset | Supported internal benchmark source | Recognition testing only; does not create pricing comps or public image catalog |
| acidtib MTG image dataset | Review-only benchmark source | Terms/source review required before large-scale local use |
| CardSight AI / CardGrader.AI | Vendor review path | Recognition benchmark or fallback only after account/terms setup; no credentials shipped |
| PriceCharting / JustTCG | Vendor review path | Secondary pricing context only unless provider proves completed-sale basis and rights |
| Apify actor outputs | Review only | Target-site rights still required; actor output alone is not permission |
| Topps Official Checklists | Approved public identity source | Catalog identity only, source-policy/robots/rate-limit gated |
| Panini Official Checklists | Approved public identity source | Catalog identity only, source-policy/robots/rate-limit gated |
| Upper Deck Official Checklists | Approved public identity source | Catalog identity only, source-policy/robots/rate-limit gated |
| Beckett checklist articles | Review only | Written permission or legal/source review required |
| Trading Card Database | Prohibited by policy | Do not collect unless written permission is obtained |
| Authorized CSV completed sales | Supported | Production comps only when rights and completed-sale status are documented |
| eBay Marketplace Insights | Integration path | Completed sales only when approved access exists |
| eBay Seller Orders | Integration path | Seller-authorized sold history only; provider image URLs may display as card context |
| eBay Browse active BIN listings | Context only | Asking-price context for listing strategy and new releases; never completed-sale comps or canonical card images |
| eBay Browse listing images | Internal benchmark source | Official API image URLs for scanner QA manifests only; not completed-sale comps, not catalog artwork, not release assets |
| Card Ladder partner | Stub | Requires written license |
| Fanatics Collect partner | Stub | Requires written license |
| Goldin partner | Stub | Requires written license |
| Heritage partner | Stub | Requires written license |
| COMC partner | Stub | Requires written license/export permission |
| TCGplayer partner | Stub | Requires authorized access |
| Whatnot partner | Stub | Requires authorized seller/partner access |

Every production sale must carry `sourceMode`, `authorizationBasis`, and `dataRightsStatus` before valuation use.

Catalog/checklist rows are identity data, not sale comps. They can improve manual add, scan matching, cert matching, shop intake, and inventory logging, but they do not by themselves create market values.

## Data Trust Notes

Approved valuation sources include official APIs, approved eBay Marketplace Insights access, seller-authorized account data, written commercial licenses, approved partner feeds, user-authorized exports, user CSV imports, and admin-approved manual evidence.

Active listings remain context only. Current BIN listings may inform `askingPriceContext`, `pricingConfidence`, and dealer listing guidance, but never `valuation.value`. Scraping/evasion/proxy-based collection is not part of this release. Demo data is never public market value.

Public value pages and widgets show only public-safe summaries. Provider secrets, raw private payloads, customer details, and shop-private inventory are never exposed through public routes.

## Image Source Notes

ManeFlow loads card images from a dedicated source policy layer. Built-in image hosts include `images.pokemontcg.io`, `assets.tcgdex.net`, `cards.scryfall.io`, `cards.lorcast.io`, `images.ygoprodeck.com`, approved TCGplayer media host, `i.ebayimg.com`, and `thumbs.ebaystatic.com`.

Image URLs are not pricing evidence by themselves. They improve search, detail, Vault, inventory, and public value display, while completed-sale valuation still requires approved sale records that pass Comp Quality.

## Recognition Benchmark Notes

Recognition benchmark data is internal testing evidence. It can report scan accuracy and identify weak fields, but it cannot be promoted into completed-sale valuation or redistributed as a public image database.

The benchmark harness supports JSON, CSV, dataset-style `metadata`/`text` labels, owner phone-photo labels, optional observed scene analysis, extra catalog files, local scan correction history, folder-based image sets, and official eBay Browse listing-image manifest scaffolds.
