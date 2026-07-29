# ManeFlow Data Health Workbench

The Data Health Workbench is the owner/admin view for determining whether ManeFlow can make trustworthy public value claims.

## What it reports

- Total comps
- Demo comps
- Production comps
- Authorized comps
- Unauthorized comps
- Active listings detected and excluded
- Missing sale dates
- Missing all-in prices
- Comps needing review
- Provider coverage and rights status
- Stale providers
- Cards with no comps
- Cards with only demo comps
- Cards with low-confidence valuations
- Cards with high outlier rates

## Launch boundary

The workbench intentionally blocks public-value readiness if demo mode is enabled, if production completed-sale feeds are absent, if active listings appear in comps, or if comps lack dates/prices/authorization.
