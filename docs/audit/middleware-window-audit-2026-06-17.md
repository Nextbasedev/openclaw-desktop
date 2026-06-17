# Middleware Window Contract Audit — 2026-06-17

Branch: `v6-1-krish` · Read-only audit. No source files modified.
Scope: `apps/middleware/src/features/chat/{routes,repo.messages,projection,live,message-normalizer,patches}.ts`
and `apps/middleware/src/db/migrate.ts`.

## Summary

The middleware **does not implement a visible-row contract**. `/api/chat/messages`
applies `LIMIT` inside the SQL window and then re-filters in JS, so an N-message
page can collapse to 0 visible rows whenever the tail of the window happens to
contain hidden internal-subagent or attached-file echo rows. The response
envelope does **not** include `hasOlder`, `hasNewer`, `oldestSeq`, `newestSeq`,
or any `visibleCount` separate from the post-filter array length — the frontend
literally cannot tell "out of rows" from "page is full of hidden rows".
Bootstrap uses a stricter normalizer (`hasVisibleAssistantSignal`) than
`/api/chat/messages`, so the two endpoints can disagree on the same window.
SSE patches carry `messageSeq` for message upserts (good), but tool / subagent
patches don't, and `live:<runId>:assistant` placeholder rows are persisted as
real `v2_messages` rows that bypass every hidden-row filter except the implicit
"messageId starts with live:" knowledge the frontend has to bring.

Top three issues (severity-ordered):
1. **LIMIT applied before the hidden-row filter** in `MessageRepository.listMessages` and again in the route (`isNonUserAttachedFileEcho`). [`repo.messages.ts:1010-1041` / `routes.ts:1393`]
2. **No window metadata in the `/api/chat/messages` response** — frontend cannot detect "all rows in this page were hidden" or "older messages exist". [`routes.ts:1396-1407`]
3. **Bootstrap and `/api/chat/messages` use different filter chains** (bootstrap also drops empty assistants via `hasVisibleAssistantSignal`); both also feed off the same `v2_messages` table, but `pruneSegmentToCanonicalMessages` in the bootstrap path can race-delete rows that a concurrent `/api/chat/messages` reader just observed. [`message-normalizer.ts:272-277` vs `repo.messages.ts:1041`; `routes.ts:1337`]

---

## Confirmed bugs

### Bug 1: `/api/chat/messages` applies SQL LIMIT before the JS hidden-row filter

- **Severity:** critical
- **Evidence:**
  - SQL in `MessageRepository.listMessages` puts `LIMIT @limit` **inside** the
    descending subquery, then orders ASC. The hidden-row filter
    (`isInternalSubagentCompletionMessage`) is applied in JS **after** the SQL
    is materialized:
    ```ts
    // apps/middleware/src/features/chat/repo.messages.ts:990-1041
    const rows = this.db.prepare(beforeSeq !== null ? `
      SELECT … FROM (
        SELECT … FROM v2_messages
        WHERE session_key = @sessionKey
          AND openclaw_seq > @afterSeq
          AND openclaw_seq < @beforeSeq
        ORDER BY openclaw_seq DESC
        LIMIT @limit                      // <-- LIMIT in SQL
      )
      ORDER BY openclaw_seq ASC
    ` : opts.latest ? `… LIMIT @limit …` : `… LIMIT @limit`).all(…);
    return rows
      .map(/* shape into ProjectedMessage */)
      .filter((row) => !isInternalSubagentCompletionMessage(row.data));  // <-- filter AFTER limit
    ```
  - The route then layers a **second** post-LIMIT filter:
    ```ts
    // apps/middleware/src/features/chat/routes.ts:1393
    const visibleMessages = messages.filter((message) => !isNonUserAttachedFileEcho(message));
    ```
  - `isNonUserAttachedFileEcho` (`routes.ts:314-317`) drops every non-user
    message whose text contains an `<attached-file …>` block.
  - `isInternalSubagentCompletionMessage` (`message-normalizer.ts:148-153`)
    drops any message whose `provenance.sourceTool === "subagent_announce"` or
    whose text contains `<<<BEGIN_OPENCLAW_INTERNAL_CONTEXT>>>` + `source: subagent`.
- **Reproduction:** Session with 300 stored rows where 20 of the most-recent 160
  are `subagent_announce` markers or non-user attached-file echoes. Client
  requests `GET /api/chat/messages?sessionKey=…&beforeSeq=Number.MAX_SAFE_INTEGER&limit=160`.
  - SQL returns 160 rows (DESC + LIMIT).
  - JS filters out 20 hidden rows.
  - Response: `messages.length === 140`, `messageCount: 140`.
  - The 20 missing rows are NOT the rows the client expected to drop; they are
    silently dropped from the window. To get them back the client must page
    further with `beforeSeq = (smallest seq it actually received)` and hope.
  - Worse: if all 160 happen to be hidden (subagent-completion bursts can run
    in long batches; attached-file echo blocks are emitted once per assistant
    turn that quotes the file), the response is `messages: []`,
    `messageCount: 0`. The client has no way to know that older visible
    messages exist.
- **Failing test design (vitest, against `MessageRepository`):**
  ```ts
  test("listMessages returns @limit VISIBLE rows even when hidden rows occupy the SQL window", () => {
    const db = openDatabase({ databasePath: testDbPath("limit-vs-hidden-filter") });
    const repo = new MessageRepository(db);
    // 10 hidden subagent-completion rows at seqs 1..10, then 5 visible at 11..15.
    repo.upsertMessages([
      ...Array.from({ length: 10 }, (_, i) => ({
        sessionKey: "s1", openclawSeq: i + 1, messageId: `hidden-${i}`, role: "user",
        data: { id: `hidden-${i}`, role: "user",
                text: "<<<BEGIN_OPENCLAW_INTERNAL_CONTEXT>>>\nsource: subagent",
                provenance: { sourceTool: "subagent_announce" } },
        updatedAtMs: i,
      })),
      ...Array.from({ length: 5 }, (_, i) => ({
        sessionKey: "s1", openclawSeq: 11 + i, messageId: `vis-${i}`, role: "assistant",
        data: { id: `vis-${i}`, role: "assistant", text: `visible ${i}` },
        updatedAtMs: 11 + i,
      })),
    ]);

    // Request the last 10 with a beforeSeq window that covers everything.
    const rows = repo.listMessages("s1", { beforeSeq: 1_000_000, limit: 10 });

    // CURRENT BEHAVIOR: 5 visible rows (10 hidden + last-5 visible -> LIMIT-10 ->
    // hidden filter drops 5 -> returns 5). Expected per contract: 5 visible only if
    // 5 exist, otherwise 10 visible.
    expect(rows.map((row) => row.messageId)).toEqual(["vis-0","vis-1","vis-2","vis-3","vis-4"]);
    // This passes today because there are only 5 visible total. Now seed 10 more.

    repo.upsertMessages(Array.from({ length: 10 }, (_, i) => ({
      sessionKey: "s1", openclawSeq: 100 + i, messageId: `tail-hidden-${i}`, role: "user",
      data: { id: `tail-hidden-${i}`, role: "user",
              text: "<<<BEGIN_OPENCLAW_INTERNAL_CONTEXT>>>\nsource: subagent",
              provenance: { sourceTool: "subagent_announce" } },
      updatedAtMs: 100 + i,
    })));

    // Now the last 10 by openclaw_seq are all hidden. A frontend asking for the
    // last 10 visible rows MUST receive 5 visible (the original ones).
    const lastTen = repo.listMessages("s1", { beforeSeq: 1_000_000, limit: 10 });
    expect(lastTen.length).toBe(5); // FAILS TODAY: returns 0 because LIMIT scooped
                                     // the 10 hidden tail rows and the filter ate
                                     // all of them.
    db.close();
  });
  ```

### Bug 2: `/api/chat/messages` response omits all pagination metadata

- **Severity:** critical
- **Evidence:** Route at `apps/middleware/src/features/chat/routes.ts:1396-1409`:
  ```ts
  return {
    ok: true,
    source: "middleware-projection",
    sessionKey: parsed.data.sessionKey,
    messages: visibleMessages.map(/*…*/),
    messageCount: visibleMessages.length,
    cursor: sessionCursor,
  };
  ```
  No `hasOlder`, no `hasNewer`, no `oldestSeq`, no `newestSeq`, no `visibleCount`,
  no `scannedCount`. (Bootstrap, by contrast, hard-codes `hasOlder: false,
  oldestLoadedSeq: null` at `projection.ts:148-150`, which is also misleading
  — see Bug 7.)
- **Reproduction:** Same as Bug 1's "all-hidden tail" repro. Client receives
  `messages: [], messageCount: 0`. Client has no defined way to detect "page
  empty because hidden" vs "no older messages exist".
- **Failing test design:**
  ```ts
  test("/api/chat/messages includes window metadata", async () => {
    // seed 50 visible rows at seqs 1..50, plus 10 hidden rows at 41..50 (overlap).
    const res = await app.inject({
      method: "GET",
      url: "/api/chat/messages?sessionKey=s1&beforeSeq=999999&limit=10",
    });
    const body = res.json();
    expect(body).toHaveProperty("hasOlder");  // FAILS: property missing
    expect(body).toHaveProperty("hasNewer");
    expect(body).toHaveProperty("oldestSeq");
    expect(body).toHaveProperty("newestSeq");
    expect(body).toHaveProperty("visibleCount");
    expect(body).toHaveProperty("scannedCount"); // # rows the SQL window scanned
  });
  ```

### Bug 3: Bootstrap and `/api/chat/messages` apply different hidden-row filters

- **Severity:** high
- **Evidence:**
  - Bootstrap path persists via `normalizeHistoryMessages` (`message-normalizer.ts:270-285`), which
    chains four filters: drop-non-objects → drop-internal-subagent → drop-non-user-attached-file → drop-no-visible-assistant-signal (`hasVisibleAssistantSignal`).
  - It then reads with `listAllMessages` (`repo.messages.ts:1061-1079`) which
    only applies `isInternalSubagentCompletionMessage`, and the route layers
    `isNonUserAttachedFileEcho` on top (`routes.ts:1343`).
  - `/api/chat/messages` uses `listMessages` + route-side `isNonUserAttachedFileEcho`
    only — no `hasVisibleAssistantSignal` check.
  - **Net difference:** an empty-but-non-error assistant row that somehow lands
    in `v2_messages` (e.g. via `broadcastLiveAssistantText` which calls
    `upsertMessages` directly at `live.ts:1049-1063`, bypassing the
    `normalizeHistoryMessages` filters) shows up in `/api/chat/messages` but
    NOT in bootstrap's filter pipeline at write-time. The placeholder DOES get
    `pruneSegmentToCanonicalMessages` against it on bootstrap (`routes.ts:1337`)
    when no pending run exists, so the row vanishes. So `/api/chat/messages`
    before bootstrap, and bootstrap-after-prune, return different sets.
- **Reproduction:**
  1. Start a run; live assistant deltas push `live:<runId>:assistant` row via
     `broadcastLiveAssistantText` (`live.ts:1039-1086`).
  2. Run completes, gateway returns history WITHOUT the live placeholder.
  3. Client A polls `/api/chat/messages` before bootstrap → sees live placeholder.
  4. Client B calls `/api/chat/bootstrap` → triggers `pruneSegmentToCanonicalMessages`
     → placeholder deleted.
  5. Client A polls `/api/chat/messages` again → placeholder gone, but no
     `chat.message.delete` patch was emitted (prune only deletes rows; no
     projection-event/SSE notification — search `pruneSegmentToCanonicalMessages`
     callers: no `appendProjectionEvent` follows). Client A is now stale.
- **Failing test design:**
  ```ts
  test("bootstrap prune emits delete patches for rows removed", async () => {
    // 1) seed v2_messages with a row that prune will reject (e.g. extra row).
    // 2) call /api/chat/bootstrap with a canonical-history response from gateway
    //    that does NOT contain that row.
    // 3) read v2_projection_events after the call.
    // EXPECT: at least one event of type chat.message.delete with the pruned
    //         messageId. ACTUAL: no such event is appended.
  });
  ```

### Bug 4: `live:<runId>:assistant` placeholder rows bypass the hidden-row filters

- **Severity:** high
- **Evidence:** `live.ts:1048-1062` upserts a synthetic assistant row directly:
  ```ts
  const messageId = `live:${run.runId}:assistant`;
  const projectedSeq = this.context.messages.nextMessageSeq(sessionKey);
  this.context.messages.upsertMessages([{
    sessionKey, openclawSeq: projectedSeq, messageId, role: "assistant",
    data: { id: messageId, role: "assistant", text: next,
            __openclaw: { id: messageId, runId: run.runId } },
    updatedAtMs: Date.now(),
  }]);
  ```
  These rows have neither attached-file blocks nor subagent-completion sentinels,
  so they pass both `listMessages`/`listAllMessages` AND the route filter. The
  frontend has to recognise `messageId.startsWith("live:")` itself.
  - When the run completes, `handleSessionMessage` (`live.ts:288-298`) reads the
    placeholder by id, deletes it (`deleteMessageById`), and reassigns its seq
    to the final assistant. Without a coordinated patch this can produce a
    "ghost row" if the client polled in between.
- **Reproduction:** Page `/api/chat/messages` during a run that is mid-stream.
  The response contains a `live:<runId>:assistant` row with text `next` and
  `openclawSeq = nextMessageSeq()`. After completion, polling again returns
  a row at the same seq with a different messageId (the gateway's final id).
- **Failing test design:**
  ```ts
  test("/api/chat/messages either excludes or labels live placeholder rows", async () => {
    // After broadcastLiveAssistantText runs, GET /api/chat/messages.
    // EXPECT: rows.every(row => !row.messageId?.startsWith("live:")) OR every
    //         row carries data.__openclaw.placeholder === true. ACTUAL: live row
    //         present and undistinguished from real assistant rows.
  });
  ```

### Bug 5: `openclaw_seq` is NOT a stable cursor — it is rewritten in-place

- **Severity:** high (only because clients use it AS A CURSOR via `beforeSeq` /
  `afterSeq`).
- **Evidence:**
  - Late-gateway-echo collision path in `upsertMessages` shifts an existing
    assistant/tool block from `openclawSeq..ceiling-1` to `openclawSeq+1..ceiling`
    via a two-pass negation/+1 update (`repo.messages.ts:299-345, 462-518`).
    The shifted rows are pushed into `changedMessages` and patched out as
    `chat.message.upsert` events at their NEW seq.
  - `resequenceSessionMessages` (`repo.messages.ts:626-672`) renumbers every
    row in the session to `1..N`. No patches are emitted; it just rewrites the
    table.
  - Pruning (`pruneSegmentToCanonicalMessages` `repo.messages.ts:574-624`) and
    direct deletes (`deleteMessageById` `repo.messages.ts:870-875`,
    `deleteMessagesForSegment` `repo.messages.ts:208-211`) leave **gaps** in
    `openclaw_seq`.
  - PRIMARY KEY is `(session_key, openclaw_seq)` (`db/migrate.ts:25`) — so
    `openclaw_seq` is unique per session, **but neither dense nor monotone over
    time for a given message**.
- **Consequence on the window contract:** a client that cached
  `oldestLoadedSeq = 200` and pages `beforeSeq=200` will silently miss messages
  whose seq used to be ≥ 200 but is now < 200 after a shift/resequence. There
  is no "epoch" or "seq generation" field to detect this.
- **Reproduction:** trigger the late-user-echo collision (the path the comment
  at `repo.messages.ts:436-452` was added to fix). Before the shift, the
  assistant row had seq=S. After the shift, it has seq=S+1. A client whose
  last seen `beforeSeq` was S+1 (when paging older) will now MISS the original
  assistant row, because `openclaw_seq < S+1` skips it.
- **Failing test design:**
  ```ts
  test("openclaw_seq returned to client is stable across late-echo shifts", () => {
    // 1) Persist optimistic user at seq 10 (text "hi").
    // 2) Backfill live assistant final at seq 10 (collision, shift fires).
    // 3) Late gateway user-echo for "hi" arrives — shift moves assistant 10 -> 11.
    // 4) GET /api/chat/messages?beforeSeq=11 -> rows must include the assistant.
    // EXPECT: assistant row visible. ACTUAL (today): row visible at seq 11, so
    //         beforeSeq=11 excludes it. A client that cached "oldest=11" misses it.
  });
  ```

### Bug 6: `chat.tool.*` and `chat.subagent.*` patches carry no `messageSeq`

- **Severity:** medium
- **Evidence:**
  - `handleSessionTool` patch emit at `live.ts:858-863`: payload is
    `{ sessionKey, phase, output?, result? }` plus the canonical patch shape
    (which includes `toolCall` from `toolCallProjection`, but NO `messageSeq`).
  - `emitSubagentPatch` at `live.ts:509-528`: payload is fully caller-controlled
    and none of the call sites include `messageSeq`.
  - This is *probably* OK in the current UI because tools render against
    `toolCalls` projection keyed by `toolCallId` independently of message order,
    BUT the audit asked specifically: there is no link from a tool patch back
    to the message window. A client that wants to drop tool patches that belong
    to a not-yet-loaded message cannot do so deterministically.
- **Failing test design:** assert that every emitted patch payload includes
  either `messageSeq: number` or a documented exemption (e.g. status-only).
  Today many do not.

### Bug 7: Bootstrap response hard-codes `hasOlder: false` and `oldestLoadedSeq: null`

- **Severity:** medium (it's wrong by tautology, not by computation)
- **Evidence:** `projection.ts:147-150`:
  ```ts
  historyCoverage: "full",
  fullMessagesIncluded: true,
  hasOlder: false,
  knownTotalMessages: params.messageCount,
  oldestLoadedSeq: null,
  ```
  These values are unconditional. The path that populates `params.messages` is
  `listAllMessages` (`routes.ts:1342`), so in practice everything-fits-in-RAM
  guarantees `hasOlder: false` — **but**:
  - If a future caller switches `buildChatBootstrapSnapshot` to a paginated read,
    the values are silently wrong with no compile-time signal.
  - `oldestLoadedSeq: null` instead of `min(messages.openclawSeq)` denies the
    frontend a useful anchor, contradicting `/api/chat/messages` (which has no
    metadata at all) and forcing the UI to recompute.
  - `knownTotalMessages` equals the **visible** count after filtering, not the
    raw DB count — name is misleading.

### Bug 8: `pruneSegmentToCanonicalMessages` deletes rows without emitting `chat.message.delete` patches

- **Severity:** medium
- **Evidence:** `repo.messages.ts:574-624` deletes rows that are absent from
  the canonical message set. Callers: bootstrap (`routes.ts:1337`) and archive
  import indirectly via `deleteMessagesForSegment` (`routes.ts:481`). Neither
  call site emits a corresponding `appendProjectionEvent` describing the delete,
  so an SSE-connected client that already paged in those rows keeps them in
  its cache forever (until a forced bootstrap).
- **Reproduction:** see Bug 3 repro.

### Bug 9: Live tool/subagent backfill emits patches that depend on rows the client may not have fetched

- **Severity:** medium (it's a contract gap, not corruption)
- **Evidence:** `backfillHistory` at `live.ts:908-942` iterates
  `projection.changedMessages` and broadcasts a `chat.message.upsert` patch per
  changed message with `messageSeq: projected.openclawSeq`. The seq comes
  through, BUT the patches do not reference `oldestLoadedSeq` of any client.
  A client paging `[seq=200..400]` may receive a patch for seq=50; it has to
  decide locally to drop it.
- **Verdict:** the seq IS in the payload, so the frontend CAN drop it; this is
  acceptable only if the frontend dedup/window logic is correct. Worth a
  contract test.

### Bug 10: `beforeSeq` is strict-less-than — undocumented and brittle

- **Severity:** low
- **Evidence:** `repo.messages.ts:997` `AND openclaw_seq < @beforeSeq`. The
  Zod validator forbids `0` (`positive()` at `routes.ts:1373`), which is fine,
  but the strictness means: to page "older than the oldest I have", the client
  passes `beforeSeq = oldestLoaded.openclawSeq`. If `oldestLoaded` was itself a
  hidden row that the client never received, it has no way to know to pass
  `oldestLoadedReturned + 1`. Compounded by Bug 1 and Bug 2.

---

## Unconfirmed suspicions

- **Optimistic-seq vs gateway-seq divergence on confirm.** `confirmOptimisticUser`
  (`repo.messages.ts:763-826`) deliberately keeps the locally-allocated
  `openclaw_seq` and stuffs `gatewaySeq` into `__openclaw.gatewaySeq`. The patch
  emitted from `routes.ts:1086-1108` includes `messageSeq: confirmedUser.openclawSeq`.
  This is internally consistent, but if any other path (e.g. a downstream
  history backfill) re-discovers the message by `messageId` AND computes
  `baseSeq + gatewaySeq`, the seqs can diverge. I did not prove a corruption
  case; the `isStrippedReplayCandidate` and `existingByGatewaySeq` lookups
  appear to handle it. Worth a focused fuzz.
- **Archive-import seq collision.** `ensureArchivedSegment` sets baseSeq to
  current `max(openclaw_seq)` (`repo.messages.ts:91-92`). Active segment 0
  created earlier has `baseSeq=0` and projects messages at `0 + gatewaySeq`.
  If gateway then issues a high `gatewaySeq` exceeding the archived span, the
  computed `openclawSeq` could collide with archived rows. Did not trace an
  exploit; the collision path in `upsertMessages` would shift or append.
- **`v2_projection_events.cursor` reuse on epoch reset.** SQLite
  `INTEGER PRIMARY KEY AUTOINCREMENT` is monotonic per-database-file. If the
  middleware DB is rebuilt (commit `84aa56cf` references exactly this case),
  new cursors restart low. The hello frame now ships `latestCursor` to let the
  client detect the reset (`patches.ts:148-165`). I did not exercise the
  client logic; only confirmed the server side is correct.
- **`scheduleHistoryBackfill` debounce window of 300 ms.** A burst of tool
  events coalesces into one backfill. If the burst spans a real run boundary,
  one backfill may project mixed messages. The `messageWithinRunBackfillScope`
  guard at `live.ts:917` mitigates by run, but did not fuzz cross-run leakage.

---

## Code map

```
HTTP                                Repo / SQL                          Filters
────────────────────────────────────────────────────────────────────────────────────
GET /api/chat/bootstrap             ────────────────────────────────────────────
  routes.ts:1298                    gateway.request("chat.history")    normalizeHistoryMessages
   └─ normalizeHistoryMessages ──>  v2_messages.upsertMessages          ↳ isInternalSubagentCompletionMessage
                                    pruneSegmentToCanonicalMessages     ↳ containsAttachedFileBlock (non-user)
                                    listAllMessages  (LIMIT none)       ↳ hasVisibleAssistantSignal
   └─ filter isNonUserAttachedFileEcho
   └─ buildChatBootstrapSnapshot (projection.ts:108)
        ↳ HARD-CODED: hasOlder=false, oldestLoadedSeq=null, knownTotalMessages=visible-count

GET /api/chat/messages              ────────────────────────────────────────────
  routes.ts:1370                    listMessages
                                      SELECT … WHERE seq>@after AND seq<@before
                                      ORDER BY seq DESC LIMIT @limit  ← LIMIT in SQL
                                      then ASC outer order
                                    .map(...)
                                    .filter(!isInternalSubagentCompletionMessage)  ← post-LIMIT
   └─ filter isNonUserAttachedFileEcho                                  ← post-LIMIT (second pass)
   └─ return { messages, messageCount, cursor }       ← NO hasOlder / hasNewer / oldestSeq

POST /api/chat/send  (routes.ts:691-1296)
  ↳ stores optimistic via insertOptimisticMessage (no filter, by design)
  ↳ scheduled gateway.history -> normalizeHistoryMessages -> upsertMessages -> patch broadcast
  ↳ patch carries messageSeq

Gateway live stream                  ────────────────────────────────────────────
ChatLiveService.handleSessionMessage live.ts:262
  ↳ normalizeHistoryMessages([msg])  ← single-message filter, same chain as bootstrap
  ↳ confirmOptimisticUser OR upsertMessages
  ↳ emit chat.message.{confirmed|upsert} with messageSeq

ChatLiveService.broadcastLiveAssistantText live.ts:1039
  ↳ direct upsertMessages([live:<runId>:assistant])  ← BYPASSES normalizeHistoryMessages
  ↳ emit chat.assistant.delta with messageSeq=projectedSeq (placeholder seq)

ChatLiveService.handleSessionTool live.ts:680-870
  ↳ runs.upsertToolCall
  ↳ emit chat.tool.{started|update|result|error}  ← NO messageSeq

ChatLiveService.backfillHistory live.ts:707-967
  ↳ gateway.history -> normalize -> upsertMessages -> emit chat.message.upsert
  ↳ run-scope filter (messageWithinRunBackfillScope) drops out-of-scope changed
    rows BEFORE emit (but they ARE persisted)

Pruning (no patches emitted)
  pruneSegmentToCanonicalMessages    DELETE FROM v2_messages WHERE …
  deleteMessageById                  DELETE FROM v2_messages WHERE message_id=…
  deleteMessagesForSegment           DELETE FROM v2_messages WHERE segment_id=…

v2_messages schema (db/migrate.ts:25)
  PRIMARY KEY (session_key, openclaw_seq)  ← UNIQUE; segment_id NOT in PK

v2_projection_events schema (db/migrate.ts:73)
  cursor INTEGER PRIMARY KEY AUTOINCREMENT  ← monotone within an epoch
```

---

## Adversarial scenarios checked

| Scenario | Predicted response | Code citation | Verdict |
| --- | --- | --- | --- |
| Empty session (no v2_messages rows) | `messages: [], messageCount: 0, cursor: 0` (or last cursor for unrelated patches). No `hasOlder` flag. Indistinguishable from "all rows hidden". | `routes.ts:1396-1408`, `repo.messages.ts:1010` | **fail** (Bug 2) |
| Session with only hidden subagent-completion messages | `messages: [], messageCount: 0`. Bootstrap returns the same. Client has no way to know rows exist. | `repo.messages.ts:1041`, `routes.ts:1393` | **fail** (Bugs 1, 2) |
| Last 50 messages all hidden, older 250 visible, `limit=50`, `beforeSeq=MAX` | SQL returns the 50 hidden rows. JS filter strips all. Response: 0 visible. Client believes session has no messages. | `repo.messages.ts:990-1041` | **fail** (Bug 1) |
| Concurrent send + page fetch | Send appends; page reads SQLite snapshot. Better-sqlite3 is synchronous, so no torn read. Patch broadcast may arrive at client before/after page response; dedupe by messageSeq is needed. | `repo.messages.ts:243-385`, `patches.ts:39-56` | uncertain — relies on UI dedupe |
| Patch arrives mid-pagination (window query in flight) | Patch is broadcast to all SSE clients immediately; the page response is a snapshot of `v2_messages` at one point in time. Race possible on order of arrival. messageSeq present in patch → UI can dedupe. | `live.ts:365-392`, `routes.ts:1396` | likely OK (with UI dedupe) |
| `beforeSeq` points to a hidden message | Strict-less-than excludes the hidden row itself, returns rows below it. If most of those are also hidden, page can collapse. | `repo.messages.ts:997` | **fail** (compounded Bug 1) |
| `beforeSeq` points to a deleted/non-existent seq | `openclaw_seq < @beforeSeq` returns the next-lower existing rows. No error. Client cannot tell the seq was deleted. | `repo.messages.ts:997` | acceptable / opaque |
| Archived backfill running concurrently with paging request | Archive backfill is sync (`for` loop, `await yieldToEventLoop` between files). Writes are inside `db.transaction`. Reads are between transactions. Pages can see partial archive state but not torn rows. `pruneSegmentToCanonicalMessages` deletes don't emit patches. | `routes.ts:457-494`, `repo.messages.ts:574-624` | **fail** (Bug 8) |
| Session reopened after middleware restart (epoch reset) | `v2_projection_events.cursor` restarts low. Hello frame ships `latestCursor` so client can reset its global cursor. `v2_messages.openclaw_seq` is durable; `gateway_offsets` is durable. Pagination unaffected. | `patches.ts:148-165` | OK |
| Tool patch projected after its run already ended | `scheduleHistoryBackfill` (300 ms debounce) calls `backfillHistory`; runs the run-scope filter (`messageWithinRunBackfillScope`); already-terminated tools are guarded at `live.ts:830-854`. | `live.ts:766-870` | OK |
| Multiple SSE clients on same session, one paging while other streaming | `PatchBus.broadcast` fans out the same frame to every client. There's no per-client backpressure or per-client window awareness. A client that just paged `[seq>=200]` still receives `messageSeq=50` patches and must drop them. | `patches.ts:39-56`, `live.ts:385-392` | acceptable (UI must filter) |
| Send fails after optimistic insert (gateway rejects) | Optimistic row stays in `v2_messages`; route emits failure events; cleanup paths (`routes.ts:1199-1296`) update run status. The optimistic message itself is NOT auto-removed. `/api/chat/messages` returns it (no `__clientOptimistic` filter). | `repo.messages.ts:737-761`, `routes.ts:1199-1296` | uncertain — could leave dangling rows |
| `live:<runId>:assistant` placeholder present when client pages | Row is returned by `listMessages` with seq from `nextMessageSeq`. Once final assistant lands, `handleSessionMessage` deletes by id and reassigns the seq, emitting a single patch under the FINAL messageId. Client must reconcile by messageId. | `live.ts:288-298, 1048-1063`, `repo.messages.ts:870-875` | **fail** (Bug 4) |

---

## Recommendations (smallest blast-radius first)

1. **Include window metadata in `/api/chat/messages` response.** Add
   `hasOlder`, `hasNewer`, `oldestSeq`, `newestSeq`, `visibleCount`, and
   `scannedCount`. This is additive and unblocks the client without changing
   the SQL. `oldestSeq` / `newestSeq` are min/max of the returned (post-filter)
   visible set; `hasOlder = exists(openclaw_seq < oldestSeq)`. (`routes.ts:1396`.)
2. **Re-run `listMessages` until `visibleCount === limit` or scan exhausted.**
   Smallest fix to Bug 1: route-side loop that pages internal SQL windows of
   `limit * 2` (or doubling) and accumulates visible rows. Keep the SQL LIMIT;
   just don't trust a single pass.
3. **Promote the hidden-row filter into the SQL.** Persist a
   `hidden_reason TEXT` column (`subagent_announce`, `attached_file_echo`,
   `live_placeholder`, etc.) at write time in `upsertMessages`; index it; add
   `AND hidden_reason IS NULL` to the SQL window. This fixes Bug 1 and Bug 4
   without per-row JSON parsing in JS. Requires a one-time backfill.
4. **Stop persisting `live:<runId>:assistant` rows in `v2_messages`.** Either
   keep them only in memory (`Map<sessionKey, LivePlaceholder>`) and merge at
   read time, OR mark them with `hidden_reason='live_placeholder'` and stream a
   parallel `chat.assistant.live` patch that the UI projects independently.
   (`live.ts:1039-1086`.) Fixes Bug 4 and removes the "ghost row" race.
5. **Emit `chat.message.delete` patches from every deletion path.** Wrap
   `pruneSegmentToCanonicalMessages`, `deleteMessageById`, and
   `deleteMessagesForSegment` to append a projection event per deleted row.
   (`repo.messages.ts:208, 574-624, 870-875`.) Fixes Bug 8.
6. **Document and enforce the visible-row contract in a single normalizer.**
   Today `normalizeHistoryMessages` (write-time, 3-filter) and the route's
   `isNonUserAttachedFileEcho` + repo's `isInternalSubagentCompletionMessage`
   (read-time, 2-filter) are not identical. Pick one canonical predicate
   (`isHiddenForUiContract(msg) -> reason | null`), call it from every entry
   point. Add a `pnpm --filter middleware typecheck`-clean unit test enumerating
   every hidden reason.
7. **Add `messageSeq` to tool / subagent patches** (even if redundant), so the
   contract is uniform. Route every `appendProjectionEvent` through a single
   builder that asserts `messageSeq: number` is present unless explicitly
   exempted by semanticType.
8. **Stop hard-coding `hasOlder: false` / `oldestLoadedSeq: null` in
   `buildChatBootstrapSnapshot`** (`projection.ts:147-150`). Compute them from
   `params.messages`; rename `knownTotalMessages` to `visibleMessageCount` or
   make it the raw DB count.
9. **Introduce a `seqEpoch` field on session.** Bumped on `resequenceSessionMessages`
   and on `confirmOptimisticUser` shift. Bootstrap and `/api/chat/messages`
   responses include it; clients invalidate cursors when it changes. Fixes Bug 5
   without rewriting the seq logic.
10. **Add the failing tests above to `apps/middleware/tests/`.** They are the
    cheapest forcing function: even before fixing, they document the contract
    and surface future regressions.

---

## What is already correct (call-outs)

- **Live single-message ingest correctly filters all three hidden categories.**
  `handleSessionMessage` calls `normalizeHistoryMessages(sessionKey, [message], …)`
  at `live.ts:271` and bails if the array is empty. So attached-file echoes
  and subagent-completion sentinels never become live patches via that path.
- **Patch envelope carries `messageSeq` for the message paths that matter**
  (`live.ts:353,380,860-863 (tool no), 937`). Where present, clients can
  dedupe and window-filter.
- **`openclaw_seq` collisions inside a single segment are handled** by the
  two-pass negative-sentinel shift (`repo.messages.ts:299-345, 462-518`). This
  is unusual and worth keeping; the comment block documenting WHY is excellent.
- **Hello frame `latestCursor` correctly closes the epoch-reset loop** that
  commit `84aa56cf` describes. The server side at `patches.ts:148-165` is
  exactly the minimum change needed.
- **`pruneSegmentToCanonicalMessages` is intentionally idempotent and protects
  optimistic rows** via `isOptimisticData` (`repo.messages.ts:586`). Good.
- **The collision-order test exists** (`apps/middleware/tests/repo.messages.collision-order.test.ts`),
  so the shift path is regression-covered. The window-contract tests are the
  gap.
