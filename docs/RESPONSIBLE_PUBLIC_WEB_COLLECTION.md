# Responsible Public Web Collection

ManeFlow can collect approved public pages only after a source is registered and approved in the Data Rights Registry.

The collector:

- identifies itself with ManeFlow's user agent
- checks acquisition policy first
- respects robots text
- honors crawl delay and per-minute budgets
- blocks login, account, checkout, admin, private, paywall, OAuth, and CAPTCHA-like URLs
- extracts only review evidence
- stores output as quarantined evidence

It does not include proxy rotation, CAPTCHA bypass, anti-bot evasion, hidden automation, fake accounts, or unauthorized session scraping.

CLI:

```text
node src/tools/public-web-collector.js --store ./runtime/maneflow.json --provider "Approved Source" --url https://example.com/sale --dry-run
```

Dry-run is recommended before any live collection. Output still requires admin review before valuation eligibility.
