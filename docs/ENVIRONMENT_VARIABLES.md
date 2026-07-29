# Environment Variables

Core:

```text
NODE_ENV=production
PUBLIC_BASE_URL=https://mane.memphiscardcompany.com
ALLOWED_ORIGINS=https://mane.memphiscardcompany.com
MANEFLOW_ADMIN_TOKEN=...
PROVIDER_WEBHOOK_SECRET=...
MANEFLOW_DEMO_MODE=false
MANEFLOW_EXPOSE_DEV_TOKENS=false
```

Storage:

```text
STORAGE_MODE=json
MANEFLOW_STATE_FILE=.runtime/state.json
```

PostgreSQL mode is disabled/fail-closed in this package until a complete production store adapter is implemented:

```text
STORAGE_MODE=postgres
DATABASE_URL=postgres://...
```

Card images:

```text
MANEFLOW_REMOTE_IMAGE_HOSTS=cdn.example.com,images.partner.example
MANEFLOW_CARD_IMAGE_TEMPLATE=https://cdn.example.com/cards/{year}/{brand}/{cardNumber}.jpg
MANEFLOW_CARD_IMAGE_SOURCE=licensed_partner_image_cdn
MANEFLOW_CARD_IMAGE_RIGHTS_NOTES=Images served under the owner's licensed partner agreement.
```

Built-in image hosts are enabled for Pokemon TCG API, Scryfall, Lorcast, and authorized eBay API image context. Add custom hosts only for image URLs you are allowed to display.

Billing:

```text
BILLING_PROVIDER=mock
```

or:

```text
BILLING_PROVIDER=stripe
STRIPE_SECRET_KEY=...
STRIPE_WEBHOOK_SECRET=...
```

eBay:

```text
EBAY_CLIENT_ID=...
EBAY_CLIENT_SECRET=...
EBAY_MARKETPLACE_INSIGHTS_ENABLED=false
EBAY_USER_ACCESS_TOKEN=...
```

Keep Marketplace Insights disabled unless eBay has approved completed-sale access.
