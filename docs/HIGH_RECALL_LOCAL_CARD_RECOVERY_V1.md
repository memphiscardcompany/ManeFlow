# High-Recall Local Card Recovery V1

## Objective

Preserve clear card photographs that the strict primary detector misses because of low contrast, glare, sleeves, top loaders, holder edges, or incomplete card boundaries.

The recovery path is local, deterministic, bounded, and review-only. It does not call a remote generative model and it cannot create an Exact identity.

## Pipeline position

```text
learned local detector, when configured
→ approved remote detector, when configured
→ strict OpenCV contour detector
→ bounded local high-recall recovery, only when explicitly allowed
→ Review Required
```

The recovery path never replaces a valid primary detection. It runs only when the preceding detector routes return no region and the caller explicitly enables whole-image recovery.

## Evidence

The implementation combines:

- several edge thresholds;
- CLAHE-assisted low-contrast edge recovery;
- Sobel-gradient proposals;
- card-compatible aspect-ratio scoring;
- rectangularity;
- center proximity;
- area support;
- appearance entropy and color diversity;
- long-line structure;
- overlap and containment deduplication.

## Safety boundaries

Every recovered region has:

```text
detector_name: opencv_recovery_v1.0
kind_hint: possible_card_requires_review
confidence: no greater than 0.72
```

Recovered regions must remain reviewable. They may supply physical-card evidence and a crop, but they may not independently support:

- Exact identity;
- exact card number;
- exact parallel or variation;
- grade;
- certification;
- market value.

Blank card-ratio images, generic desktop panels, very small inputs, and ultra-wide banners remain rejected.

## Validation performed before opening the pull request

The complete Python vision suite passed locally:

```text
63 passed
```

A small owner-controlled Drive diagnostic included five heterogeneous source images. Four continued through the existing primary contour detector. One small card-ratio JPEG that the primary detector missed was retained by `opencv_recovery_v1.0` as `possible_card_requires_review` in approximately 19 ms of local detector processing.

Those measurements are diagnostic only. They do not establish full-corpus recall, exact-card accuracy, production latency, or competitor superiority.

## Promotion requirements

Before enabling this path in a canonical live deployment:

1. Complete GitHub CI on the exact pull-request head.
2. Run the locked Ohtani batch and protected negative set.
3. Confirm zero silent source drops.
4. Measure source-retention recall, no-card false positives, duplicate rate, and latency.
5. Confirm that recovered regions cannot become Exact without independent evidence.
6. Deploy behind a rollback-capable release flag.
7. Tie the deployment to an exact Git commit and artifact digest.
