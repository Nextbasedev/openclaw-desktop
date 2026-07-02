# Plan: Auto-Compaction Indicator in Chat

**Goal:** When an OCPlatform session auto-compacts mid-run (context full), show it in the
chat screen: a horizontal divider reading "Compacting automatically" with a small
loader while it runs, click-to-expand a details box showing the compaction summary
(goal/progress) that OCPlatform itself produced. Must survive history reload + caching,
and work even when compaction starts during a tool call / streaming response.

---

## 1. Verified OCPlatform wire contract (runtime 2026.4.23, gitSha a979721)

Source: reverse-read of `~/.openclaw/runtime/openclaw-telegram-timeout/dist` +
real session transcripts under `~/.openclaw/agents/main/sessions`.

### 1a. Live in-progress signal — gateway `agent` event
`server.impl` broadcasts every agent stream event via `broadcast("agent", payload)`.
Compaction is a non-tool stream, so it is delivered as:

```jsonc
{ "event": "agent", "payload": {
  "runId": "...", "sessionKey": "agent:...", "seq": 42, "ts": 1751...,
  "stream": "compaction",
  "data": { "phase": "start" | "end", "completed": true|false, "summary": "..." }
}}
```
- `phase:"start"` → compaction began (show spinner divider).
- `phase:"end"` + `data.completed === true` → finished OK.
- `phase:"end"` + `completed !== true` → incomplete/cancelled.

The middleware `ChatLive.handleAgentEvent` currently handles only
`stream` = `item` / `command_output` / `thinking` / assistant-delta. **`compaction`
is silently dropped today.**

### 1b. Persisted record + history replay — gateway `session.compaction` event
When a compaction transcript entry is appended (and during history replay),
`commands-handlers.runtime` pushes:

```jsonc
{ "event": "session.compaction", "payload": {
  "summary": "## Goal\n...\n## Progress\n...",   // markdown, OCPlatform-authored
  "firstKeptEntryId": "8337ea68",
  "tokensBefore": 123456,
  "details": { ... },                             // structured, sanitized
  "fromHook": false
}}
```
Persisted transcript entry shape (`~/.openclaw/agents/.../*.jsonl`):
`{ type:"compaction", id, parentId, timestamp, summary, firstKeptEntryId, tokensBefore, details, fromHook }`.
**Not handled by the middleware today** (no `session.compaction` case, no projection).

### 1c. Channel notice (NOT the desktop path)
`agent-runner.runtime` also has `sendCompactionNotice()` that posts a block reply
"🧹 Compacting context..." tagged `isCompactionNotice:true`, gated by
`agents.defaults.compaction.notifyUser`. That is for Telegram/Discord text channels.
Desktop should use the structured `agent`/`session.compaction` events instead — do
NOT depend on `notifyUser`.

### Assumption / residual risk
The code trace is authoritative, but I have not captured a live compaction WS frame
(triggering a real compaction needs a full context). Mitigation: middleware handler
is written defensively (tolerates missing `completed`/`summary`), and we log every
`stream:"compaction"` / `session.compaction` receipt so the first real compaction in
dev confirms the shape. If `data.phase` values differ, only one switch needs editing.

---

## 2. Middleware layer (`apps/middleware`)

Reuse the existing persisted patch bus (`appendProjectionEvent` → SQLite → replayed
by `listPatchesAfter` on bootstrap). This gives caching + reload persistence for free.

New patch types:
- `chat.compaction.status` — **live, ephemeral** (start/end). Broadcast only (not the
  key persistence mechanism); carries `{ runId, phase, completed }`.
- `chat.compaction.marker` — **persisted** via `appendProjectionEvent`; carries
  `{ compactionId, runId, summary, tokensBefore, firstKeptEntryId, details, fromHook, createdAtMs }`.
  Because it is appended, it replays on reload and is cached like every other patch.

Changes:
1. `chat/live.ts`
   - `handleGatewayEvent`: add `if (event.event === "session.compaction") this.handleCompaction(event.payload)`.
   - `handleAgentEvent`: before the tool branch, add
     `if (payload.stream === "compaction") { this.handleCompactionStatus(sessionKey, run, data); return }`.
   - `handleCompactionStatus(sessionKey, run, data)`: map `data.phase`→status, broadcast
     `chat.compaction.status` (ephemeral, not appended). Also flip run statusLabel to
     "Compacting…" while active so the composer/typing affordance is honest.
   - `handleCompaction(payload)`: build the marker payload, `appendProjectionEvent`
     (`chat.compaction.marker`) keyed by a stable id (derive from
     `firstKeptEntryId`+seq so replay is idempotent), then `patchBus.broadcast`.
2. `chat/message-semantics.ts`: register the two new semantic types so they route.
3. Idempotency: dedupe markers by `compactionId` in the messages/segment store the
   same way message upserts dedupe (avoid double-insert on live + replay).

Tests (vitest, `apps/middleware/tests`):
- `compaction.test.ts`: feed a fake gateway `agent` compaction start/end and a
  `session.compaction` event through `ChatLive`; assert the exact patches broadcast,
  ordering, idempotency on replay, and that a compaction during `tool_running` does
  not terminate the run.

## 3. Frontend engine (`packages/ui/lib/chat-engine-v2`)

1. `types.ts`: extend `PatchPayloadV2` unions; add a `CompactionMarker` type
   `{ id, runId?, summary, tokensBefore?, firstKeptEntryId?, details?, createdAtMs }`
   and add `compaction: { activeRunId: string | null; markers: CompactionMarker[] }`
   to `ChatStateV2`.
2. `applyPatches.ts` / `store.ts`:
   - `chat.compaction.status` → set/clear `compaction.activeRunId` (start sets,
     end clears). Does not add a timeline row by itself.
   - `chat.compaction.marker` → upsert into `compaction.markers` (dedupe by id),
     ordered by `createdAtMs`.
3. Timeline placement: markers carry `createdAtMs`; ChatView interleaves them with
   `messages` by timestamp so the divider sits where compaction actually happened.
4. Bootstrap/cache: markers live in the same patch stream, so
   `CachedChatBootstrapV2` already persists them — bump `CHAT_PROJECTION_VERSION`.

## 4. UI (`packages/ui/components/ChatView`)

New `CompactionDivider.tsx`:
- A full-width horizontal rule with centered pill.
- Live (`activeRunId` set, no matching marker yet): pill = spinner +
  "Compacting automatically". Uses existing token classes (surface/line/ink), the
  project spinner, `cn()` — no inline hex, honor motion tokens.
- Resolved (marker present): pill becomes a button; click toggles a details box
  docked directly beneath the divider showing the OCPlatform `summary` rendered as
  markdown (reuse the existing markdown renderer used by MessageBubble), plus a small
  meta line (tokensBefore). Details come verbatim from OCPlatform — no custom copy.
- Rendered inline in `ChatView/index.tsx`'s row map at the interleaved position;
  keyed by marker id (or `live-compaction:<runId>` while pending) so virtualization
  and prepend-anchoring stay stable.

## 5. Verification (per standing E2E rule)
1. `pnpm --filter @openclaw/desktop-middleware exec vitest run tests/compaction.test.ts`.
2. `pnpm --filter ui` vitest for store/applyPatches compaction cases.
3. `pnpm --filter ui typecheck` + middleware typecheck.
4. `pnpm --filter ui build` (host RAM-limited; fall back to tsc + evidence if it OOMs).
5. Run middleware + app, force a compaction (or inject a synthetic `session.compaction`
   + `agent` compaction event via a dev harness), drive the divider open/close, confirm
   clean DevTools console + patch logs, screenshot both states.
6. Reload chat → divider + details persist from cache/replay (caching requirement).

## 6. Sequencing
1. Middleware handlers + semantics + tests (deterministic; do first).
2. Engine types + applyPatches/store + unit tests.
3. UI divider/details + ChatView interleave.
4. Full app drive + screenshots.

Branch: `krish-master` (current). Small targeted commits per layer.
