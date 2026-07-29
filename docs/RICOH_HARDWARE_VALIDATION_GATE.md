# Ricoh Hardware Validation Gate

ManeFlow cannot certify Ricoh production readiness without running actual duplex batches on the target scanner. This gate converts each physical beta run into repeatable evidence.

## Required runs

Run these three batches on each supported scanner/computer combination:

1. **Calibration batch:** 25 low-value cards.
2. **Operational batch:** 250 cards containing mixed eras, finishes, thicknesses, and dark/light borders.
3. **Sustained batch:** at least 1,000 physical cards, with refill operation and ordinary shop interruptions.

Keep raw scan outputs until the batch report and review queue have been approved.

## Command

From the repository root:

```bash
npm run vision:ricoh:benchmark -- \
  --folder "D:/ManeFlow-Ricoh-Test/Batch-001" \
  --pairing-strategy auto \
  --run-detector \
  --elapsed-seconds 240 \
  --out reports/ricoh-batch-001.json \
  --csv reports/ricoh-batch-001-images.csv
```

`--elapsed-seconds` is the physical scan duration from first feed to final captured image. Do not include manual review time.

## Initial beta acceptance targets

- Duplex pairing coverage: **>= 99%**
- Decode success: **100%**
- Images scoring below 70: **<= 5%**
- Identical front/back pairs: **0**
- Accidental duplicate hashes: **0**, unless the physical batch intentionally contains duplicate scans
- Physical throughput: **>= 40 cards/minute** for the 250-card batch
- No card damage, jams, or unexplained feeder stoppage
- Every missing or low-confidence identity must appear in the review queue

These targets validate software intake and scanner workflow. They do not validate exact-card identity accuracy; identity is measured by the separate labeled recognition benchmark.

## Safety and provenance

- Use low-value cards first.
- Follow the scanner manufacturer's media and thickness guidance.
- Record scanner model, driver version, DPI, duplex mode, operating system, CPU/GPU, and whether double-feed detection was adjusted.
- Do not automatically contribute a friend's scans to model training. Contribution requires explicit consent and owner approval through ManeFlow's curation workflow.
