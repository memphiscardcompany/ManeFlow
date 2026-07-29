# Shopify Integration

ManeFlow can integrate with Shopify using public-safe widgets first, then a Shopify app proxy/theme app extension after production hosting is ready.

Recommended path:

1. Deploy ManeFlow to HTTPS.
2. Set `MANEFLOW_WIDGET_ALLOWED_ORIGINS=https://memphiscardcompany.com,https://www.memphiscardcompany.com`.
3. Embed valuation/intake widgets on pages.
4. Add a Shopify theme app extension for storefront placement.
5. Add app proxy routes for authenticated customer-account features only after Shopify app authorization is complete.

Do not put API keys or provider credentials in storefront code.
