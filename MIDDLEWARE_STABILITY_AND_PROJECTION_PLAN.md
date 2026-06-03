# Middleware Stability & Projection Plan

**Branch:** `v5`
**Scope:** `apps/middleware/src/features/chat/*` (middleware only — no frontend)
**Status:** PLAN ONLY (no `.ts` changes in this commit)
**Follows:** 0007 (archived-history import non-blocking), 0008 (live backfill non-blocking)

This plan covers two production problems on huge/historical sessions (a real
4371-message session with ~5MB bootstrap payloads and 600+ `toolCall` blocks):

1. **Middleware still wedges** (event-loop freeze; `/health` hangs, `http=000`,
   firstbyte never) under concurrent `/api/chat/bootstrap` on huge sessions.
2. **`tools`/`toolCalls` empty** on huge/historical sessions even though message
   content carries 600+ `toolCall` blocks.

0007 fixed the **archived-history import** path and 0008 fixed the **live
backfill** path. Neither touched the **foreground `/api/chat/bootstrap`
handler**, which is where Problem 1 now lives. Problem 2 is a projection gap:
tool rows are written on the *live/backfill/foreground-window* paths but never
on the *archived-import* path.

---

## Problem 1 — Bootstrap still wedges under concurrent load

### 1.1 Where it happens

The cold/non-local-first branch of the bootstrap handler:
`apps/middleware/src/features/chat/routes.ts:1252` (`app.get("/api/chat/bootstrap")`),
specifically everything **after** the local-first fast path returns at
`routes.ts:1285` (`if (canServeLocal) { … return … }`). When `canServeLocal` is
false (`routes.ts:1283`) the handler runs a fully synchronous chain on the JS
thread with **no yields and no per-session dedupe**.

A huge session hits the cold path precisely when it is most expensive:

- Fresh middleware DB / wiped SQLite → no `localSession`, so `canServeLocal=false`.
- Concurrent first-bootstraps for the same session all race **before** any of
  them stamps `localFirstBootstrapTimestamps` (`routes.ts:1434`) or clears
  `localFirstSqliteBlocked` (`routes.ts:1435`), so **every** concurrent request
  takes the full synchronous path simultaneously.

### 1.2 Synchronous hot spots (all on one tick, in order)

1. **`await chat.history` then synchronous JSON of ~5MB** — `routes.ts:1361`.
   The await is fine, but the gateway client's `JSON.parse` of a ~5MB payload is
   one synchronous burst per request. N concurrent bootstraps = N parses.

2. **`messageFactorSummary(history.messages)`** in the log line —
   `routes.ts:1366` → `messageFactorSummary` (`routes.ts:520`). Iterates **all**
   messages and calls `projectGatewayMessage` on each (re-parses content blocks).
   Pure overhead that runs even just to emit a log.

3. **`normalizeHistoryMessages(sessionKey, messages)`** — `routes.ts:1370`.
   Synchronous loop over up to `limit ?? 1000` messages (each potentially large).

4. **`context.messages.upsertMessages(normalized, …)`** — `routes.ts:1392`. One
   synchronous SQLite transaction. Inside the tx (`repo.messages.ts:243`), for
   each **stripped-replay candidate** user/assistant row it runs
   `existingByRole.all(… LIMIT 1000)` (`repo.messages.ts:336`) and linearly
   scans the result — i.e. up to **O(messages × 1000)** `fromJson`+`textOf`
   comparisons in the worst case, plus per-row `json_extract` lookups
   (`existingByGatewayId`). On a 1000-row huge-message window this is the single
   biggest synchronous CPU hog, and it holds the SQLite writer the whole time.

5. **`pruneSegmentToCanonicalMessages`** — `routes.ts:1393`. Another synchronous
   transaction over the canonical set.

6. **`inferBootstrapToolCalls(context, sessionKey, messages, …)`** —
   `routes.ts:1402` → `inferBootstrapToolCalls` (`routes.ts:405`). For every
   assistant message it calls `projectGatewayMessage` and, per tool event,
   `inferToolResultFromHistory(messages, messageIndex, toolCallId)`
   (`routes.ts:378`) which **forward-scans the rest of the message array**. That
   is **O(messages × toolEvents × forwardScan) ≈ O(n²)**. With 600+ tool calls
   over thousands of messages this alone can be seconds, plus a DB
   `upsertToolCall` write per tool.

7. **`listMessages(… limit 1000).map(serializeProjectedMessage)`** —
   `routes.ts:1445`. Reads rows back out, `fromJson` each, and
   `serializeProjectedMessage`/`cleanMessageDisplayText` over every message.

8. **`buildChatBootstrapSnapshot`** — `routes.ts:1452` → `projection.ts:113`.
   Light relative to the above, but adds another `listToolCalls` + map.

None of steps 2–8 yield. The whole handler is one synchronous span per request.

### 1.3 The compounding factor (the actual wedge trigger)

There is **no in-flight dedupe/lock** for the foreground bootstrap path. Contrast
with `scheduleArchivedHistoryProjection`, which *does* dedupe via the
`archiveProjectionJobs` map (declared `routes.ts:49`; used in
`scheduleArchivedHistoryProjection` `routes.ts:595` via get/set/delete). The foreground path has nothing
equivalent. So K concurrent bootstraps for the same 4371-message session each
run the full O(n²) chain → **K× the synchronous CPU on a single thread**, plus
SQLite writer-lock serialization (each tx blocks the next, extending the stall).
That is what takes `/health` to `http=000` / firstbyte-never even after 0007/0008.

Secondary: the background sync inside the local-first branch (`routes.ts:1305`+)
is correctly fire-and-forget, but it re-runs `chat.history` + `upsertMessages` +
`pruneSegmentToCanonicalMessages` without yields; on a huge session a burst of
these (one per space-switch/tab) can also pile synchronous work. Lower priority
than the cold path but same class of fix.

### 1.4 Fix options

**Option A — Yield discipline + per-session in-flight dedupe (recommended).**
- Add a module-level `Map<string, Promise<BootstrapSnapshot>>` keyed by
  `sessionKey` (mirror of `archiveProjectionJobs` at `routes.ts:49`). On entry to
  the cold path, if a build is already in flight for that session, `await` and
  return the **same** snapshot instead of starting a second full build. This
  collapses K concurrent first-bootstraps into 1 unit of work (the dominant win).
- Insert `await yieldToEventLoop()` (already defined at `routes.ts:7`) between the
  heavy stages: after `normalizeHistoryMessages` (1370), after `upsertMessages`
  (1392), after `pruneSegmentToCanonicalMessages` (1393), and **inside**
  `inferBootstrapToolCalls` (make it `async`, yield every N≈25 messages — same
  discipline as 0007/0008) and inside the final `listMessages().map(serialize)`
  loop (chunk it, yield every N≈200).
- Bound the work: cap the foreground window to a sane `limit` (e.g. default the
  bootstrap window to ≤300 newest messages for projection, with `hasOlder`
  already supported by `buildChatBootstrapSnapshot` via `knownTotalMessages` —
  see `projection.ts:147`), and skip `messageFactorSummary` on the hot log line
  (1366) for large `messages` (gate behind message-count threshold).
- Fix the `inferToolResultFromHistory` O(n²): precompute, in a single pass, a
  `Map<toolCallId, result>` and a forward index of the next tool-result/assistant
  per message, so per-tool lookup is O(1) instead of a forward scan.

  *Tradeoff:* most code change; the dedupe map needs careful error handling so a
  failed in-flight build rejects all awaiters and clears the map entry
  (`.finally`), exactly like `archiveProjectionJobs` (`routes.ts:680`).

**Option B — Offload heavy projection to a background job, serve a thin snapshot
synchronously.** On cold path, immediately return messages straight from the
gateway window (already in memory) + empty/partial tools, then `setImmediate` the
`upsertMessages`/`inferBootstrapToolCalls`/prune work and broadcast a
`chat.bootstrap` refresh patch when done (the archived path already does this at
`routes.ts:630`+). 
  *Tradeoff:* fastest first byte, but the first snapshot is less complete (tools
  arrive via a follow-up patch), and it still needs the dedupe from Option A to
  avoid N concurrent background jobs. Higher risk of UI fl/refetch churn.

### 1.5 Recommended fix

**Option A**, in this priority order (each independently reduces wedge risk):

1. **Per-session in-flight dedupe** on the cold bootstrap path — biggest win,
   smallest blast radius, directly kills the "concurrent bootstraps compound"
   trigger. Model it on `archiveProjectionJobs` (`routes.ts:49/595/680`).
2. **Make `inferBootstrapToolCalls` async + single-pass result index** — removes
   the O(n²) and yields. (Also benefits Problem 2's backfill, see §2.)
3. **Yield between stages** (normalize / upsert / prune / serialize) and chunk the
   serialize loop.
4. **Bound the projection window** + drop `messageFactorSummary` on huge logs.

Keep Option B's "background-refresh patch" mechanism (already present for
archives) as the delivery channel if step 2/3 still measure multi-second on the
real 4371-message session.

### 1.6 Test / verification

- `pnpm --filter ./apps/middleware typecheck` clean; `pnpm --filter
  ./apps/middleware test` (currently 175/175) stays green.
- **Unit:** new test that fires N=10 concurrent `/api/chat/bootstrap` for one
  session against a stub gateway returning a synthetic 4000-message / 600-tool
  history; assert the gateway `chat.history` is called **once** (dedupe) and that
  a concurrently-issued `/health` resolves < 1s throughout (measure event-loop
  lag via `setTimeout` drift inside the test).
- **Micro-bench:** `inferBootstrapToolCalls` old vs new on 4000 msgs / 600 tools
  — assert new is ≥1 order of magnitude faster and produces identical tool rows.
- **Manual (deploy):** wipe middleware SQLite, fire concurrent bootstraps on the
  4371-message session while curling `/health` in a loop; `/health` must stay
  sub-second and never return `000`. Confirm `bootstrap.end` still logs the same
  `messageCount`.

---

## Problem 2 — `tools`/`toolCalls` empty on huge/historical sessions

### 2.1 Where the snapshot reads tools

`buildChatBootstrapSnapshot` fills both `tools` and `toolCalls` from the same
source: `projection.ts:129`

```
const tools = (latestRun
  ? context.runs.listToolCalls(params.sessionKey, latestRun.runId)   // run-scoped
  : context.runs.listToolCalls(params.sessionKey)                    // session-wide
).map(toolCallProjection);
```

`listToolCalls` (`repo.runs.ts:341`) reads the `v2_tool_calls` table. So if there
are **zero rows** in `v2_tool_calls` for the session, `tools`/`toolCalls` are
empty regardless of message content.

### 2.2 Where tool rows actually get written (and where they don't)

`v2_tool_calls` rows are created **only** via `RunRepository.upsertToolCall`
(`repo.runs.ts:210`), which is reached from exactly these call sites:

- **Live ingest:** `live.ts:244` `handleSessionTool` (gateway `session.tool`),
  `live.ts:319/904` `projectToolsFromMessage` → `handleSessionTool`
  (`live.ts:686/691`), and `live.ts:799` (`projectAgentToolEvent`).
- **Foreground bootstrap window:** `inferBootstrapToolCalls` (`routes.ts:405`,
  called at `routes.ts:1402`) — but it iterates only the **gateway
  `chat.history` `messages`** array (`routes.ts:1369`), i.e. the live/current
  session window the gateway returns, **not** the archived segments merged into
  SQLite.
- **Send / live backfill:** `routes.ts:1036`+ loop and `live.ts:829`
  `backfillHistory` (`projectToolsFromMessage` at `live.ts:904`).

The **archived/history import path writes messages but never projects tools**:
`persistArchivedHistorySegments` (`routes.ts:242`) reads each archive file
(`transcriptMessagesFromJsonl(file)`, `routes.ts:274`), normalizes, and calls
`context.messages.upsertMessages(...)` (`routes.ts:281`) — **only** message rows.
The background job `scheduleArchivedHistoryProjection` (`routes.ts:595`) then
`resequenceSessionMessages` + broadcasts a refresh (`routes.ts:615`+) but still
**never** calls `upsertToolCall` / `projectToolsFromMessage`.

### 2.3 Root cause (confirmed)

A 4371-message session is reconstructed in SQLite from **archived segments**
(merged across multiple `*.jsonl.reset/deleted.*` files). Those segments are
populated exclusively through `persistArchivedHistorySegments` →
`upsertMessages`, which does not project tools. The gateway `chat.history` window
that `inferBootstrapToolCalls` sees only covers the **current/active** session
file (the recent tail), which is why live/normal sessions project 6–15 tools but
the 600+ `toolCall` blocks living in the archived segments yield **zero**
`v2_tool_calls` rows → empty `tools`/`toolCalls`.

The extraction primitive already exists and is reusable:
`extractToolEventsFromMessage` (`gateway-event-projector.ts:184`) pulls both
`toolCall*` blocks and `toolResult*` blocks (plus tool-role top-level) and is
exactly what `projectToolsFromMessage` (`live.ts:686`) feeds into
`handleSessionTool`. The archived import simply never calls it.

Secondary scoping hazard: even after we project historical tools with
`runId = null`, `buildChatBootstrapSnapshot` (`projection.ts:129`) scopes to
`latestRun.runId` whenever **any** run row exists for the session. A leftover
stale run would then hide the null-run historical tools. The fix must account for
this (see §2.5).

### 2.4 Fix options

**Option A — Project tools during archived import (recommended).**
Inside `persistArchivedHistorySegments` (`routes.ts:242`), after the per-file
`upsertMessages` (`routes.ts:281`), iterate the imported `normalized` messages
and, for each, run `extractToolEventsFromMessage` (reuse
`gateway-event-projector.ts:184`) and `context.runs.upsertToolCall(...)` for each
event — correlating by:
- `toolCallId` from the block,
- `messageId` from the message's `__openclaw.id`/`id` (so the UI can attach the
  card to its message),
- `runId` from `message.__openclaw.runId` when present in the archive, else
  `null`,
- `phase`/`status` from the block (`calling` for `toolCall`, `result`/`error`
  for `toolResult`/tool-role), with `startedAtMs`/`finishedAtMs` from
  `historyTimestampMs`.
Pair toolCall blocks with their matching toolResult blocks by `toolCallId` in a
single pass per file (build a `Map<toolCallId, result>` first, then upsert), so
each tool gets its result in one write. Do this with the **same non-blocking
discipline as 0007** (the import loop already yields every 3 files at
`routes.ts:287`; add a yield every N tool upserts for very tool-dense files).

This is naturally idempotent: `upsertToolCall`'s `ON CONFLICT(session_key,
tool_call_id)` (`repo.runs.ts:250`) means re-import won't duplicate, and the
terminal-state guard (`repo.runs.ts:231`) prevents replays from resurrecting
running rows.

**Backfill of existing sessions:** add a one-shot
`backfillArchivedToolCalls(sessionKey)` that reads already-projected messages
from SQLite (`listMessages`, `repo.messages.ts:822`) in bounded chunks and runs
the same extract→upsert, yielding every N. Trigger it (a) lazily from the
background `scheduleArchivedHistoryProjection` job (`routes.ts:595`) when
`v2_tool_calls` count for the session is 0 but messages contain toolCall blocks,
and/or (b) from startup repair (`live.ts:repairStaleRunsOnStartup`). Idempotent,
so safe to run on every cold bootstrap of a historical session.

  *Tradeoff:* adds write volume during import (mitigated by yields + idempotent
  upsert); needs the snapshot-scoping fix in §2.5 to actually surface.

**Option B — Infer tools at snapshot time from SQLite messages.** Extend
`inferBootstrapToolCalls` (`routes.ts:405`) to read from the **projected SQLite
messages** (all segments) instead of only the gateway window, on cold bootstrap.
  *Tradeoff:* recomputes on every bootstrap (cost — see Problem 1), and only
  populates the foreground path, not live clients that rely on persisted rows.
  Rejected as primary; the import-time projection (A) is the durable fix.

### 2.5 Recommended fix

**Option A** — project tool calls at archived-import time + an idempotent
backfill for existing sessions, **plus** a snapshot-scoping adjustment:

In `buildChatBootstrapSnapshot` (`projection.ts:129`), when `latestRun` is a
**terminal/historical** run (status in `done/error/aborted`) or when the
run-scoped query returns empty, also include session-wide historical tool rows
(`runId IS NULL`) — i.e. union run-scoped + historical instead of strictly
run-scoping. This keeps live active-run scoping intact while letting historical
cards render. (Alternatively, gate purely on `findLatestPendingRun`: scope only
when there is an *active* run, else return session-wide — simplest.)

Project historical tools with `runId = null` and a correct `messageId` so the UI
can render inline tool cards by message association even when the top-level
`tools` array is run-scoped.

### 2.6 Test / verification

- `pnpm --filter ./apps/middleware typecheck` clean; mw test suite green.
- **Unit (import projection):** feed `persistArchivedHistorySegments` a synthetic
  archive JSONL containing assistant messages with `toolCall` blocks and matching
  `toolResult` messages; assert `v2_tool_calls` gets one row per `toolCallId`
  with the paired result/status and correct `messageId`, and that re-running the
  import does **not** duplicate or resurrect running rows (idempotency).
- **Unit (snapshot):** historical session with `latestRun=done` and N null-run
  tool rows → `buildChatBootstrapSnapshot` returns `tools.length === N`
  (regression guard for the §2.5 scoping change).
- **Unit (backfill):** session with messages-but-zero-tools → run
  `backfillArchivedToolCalls` → tool rows appear; second run is a no-op.
- **Manual (deploy):** bootstrap the real 4371-message session; `tools`/
  `toolCalls` non-empty and historical tool cards render; live tool projection on
  normal sessions still shows 6–15 (no regression).

---

## Cross-cutting notes

- Both fixes share the **non-blocking discipline** established by 0007/0008
  (`yieldToEventLoop = () => new Promise(r => setImmediate(r))`, already at
  `routes.ts:7` and `live.ts:13`) and the **single-flight dedupe** pattern
  already proven by `archiveProjectionJobs` (`routes.ts:595`). Reuse both rather
  than introducing new mechanisms.
- The single-pass tool-result index built for Problem 1 §1.5(2) is the same
  primitive needed for Problem 2's import-time pairing — implement once, reuse.
- Order of delivery: ship Problem 1's **per-session bootstrap dedupe** first
  (stops the production wedge with minimal change), then the async/O(n²) cleanup,
  then Problem 2's import-time tool projection + backfill + snapshot scoping.
