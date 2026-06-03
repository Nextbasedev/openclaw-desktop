# Chat Frontend Plan — v5 (clean rebuild)

Status: **PLAN ONLY — do not implement yet.**
Branch context: `v5` (legacy chat UI fully removed; middleware stable).
Author: Cozy, for Dixit.

This plan rebuilds the chat frontend from scratch against the **current middleware
contract**. It deliberately discards the v3/v4 approach (content-fingerprint stable
IDs, hybrid assistant-ui/ChatView wrapper) which was the root cause of blink /
remount / reorder bugs. The new design treats the middleware as the single source
of truth and the UI as a pure, cursor-ordered projection of it.

---

## 0. Why the old approach failed (so we don't repeat it)

From `VERCEL_CHATBOT_REPLACEMENT_PLAN.md` + the 06-02 debugging session:

1. **Identity was derived from content** (`text + attachment names + approximate order`).
   Duplicate text collapsed rows; reorders shifted assistant slots. Fragile by design.
2. **Hybrid rendering** — assistant-ui path wrapped inside legacy `ChatView`, so a
   state/flag change could remount the whole subtree → blink.
3. **No single source of truth for run state** — `isRunning`/status got stuck from
   5+ triggers; tool cards leaked across turns.
4. **Streaming fought reconciliation** — final assistant message id differed from
   live/delta id → React unmounted the streaming row and re-rendered everything.
5. **Virtualization + streaming were coupled** — re-render storms (20–40 renders per
   `chat.tool.update` burst).

**Design rule for v5:** identity comes from the **server**, run state has **one owner**,
and the **actively-streaming turn is rendered outside the virtualizer**.

---

## 1. Middleware contract (the source of truth)

### 1.1 Transport
- **Bootstrap (snapshot):** `GET /api/chat/bootstrap?sessionKey&limit&maxChars`
  Returns `buildChatBootstrapSnapshot`:
  `{ messages[], messageCount, tools[]/toolCalls[], runStatus, statusLabel,
     activeRun, cursor, knownTotalMessages, hasOlder, oldestLoadedSeq,
     historyCoverage, thinkingLevel, fastMode, verboseLevel, projectionVersion }`
- **Live (deltas):** WebSocket `GET /api/stream/ws?afterCursor=<cursor>`
  - First frame: `{ type:"hello", afterCursor, replayCount, replayHasMore,
    replayWindowExceeded, recovery }`.
  - Then `{ type:"patch", patch }` frames in **strictly increasing `cursor`**.
  - If `recovery === "bootstrap"` (cursor too far behind) → **re-bootstrap**, don't
    apply partial replay.
- **REST replay (fallback):** `GET /api/patches?afterCursor&limit` →
  `{ patches[], latestCursor, hasMore, replayWindowExceeded, recovery }`.
- **Older history (pagination):** `GET /api/chat/messages?sessionKey&beforeSeq&limit`
  (also `afterSeq`). Server returns projected messages with `openclawSeq`.
- **Send:** `POST /api/chat/send` `{ sessionKey, text, attachments, idempotencyKey,
  clientMessageId, agentId, execPolicy, label }`.
- **Abort:** `POST /api/chat/abort`.
- **Full tool result (untruncated):** `GET /api/chat/tool-result?sessionKey&toolCallId`.
- **Search:** `GET /api/chat/search?sessionKey&query`.
- **Exec approval:** `POST /api/exec/approval/resolve`.

### 1.2 Patch (cursor) model
Every patch: `{ cursor, type, sessionKey, payload, createdAtMs }`.
`cursor` is a global monotonic integer = the **only ordering authority**.
`type` (a.k.a. `semanticType`) is one of:

- User: `chat.user.created` (optimistic echo), `chat.user.confirmed` (canonical)
- Assistant text: `chat.assistant.delta` (streaming chunk), `chat.message.upsert`
  (assistant message body), `chat.assistant.final` / `chat.final`
- Reasoning: `chat.reasoning.delta`
- Tools: `chat.tool.started`, `chat.tool.update`, `chat.tool.result`, `chat.tool.error`
- Run lifecycle: `chat.run.status`, `chat.run.streaming`, `chat.run.done`,
  `chat.run.error`, `chat.run.aborted`
- Session/meta: `chat.status`, `chat.bootstrap`, `chat.history`, `session.upsert`

### 1.3 Identity primitives provided by the server (USE THESE, never invent)
- `openclawSeq` — monotonic per-session message order. **Primary sort key.**
- `messageId` / `__openclaw.id` — canonical message identity.
- `__openclaw.runId` / `runId` — groups an assistant turn.
- `clientMessageId` — echoed back on `chat.user.confirmed` → **the join key** that
  maps an optimistic user row to its canonical row (no fingerprinting).
- `idempotencyKey` — send dedupe.
- Tool: `toolCallId` (stable), `phase` (start/calling/update/result/error),
  `status` (running/success/error).
- Run: `status` ∈ `queued|thinking|streaming|tool_running|done|error|aborted`.

---

## 2. Frontend architecture

Three layers, strictly separated. The data layer never touches React; the view
layer never invents identity or status.

### Layer A — Connection/sync (`chat/sync/`)
- `ChatSyncClient`: owns one WS, bootstrap, and gap recovery.
  - On open: bootstrap (gets `cursor`) → connect WS with `afterCursor=cursor`.
  - Apply replayed patches, then live patches, in cursor order.
  - **Gap guard:** if an incoming patch `cursor > lastCursor + 1` and we have a
    hole, OR `hello.recovery==="bootstrap"`, OR WS reconnects stale → re-bootstrap
    (atomic store reset). This is the only correct fix for replay-window-exceeded.
  - Reconnect with backoff; resubscribe `afterCursor=lastAppliedCursor`.
- One WS per **active** session only (matches middleware note: do not subscribe all
  recent chats; foreground ChatView subscribes its own session).

### Layer B — State store (single source of truth) (`chat/store/`)
A framework-agnostic reducer (plain TS + a tiny subscribe API; Zustand/Jotai
optional as the React binding). **One** `applyPatch(state, patch)` pure function.

Normalized shape:
```
ChatSessionState {
  cursor: number                       // last applied cursor
  status: RunStatus | "idle"
  activeRun: { runId, status, statusLabel, startedAtMs } | null
  order: string[]                      // row keys sorted by openclawSeq
  messages: Map<key, MessageRow>       // user + assistant rows
  runs:     Map<runId, RunRow>         // turn-level state
  tools:    Map<toolCallId, ToolRow>
  pagination: { knownTotalMessages, oldestLoadedSeq, hasOlder, loadingOlder }
}
```
Reducer rules (deterministic, idempotent, cursor-guarded):
- Ignore any patch with `cursor <= state.cursor` (dedupe/out-of-order safety).
- `chat.user.created`: insert optimistic row keyed by `client:<clientMessageId>`.
- `chat.user.confirmed`: find row by `clientMessageId`; **rewrite its identity to
  canonical messageId in place** (same React key — see §3). Never delete+recreate.
- `chat.assistant.delta`/`reasoning.delta`: **append** to the run's buffer; never
  replace existing buffer with a non-extending value (continuation check).
- `chat.message.upsert`/`assistant.final`: set canonical body for the run's
  assistant row; keep the run's React key stable across delta→final.
- `chat.tool.*`: upsert into `tools` by `toolCallId`, attach to `runId`.
- `chat.run.*`: single owner of `status`/`activeRun`. Terminal states
  (`done|error|aborted`) clear `activeRun`. (Kills the stuck-`isRunning` class.)
- `chat.bootstrap` (background refresh patch): reconcile, prune to canonical.

This store is unit-testable headless (no DOM) — port the old
`chat-projection-contract.test.ts` expectations.

### Layer C — View (`chat/ui/`)
Pure render of the store. The view **never** computes identity or run state.

---

## 3. Stable identity & React keys (the core fix)

- **Row React key = stable local key**, assigned once and preserved across backend
  id changes:
  - User: key = `clientMessageId` for the whole optimistic→confirmed lifecycle.
    Store the canonical `messageId` as data, not as the key.
  - Assistant turn: key = `runId` (one assistant row per run). Delta→final→upsert
    all mutate the same row under the same key.
  - History rows (from bootstrap/older fetch): key = `messageId` (already canonical),
    fallback `seq:<openclawSeq>`.
- **Sort = `openclawSeq`** only. Never reorder by content or timestamp.
- Result: optimistic confirm, delta→final, and tool appearance never change a row's
  key → React never unmounts → **no blink, no reorder**.

---

## 4. Run/turn rendering model

One assistant **turn** = one `runId` = one assistant row containing, in order:
1. Reasoning block (collapsible) — fed by `chat.reasoning.delta`.
2. Tool cards — `tools` filtered by `runId`, ordered by start; each shows
   phase/status, args meta, result meta; "view full result" calls
   `/api/chat/tool-result`; exec-approval buttons wired to approval resolve.
3. Streaming/final text — buffered reveal (append-only).
4. Action bar (copy/retry/edit/fork/pin/feedback) — appears only when run terminal.

Status surface from `activeRun`:
- `queued|thinking` → shimmer "Thinking…" placeholder (separate from user row).
- `streaming` → text reveals into the row.
- `tool_running` → tool card live state.
- terminal → finalize, show action bar.

---

## 5. Virtualization (scales to long chats)

`knownTotalMessages` can be large. Decouple history from the live turn:

- **Two render zones:**
  1. **Virtualized history** — all finalized rows. Use `@tanstack/react-virtual`
     with dynamic measurement (variable heights). Keyed by stable id (§3).
  2. **Live tail (non-virtualized)** — the active run row + any not-yet-finalized
     rows are rendered normally at the bottom, **outside** the virtualizer. This is
     the key insight: streaming never invalidates virtualizer measurements, so no
     re-render storms.
- On run finalize, the row migrates from live tail into the virtualized history at
  its `openclawSeq` position (cheap, one-time).
- **Older loading:** when top sentinel enters view and `hasOlder`, call
  `/api/chat/messages?beforeSeq=oldestLoadedSeq`; prepend with scroll-anchor
  preservation (compensate scrollTop by inserted height) so the viewport doesn't jump.
- Alternative if react-virtual proves heavy with markdown: CSS
  `content-visibility:auto` + `contain-intrinsic-size` on history rows. Tradeoff:
  simpler, but less reliable for 5k+ msgs and for accurate scroll restoration.
  **Recommendation:** start with react-virtual for history + non-virtual live tail.

---

## 6. Smoothness engineering

1. **One stable scroll viewport** — a single `overflow-y-auto` container that is
   never swapped/remounted on send/response/session change (reset state, not DOM).
2. **Stick-to-bottom with intent** (Vercel `use-scroll-to-bottom` pattern):
   - track `isAtBottom` (120–160px threshold), user-scroll intent timeout;
   - `ResizeObserver` on the live tail for streaming/tool growth;
   - if pinned → follow bottom; if user scrolled up → show jump-to-latest button,
     don't force scroll.
3. **Buffered streaming reveal** — append-only; reset reveal only if new text is not
   a continuation of current display. Never blank+rerender.
4. **RAF-batched store→view** — coalesce multiple patches arriving in one frame into
   a single React commit (middleware already coalesces deltas at 16ms; mirror that
   on the client). Only the active-run row subscribes to delta updates; history rows
   are memoized and never re-render during streaming.
5. **Animation** — `transitions.dev` (FLIP/auto-height) for: new-row enter, reasoning
   expand/collapse, tool card height, and turn finalize. Respect
   `prefers-reduced-motion` (instant reveal).
6. **Isolated re-render** — split components so the streaming text node is its own
   memo boundary; tool cards memoized per `toolCallId+updatedAtMs`.

---

## 7. Library choices (with tradeoffs)

References to map onto the layers:

- **AI Elements (`elements.ai-sdk.dev`)** — recommended for the visual building
  blocks: `Conversation`, `Message`, `Response` (streamed markdown), `Reasoning`,
  `Tool`, `PromptInput`. They're unstyled/composable and match our turn model.
  Tradeoff: assumes AI-SDK message shape → we feed them from our store via a thin
  adapter, not from AI-SDK's `useChat`.
- **Vercel chatbot (`vercel/chatbot`)** — copy the *patterns*, not the data layer:
  scroll hook, messages list structure, composer shell, thinking placeholder.
- **assistant-ui (`assistant-ui.com`)** — full runtime + primitives. Option B below.
- **transitions.dev** — animation layer for smoothness (§6.5).
- **opencode (`anomalyco/opencode`)** — reference for desktop agent-chat + rich tool
  rendering (terminal/diff/file tools) and keyboard-first UX; informs our ToolCard
  variants and command palette.

**Two viable approaches — pick one before building:**

- **Approach A (recommended): custom thin runtime + AI Elements + react-virtual.**
  - Pros: full control over identity/cursor/virtualization (the exact things that
    broke before); no fighting a 3rd-party runtime's reconciliation; smallest
    surface to keep stable.
  - Cons: we own scroll/stream/animation glue.
- **Approach B: assistant-ui runtime with a custom `ExternalStoreAdapter`.**
  - Pros: batteries-included primitives, composer, branching.
  - Cons: this is essentially what failed in v4; its reconciliation expects stable
    message ids and fought our optimistic/canonical churn. Only revisit if we first
    prove our store yields fully stable ids (§3) and adapt assistant-ui's external
    store (not its message-id-derived identity).

Decision: **Approach A.** It directly addresses every prior failure mode and keeps
the middleware as the only source of truth.

---

## 8. Component tree (Approach A)

```
ChatScreen
├─ ChatSyncProvider            (Layer A+B: WS + store, context)
├─ ChatViewport                (single stable scroll container)
│  ├─ LoadOlderSentinel        (top; triggers /api/chat/messages?beforeSeq)
│  ├─ VirtualHistory           (@tanstack/react-virtual; finalized rows)
│  │   ├─ UserRow (memo)
│  │   └─ AssistantTurn (memo)  reasoning + ToolCard[] + Response
│  ├─ LiveTail                 (non-virtualized; active run + unfinalized)
│  │   ├─ ThinkingPlaceholder  (when activeRun queued/thinking)
│  │   └─ AssistantTurn(live)  (streaming, subscribes to deltas)
│  └─ JumpToLatestButton
└─ Composer                    (PromptInput; optimistic send; stop button)
```

Cross-cutting: `SearchOverlay`, `PinnedOverlay`, `SubagentBar/Card`,
`ExecApprovalPrompt` — built as overlays/sub-rows reading the same store.

---

## 9. Phasing & acceptance

- **Phase 0 — Contract harness:** typed client for all endpoints + WS; record real
  patch streams (we already have captured trajectories) into fixtures.
- **Phase 1 — Headless store:** `applyPatch` reducer + bootstrap reset + gap
  recovery; pass ported `chat-projection-contract` tests on real fixtures. No UI.
- **Phase 2 — Static timeline:** render bootstrap snapshot (no streaming) with AI
  Elements; stable keys; virtualized history + older loading + scroll anchoring.
- **Phase 3 — Live streaming:** WS deltas → live tail; buffered reveal; run lifecycle
  status; RAF batching; isolated re-render.
- **Phase 4 — Tools & approvals:** ToolCard variants, full-result fetch, exec
  approval; subagent bar.
- **Phase 5 — Smoothness:** transitions.dev animations, stick-to-bottom intent,
  reduced-motion, jump-to-latest.
- **Phase 6 — Composer + parity:** attachments, voice, edit/retry/fork/pin/feedback,
  search/pinned overlays.
- **Phase 7 — Hardening:** reconnect/gap-recovery chaos tests; the exact v4 repro
  (image + 4–5 tool-heavy messages) must stay ordered and stable; long-chat (5k msg)
  scroll perf; typecheck + build + targeted eslint.

**Acceptance (must all hold):**
1. Sent user message stays visible continuously (optimistic→confirmed, no blink).
2. Assistant: thinking → streams into the *same* row → finalizes, no hide-then-flash.
3. Tool cards stay attached to their run; never leak across turns; reorder-free.
4. Run status has one owner; never stuck "Thinking" after terminal.
5. Replay-window-exceeded / reconnect → clean re-bootstrap, consistent transcript.
6. The image + tool-heavy stress sequence preserves order and identity.
7. Long chats scroll smoothly; older loads without viewport jump; no render storms.
8. Headless store tests + typecheck + build pass.

---

## 10. Explicit non-goals
- No changes to middleware or Gateway protocol (UI projects existing state).
- No content-fingerprint identity. No hybrid wrapper around a legacy view.
- No subscribing all recent sessions on connect (foreground session only).
```
