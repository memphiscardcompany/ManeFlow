# ManeFlow AppDeploy v98 detection regression repair — 2026-07-31

## Classification

**Deployed AppDeploy beta hotfix with automated access, UI, queue, and non-card rejection checks. Real-card separation and identification accuracy still require physical-image verification.**

This record preserves the live hosted repair without reclassifying the AppDeploy snapshot as the complete canonical GitHub production application.

## Release identity

- Canonical repository: `memphiscardcompany/ManeFlow`
- AppDeploy application ID: `142df297558ace9e22`
- AppDeploy version: `v98`
- AppDeploy version ID: `1785523021879`
- Created: `2026-07-31T18:37:01.879Z` (`2026-07-31 1:37:01 PM CDT`)
- Hosted application: `https://142df297558ace9e22.v2.appdeploy.ai/`
- Existing website route: `https://www.memphiscardcompany.com/pages/maneflow`
- Canonical `main` at documentation branch creation: `2ec8853f5832c5d7139d6910a89c69bcf4689be8`

The public Shopify page already embeds the stable AppDeploy application hostname. No Shopify theme, navigation, product, or unrelated page change was required for this hosted snapshot update.

## Objective

Repair the scanner regression shown in live use:

- multi-card photos were sometimes retained as one scene-sized unidentified card;
- images without a card could become 0% full-image card records;
- newer secondary verification could erase a useful provisional player or card-family result without finding a concrete contradiction;
- the scanner page contained secondary install/archive controls that distracted from the core workflow.

The target customer flow remains:

`Take photo or choose images → separate actual cards → identify conservatively → review/correct → save`

## Implemented hosted-snapshot changes

### Detection and separation

- Removed the unconditional backend full-image card box when no boundary was detected.
- Removed the frontend fallback that converted every boundary failure into a full-image card result.
- Added a dedicated dense-scene recovery pass for binder pages, trays, grids, and loose-card spreads.
- The recovery pass now runs when:
  - the scene is classified as multi-card;
  - more than one raw boundary is returned;
  - no raw boundary is returned; or
  - the primary detector returns one suspicious scene-sized container box.
- Candidate boxes are processed from smaller to larger so individual card boxes suppress overlapping page/tray container boxes.
- Empty binder pockets, interface chrome, generic rectangles, and non-card regions are instructed to be rejected.
- A scene-sized whole-image fallback is allowed only when structured evidence supports exactly one card and the identification pass completes with card-specific evidence.

### Non-card rejection

- Multi-card and no-card inputs no longer receive an automatic full-image unresolved record.
- Unconfirmed whole-image provider failures return no card result instead of fabricating a review item.
- Detector-confirmed card crops may still be preserved as unresolved during a temporary recognition-capacity failure.

### Non-destructive identity verification

- The automatic catalog resolver and specialist ensemble are advisory when the provisional result contains useful supported identity data and no concrete conflict is found.
- A secondary worker's inability to independently repeat every exact-card anchor no longer erases a useful player or card-family draft by itself.
- Exact-card and exact-variant claims remain withheld when required evidence is incomplete.

### UI simplification

- Removed the scanner-page install panel.
- Removed the scanner-page archive panel from the primary workflow.
- Shortened the scanner heading and explanatory copy.
- Preserved one unified camera/file/folder queue.
- Hidden confidence badges when confidence is zero rather than emphasizing meaningless `0%` labels.
- Internal provider, ensemble, and evidence-engine language remains excluded from customer-facing copy.

## Automated AppDeploy evidence

AppDeploy reported for v98:

- Deployment: `ready`
- E2E: `passed`
- Total jobs: `6`
- Passed jobs: `6`
- Frontend errors: `0`
- Backend errors: `0`
- Network errors: `0`
- QA run group: `69c74297e1f9ecbc`

The automated suite verifies only what its generic image fixture can support:

1. Anonymous visitors cannot access camera or file intake.
2. Signed-in collectors receive the simplified scanner interface.
3. A generic non-card image does not create a fake full-image card record.
4. The upload queue can be cleared without stale results.
5. Mobile anonymous access remains account-gated and responsive.
6. Signing out removes collection and scanner access.

## Test-fixture limitation discovered

AppDeploy's browser QA supplied the same generic `test_image.png` for scenarios previously described as:

- a valid single card;
- a multi-card photo; and
- a non-card screenshot or room photo.

Those scenarios are contradictory when backed by one identical file. The release gate was therefore corrected instead of weakening the product to classify the generic non-card fixture as a card.

No automated passing result is claimed for real card separation or identity from this fixture.

## Mandatory physical-image release gates — not yet verified

The following require original, owner-authorized card photographs:

- One clear single card returns one reviewable draft and saves successfully.
- A nine-card binder page returns individual crops and rejects empty pockets.
- A loose multi-card spread returns one result per supportable physical card and no scene-sized card record.
- Rotated cards are cropped and rectified independently.
- Useful provisional identity remains unless a specific contradiction is found.
- A recognition-capacity failure preserves a detector-confirmed crop without retry amplification.
- A room photo or unrelated screenshot produces no card record.
- Physical iPhone camera, photo-library, progress, correction, save, sign-out, sign-in, and collection reopening work without horizontal overflow.

## Evidence boundaries

This deployment does not prove:

- real-world multi-card recall;
- exact card-count accuracy;
- universal exact identity or exact-parallel accuracy;
- trained production detector improvement;
- production-scale catalog or dense retrieval coverage;
- completed-sale valuation correctness;
- physical iPhone behavior;
- equivalence between AppDeploy source and canonical GitHub application source;
- first-party production PostgreSQL, private object storage, queue, backup, or rollback readiness.

## Rollback

AppDeploy version history remains available. The immediate pre-repair snapshot is v85 (`1785488592515`); intermediate v86-v97 snapshots document the controlled repair attempts. Rollback must preserve the account gate and must not reintroduce unconditional full-image unknown-card creation.

## Canonical next step

Use one clear single-card photograph, one nine-card binder-page photograph, one loose multi-card spread, and one unrelated non-card image to run the mandatory physical release matrix. Record card-count recall, crop quality, identity tier, false positives, latency, and screenshots. Then port compatible fixes into repository-native detector/orchestration code with Node, Python, browser, security, and benchmark gates before treating the behavior as canonical production capability.
