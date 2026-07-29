# Website Integration Kit

v1.9 includes public-safe embed tooling for MemphisCardCompany.com and future shop websites.

## Widget file

`GET /embed/maneflow-widget.js`

The v1.9 widget uses isolated Shadow DOM styles and supports:

- valuation mode
- scan intake mode
- consignment intake mode
- public-safe value summaries
- demo/live labeling
- source-quality disclaimers

## API routes

- `GET /api/embed/config`
- `POST /api/embed/scan-intake`
- `POST /api/embed/consignment-intake`
- `GET /api/public/cards/:slug/value`
- `/value/:slug` public value page

## Security

- allowed origins are enforced using `MANEFLOW_WIDGET_ALLOWED_ORIGINS` or `ALLOWED_ORIGINS`
- widgets expose only public card/value fields
- private Vaults and shop inventory are not exposed
- demo/live mode is labeled
- values are estimates, not appraisals or guarantees

## Example

```html
<div id="maneflow-widget"></div>
<script src="https://mane.memphiscardcompany.com/embed/maneflow-widget.js" data-mode="consignment"></script>
```

Public value pages and widgets must never expose private Vault data, raw provider payloads, provider secrets, customer data, or shop-private inventory.
