# Chat Frontend — Approach A: Build Plan (v5)

Status: **PLAN ONLY — do not implement yet.**
Parent: `CHAT_FRONTEND_PLAN_V5.md` (architecture + middleware contract + rationale).
Stack (confirmed from `packages/ui/package.json`): Next.js 16, React 19, Tailwind,
Jotai, Framer Motion, React Query, react-markdown (+remark-gfm/breaks), Radix/shadcn.

Approach A = **custom thin runtime + AI Elements (presentational) + react-virtual +
Framer Motion / transitions for smoothness**. Middleware stays the source of truth;
the UI is a cursor-ordered projection. No assistant-ui runtime, no content-based identity.

---

## 1. Dependencies

Add:
- `@tanstack/react-virtual` — history virtualization (dynamic measurement).
- AI Elements: install via shadcn registry (`elements.ai-sdk.dev`) into
  `packages/ui/components/ai-elements/*` (vendored, not a runtime dep). We use only
  the presentational pieces: `Conversation`, `Message`, `Response`, `Reasoning`,
  `Tool`, `PromptInput`, `Actions`, `Loader`.
- (optional) `transitions.dev` — or use the View Transitions API; **Framer Motion is
  already present** and covers enter/height/layout, so transitions.dev is optional
  polish, not required.

Remove/retire (after migration): `@assistant-ui/react`, `@assistant-ui/react-markdown`
(Approach A doesn't use the assistant-ui runtime). Keep react-markdown stack for
`Response` rendering.

> Note: AI Elements components assume AI-SDK `UIMessage` shapes. We do **not** use
> AI-SDK `useChat`. We feed them via a thin adapter from our own store (§4). Where a
> component fights our model, we fork it locally (it's vendored source, not a dep).

---

## 2. Folder layout (`packages/ui/components/chat/`)

```
components/chat/
├─ sync/
│  ├─ apiClient.ts          # typed REST client for all /api/chat/* endpoints
│  ├─ ChatSyncClient.ts     # WS lifecycle + bootstrap + gap recovery (no React)
│  └─ types.contract.ts     # patch/event/snapshot types mirrored from middleware
├─ store/
│  ├─ state.ts              # ChatSessionState types
│  ├─ applyPatch.ts         # pure reducer: (state, patch) => state
│  ├─ applyBootstrap.ts     # snapshot -> initial state (atomic reset)
│  ├─ selectors.ts          # derived views (orderedRows, activeRun, toolsForRun)
│  └─ store.ts              # Jotai atoms + subscribe bridge (React binding)
├─ runtime/
│  ├─ ChatSyncProvider.tsx  # wires ChatSyncClient -> store; context
│  ├─ useChatSession.ts     # hook: rows, status, send, abort, loadOlder
│  ├─ useStreamingText.ts   # buffered append-only reveal for active run text
│  └─ useStickToBottom.ts   # scroll intent + ResizeObserver follow
├─ ui/
│  ├─ ChatScreen.tsx        # top composition
│  ├─ ChatViewport.tsx      # single stable scroll container
│  ├─ VirtualHistory.tsx    # @tanstack/react-virtual over finalized rows
│  ├─ LiveTail.tsx          # non-virtualized active run + unfinalized rows
│  ├─ rows/
│  │  ├─ UserRow.tsx
│  │  ├─ AssistantTurn.tsx  # reasoning + tools + response + actions
│  │  ├─ ThinkingPlaceholder.tsx
│  │  └─ ToolCard.tsx
│  ├─ Composer.tsx
│  ├─ JumpToLatest.tsx
│  ├─ LoadOlderSentinel.tsx
│  └─ overlays/ (SearchOverlay, PinnedOverlay, ExecApprovalPrompt, SubagentBar)
└─ adapt/
   └─ toAiElements.ts       # store row -> AI Elements props (presentational only)
```

Mount point: re-introduce a chat route/panel in `AppPage.tsx` that renders
`<ChatScreen sessionKey=… />`. Keep it behind a flag during build
(`NEXT_PUBLIC_CHAT_V5=1`) so it can land incrementally on `v5`.

---

## 3. Sync layer (`sync/`)

### `apiClient.ts` (typed; thin wrappers, no logic)
```ts
bootstrap(sessionKey, opts?) : Promise<ChatBootstrapSnapshot>      // GET /api/chat/bootstrap
fetchMessages(sessionKey, {beforeSeq?, afterSeq?, limit?})         // GET /api/chat/messages
send(body: SendBody) : Promise<SendResult>                         // POST /api/chat/send
abort(sessionKey) : Promise<void>                                  // POST /api/chat/abort
toolResult(sessionKey, toolCallId) : Promise<{text}>              // GET /api/chat/tool-result
search(sessionKey, query)                                          // GET /api/chat/search
resolveApproval(payload)                                           // POST /api/exec/approval/resolve
patchesAfter(cursor, limit?)                                       // GET /api/patches (fallback)
```

### `ChatSyncClient.ts` (no React)
Responsibilities & state machine:
1. `start(sessionKey)`:
   - `snapshot = bootstrap(sessionKey)` → emit `onBootstrap(snapshot)`; record
     `cursor = snapshot.cursor`.
   - open WS `…/api/stream/ws?afterCursor=cursor`.
2. WS `hello`:
   - if `recovery === "bootstrap"` or `replayWindowExceeded` → **re-bootstrap**, then
     reopen WS at new cursor. Else continue.
3. WS `patch`:
   - if `patch.cursor <= lastCursor` → drop (dedupe).
   - if `patch.cursor > lastCursor + 1` (hole) → **re-bootstrap** (don't apply partial).
   - else `onPatch(patch)`; `lastCursor = patch.cursor`.
4. `close`/`error`: reconnect with backoff (250ms→5s, jitter); on reopen subscribe
   `afterCursor=lastCursor`. After N failures, fall back to REST `patchesAfter` poll.
5. `stop()`: close WS, cancel timers.
6. Single active session — switching sessions = `stop()` + `start(next)` (atomic).

Emits: `onBootstrap(snapshot)`, `onPatch(patch)`, `onStatus(connState)`.
**No DOM, no store import** — pure event source → unit-testable with a fake WS.

---

## 4. Store layer (`store/`) — single source of truth

### `state.ts`
```ts
type RowKind = "user" | "assistant";
type RowKey = string;                       // user: client:<id>; assistant: run:<runId>; history: msg:<id>|seq:<n>

interface MessageRow {
  key: RowKey;
  kind: RowKind;
  seq: number;                              // openclawSeq (sort authority)
  messageId: string | null;                // canonical id once known
  clientMessageId?: string;                // user optimistic join key
  runId?: string;                          // assistant turn
  text: string;                            // committed text
  reasoning?: string;
  attachments?: Attachment[];
  toolCallIds: string[];                   // ordered, belong to this run
  finalized: boolean;                      // in history (true) vs live tail (false)
  model?: string; usage?: unknown; stopReason?: string;
  updatedAtMs: number;
}

interface RunRow { runId; status: RunStatus; statusLabel?; startedAtMs; assistantKey: RowKey; }
interface ToolRow { toolCallId; runId; name; phase; status; argsMeta; resultMeta; awaitingResult?; startedAtMs; finishedAtMs; updatedAtMs; }

interface ChatSessionState {
  sessionKey: string;
  cursor: number;
  status: RunStatus | "idle";
  activeRun: { runId; status; statusLabel?; startedAtMs } | null;
  order: RowKey[];                          // sorted by seq
  rows: Map<RowKey, MessageRow>;
  runs: Map<string, RunRow>;
  tools: Map<string, ToolRow>;
  byMessageId: Map<string, RowKey>;        // canonical id -> key
  byClientId: Map<string, RowKey>;         // optimistic join
  byRunId: Map<string, RowKey>;            // run -> assistant row key
  pagination: { knownTotalMessages; oldestLoadedSeq; hasOlder; loadingOlder };
  conn: "connecting" | "live" | "reconnecting" | "rebootstrapping";
}
```

### `applyBootstrap.ts`
`(snapshot) => ChatSessionState` — atomic reset. Build rows from
`snapshot.messages` (each has `openclawSeq`, `messageId`, role, data), tools from
`snapshot.toolCalls`, set `activeRun`, `cursor`, pagination
(`knownTotalMessages/hasOlder/oldestLoadedSeq`). All rows `finalized:true` except a
row belonging to `activeRun` (kept in live tail).

### `applyPatch.ts` — pure reducer, **cursor-guarded & idempotent**
```
if patch.cursor <= state.cursor: return state            // dedupe/out-of-order
switch (patch.semanticType):
  chat.user.created     -> upsert optimistic user row key=client:<clientMessageId>
  chat.user.confirmed   -> locate via byClientId[clientMessageId];
                           set messageId/seq in place; map byMessageId; KEEP key
  chat.assistant.delta  -> ensure assistant row key=run:<runId> (live);
                           append delta to text (continuation-safe)
  chat.reasoning.delta  -> append to reasoning
  chat.message.upsert /
  chat.assistant.final /
  chat.final            -> set canonical body+messageId on run:<runId> row; KEEP key
  chat.tool.started/update/result/error -> upsert tools[toolCallId]; link runId;
                           push into row.toolCallIds (ordered, dedup)
  chat.run.status/streaming -> set activeRun + status (single owner)
  chat.run.done/error/aborted -> finalize run; activeRun=null; mark row finalized;
                           schedule migration history (selector handles placement)
  chat.bootstrap (bg)   -> reconcile/prune: drop rows not in canonical set unless
                           they belong to an active run
  chat.status           -> session-level status label
set state.cursor = patch.cursor; bump updatedAtMs
```
Rules: never delete+recreate a row that has a stable key; sort `order` by `seq`;
terminal run states are the ONLY thing that clears `activeRun`.

### `selectors.ts`
- `historyRows(state)` → rows where `finalized`, sorted by seq (for virtualizer).
- `liveRows(state)` → unfinalized rows + active run (for live tail).
- `toolsForRun(state, runId)` → ordered ToolRow[].
- `activeRunView(state)` → status/label for thinking placeholder.

### `store.ts` (React binding via Jotai — already a dep)
- `chatStateAtom` holds `ChatSessionState`.
- `applyPatchAtom` / `applyBootstrapAtom` write atoms.
- **RAF batching:** a queue atom collects patches; a single rAF flush applies them in
  cursor order and commits once → one React commit per frame.
- Fine-grained selector atoms so history rows don't re-render during streaming
  (`selectAtom`/`atomFamily` by RowKey).

---

## 5. Runtime hooks (`runtime/`)

- `ChatSyncProvider`: instantiate `ChatSyncClient` for `sessionKey`; pipe
  `onBootstrap→applyBootstrap`, `onPatch→enqueue(RAF)`, `onStatus→conn`. Cleanup on
  unmount / sessionKey change.
- `useChatSession()` returns:
  `{ historyRows, liveRows, activeRun, conn, send, abort, loadOlder, search }`.
  - `send(text, attachments, opts)`: generate `clientMessageId` + `idempotencyKey`;
    optimistic append is driven by the server `chat.user.created` echo (preferred) or
    a local optimistic row keyed by `clientMessageId` reconciled on confirm.
  - `loadOlder()`: `fetchMessages(beforeSeq=oldestLoadedSeq)`; prepend; update
    pagination; preserve scroll anchor (handled in viewport).
- `useStreamingText(runId)`: buffered, append-only reveal; only re-reveal if new text
  is NOT a continuation; respects `prefers-reduced-motion`.
- `useStickToBottom(viewportRef, liveTailRef)`: `isAtBottom` (140px), user-intent
  timeout, `ResizeObserver` on live tail; expose `pinned`, `scrollToLatest()`.

---

## 6. View layer (`ui/`) + AI Elements mapping

- `ChatScreen` → `ChatSyncProvider` + `ChatViewport` + `Composer`.
- `ChatViewport`: ONE `overflow-y-auto` div, never remounted. Contains
  `LoadOlderSentinel`, `VirtualHistory`, `LiveTail`, `JumpToLatest`.
- `VirtualHistory`: `useVirtualizer({ count: historyRows.length, estimateSize,
  measureElement })`; render `UserRow`/`AssistantTurn` (memoized by key+updatedAtMs).
  Wrap in AI Elements `Conversation`/`Message` for layout.
- `LiveTail`: non-virtualized; renders active `AssistantTurn` (streaming) +
  `ThinkingPlaceholder` when `activeRun.status ∈ {queued,thinking}`. This subtree is
  the only one that re-renders on deltas.
- `AssistantTurn`: AI Elements `Message` →
  `Reasoning` (collapsible) + `ToolCard[]` (from `toolsForRun`) + `Response`
  (markdown stream) + `Actions` (copy/retry/edit/fork/pin/feedback, terminal only).
- `UserRow`: AI Elements `Message` (right-aligned) + attachments preview.
- `ToolCard`: AI Elements `Tool` adapted — phase/status badge, args/result meta,
  "view full result" → `toolResult()`, exec-approval buttons → `resolveApproval()`.
- `Composer`: AI Elements `PromptInput` — attachments, voice, stop button while
  generating; clears immediately on submit; never remounts.

`adapt/toAiElements.ts`: maps `MessageRow`/`ToolRow` → the props AI Elements expect.
Pure, presentational; carries our `key` through unchanged.

Animations (Framer Motion / optional transitions.dev): row enter (new only),
reasoning expand/collapse, tool card height, turn finalize migration. Reduced-motion
= instant.

---

## 7. Virtualization & scroll specifics

- History virtualized with dynamic measurement; stable keys (§3 parent doc).
- Live tail outside virtualizer → streaming never invalidates measured sizes.
- On `run.done`, the live assistant row flips `finalized:true`; selector moves it into
  `historyRows`; it renders once in the virtualizer at its seq slot (no flash because
  same DOM content, Framer `layout` smooths the handoff).
- Older load: top sentinel + `hasOlder` → fetch `beforeSeq`; before prepend, capture
  `scrollHeight`; after insert, set `scrollTop += (newScrollHeight - oldScrollHeight)`
  so viewport stays anchored.
- Stick-to-bottom: pinned → follow growth via ResizeObserver; scrolled up → show
  `JumpToLatest`, don't force.

---

## 8. Phase plan (file-level)

**Phase 0 — Contract harness**
- `sync/types.contract.ts`, `sync/apiClient.ts`.
- Capture real patch streams (we have trajectories) → `__fixtures__/*.jsonl`.
- Fake WS + fixture player for tests.

**Phase 1 — Headless store (no UI)**
- `store/state.ts`, `applyBootstrap.ts`, `applyPatch.ts`, `selectors.ts`.
- Tests: replay each fixture → assert final transcript stable, ids canonical,
  no dup/reorder, tools attached to right run, status terminal correct, idempotent
  on replay, gap → rebootstrap signaled. Port `chat-projection-contract` expectations.

**Phase 2 — Sync client**
- `sync/ChatSyncClient.ts` + reconnect/gap/rebootstrap tests with fake WS.

**Phase 3 — Static timeline**
- `store/store.ts`, `runtime/ChatSyncProvider.tsx`, `useChatSession.ts`.
- `ui/ChatScreen/Viewport/VirtualHistory/rows` rendering a bootstrap snapshot
  (no streaming). Older load + scroll anchoring. Behind `NEXT_PUBLIC_CHAT_V5`.

**Phase 4 — Live streaming**
- `LiveTail`, `useStreamingText`, RAF batching, run lifecycle, isolated re-render.

**Phase 5 — Tools & approvals**
- `ToolCard`, full-result fetch, exec approval, `SubagentBar`.

**Phase 6 — Smoothness + parity**
- `useStickToBottom`, `JumpToLatest`, Framer animations, reduced motion.
- `Composer` parity: attachments, voice, edit/retry/fork/pin/feedback;
  `SearchOverlay`, `PinnedOverlay`.

**Phase 7 — Hardening & cutover**
- Chaos: reconnect storms, replay-exceeded, rapid session switches.
- v4 repro: image + 4–5 tool-heavy messages must stay ordered/stable.
- Long-chat (5k) perf; typecheck + build + targeted eslint.
- Remove `@assistant-ui/*` deps; flip flag default on; wire into `AppPage`.

---

## 9. Test gates (per phase + final)
- `pnpm --filter ui vitest run` (store + sync unit tests on real fixtures).
- `pnpm --filter ui typecheck`, `pnpm --filter ui build`.
- Targeted eslint on touched files.
- Playwright smoke (reuse `tests/long-chat-*`) if Chrome available.

## 10. Acceptance (Approach A)
1. Optimistic→confirmed user row: no blink, same key.
2. thinking → stream into same assistant row → finalize; no hide-then-flash.
3. Tools stay attached to their run; no cross-turn leak; no reorder.
4. Single owner of run status; never stuck "Thinking".
5. Replay-exceeded / reconnect / gap → clean re-bootstrap; consistent transcript.
6. Image + tool-heavy stress preserves order + identity.
7. 5k-msg chat scrolls smoothly; older loads w/o jump; no render storms.
8. Headless store/sync tests + typecheck + build pass.

## 11. Risks & mitigations
- **AI Elements expect AI-SDK message shape** → vendored source, adapter at
  `adapt/toAiElements.ts`, fork components if they fight our model.
- **react-virtual + streaming** → live turn outside virtualizer (designed away).
- **Patch ordering across reconnect** → cursor guard + rebootstrap on hole.
- **Next.js 16 / React 19 strictness** → store is framework-agnostic; only the Jotai
  bridge touches React, keeping reducers testable headless.
```
