# AppDeploy v90 unified scanner release record

## Status taxonomy

- **Deployed:** AppDeploy application `142df297558ace9e22`, applied source snapshot `1785476302989`.
- **Website-routed:** the published Memphis Card Company ManeFlow page embeds the AppDeploy application.
- **Provider-tested:** AppDeploy reported the deployment ready, seven browser QA jobs passed, and no frontend, backend, or network errors were returned in the post-deployment status check.
- **Not canonical-production:** this deployed React/AppDeploy source is not the same application tree as the canonical Node/Python repository and is not tied to this Git commit.
- **Not first-party-domain active:** `app.memphiscardcompany.com` is registered to this AppDeploy app but remains `pending_dns`.

## Deployment identifiers

```text
AppDeploy app ID: 142df297558ace9e22
AppDeploy stage: v2
Applied source snapshot: 1785476302989
Hosted URL: https://142df297558ace9e22.v2.appdeploy.ai/
Requested first-party hostname: app.memphiscardcompany.com
Required DNS record: CNAME app -> proxy-v2.appdeploy.ai
Custom-domain state at verification: pending_dns
```

## Customer-facing change

The scanner now presents one intake surface instead of separate single-card and batch modes.

Supported entry actions in the deployed UI:

- phone camera capture;
- drag and drop;
- multi-file selection;
- folder selection where the browser supports `webkitdirectory`;
- repeated selection of the same file or alternate view;
- progressive per-image processing;
- visible queue count and total bytes;
- safe stop after the current image;
- explicit rejection of non-image files;
- card-spread detection and per-card review results;
- local scanning before sign-in, with optional cloud history.

The customer-facing scanner copy no longer advertises provider credentials, an owner role, or a specific phone brand.

## Count behavior

The v90 UI does not impose an artificial item-count slice on the selected browser queue. This must not be described as infinite capacity.

Actual constraints remain:

- browser memory;
- browser file-system capabilities;
- upload and request limits;
- AppDeploy runtime limits;
- provider rate limits;
- image dimensions and bytes;
- session duration;
- network reliability.

The applied v90 implementation processes selected source images progressively in the browser. It is not a replacement for the canonical repository's authenticated, restart-safe, server-owned durable scan-job implementation. The intended promotion path is to preserve this unified intake experience while submitting work to the canonical durable job API.

## Identity and pricing safeguards

- Results remain draft evidence until reviewed.
- Failed detection falls back to a reviewable unresolved result instead of inventing an identity.
- Card-number, set, player, variant, grader, grade, and certification fields remain editable during review.
- Certification data may corroborate a graded-card result where an authorized provider response succeeds.
- Active marketplace listings are labeled reference-only and do not establish value.
- Completed-sale research is separate from identity evidence.
- Saving a correction does not automatically make an image training-eligible; explicit learning permission and governed review are still required.

## AppDeploy QA scenarios

The deployed `tests/tests.txt` defines seven scenarios:

1. repeated image selections append to one queue;
2. unsupported files are rejected without removing valid files;
3. large queues progress incrementally and can stop safely;
4. an image reaches a reviewable card result;
5. mobile camera intake stays within one responsive flow;
6. collection review controls remain reachable;
7. cloud scan history remains optional.

These are deployment-provider browser tests. They do not replace canonical repository unit, integration, PostgreSQL, security, migration, container, physical-device, accuracy, or endurance gates.

## Reconciliation decision

Preserve the exact applied scanner source under:

```text
deployments/appdeploy/142df297558ace9e22/1785476302989/
```

Do not copy it over canonical production routes without adapting it to:

- authenticated server-owned durable scan jobs;
- private persistent object storage;
- PostgreSQL job/item persistence and tenant isolation;
- canonical identity and pricing contracts;
- rate limiting and abuse ceilings based on bytes, pixels, runtime, and memory;
- release provenance tied to an exact commit;
- the full repository CI gate.

## Remaining release gates

1. Add the DNS CNAME and verify AppDeploy TLS for `app.memphiscardcompany.com`.
2. Complete a real desktop and physical-mobile camera/files/folder scan test.
3. Verify save, close, reopen, sign-out, sign-in, and cross-device persistence.
4. Verify live authorized certification and completed-sale provider responses without exposing credentials.
5. Connect the unified UI to the canonical durable scan-job API.
6. Run an owner-authorized large-folder endurance test and report throughput, retries, failures, P50, and P95.
7. Tie the deployed artifact to an approved Git commit and immutable release manifest.

## Rollback

The website can be returned to the prior AppDeploy release by changing only the ManeFlow page embed after verifying the prior deployment remains healthy. The custom domain is not active while DNS is pending.
