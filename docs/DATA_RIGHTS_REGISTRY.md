# Data Rights Registry

ManeFlow v1.9 stores source policy records in `sourcePolicies` and exposes them through the Owner Data Ops Workbench.

Each policy tracks:

- provider
- source type
- authorization basis
- data-rights status
- terms URL
- robots URL
- allowed and disallowed paths
- crawl delay
- rate limit
- attribution requirements
- retention rules
- redistribution rules
- AI/training restrictions
- personal-data restrictions
- legal review status
- owner approval status
- valuation eligibility
- public display eligibility

Default seeded policies include eBay Marketplace Insights, eBay Seller Orders, eBay Browse, TCGplayer, Whatnot, Manual Comp Evidence, and PSA/BGS/SGC/CGC Cert Verification.

Admin endpoints:

```text
GET  /api/admin/data-sources
POST /api/admin/data-sources
POST /api/admin/acquisition/authorize
```

Unknown sources are blocked. Review-only and prohibited sources cannot run automated acquisition or affect valuation.
