# ManeFlow AppDeploy v98 mixed-queue rejection patch — 2026-07-31

## Classification

**Deployed hosted-beta behavior, source-inspected and covered by the existing AppDeploy access/non-card QA suite. Physical-card accuracy remains unverified until owner-authorized real images are run through the release matrix.**

This record supplements `MANEFLOW_APPDEPLOY_V98_DETECTION_REPAIR_2026-07-31.md` and preserves the final queue behavior added after the core detection regression repair.

## Deployment identity

- AppDeploy application ID: `142df297558ace9e22`
- Hosted application: `https://142df297558ace9e22.v2.appdeploy.ai/`
- AppDeploy release: `v98`
- Version ID: `1785523021879`
- Website route already embedding the stable application hostname: `https://www.memphiscardcompany.com/pages/maneflow`

## Objective

A source-image queue may contain a mixture of:

- one or more valid card photographs;
- screenshots;
- room or collection-overview photographs;
- images where no individual physical-card boundary can be supported.

The scanner must preserve valid card results while rejecting unrelated source images. It must not convert a rejected source image into a `0%` unknown card, and it must not discard valid cards merely because another source image in the same queue was rejected.

## Implemented behavior

The deployed `CardScannerV2` queue now:

1. tracks source images that produce zero valid card crops;
2. keeps valid detector-confirmed card results from the same queue;
3. reports the exact number of rejected source images after processing;
4. creates no collection record for rejected screenshots, room photos, or collection-overview images;
5. preserves an unresolved retryable result only for a detector-confirmed physical-card crop when recognition temporarily fails;
6. returns explicit guidance when the complete queue contains no valid individual card.

Customer-facing mixed-queue guidance:

> `N image(s) were skipped because no individual physical card was detected. Valid card results from the same batch remain available.`

Customer-facing empty-result guidance:

> `No individual cards were detected. Use a brighter, closer photo with visible card edges; photograph binder pages square to the page. Collection overview photos and screenshots are not saved as cards.`

## Source-level safeguards verified

The deployed source was read back and confirms:

- `skippedImages` is incremented only when a source image yields no accepted result;
- the final result list is assembled independently from the rejected-source count;
- no unconditional full-image unknown-card record is inserted;
- whole-image recovery accepts only exactly one single-card result with useful card evidence;
- detector-confirmed crops are rejected when the recognition result says the crop contains zero or multiple physical cards;
- the secondary specialist ensemble preserves a useful provisional identity when no concrete conflict is found;
- unconfirmed whole-image recognition failures return no card result;
- detector-confirmed crop failures can remain available for recheck without inventing identity fields.

## Automated evidence

The current AppDeploy suite reports:

- deployment status: `ready`;
- E2E jobs: `6/6 passed`;
- frontend errors: `0`;
- backend errors: `0`;
- observed network errors: `0`.

The suite directly verifies that its generic non-card fixture creates no card result and displays the no-card guidance. The suite also verifies the account gate, simplified signed-in scanner, reversible queue clearing, mobile signed-out privacy, and sign-out isolation.

## Verification boundary

The automated fixture is not an owner-authorized physical-card benchmark. Therefore, this patch does not claim:

- successful exact identification of a real card;
- binder-page card-count recall;
- loose-spread recall;
- exact parallel accuracy;
- physical iPhone camera success;
- completed-sale valuation correctness.

Those claims require the documented physical-image matrix using original card photographs.

## Canonical integration requirement

The hosted AppDeploy code and the repository-native ManeFlow application use different implementations. This document records the required invariant for the canonical detector/orchestration path:

```text
valid card results = accepted detector-confirmed single-card crops
rejected source images = source images producing zero accepted crops
unknown card records != rejected source images
```

Repository-native implementation must preserve that invariant, add automated Node/Python tests, and pass the full release gate before the hosted fix is treated as canonical production capability.
