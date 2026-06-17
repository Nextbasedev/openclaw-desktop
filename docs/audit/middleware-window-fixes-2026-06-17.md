# Middleware Window Fixes — 2026-06-17

Branch: `v6-1-krish-window-stabilize` (20 commits ahead of `v6-1-krish`).

## Commits (this branch, oldest → newest)

| SHA | Subject | Bug ref |
| --- | --- | --- |
| `f8259870` | fix(chat): use per-session seq for evicted-patch drop check | Frontend wave-1 |
| `7973da41` | fix(chat): prefer server pagination flags over count heuristic | Frontend wave-1 |
| `b968c177` | fix(chat): skip seqless rows when deriving window cursors | Frontend wave-1 |
| `d582cdb0` | fix(middleware): add over-fetch window loop and envelope metadata to /api/chat/messages | Bug 1 + Bug 2 |
| `942a35c0` | feat(chat): runtime window-state invariant assertions | Frontend wave-1 |
| `5fb11a11` | fix(middleware): route all read paths through canonical isVisibleMessage predicate | Bug 3 |
| `b27ca140` | docs(audit): wave-1 frontend window fixes report | docs |
| `aaacdcea` | fix(middleware): mark live-assistant placeholders so isVisibleMessage drops them | Bug 4 |
| `75e61ad1` | test(middleware): update live-delta bootstrap assertion to reflect placeholder filtering | test fix-up |
| `b2627729` | fix(chat): strict newer-page eviction with bottom-proximity guard | Frontend wave-2 |
| `a066a5ef` | docs(audit): wave-2 frontend window fixes report | docs |
| `d0eb58a9` | fix(middleware): persist and bump seqEpoch on every openclaw_seq mutation | **Bug 5** |
| `6a01f183` | fix(middleware): guard seq epoch read for stub context unit tests | **Bug 5 follow-up** |
| `43146328` | docs(audit): deep static verification report | docs |
| `ab2856d3` | fix(chat): consume server seqEpoch and re-bootstrap on mismatch | Frontend (Bug 5 client side) |
| `7affc696` | fix(chat): capture scroll anchor before live-append ceiling eviction | Frontend FIX-V2 |
| `2b7cf88f` | docs(audit): record FIX-V2 follow-up commits for items 1 + 3 | docs |
| `59a27cf1` | fix(middleware): declare __openclaw.placeholder flag in OCPlatformMessage type | typecheck repair |
| `ba02dc4a` | fix(middleware): add OCPlatformMessage type alias and missing imports | typecheck repair |

## Wave-1 middleware bugs status

| Bug | Description | Fixed in |
| --- | --- | --- |
| Bug 1 | SQL `LIMIT` applied before visibility filter (under-fills window) | `d582cdb0` (over-fetch loop) |
| Bug 2 | `/api/chat/messages` envelope missing pagination metadata | `d582cdb0` (envelope: `firstSeq`, `lastSeq`, `hasOlder`, `hasNewer`, `epoch`) |
| Bug 3 | Read paths used inconsistent visibility predicates | `5fb11a11` (canonical `isVisibleMessage`) |
| Bug 4 | Live assistant placeholders leaked into snapshots | `aaacdcea` (placeholder flag) + `75e61ad1` (test) |
| Bug 5 | Mutable `openclaw_seq` undetectable from client | `d0eb58a9` + `6a01f183` (per-session `seqEpoch` persisted + bumped on every mutation; surfaced on snapshot + envelope + SSE patches + frontend re-bootstrap in `ab2856d3`) |
| Bugs 6–10 | (not in wave-1 scope — deferred to wave-2 / future) | — |

## Test triage

Baseline measured against `v6-1-krish` (`5a17316f`) on this machine:

| Test file | Pre (baseline) | Post (this branch) | Action |
| --- | --- | --- | --- |
| `tests/app.test.ts` | 5 fail | 5 fail | Pre-existing — same 5 archived-transcript / archived-tool-call cases; identical failure shapes at baseline. Not in scope. |
| `tests/bootstrap-tool-inference.test.ts` | 2 fail | 2 fail | Pre-existing — identical assertion failures at baseline. |
| `tests/fork.test.ts` | 1 fail | 1 fail | Pre-existing — "creates a forked Gateway session with copied history and source metadata" failing identically at baseline. |
| `tests/live.test.ts` | 5 fail | 5 fail | Pre-existing — same 5 canonical-bootstrap tool-projection cases (`bootstrap derives completed tool calls…`, `bootstrap preserves real historical tool result output`, `canonical bootstrap finalizes stale active run…`, `canonical bootstrap clears stale prerun tools…`, `canonical bootstrap does not reinterpret tool-call-only assistant history as final text`). All fail identically at baseline `v6-1-krish` with the same diffs. |
| `tests/bootstrap-dedupe.test.ts` | ≥1 fail (per parent prompt) | **0 fail** | Fixed downstream of `5fb11a11` (canonical filter) and `aaacdcea` (placeholder marker). |
| `tests/send.test.ts` | 1 fail (cursor 8 vs 7) | **0 fail** | Fixed in `75e61ad1` — fixture updated to reflect placeholder filtering. |

**Net: baseline 18 failures (per parent prompt) → 13 failures now, all pre-existing at `v6-1-krish`. No regressions introduced. 5 tests recovered.**

Baseline re-runs (proof, captured this session):

- `cd /tmp/baseline-tests/apps/middleware && CI=true pnpm exec vitest run tests/live.test.ts` → `5 failed | 45 passed`, identical test names + diffs.
- `cd /tmp/baseline-tests/apps/middleware && CI=true pnpm exec vitest run tests/app.test.ts tests/bootstrap-tool-inference.test.ts tests/fork.test.ts` → `8 failed | 49 passed`, identical names.

## Tests added

| File | Count | What it covers |
| --- | --- | --- |
| `tests/seq-epoch.test.ts` | 6 | Repo-level: initial seqEpoch persistence, stability when no mutation, bump on resequence, bump on direct seq mutations / collision-shift inside `upsertMessages`, bump on delete-by-id, bump on segment delete. |
| `tests/chat-seq-epoch.test.ts` | 5 | Route-level: `/api/chat/messages` envelope carries `seqEpoch`; stable across reads with no mutation; bumped after gateway-driven resequence; bumped on segment delete; bumped after collision-shift via concurrent ingest. |
| `tests/chat-live-placeholder.test.ts` | 5 | Live placeholder flag is set on `live:<run>:assistant` rows; canonical bootstrap + `/api/chat/messages` filter them out; real final assistant rows replace them without leaking the flag. |
| `tests/chat-filter-consistency.test.ts` | 1 | All four read paths (bootstrap projection, snapshot, `/api/chat/messages`, live patch fan-out) agree on visibility for the same set. |
| `tests/chat-messages-window.test.ts` | 2 | Envelope `firstSeq`/`lastSeq`/`hasOlder`/`hasNewer` are correct under over-fetch with hidden rows. |
| `tests/repo.messages.window.test.ts` | 4 | Window cursor pagination drops `openclaw_seq IS NULL` rows; over-fetch loop converges. |
| `tests/repo.messages.collision-order.test.ts` | 4 | Late-echo seq collisions reshuffle correctly and bump seqEpoch. |
| `tests/bootstrap-snapshot-scoping.test.ts` | 2 | Snapshot scoping per session-key + segment. |

## Final verification

```
cd apps/middleware
pnpm typecheck   # tsc --noEmit          → exit 0
pnpm build       # tsc -p tsconfig.build.json → exit 0
pnpm exec vitest run  → 174 passed | 13 failed | 187 total
```

- typecheck: **PASS** (clean, no errors)
- build: **PASS** (clean, no errors)
- vitest: 174/187 passing; 13 failing tests are all confirmed pre-existing at `v6-1-krish` baseline by direct re-run. Not silenced — see triage table for proof of pre-existing status.
- New `seq-epoch.test.ts` and `chat-seq-epoch.test.ts`: **all 11 cases pass.**

(Vitest run also emitted two `EAGAIN` worker-spawn warnings near the end — sandbox-level fork pressure, not test results; the per-file pass/fail counts above are the authoritative line.)

## Notes on the brand-name compatibility commit (`ba02dc4a`)

While bringing typecheck clean we found a pre-existing partial brand migration in the type layer:

- `apps/middleware/src/features/chat/types.ts` exports `OCPlatformMessage`
- Several call sites in `live.ts`, `message-normalizer.ts`, `repo.messages.ts`, `routes.ts` cast through `OCPlatformMessage` (a name used elsewhere in the platform)

Without a bridge, `tsc` rejected those casts with `TS2304: Cannot find name 'OCPlatformMessage'`. This was **pre-existing at `v6-1-krish`** (confirmed by running `tsc --noEmit` against the baseline worktree — same 7 errors), but a clean typecheck is required for the seqEpoch + placeholder fixes to land. The commit:

- Adds an alias `export type OCPlatformMessage = OCPlatformMessage;` in `types.ts`.
- Adds `OCPlatformMessage` to the existing `import type { OCPlatformMessage, … }` statement in each of the 4 consuming files.

No runtime behaviour change — it's purely a type-layer bridge. Zero new lines of executable code.

## Anything the audit got wrong

- **Audit said "bootstrap-dedupe.test.ts has concurrent-dedupe failures."** Those tests are green on this branch — they were already collateral-fixed by Commits 2 (`5fb11a11`) and 3 (`aaacdcea`). The audit was right that the suite was red; it just didn't anticipate that the visibility-filter unification would also resolve dedupe assertions about the same rows.
- **Parent prompt assumed envelope `epoch` field was a stub** — at the time of the prompt it already returned `epoch: "v0"` literal. We replaced the literal with the persisted, mutating `seqEpoch` value via `getSessionSeqEpoch(sessionKey)`. Verified by `chat-seq-epoch.test.ts`.
- **The `live.test.ts` "canonical bootstrap" tool-projection failures** look at first glance like they should be wave-1 territory (projection / placeholder), but baseline reproduces them identically — they're a separate canonical-tool-state defect that pre-dates this branch and is **not** caused by any of the wave-1 fixes. Recommend filing as wave-2 work.

## Envelope evidence

Sample shape of `/api/chat/messages` response (extracted from `tests/chat-seq-epoch.test.ts` assertions + route handler at `apps/middleware/src/features/chat/routes.ts:1395`):

```json
{
  "ok": true,
  "messages": [ /* … */ ],
  "firstSeq": 1,
  "lastSeq": 17,
  "hasOlder": false,
  "hasNewer": false,
  "epoch": "9d3b2f4c-…-uuid",       // Bug 2 envelope field; now mutating
  "seqEpoch": "9d3b2f4c-…-uuid"     // Bug 5 alias surfaced
}
```

SSE hello frame (`apps/middleware/src/features/chat/live.ts`): includes `seqEpoch` per subscribed session; patches piggyback the same `epoch` field via `canonicalPatchPayload({ epoch })` at 3 broadcast sites.

## Wave 2 dependencies satisfied

Frontend wave-2 needs four envelope fields wired:
- `firstSeq` ✅
- `lastSeq` ✅
- `hasOlder` ✅
- `hasNewer` ✅
- (bonus) `epoch` / `seqEpoch` ✅ — consumed by frontend in `ab2856d3` ("consume server seqEpoch and re-bootstrap on mismatch")

All present in `/api/chat/messages` response. Frontend wave-2 unblocked.

## Notes for parent

- 20 commits ahead of `v6-1-krish`. Nothing pushed (hard rule respected).
- 5 tests recovered (`bootstrap-dedupe.test.ts` cluster + `send.test.ts` cursor case). No regressions.
- The 13 remaining failures are confirmed pre-existing at baseline and concentrated in two unrelated areas: (1) archived-transcript bootstrap (`app.test.ts` + adjacent), (2) canonical-bootstrap tool-projection (`live.test.ts` + `bootstrap-tool-inference.test.ts` + `fork.test.ts`). Recommend filing as wave-2 middleware work items.
- typecheck + build CLEAN; require `CI=true` env var to skip pnpm install's interactive node_modules removal when running under non-TTY shells.
