---
title: Platform Import Reliability — System Design & Migration Plan
status: proposed
date: 2026-07-13
origin: docs/investigations/2026-07-13-telegram-import-investigation.md
---

# Platform Import Reliability — System Design & Migration Plan

## Decision requested
Approve this plan before implementation. This document intentionally contains no production changes.

## Problem frame
Telegram and Discord imports are currently implemented as synchronous bulk requests with local-only imported provenance. The investigation established five independent correctness failures:

1. Telegram discovery can omit valid sessions because discovery is filename-constrained, non-recursive, cached, silently lossy, and non-paginated at the Gateway boundary.
2. Imported history can remain empty because source-key Gateway fallback is not consistently used during bootstrap or imported older-page misses.
3. Imported identity is lost when local compat state is rebuilt; Gateway sync then treats migrated sessions as ordinary desktop sessions.
4. Progress is terminal-only UI state, not actual import work.
5. Import performance is dominated by synchronous parsing/transcript/SQLite work, while detached prewarm work is unbounded relative to foreground work.

## Scope boundaries

### In scope
- Telegram and Discord scan/import correctness.
- Durable imported-session provenance and dedicated platform spaces.
- Gateway-first fallback for imported history with transcript fallback retained.
- Selected-session asynchronous import jobs with actual stage progress.
- Bounded import pipeline and prewarm queue.
- Import UX, cancellation, retry, partial success, and regression coverage.

### Explicitly out of scope
- Deleting canonical Gateway source sessions as part of import cleanup.
- Changing unrelated normal desktop-chat behavior.
- Claiming Discord archive parity before Discord archive sources are designed.
- Migrating user-created spaces based on display names.

## Target architecture

```text
UI scan
  -> immutable scan snapshot (scanId)
  -> selected sourceSessionKeys
  -> platform import job
     -> source read
     -> bounded Gateway session creation
     -> bounded transcript write
     -> serialized projection + compat commit
     -> background bounded archive-prewarm queue
  -> job status + sequenced SSE events
  -> sidebar refresh after at least one committed outcome

Gateway metadata <-> v2_import_provenance <-> compat projection
                           |
                           +-> stable platform-marked space

Chat open
  -> local projection
  -> desktop-key Gateway history
  -> imported source-key Gateway projection on local/desktop miss
  -> transcript hydration fallback
```

## Cross-cutting design decisions

1. **Gateway is canonical for canonical source sessions.** Local SQLite remains the fast projection/cache. Transcript archives remain a required fallback for source sessions missing from Gateway.
2. **Imported provenance becomes durable.** `v2_compat_state` is a display projection, not the identity authority.
3. **Platform space identity is marker-based, never name-based.** A user-created `Telegram` space is never adopted.
4. **Scan snapshots make imports deterministic.** An import job can only import keys from its selected scan snapshot.
5. **Progress is evented work completion.** No timer-based or artificial percentage.
6. **Existing synchronous import endpoints remain compatibility wrappers** until the job API is proven and rolled out.
7. **Imported deletion remains local-only.** Durable tombstones stop Gateway sync from resurrecting a locally deleted import; explicit re-import is the only revival path.

---

# Phase 1 — Correctness

## A. Telegram Discovery

### Root cause
`scanTelegramSessions` merges disk, Gateway, and transcript sources, but transcript discovery only accepts `topic-<number>.jsonl*` from a small non-recursive root set. Gateway is called once with no cursor handling. Errors become empty results and scan limits slice unsorted results.

### Owned modules
- `apps/middleware/src/features/compat/routes.ts`
  - transcript discovery helpers
  - `gatewayTelegramSessionEntries`
  - `scanTelegramSessions`
- `apps/middleware/tests/telegram-discovery.test.ts` (new)

### Design change
- Walk configured session/archive roots recursively.
- Treat parsed Telegram metadata or exact disk-index association as identity; filename is only a hint.
- Page Gateway `sessions.list` when its response exposes a continuation contract. If a continuation request fails or is unavailable, return an additive diagnostic showing source completeness rather than silently claiming success.
- Deduplicate by canonical source key and retain all related archive files.
- Deterministically sort by `updatedAt DESC, sourceSessionKey ASC` before applying `limit`.
- Extend scan responses additively with source counters and structured partial failures while preserving `sessions`, `summary`, and `groups`.

### Dependencies
None. This unit may run in parallel with C.

### Risks and rollback
- Gateway cursor protocol may differ from assumptions. Gate pagination on documented response fields and preserve partial diagnostics.
- Broader file walk can discover unrelated JSONL. Require metadata/index validation before accepting a candidate.
- Rollback: retain current scan route contract; disable new source walker behind an internal feature flag if needed.

### Tests and acceptance criteria
- Multi-page Gateway lists are fully requested and deduplicated.
- Nested, direct, and non-`topic-*` valid Telegram transcripts are discovered.
- Metadata wins over filename disagreement; unidentifiable files are rejected and reported.
- Filesystem/Gateway failure returns remaining source data plus diagnostics.
- Repeated/limited scans are stably ordered.
- **Acceptance:** no known filename-only discovery loss, no silent source failure, no order-dependent limit result.

---

## B. Imported History Loading

### Root cause
Bootstrap sends `chat.history` with the imported desktop key. `ensureGatewayHistoryProjected` can resolve the imported source key and cache under the desktop key, but bootstrap does not call it. Imported paginated misses currently skip Gateway fallback after failed local hydration.

### Owned modules
- `apps/middleware/src/features/chat/routes.ts`
  - bootstrap history load
  - `ensureGatewayHistoryProjected`
  - `/api/chat/messages` refill paths
- `apps/middleware/tests/imported-history-fallback.test.ts` (new)

### Design change
- Keep desktop-key history first for continued/new desktop sessions.
- When an imported session has no normalized desktop history, no archive hydration, and no local projection, resolve its source key and project Gateway history under the desktop key.
- Apply the same source-key projection for imported older-page misses.
- Return additive diagnostic reasons (`desktop_empty`, `local_hydrated`, `source_gateway_projected`, `source_gateway_empty`, `source_gateway_failed`) without changing existing success/error semantics.
- Never project source data under the source key for an imported desktop open; preserve non-imported behavior and anti-prune protections.

### Dependencies
Requires C’s durable source-key resolver to be integrated first.

### Risks and rollback
- Source Gateway history may be empty while transcript is authoritative. Keep transcript hydration before source fallback.
- A source-key error must not fail normal chat open. Keep fallback non-fatal and observable.
- Rollback: disable source fallback without changing local/transcript behavior.

### Tests and acceptance criteria
- Empty local + empty desktop history + source history produces bootstrap messages and desktop-key cache.
- Imported older-page miss uses source history and returns requested page.
- Empty/error source history is non-fatal and observable through reason metadata.
- Normal desktop sessions retain desktop-key-only behavior.
- Existing local import projection is preserved and not pruned/replaced by source fallback.
- **Acceptance:** an imported chat is empty only when local, transcript, and source Gateway history are all genuinely unavailable/empty.

---

## C. Durable Imported Identity and Migration

### Root cause
`importedFrom` lives only in local compat JSON. After reset/rebuild, `syncGatewaySessionsUncached` sees `migrated-*` sessions as generic desktop sessions and writes them into fallback/default placement without imported provenance.

### Owned modules
- `apps/middleware/src/db/migrate.ts`
- `apps/middleware/src/app.ts`
- `apps/middleware/src/features/compat/routes.ts`
- `apps/middleware/src/features/migration/provenance-repository.ts` (new)
- `apps/middleware/src/features/migration/runtime.ts` (new)
- `apps/middleware/tests/imported-identity-migration.test.ts` (new)
- `apps/middleware/tests/app.test.ts`

### Schema and migration
Bump schema version additively and create `v2_import_provenance` (or `v2_imported_session_identity`, final naming selected once):
- `desktop_session_key` primary key
- `platform_kind`
- `source_session_key`
- optional `source_session_id`
- `platform_space_id`
- lifecycle (`active`, `local_delete_tombstone`)
- metadata version, created/updated timestamps
- unique `(platform_kind, source_session_key)`

Startup migration backfills existing active compat `importedFrom` records idempotently. Compat JSON keeps `importedFrom` as a backward-compatible display cache; provenance table is authoritative.

For new imports, persist validated migration provenance in Gateway session metadata as well as SQLite, e.g. `metadata.openclawDesktop.migration = { version, platform, sourceSessionKey }`. During Gateway sync, reconstruct imported placement from durable table or metadata before creating a generic desktop session. Legacy random-key imports use table-backed recovery; key-prefix-only legacy records receive an explicit unresolved-provenance diagnostic instead of silent generic classification.

### Dedicated-space rule
`ensureImportedPlatformSpace` may reuse only a provenance-marked platform space. It must never adopt or relabel a user space solely because of the name Telegram/Discord.

### Dependencies
C is the Phase 1 foundation. B requires its resolver. D consumes its provenance/space runtime.

### Risks and rollback
- Gateway metadata/key constraints must be validated before rollout.
- Tombstone omission would resurrect local-only deletes; treat as release-blocking test.
- Schema is additive; old JSON stays intact. Rollback disables reconstruction/metadata use while table and legacy behavior remain readable.

### Tests and acceptance criteria
- Legacy JSON imports backfill identity idempotently.
- Restart/reset plus Gateway sync restores imported source mapping and platform placement.
- User-created same-name platform space is untouched.
- Local delete never sends Gateway deletion and sync does not resurrect; explicit re-import revives once.
- Ordinary/project-scoped desktop sessions are unchanged.
- **Acceptance:** known imported chats never become normal fallback-space chats after restart, reset, rebuild, migration, or sync.

---

# Phase 2 — Architecture

## D. Dedicated Imported Platform Spaces

### Root cause
Current dedicated-space behavior is correct only while local compat provenance survives; space reuse is display-name-based.

### Owned modules
Primarily C’s provenance/space modules. D does not open a competing edit stream in `compat/routes.ts`; it follows C integration.

### Design change
Create stable provenance-marked platform spaces:

```text
Workspace
├── Telegram Imports
├── Discord Imports
├── WhatsApp Imports
└── Slack Imports
```

Imported chats remain flat in their platform space (`projectId:null`, `topicId:null`). Platform names are presentation labels; immutable marker/ID is identity. Current active project/space is never a fallback for an import.

### Acceptance
- Each platform has at most one active provenance-marked import space per workspace policy.
- User-created spaces with equivalent names are not reused.
- Imported records preserve platform source linkage through reset/re-sync.

---

## E. Scan Snapshots and Actual Progress Jobs

### Root cause
Import currently posts `{}`, imports all scan results, blocks on one terminal response, and UI then runs a second scan. There is no job, stage, event, selection, retry, or cancellation model.

### Owned modules
- `apps/middleware/src/features/migration/types.ts` (new)
- `apps/middleware/src/features/migration/scan-store.ts` (new)
- `apps/middleware/src/features/migration/jobs.ts` (new)
- `apps/middleware/src/features/migration/routes.ts` (new)
- `apps/middleware/src/features/compat/migration-jobs.ts` (alternative location resolved during implementation; create one canonical module only)
- `apps/middleware/src/features/compat/routes.ts` adapters only
- `apps/middleware/tests/migration-jobs.test.ts` (new)
- `apps/middleware/tests/app.test.ts`

### API contract
- `POST /api/migration/:platform/import-jobs` → `202 { job }`
  - input `{ scanId, sourceSessionKeys }`
  - keys must be selected from immutable short-lived scan snapshot
- `GET /api/migration/import-jobs/:jobId` → current/recoverable snapshot
- `GET /api/stream/migration/import-jobs/:jobId` → sequenced SSE events
- `POST /api/migration/import-jobs/:jobId/cancel`
- `POST /api/migration/import-jobs/:jobId/retry` → job limited to failed/cancelled keys

Job snapshot includes job/platform/status/stage, `totals { planned, started, completed, imported, skipped, failed, cancelled }`, current session, outcomes, stage timings, prewarm state, sequenced bounded redacted logs, timestamps, and ETA only after enough completed-item timing data.

States: `queued → preparing → running → finalizing → succeeded|partial|failed|cancelled`.

Existing synchronous `POST /api/migration/:platform/import` remains as a compatibility wrapper returning its existing terminal `{ imported, skipped, failed, summary }` response.

### Progress semantics
Emit actual boundaries: resolve, source read, Gateway create, transcript write, projection write, compat commit, finalize. Prewarm is separately queued/running/completed and never inflates foreground completion.

### Dependencies
Requires C runtime/provenance seam. F consumes jobs/types. G consumes API/SSE contract.

### Risks and rollback
- In-memory job state is lost on middleware restart. Return explicit recoverable job-unavailable state; completed imports remain idempotent. Durable job persistence is a later enhancement.
- SSE is acceleration, not authority: UI polls status on reconnect.
- Rollback UI to synchronous compatibility endpoints; no imported data deletion.

### Tests and acceptance criteria
- Job starts immediately and honors exactly selected keys.
- Duplicate concurrent platform job rejected.
- State/events sequence monotonically; reconnect retrieves terminal state.
- Cancel stops scheduling new sessions but preserves completed atomic sessions.
- Retry selects only failed/cancelled keys.
- Legacy endpoint schema unchanged.
- **Acceptance:** no client needs to wait 120 seconds for a terminal import response; progress reflects completed work only.

---

## F. Bounded Import Pipeline

### Root cause
Only Gateway create overlaps. Source parsing, transcript writing, normalization, and SQLite persistence use synchronous work; detached archive prewarm can compete after the import reports complete.

### Owned modules
- `apps/middleware/src/features/migration/import-executor.ts` (new)
- `apps/middleware/src/features/migration/import-pipeline.ts` (new)
- `apps/middleware/src/features/migration/prewarm-queue.ts` (new)
- `apps/middleware/src/features/chat/repo.messages.ts`
- `apps/middleware/tests/migration-pipeline.test.ts` (new)
- `apps/middleware/tests/repo.messages.import.test.ts` (new)

### Design change
Bound stages explicitly:

```text
scan snapshot
  -> Gateway create queue (2)
  -> transcript-write queue (2)
  -> serialized SQLite projection + compat commit (1)
  -> archive-prewarm queue (1, background)
```

Use a dedicated fresh-import repository transaction rather than replay/collision-heavy live `upsertMessages` path; retain existing generic upsert for live/replay traffic. Normalize in chunks with cooperative yields. Record stage duration, bytes, messages, queue depth, actual upserts, and prewarm outcome.

### Dependencies
Requires C provenance runtime and E job events/types.

### Risks and rollback
- Concurrency values are initial safety bounds, not performance promises; benchmark before increasing.
- Fresh-import fast path must be idempotent and not alter live projection semantics.
- Rollback use generic projection path and disable background queue; preserve data.

### Tests and acceptance criteria
- Fixtures prove each stage respects configured concurrency.
- Large archived fixture (~6.7k messages) produces correct transcript/projection/outcome/timing.
- Existing source re-import remains idempotent.
- Prewarm begins after foreground commit and cannot delay terminal job result.
- One item failure does not stop unrelated selected sessions.
- **Acceptance:** bounded real work, measurable stage timings, no unbounded detached prewarm competition.

---

# Phase 3 — UX and Discord Parity

## G. Import UX

### Owned modules
- `packages/ui/lib/sessionMigration.ts` (new)
- `packages/ui/components/settings/tabs/HelpTab.tsx`
- `packages/ui/lib/ipc.ts`
- `packages/ui/app/api/stream/migration/[jobId]/route.ts` (new)
- `packages/ui/lib/__tests__/sessionMigration.test.ts` (new)
- `packages/ui/lib/__tests__/ipc-new-backend.test.ts`

### Design change
- Show scan-result selection with checkboxes, Select all importable, selected count, and immutable already-imported rows.
- Never send an empty import request.
- Start a selected-key job; do not block on post-import scan.
- Render current stage, completed/selected count, current label, valid ETA, bounded redacted live logs, Cancel, Retry failed/cancelled, and terminal breakdown.
- Subscribe via SSE, but recover status through endpoint polling/reconnect.
- Refresh sidebar/bootstrap only when at least one import succeeds.

### Acceptance
- Progress monotonic; terminal totals account for every selected key.
- SSE drop cannot lose final result.
- Retry never recreates successful imports.
- No message body/token/raw transcript appears in logs or errors.

## H. Discord parity

### Owned modules
- `apps/middleware/src/features/compat/routes.ts` Discord adapter after E job controller is integrated
- `apps/middleware/tests/migration-jobs.test.ts`
- `apps/middleware/tests/app.test.ts`

### Decisions
- Required now: selected imports, job/progress contract, cancel/retry/partial outcomes, dedicated spaces, idempotency, history fallback, diagnostics.
- Use shared bounded runner interface but keep Discord import concurrency at one until measured benchmark approval.
- Discord declares archive warmup unsupported until its archive source/discovery design exists; do not claim parity by omission.

### Acceptance
- Telegram and Discord provide identical job outcome semantics and imported-space behavior.
- Differences are exposed as capability/diagnostic metadata, not hidden.

---

# Phase 4 — Regression and release gate

## QA ownership
QA starts characterization tests alongside every unit and owns integrated validation after units merge. QA does not edit implementation-owned modules.

### New/extended automated coverage
- `apps/middleware/tests/telegram-discovery.test.ts`
- `apps/middleware/tests/imported-history-fallback.test.ts`
- `apps/middleware/tests/imported-identity-migration.test.ts`
- `apps/middleware/tests/migration-provenance.test.ts`
- `apps/middleware/tests/migration-jobs.test.ts`
- `apps/middleware/tests/migration-pipeline.test.ts`
- `apps/middleware/tests/repo.messages.import.test.ts`
- `packages/ui/lib/__tests__/sessionMigration.test.ts`
- `packages/ui/lib/__tests__/ipc-new-backend.test.ts`
- `tests/migration-import.spec.ts` (browser: scan, subset select, progress, partial failure, retry, spaces)

### Mandatory unchanged regressions
- imported-session 160-window tests in `apps/middleware/tests/app.test.ts`
- `packages/ui/lib/__tests__/telegramReliability.phase4.matrix.test.ts`
- middleware live stream tests
- ChatView virtualization/order tests

### Release scenarios
1. Telegram scan: nested, direct, archived, transcript-only, paginated Gateway results, partial failure.
2. Discord scan/import capability behavior.
3. New install / empty DB.
4. Existing legacy import upgrade.
5. Middleware restart, app reset, Gateway reconnect.
6. Imported local deletion and explicit re-import.
7. Empty local history, source Gateway history, transcript fallback, older pagination.
8. Large import with timing/concurrency assertions.
9. UI subset selection, progress, cancel, retry, partial success, SSE reconnect.
10. User-created same-name space remains untouched.

### Quality gates
- Targeted middleware/UI tests first.
- `pnpm --filter @openclaw/desktop-middleware typecheck`
- `pnpm --filter ui typecheck`
- relevant middleware test suites and browser import flow
- `git diff --check`
- build/smoke only after focused tests pass; no claim of browser evidence if host memory blocks it.

---

# Dependency graph and execution order

```text
C durable provenance
├─ A discovery correctness (parallel)
├─ B imported history fallback
└─ D platform spaces

C + D -> E import jobs/snapshots/events
E -> F bounded executor/prewarm queue
E -> G import UX
E -> H Discord job adapter
A + B + C + D + E + F + G + H -> QA integration/release gate
```

## File-conflict ownership
- `apps/middleware/src/features/compat/routes.ts` is a merge hotspot.
  - A owns discovery helpers and scan assembly only.
  - C owns provenance, imported lifecycle, space normalization, and Gateway sync.
  - E owns endpoint extraction/adapters and job-controller integration after C lands.
  - H owns only Discord adapter changes after E lands.
- B owns `apps/middleware/src/features/chat/routes.ts`.
- F owns new migration executor/pipeline modules and fresh-import repository path.
- G owns UI modules and migration SSE proxy.
- QA owns test-only additions/edits, coordinated to avoid fixture conflicts.

## Rollout and rollback posture
- Ship behind internal migration-job UI enablement until legacy sync endpoints pass parity regression.
- Keep synchronous import endpoints as compatibility wrappers through rollout.
- Schema migration is additive; old compat metadata remains readable.
- Do not delete source Gateway sessions during rollback or import failure.
- If job API fails, UI returns to synchronous compatibility endpoint; successful imported records remain intact.

## Approval gate
Implementation starts only after approval of:
1. additive provenance schema and Gateway migration metadata;
2. job/SSE API contract and in-memory restart behavior;
3. source-key imported history fallback;
4. staged delivery order C/A → B/D → E → F/G/H → QA.
