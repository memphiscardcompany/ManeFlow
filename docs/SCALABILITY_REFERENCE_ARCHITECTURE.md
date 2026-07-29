# ManeFlow scalability reference architecture

Status: architecture contract and release gate, not a claim of measured capacity.

ManeFlow must be able to grow from a private beta to a globally distributed service without weakening identity accuracy, tenant isolation, auditability, or honest abstention. Capacity is earned through measured load tests and production evidence. “Millions of users” and “billions of events” are design horizons, not current verified results.

## Non-negotiable invariants

1. Every private record is scoped by an immutable authenticated tenant or owner identity at the database boundary.
2. Every mutation, job, upload, provider event, and outbound action has a stable idempotency identity.
3. Retries are bounded. Ambiguous external outcomes are terminal reconciliation work, never blind retries.
4. Work is admitted against explicit byte, pixel, crop, provider-call, CPU/GPU, and time budgets.
5. Queues are durable, partitionable, observable, and protected by backpressure and dead-letter handling.
6. Interactive APIs never wait for unbounded vision, pricing, provider, or model work.
7. Recognition can abstain. Candidate retrieval and calibration cannot manufacture observed evidence.
8. Releases are bound to an exact commit, schema version, build identity, configuration class, and rollback.
9. Logs, traces, analytics, caches, and exports preserve the same authorization boundary as primary storage.
10. A capacity target is never reported as achieved without the traffic model, hardware, dataset, commit, p50, p95, p99, saturation point, and error rate.

## Scale plane

ManeFlow separates request admission, durable orchestration, compute, evidence, and delivery:

```text
edge admission
  -> stateless API
  -> private object storage + durable job record
  -> partitioned work queues
  -> bounded vision / OCR / pricing workers
  -> evidence and decision ledger
  -> user confirmation
  -> private Vault
```

Meta follows a separate owner-only plane:

```text
signed Meta webhook
  -> exact asset allowlist
  -> replay-safe batch persistence
  -> owner-partitioned conversation queue
  -> draft-only ManeBrain worker
  -> Joshua approval
  -> fenced durable outbox
  -> provider delivery or terminal reconciliation
```

Public ManeFlow traffic and owner-only Meta operations may share reviewed intelligence services, but never sessions, tokens, tenant context, private caches, queues, exports, or authorization.

## Tenant-fair admission

The target admission controller uses a **Costed Work Envelope** for each request. The envelope is calculated before expensive work and records:

- compressed and decoded bytes;
- image dimensions and megapixels;
- predicted crop count;
- OCR and embedding work units;
- provider-call allowance;
- CPU/GPU memory class;
- deadline and cancellation token;
- tenant plan and current concurrency;
- retry and idempotency identity.

Admission is fail-fast when a hard safety limit is exceeded. Otherwise work enters weighted fair queues so one large customer, pathological binder batch, hot Meta thread, or retry storm cannot starve other tenants. The exact scheduler is planned until load tests prove its implementation.

## Data partitioning and persistence

- PostgreSQL remains the transaction authority for accounts, ownership, jobs, evidence, decisions, and audits.
- Row-level security is mandatory on tenant and owner data.
- Hot queues use partial covering indexes and keyset pagination.
- Event and message writes are set-based when a signed provider batch permits it.
- Tables that outgrow a single primary are partitioned first by lifecycle/time and then by stable tenant hash when measurements justify it.
- Cross-region replicas are read-only unless a documented ownership or conflict protocol exists.
- Object storage keys contain opaque tenant scope and immutable content identity; access uses short-lived authorization.
- Vector indexes store authorized catalog candidates only. They do not become ground truth or a cross-tenant data channel.
- Cache keys include authorization scope, data version, model version, and evidence policy version.

## Worker and queue contract

Every worker:

- claims with a lease and fencing token;
- renews only while it owns the same fence;
- writes state transitions transactionally;
- honors deadlines and cancellation;
- uses bounded concurrency and memory;
- distinguishes permanent rejection, retryable pre-acceptance failure, and ambiguous external outcome;
- emits redacted structured telemetry;
- can be restarted without losing or duplicating accepted work.

Queue lag, oldest age, retry count, dead-letter rate, saturation, and per-tenant fairness are release metrics. Autoscaling must use both resource saturation and queue age; CPU alone is insufficient.

## Recognition at scale

The Evidence-Bounded Selective Matcher is the decision boundary:

- visual/vector similarity is candidate-prior evidence, not observed identity;
- OCR, visible card number, checklist agreement, slab label, serial evidence, and official certification data remain source-tagged;
- critical conflicts force abstention;
- an empty explicit scope never falls back to the global catalog;
- automatic acceptance requires a versioned held-out calibration artifact;
- weak evidence cannot be promoted by calibration;
- every accepted, reviewed, or abstained result records stable reason codes.

The pipeline should progressively narrow candidates before expensive OCR or provider access. Models, indexes, catalog snapshots, calibration, and policy versions are immutable per job so results remain reproducible during rolling releases.

## SLO classes

Initial targets must be validated before public commitments:

| Class | Example | Target behavior |
|---|---|---|
| Interactive API | login, Vault read, job status | low latency, strict availability, no expensive inline work |
| Intake | upload admission and durable acceptance | bounded by bytes, returns after durable persistence |
| Vision | single card, slab, binder, batch | asynchronous, deadline-aware, separately measured by workload |
| Pricing | completed-sale evidence | source-aware degradation and explicit unavailable state |
| Meta inbound | signed webhook | fast durable acknowledgement after validation |
| Meta outbound | approved reply | exact job identity, fenced delivery, no blind ambiguous retry |

For each class report p50, p95, p99, error rate, timeout rate, queue age, saturation, hardware, region, release commit, and workload distribution. Tail latency and false-confident recognition rate are primary release signals.

## Failure containment

- Pricing failure does not erase identification or Vault access.
- Vision failure preserves a private queued job or returns an honest failure without invented results.
- Provider outages use circuit breakers with jittered bounded backoff and per-provider bulkheads.
- Kill switches are subsystem-specific; Meta can stop without disabling public ManeFlow.
- Schema changes are expand/contract, backward compatible through the rollback window, and verified before traffic migration.
- Deployments use canaries, immutable release metadata, automated health gates, and a tested rollback.
- Region, queue, provider, model, and catalog failures have independent health signals and runbooks.

## Required scale evidence

Before claiming a capacity tier, run:

1. steady-state and burst tests with realistic tenant skew;
2. large-image and decompression-bomb admission tests;
3. hot-tenant fairness and retry-storm tests;
4. database failover, queue restart, worker crash, and provider timeout tests;
5. cache-key and cross-tenant isolation tests under concurrency;
6. recognition accuracy and abstention tests under load;
7. cost-per-successful-card and cost-per-provider-event measurements;
8. sustained soak tests long enough to expose connection, memory, and queue leaks.

Publish only reproducible evidence. Current automated correctness tests establish invariants; they do not establish internet-scale throughput.
