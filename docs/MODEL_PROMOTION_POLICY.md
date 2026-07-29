# Model Promotion Policy

Promotion states:

```text
EXPERIMENTAL -> CANDIDATE -> VALIDATED -> STAGING -> PRODUCTION
                         \-> REJECTED
PRODUCTION/STAGING -> RETIRED
```

A model may advance only when:

1. Data use is authorized and provenance is complete.
2. Artifact and dataset checksums match.
3. Training is reproducible from the recorded commit/configuration/seed.
4. Locked-test exact identity improves or is statistically equivalent.
5. False-confident identifications do not increase.
6. Abstention remains honest.
7. Important subgroup performance does not materially regress.
8. Latency and memory remain within documented budgets.
9. CPU fallback still works.
10. Rollback is tested.

Training loss alone is not promotion evidence. A nearest visual match is not proof of identity. OCR text is not official cert verification. Production predictions and pseudo-labels never become automatic ground truth.
