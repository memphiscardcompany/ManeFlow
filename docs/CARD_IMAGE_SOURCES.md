# Card Image Sources

ManeFlow v2.5 includes a real remote image-source and enrichment layer. The app does not bundle a giant local card image catalog. It resolves card images from configured, rights-aware URLs and falls back to a local ManeFlow placeholder when a card has identity data but no usable image source.

## Resolution Order

Card images resolve in this order:

1. Bundled local demo assets for the small starter catalog.
2. Approved remote image URLs included in authorized catalog rows.
3. Approved provider sale images from completed-sale/seller-authorized records.
4. Admin-approved image enrichment overrides with rights metadata.
5. Optional owner-configured remote image template.
6. ManeFlow placeholder image for identity-only catalog rows.

The placeholder is intentional. It means ManeFlow can search, autocomplete, scan-match, or log the card, but it does not have a usable image URL from a configured source.

## Built-In Source Profiles

These hosts are enabled by default:

| Source | Hosts | Use |
|---|---|---|
| Pokemon TCG API | `images.pokemontcg.io` | Catalog card images from `images.small` / `images.large` fields |
| Scryfall Bulk Data | `cards.scryfall.io` | Magic images from returned `image_uris` fields |
| Lorcast API | `cards.lorcast.io` | Lorcana images from returned `image_uris` fields |
| Approved TCGplayer media | `6d4be195623157e28848-7697ece4918e0a73861de0eb37d08968.ssl.cf1.rackcdn.com` | TCGplayer product media only when imported through approved access |
| eBay API | `i.ebayimg.com`, `thumbs.ebaystatic.com` | Provider-returned item images from authorized completed-sale, seller-order, or owner-authorized import records |

Active eBay listings remain context only. Their images are not promoted as canonical completed-sale card images.

## API Visibility

The app exposes a public-safe source status endpoint:

```text
GET /api/card-images/sources
GET /api/card-images/coverage
```

It returns:

- configured image hosts
- built-in source profiles
- source rights notes
- placeholder path
- the current image policy
- image coverage counts and gaps

No provider secrets, private payloads, shop data, or customer data are returned.

## Configuration

Owners can add a licensed/partner image CDN:

```text
MANEFLOW_REMOTE_IMAGE_HOSTS=cdn.example.com,images.partner.example
MANEFLOW_CARD_IMAGE_TEMPLATE=https://cdn.example.com/cards/{year}/{brand}/{cardNumber}.jpg
MANEFLOW_CARD_IMAGE_SOURCE=licensed_partner_image_cdn
MANEFLOW_CARD_IMAGE_RIGHTS_NOTES=Images served under the owner's licensed partner agreement.
```

Templates support simple card fields:

```text
{year}
{brand}
{set}
{player}
{cardNumber}
{parallel}
{grade.company}
{grade.grade}
```

Every generated URL must be HTTPS and hosted on an allowed image host.

## Image Enrichment Jobs

Admins can preview, import, and roll back image enrichment rows:

```text
GET /api/admin/card-images
POST /api/admin/card-images/enrich
POST /api/admin/card-images/rollback
```

Rows require a known `cardId`, an HTTPS image URL on an allowed host, an approved authorization basis, source metadata, and rights notes. Dry-runs report coverage changes without writing records. Rollback removes overrides by provider batch ID.

## Data-Rights Boundary

Catalog/checklist rows are identity data. They do not automatically grant image rights or pricing rights.

ManeFlow does not:

- scrape full image catalogs without permission
- store a local copy of every card image
- treat images as completed-sale evidence
- expose private provider payloads on public pages
- use active listing images as completed-sale comps

Public pages show only the resolved image URL, alt text, and public-safe image metadata.
