# Vision Release Quality Gates

The development roadmap requires a human-labeled evaluation corpus before ManeFlow can make broad accuracy claims. The PDF specifies at least 10,000 reference images before claiming superior recognition performance. ManeFlow therefore keeps three explicit gate profiles:

- `private_beta`: controlled internal and invited-user testing
- `production`: broad shop deployment
- `superiority_claim`: prerequisite evidence before any named competitor comparison

The numeric thresholds in `config/vision-release-gates.json` are ManeFlow internal quality policy. They are intentionally stricter at each profile and can only be changed through a reviewed release decision.

## Benchmark manifest

Create a manifest that validates against:

`integrations/vision-benchmark-manifest.schema.json`

Every metric is a fraction between 0 and 1 except latency, which is milliseconds. Every evidence file must include its SHA-256 digest. The gate scorer verifies evidence integrity by default.

## Run the gate

```bash
npm run vision:gate -- \
  --manifest reports/vision-benchmark-manifest.json \
  --profile private_beta \
  --out reports/private-beta-gate.json
```

A nonzero exit status blocks the release. Missing metrics also block the release; they are never silently treated as passing.

## Required metrics

- Raw card detection recall
- Slab identity and certification accuracy
- Multi-card segmentation recall
- Exact identity top-1 accuracy
- Exact parallel/variant accuracy
- False-confident match rate
- Duplicate-grouping F1
- Edge p95 inference latency
- Cloud fallback p95 latency

## Competitor claims

Passing `superiority_claim` is necessary but not sufficient. A public comparison must also:

- Use identical images for every product
- Use currently available product versions
- Record date, plan, device, and network conditions
- Preserve raw outputs and correction behavior
- Publish unresolved cases and failures, not only successes
- Avoid reverse engineering or unauthorized access
