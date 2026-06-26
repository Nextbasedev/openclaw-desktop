# CHAT_ARCHITECTURE_BEST_PRACTICES.md

> Target architecture for a real-time AI chat client (Electron/Tauri + React/TS + local middleware proxying an agent gateway over WS/SSE).
> Opinionated. Boring. Minimal. Designed to **kill** flicker/jump/blink, out-of-order messages, broken streaming text, cache lag, duplicate tool-call/thinking UI, WS unreliability, multi-session desync, and optimistic-vs-echo races.

**Guiding principles**

1. **One store, one writer, one window.** Everything flows through a single normalized store updated by a single reducer. Any other path is a bug.
2. **Server-assigned IDs and monotonic sequence numbers are non-negotiable.** Order and identity are properties of data, not of arrival time.
3. **Patches are idempotent and replayable.** The stream is a log, not a notification firehose.
4. **Animation is decoupled from React reconciliation.** Tokens are appended to a DOM node imperatively. React owns the row's *identity*; the DOM owns the row's *characters*.
5. **Optimistic writes carry client-generated IDs that the server echoes back.** Reconciliation is by ID, never by position or content match.
6. **The simplest thing that's correct beats the cleverest thing that's almost correct.**

Symptom → root-cause map (referenced throughout):

| Symptom | Root causes addressed by |
|---|---|
| UI flicker / blink | §1 selectors, §3 stable keys, §5 decoupled animation, §8 tearing, §9 memo boundaries |
| Message jump / scroll jank | §4 scroll anchoring, §4 single window, §9 row-level memo |
| Order instability | §2 monotonic seq, §3 server IDs + ordering key |
| Broken streaming text | §5 imperative token append, §8 patch coalescing |
| Laggy / unreliable cache | §7 normalized + SWR + IndexedDB, §1 selector cache |
| Duplicated tool-call / thinking | §2 idempotent reducer (apply-once by patch id), §3 stable IDs |
| WS unreliability | §6 resume-from-cursor, ping/pong, backoff+jitter, epoch |
| Multi-session desync | §6 epoch/generation, §7 cache invalidation on epoch, §2 resume cursor |
| Optimistic vs echo race | §2 client idempotency key, §3 stable id reconciliation, §8 single writer |

---

## 1. State management

**Technique.** A single **normalized** in-memory store (entities keyed by id; ordered lists keyed by stable ordering keys) exposed via **`useSyncExternalStore`** (uSES). Components read only the narrowest selector they need. No derived render-state lives in component bodies; derivations are memoized selectors over the store.

**Why it kills the symptoms.**
- Flicker/blink: uSES guarantees a tear-free, consistent snapshot during a single React render pass; component-local derivations re-run on every parent render and produce new object references → child remount/re-render → blink.
- Duplicated visualizations: normalization means a tool-call exists exactly once, by id, regardless of how many patches reference it.
- Order instability: order is a property of the store (an ordered index), not of how components recompute arrays.

**Minimal correct implementation (React 18 + TS).**

```ts
// store.ts — single source of truth, single writer
type Patch = { id: string; seq: number; /* ... */ };
type State = {
  epoch: number;
  lastSeq: number;
  appliedPatchIds: Set<string>;          // idempotency
  messagesById: Record<string, Message>; // normalized
  orderBySession: Record<string, string[]>; // sessionId -> messageId[] sorted by orderingKey
  toolCallsById: Record<string, ToolCall>;
  // ...
};

let state: State = initialState;
const listeners = new Set<() => void>();

export function getSnapshot(): State { return state; }
export function subscribe(fn: () => void) { listeners.add(fn); return () => listeners.delete(fn); }

export function dispatch(patch: Patch) {       // THE ONLY WRITER
  const next = reduce(state, patch);
  if (next === state) return;                   // structural sharing: bail-out
  state = next;
  listeners.forEach(l => l());
}
```

```ts
// useStore.ts
export function useStore<T>(selector: (s: State) => T, isEqual: (a: T, b: T) => boolean = Object.is) {
  return useSyncExternalStoreWithSelector(subscribe, getSnapshot, getSnapshot, selector, isEqual);
}
```

**Why uSES over alternatives** (for *this* product):

| Option | Verdict | Reason |
|---|---|---|
| Context + `useState` | ❌ | Re-renders every consumer on any change; tearing under concurrent rendering. |
| Redux (RTK) | ✅ acceptable | Solid, but ceremony. Use only if you already have it; otherwise overkill. |
| **Zustand** | ✅ recommended | Tiny wrapper over uSES; ergonomic; trivial to add immer/structural sharing; no provider. |
| Jotai/Recoil | ⚠️ | Atom-per-thing fights normalization; harder to reason about ordering. |
| Bare `useSyncExternalStore` | ✅ | Use directly if you don't want a lib. |

**Selector stability rules** (these eliminate most blink):
- Selectors return **referentially stable** values. Returning `state.messages.filter(...)` every call → new array → re-render. Memoize per-selector (Reselect, Zustand `shallow`, or `useSyncExternalStoreWithSelector`'s `isEqual`).
- Selectors return **primitives or normalized references**, never freshly constructed objects.
- For lists, select the **id array** (e.g. `orderBySession[id]`) and let row components select their own message by id. List re-renders only when the id array's identity changes.

**Immutable update discipline.**
- Use Immer for reducers, but **freeze** in dev only (`enableFreeze`); freezing in prod is a perf hit on hot paths.
- Structural sharing: returning the same reference when nothing changed lets uSES + `Object.is` bail out at every level.
- Never mutate arrays in place. Never spread the whole `messagesById` if only one entry changed — Immer handles this correctly.

**Trade-offs.** Normalization adds reducer complexity vs. "just put the array in state." That cost is one-time; the alternative pays the cost forever in flicker bugs.

**When NOT to use.** A throwaway prototype with <100 messages and one session. You'd never see the symptoms.

---

## 2. Streaming patch model

**Technique.** Treat the gateway stream as an **ordered, append-only log of patches**. Each patch carries:
- `id` (server-assigned UUID, unique per patch)
- `seq` (monotonically increasing per session/stream)
- `epoch` (server generation; bumps on backend restart or session reset)
- `target` (e.g. `message:abc`, `toolCall:xyz`, `run:r1`)
- `op` (`upsert`, `append-text`, `set-status`, `delete`, …)
- `payload`

The reducer is **idempotent**: applying the same patch twice == once. Reconciliation is by **stable id**, never by content or position.

**Why it kills the symptoms.**
- Duplicate tool-call/thinking UI: `appliedPatchIds.has(patch.id)` short-circuits replays; upserts on `toolCall:xyz` collapse N events into one entity.
- Order instability: reducer sorts by `(epoch, seq)`, not by arrival.
- Optimistic-vs-echo races: client sends with `clientMsgId`; server echoes the same id; reducer upserts → no duplicate row.
- Dropped patches on reconnect: client resumes from `lastSeq` per session.

**At-least-once + idempotency = effective exactly-once.** Don't try to build exactly-once at the transport layer; it's the wrong place.

**Minimal correct implementation.**

```ts
type Op =
  | { type: 'message.upsert'; message: Message }
  | { type: 'message.appendText'; messageId: string; delta: string; offset: number }
  | { type: 'message.setStatus'; messageId: string; status: 'streaming'|'done'|'error' }
  | { type: 'toolCall.upsert'; call: ToolCall }
  | { type: 'message.delete'; messageId: string }; // emits tombstone

type Patch = { id: string; seq: number; epoch: number; sessionId: string; op: Op };

function reduce(s: State, p: Patch): State {
  if (p.epoch < s.epoch) return s;                         // stale epoch
  if (p.epoch > s.epoch) s = resetForNewEpoch(s, p.epoch); // generation bump
  if (s.appliedPatchIds.has(p.id)) return s;               // idempotent
  if (p.seq <= s.lastSeqBySession[p.sessionId]) {
    // out-of-order or duplicate seq: still apply if id is new, but don't advance cursor
  }
  const next = applyOp(s, p.op);
  next.appliedPatchIds = new Set(s.appliedPatchIds).add(p.id);
  next.lastSeqBySession = { ...s.lastSeqBySession,
    [p.sessionId]: Math.max(s.lastSeqBySession[p.sessionId] ?? 0, p.seq) };
  return next;
}
```

**Out-of-order handling.** For text appends specifically, include `offset` in the payload (character offset in the message). The reducer writes `text = splice(text, offset, delta)`. This makes append-text commutative under reordering. If `offset` is missing, buffer patches with `seq > lastSeq+1` in a small reorder window (e.g. 200 ms, max 64 patches) and flush in order.

**Optimistic writes.**
- UI generates `clientMsgId = uuid()` and inserts a local message with `status: 'pending'` and `orderingKey = now()`.
- Send to server with `clientMsgId`.
- Server's first echo carries `{ id: clientMsgId, serverId, orderingKey: serverAssigned }`.
- Reducer **upserts by `clientMsgId`** and replaces `orderingKey` with the server's. No second row appears.

**Resume-from-cursor.**
- Client persists `{ sessionId, epoch, lastSeq }`.
- On reconnect, opens stream with `?resume=<epoch>:<lastSeq>`.
- Server replays patches with `seq > lastSeq` (or sends `epoch-changed` → client invalidates cache for that session).

**Trade-offs.**
- `appliedPatchIds` grows unbounded; bound it by `(epoch, sessionId)` and prune on epoch change, or keep a sliding window of last N ids per session.
- Idempotent text append needs offsets from the server; if the server only sends deltas without offsets, you must rely on strict ordering (worse).

**When NOT to use.** Pure request/response APIs with no streaming. But you have streaming, so use this.

---

## 3. Message identity & order

**Rules.**
- **Server assigns the ID** for every message, tool-call, run, and thinking block. Client-generated ids exist only as `clientMsgId` for reconciliation and are replaced/aliased on echo.
- **Never key React lists by index** or by anything derived from array position. Keying by index causes React to remount rows on insert/delete/reorder → DOM blink + scroll jump + state loss (animations restart, IME breaks, hover loses).
- **Ordering key** is a server-assigned monotonic value: a Lamport-style `(epoch, seq)` or a `bigint`/`string` sort key (think CRDT fractional indices like `a0`, `a1`, `a0V` if you ever need insertions between existing items — rare in chat).
- **Tombstones for deletes.** A delete is `{ op: 'message.delete', id }` → reducer sets `messagesById[id] = { ...m, deletedAt }` and removes it from the ordered index. Tombstones survive long enough to suppress late-arriving patches for the same id.

**Why it kills the symptoms.**
- Blink: stable keys → no remount → no DOM teardown → no animation reset → no scroll snap.
- Duplicated tool-calls: same id ⇒ same React element ⇒ updated in place.
- Order instability: rows render in `orderBySession` order, which is the reducer's authoritative order.

**Minimal correct implementation.**

```tsx
function MessageList({ sessionId }: { sessionId: string }) {
  const ids = useStore(s => s.orderBySession[sessionId], shallowEqualArray);
  return <Virtuoso data={ids} itemContent={(i, id) => <MessageRow key={id} id={id} />} />;
}
const MessageRow = React.memo(function MessageRow({ id }: { id: string }) {
  const msg = useStore(s => s.messagesById[id]);
  if (!msg || msg.deletedAt) return null;
  return /* row UI */;
});
```

**Trade-offs.** Forces the server to be the source of truth for ids and order. That's the right answer; do it.

**When NOT to use.** Never. There is no scenario in a real chat where index keys are correct.

---

## 4. Virtualization / windowing

**Technique.** Exactly **one** windowing implementation across the app. The chat list:
- Grows at the **head** (older history loaded on scroll up).
- Streams at the **tail** (new messages and token appends).
- Has **dynamic, unknown row heights** (code blocks, images, tool calls).

The correct primitive: a **reverse-anchored virtualizer** with first-class support for "prepend without scroll jump" and "stick to bottom when user is at bottom."

**Recommendation: `react-virtuoso`.**
- Built for chat. `followOutput`, `firstItemIndex` (prepend without jump), `atBottomStateChange`, `initialTopMostItemIndex`, sticky headers, and it handles dynamic heights via ResizeObserver internally.
- `@tanstack/virtual` is excellent but lower-level; you'll reimplement scroll anchoring on prepend and bottom-stick yourself. For *this* problem set, that's where bugs live.
- Hand-rolled: don't. You will reinvent overflow-anchor and ResizeObserver and ship the bugs you're trying to fix.

**Why it kills the symptoms.**
- Jump on prepend: Virtuoso's `firstItemIndex` adjusts the index space; scroll position is preserved. Equivalent hand-rolled fix: before prepend, record `anchorEl.getBoundingClientRect().top`; after prepend (in `useLayoutEffect`), measure again and `scrollContainer.scrollTop += (newTop - oldTop)`. CSS `overflow-anchor: auto` helps for static prepends but is unreliable across browsers and breaks under virtualization — don't rely on it as the only mechanism.
- Flicker on stream tail: `followOutput: 'smooth'` only when `atBottom === true`; otherwise do nothing. That preserves user scroll.
- Layout thrash: one ResizeObserver per row (the lib handles it). Use `content-visibility: auto` + `contain-intrinsic-size: 0 80px` on **non-virtualized** rows only if you bail to a non-virtual fallback; inside a virtualizer it's redundant and can fight the lib.

**Bottom-stick correctness.**

```ts
const [atBottom, setAtBottom] = useState(true);
// in Virtuoso:
<Virtuoso
  data={ids}
  followOutput={atBottom ? 'auto' : false}
  atBottomStateChange={setAtBottom}
  atBottomThreshold={64}   // px; forgiving so small jitter doesn't unstick
  itemContent={...}
/>
```

Show a "Jump to latest" pill when `!atBottom && hasNewBelow`. Never auto-scroll if the user has scrolled up — that's the #1 chat UX sin.

**Trade-offs.**
- Virtuoso adds ~30 KB gz. Worth it.
- Dynamic heights mean the scrollbar isn't perfectly proportional until rows are measured. Acceptable.

**When NOT to use a virtualizer.** Sessions with a hard cap of <200 small rows. Otherwise virtualize.

**Hard rule: one window.** Multiple nested scroll containers (outer page + inner list) cause every scroll-anchor bug you'll ever see. The list is the scroll container. Period.

---

## 5. Streaming text animation

**Technique.** The streaming row has **two layers**:
1. A React-owned shell (avatar, header, status, role, tool-call slots) keyed by stable id.
2. A **DOM-owned text node** updated imperatively from a `requestAnimationFrame` buffer. React does **not** re-render on every token.

The reducer accumulates `pendingText` for the streaming message in the store, but the **streaming row reads it via a ref-bound subscription**, not via a normal selector. On every animation frame, the row flushes `pendingText` to `textNode.textContent` (or appends a `<span>` child) and clears the buffer.

**Why it kills the symptoms.**
- Typewriter reset: the text lives in the DOM, not in React component state. A parent re-render (e.g. another row arriving) doesn't touch `textContent`. No reset.
- Flicker: no virtual-DOM diff per token; no list re-render per token.
- CPU: one rAF coalesces hundreds of tokens/sec into one paint per frame.

**Minimal correct implementation.**

```tsx
function StreamingText({ messageId }: { messageId: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const lastRenderedLen = useRef(0);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const text = getSnapshot().messagesById[messageId]?.text ?? '';
      if (text.length !== lastRenderedLen.current && ref.current) {
        // append only the diff; never replace the whole text
        ref.current.appendChild(document.createTextNode(text.slice(lastRenderedLen.current)));
        lastRenderedLen.current = text.length;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [messageId]);

  return <span ref={ref} />;
}
```

For Markdown/code: don't re-parse on every token. Either (a) render as plain text while `status === 'streaming'`, then swap to a parsed Markdown component on `status === 'done'`, or (b) parse incrementally with a streaming-friendly parser (`marked` with `walkTokens`, or `mdast-util-from-markdown` streaming) and only diff the *last* block. Option (a) is the boring, correct default.

**CSS-only reveal alternative.** If you want a cursor or fade-in, do it in CSS (`@keyframes`, `::after` blinking caret). Don't simulate typing in JS by setting state per character — that's exactly the React-coupled animation you're trying to avoid.

**Interruption / finalization.**
- On `status: 'done'`: stop the rAF loop, swap the DOM-owned text node for a properly-rendered Markdown component, set `lastRenderedLen = 0`.
- On cancel: same swap, but with the final partial text and an "interrupted" badge.
- On reconnect mid-stream with `resume`: server replays missed deltas; reducer applies them; the next rAF tick paints the diff — no visible reset.

**Trade-offs.**
- Imperative DOM manipulation inside React is unusual; gate it behind a single component and document it.
- Text selection during streaming: appending children can collapse selection. Mitigate by appending to the same text node (`textNode.data += delta`) rather than creating new nodes.

**When NOT to use.** Static (already-finalized) messages — render normally as Markdown.

---

## 6. WebSocket reliability

**Technique stack** (all of them; none are optional):

| Concern | Mechanism |
|---|---|
| Liveness | App-level ping/pong every 15–25 s; close + reconnect if no pong in 2× interval. Don't trust TCP keepalive or browser-level WS pings. |
| Reconnect | Exponential backoff with **full jitter**: `delay = random(0, min(cap, base * 2^attempt))`, base 500 ms, cap 30 s. |
| Resume | Connect with `?resume=<sessionId>:<epoch>:<lastSeq>`; server replays `seq > lastSeq` or returns `epoch-changed`. |
| Epoch | Server bumps `epoch` on restart, session reset, or auth change. Client treats `epoch++` as "drop caches for that session, refetch head." |
| Multiplexing | **One** WS connection multiplexed across sessions. Each frame carries `sessionId`. Per-session connections explode under N tabs / N sessions, complicate auth refresh, and serialize on the wrong axis. |
| Backpressure | Middleware reads from gateway, writes to a bounded per-session queue toward the UI (e.g. 1024 patches). On overflow: drop oldest *text-delta* patches and emit a `resync` marker → UI refetches that message's full text. Never drop `upsert` or `status` patches. |
| Framing | Length-prefixed JSON or MessagePack frames in the middleware ↔ UI WS. One patch per frame. No batching at the transport layer — batch at the render layer (§8). |
| Auth | Token in the connect URL or first frame; on 401, reconnect with refreshed token; preserve `lastSeq` across the swap. |

**Why it kills the symptoms.**
- WS unreliability: ping/pong catches half-open TCP; backoff+jitter prevents thundering herd; resume cursor restores state without full reload.
- Multi-session desync: epoch + per-session `lastSeq` give you a precise invalidation signal.
- Order instability after reconnect: server replays from `lastSeq`; reducer is idempotent.

**SSE vs WebSocket.**

| Factor | SSE | WS |
|---|---|---|
| Direction | server→client only | bidirectional |
| Reconnect/resume | built-in `Last-Event-ID` | DIY (but you have it now) |
| HTTP/2 multiplexing | yes | no (separate TCP) |
| Proxies / corp networks | better (just HTTP) | sometimes blocked |
| Backpressure | weaker | explicit |
| Binary | no (text only) | yes |

For a **one-way patch stream**, SSE is genuinely simpler and gives you `Last-Event-ID` resume for free. Use SSE for the gateway→middleware leg if it's one-way. Use **WS for middleware↔UI** because the UI sends commands (send message, cancel, switch session, etc.) and you want one connection for both directions.

**Minimal client.**

```ts
class ReliableWS {
  private ws?: WebSocket; private attempt = 0; private pingTimer?: number;
  constructor(private url: () => string, private onPatch: (p: Patch) => void,
              private getResume: () => string) {}
  connect() {
    const ws = new WebSocket(`${this.url()}?resume=${this.getResume()}`);
    this.ws = ws;
    ws.onopen = () => { this.attempt = 0; this.startPing(); };
    ws.onmessage = e => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'pong') return;
      if (msg.type === 'patch') this.onPatch(msg.patch);
    };
    ws.onclose = () => { this.stopPing(); this.scheduleReconnect(); };
    ws.onerror = () => ws.close();
  }
  private scheduleReconnect() {
    const cap = 30_000, base = 500;
    const delay = Math.random() * Math.min(cap, base * 2 ** this.attempt++);
    setTimeout(() => this.connect(), delay);
  }
  private startPing() {
    let lastPong = Date.now();
    this.pingTimer = window.setInterval(() => {
      if (Date.now() - lastPong > 50_000) { this.ws?.close(); return; }
      this.ws?.send(JSON.stringify({ type: 'ping' }));
    }, 20_000);
    // wire lastPong = Date.now() in onmessage when type==='pong'
  }
  private stopPing() { if (this.pingTimer) clearInterval(this.pingTimer); }
}
```

**Trade-offs.** App-level ping costs a few bytes per 20 s. Worth it.

**When NOT to use this full stack.** If you only have polling (no streaming), skip §6 entirely.

---

## 7. Caching

**Layered cache.**

| Layer | Purpose | Eviction |
|---|---|---|
| L1: normalized in-memory store | Live data, single source of truth | Never (during session); pruned on epoch reset |
| L2: bounded LRU page cache | Paginated history pages (`{sessionId, beforeSeq}` → ids[]) | LRU, e.g. 200 pages |
| L3: IndexedDB persistence | Cross-launch survival; cache-then-network on cold start | Per-session size cap + epoch keying |

**Patterns.**
- **Cache-then-network on cold start.** Load IndexedDB snapshot for the active session → hydrate L1 → render → in parallel open WS with `resume=<epoch>:<lastSeq>`. UI is instant; updates stream in.
- **Stale-while-revalidate** for history page fetches. Show the cached page, refetch in background, reconcile by id.
- **Live-cache update.** Because the cache is the store, any patch updates the visible list automatically. There is no "refetch after send" code path. If you have one, delete it.
- **Optimistic UI with rollback.** On send: upsert pending message in L1. On server echo: upsert by `clientMsgId`. On error/timeout: set `status: 'failed'` and offer retry. Never delete-and-reinsert — that causes a row remount.
- **Cache invalidation on epoch.** `epoch-changed` for a session ⇒ drop L1 entries for that session, drop L2 pages for that session, drop IDB rows for that session, refetch head. Other sessions untouched.
- **Write-through to IndexedDB**: debounced (e.g. 250 ms) batched writes from the reducer. Never write per-patch.

**Why it kills the symptoms.**
- Laggy cache: SWR + cache-then-network = instant paint.
- Multi-session desync: per-session epoch keying.
- Duplicated rows after refetch: reconciliation by id, not by append.

**Library choice.**
- Don't use React Query / SWR libraries as the *primary* cache for a streaming chat — they're optimized for request/response, not for a patch log driving a normalized store. Use them only for non-streaming side data (user profile, settings).
- IndexedDB wrapper: `idb` (Jake Archibald). Tiny, correct.

**Trade-offs.**
- IndexedDB writes from the renderer process are fine in Electron/Tauri; consider moving heavy writes to a worker if profiling shows main-thread stalls.
- LRU sizing: 200 pages × 50 messages × ~1 KB ≈ 10 MB. Acceptable.

**When NOT to persist.** Ephemeral/private sessions (e.g. "incognito") — skip L3.

---

## 8. Concurrency / race elimination

**Principles.**

1. **Single writer.** Only the reducer writes to the store. WS handler, optimistic send, retry logic — all funnel through `dispatch(patch)`. No `setState` from random effects updates the chat model.
2. **Monotonic cursors/epochs everywhere.** Every async result carries `(epoch, seq)` or a `generation` token; if it doesn't match the current generation, drop it.
3. **AbortController per request.** When switching sessions, abort the previous session's in-flight fetches. Pair with a `generationRef` so even non-abortable async (timers, third-party libs) is filtered: `if (gen !== generationRef.current) return;`
4. **No setState-in-effect cascades.** If an effect's job is to set state from a derived value, the derivation belongs in a selector or the reducer, not in an effect.
5. **Tearing under React 18 concurrent rendering** is real with plain Context/`useState`. `useSyncExternalStore` is the only built-in way to read external stores without tearing. This is precisely why uSES exists; use it.
6. **Coalesce high-frequency patches.** Patches arrive faster than 60 fps during streaming. Buffer them in the reducer's "inbox" and flush once per animation frame:

```ts
let inbox: Patch[] = [];
let scheduled = false;
export function enqueue(p: Patch) {
  inbox.push(p);
  if (!scheduled) {
    scheduled = true;
    requestAnimationFrame(() => {
      const batch = inbox; inbox = []; scheduled = false;
      let next = state;
      for (const p of batch) next = reduce(next, p);
      if (next !== state) { state = next; listeners.forEach(l => l()); }
    });
  }
}
```

This single change typically gives a 5–20× CPU reduction during heavy streaming and eliminates a class of "flicker because we rendered 200 times in 16 ms" bugs.

**Why it kills the symptoms.**
- Optimistic-vs-echo race: single writer + id-based upsert is race-free by construction.
- Multi-session desync on rapid session switch: generation tokens + AbortController drop stale results before they corrupt state.
- Tearing/flicker during concurrent rendering: uSES.
- CPU melts during streaming: rAF coalescing.

**Trade-offs.** rAF batching delays patch visibility by up to ~16 ms. Imperceptible; well worth it. If you want lower latency for the *active* streaming message, the §5 DOM-owned text node already bypasses the React render path.

**When NOT to use.** You won't avoid these — every one is load-bearing.

---

## 9. Rendering performance

**Memo boundaries.**
- `MessageList` selects only the **id array** for the session. Re-renders only when the array's identity changes (new message, delete, reorder).
- `MessageRow` is `React.memo`'d, takes only `{ id }`, and selects its own message. Re-renders only when its message changes.
- **Streaming row is a different component** from static rows, or at least has a different render path: it subscribes to the rAF text loop (§5) instead of to message text via the store. Result: token appends don't re-render any other row, and don't even re-render the streaming row's React tree.
- Tool-call / thinking blocks are their own memo'd components keyed by tool-call id. The same patch updating a tool-call's status doesn't re-render the parent message row's text.

**Selector granularity.**

```ts
// BAD: returns a new object every call → row re-renders every store change
const { text, status, role } = useStore(s => {
  const m = s.messagesById[id]; return { text: m.text, status: m.status, role: m.role };
});

// GOOD: three subscriptions, each primitive, each bails out on Object.is
const text   = useStore(s => s.messagesById[id]?.text);
const status = useStore(s => s.messagesById[id]?.status);
const role   = useStore(s => s.messagesById[id]?.role);
```

Or one selector with a custom `isEqual`. Either is fine; the freshly-allocated object is not.

**Measurement.**
- React Profiler in dev: look for rows re-rendering when they shouldn't. Goal: during streaming, only the streaming row's text node updates; nothing else paints.
- `PerformanceObserver` for `longtask` (>50 ms) and `layout-shift` entries. Any CLS during streaming or prepend is a bug.
- `performance.measure` around patch batches to track p95 reducer time.
- Chrome's "Paint flashing" overlay to visually confirm only the streaming text repaints.

**Concrete budget.** During steady-state streaming at 50 tokens/s:
- ≤1 React commit per frame (the streaming row's status changes, if any).
- 0 list re-renders.
- 0 layout shifts.
- Main-thread reducer cost: <2 ms / frame on a mid-range laptop.

**When NOT to optimize.** Before measuring. Use the profiler; don't guess.

---

## 10. Testing

**Layered test strategy.**

| Layer | Tool | What it locks down |
|---|---|---|
| Pure reducer | Vitest + fast-check | Idempotency, commutativity (where applicable), epoch handling |
| Store + fake transport | Vitest | Resume-from-cursor, optimistic reconciliation, multi-session isolation |
| Component (RTL) | Vitest + @testing-library/react | Stable keys, no remount on update, selector stability |
| E2E | Playwright (Electron driver) | Scroll anchoring, streaming animation, reconnect, no flicker |

**Characterization tests first.** Before refactoring, write tests that capture *current* behavior on a representative session log (record real patches in dev, replay in tests). After the refactor, these tests should pass with at most documented intentional changes. This is the only safe way to land a large state/streaming rewrite.

**Property-based tests for the reducer** (the highest-leverage test you can write):

```ts
import fc from 'fast-check';

test('reducer is idempotent under permutation and duplication', () => {
  fc.assert(fc.property(fc.array(arbitraryPatch(), { maxLength: 200 }), (patches) => {
    const a = patches.reduce(reduce, initial);
    const shuffled = [...patches].sort(() => Math.random() - 0.5);
    const duplicated = shuffled.flatMap(p => [p, p]);
    const b = duplicated.reduce(reduce, initial);
    expect(canonicalize(a)).toEqual(canonicalize(b));
  }));
});
```

This single test catches the entire class of duplicate-tool-call and order-instability bugs.

**Deterministic virtual clock + fake transport.**
- Inject `now()` and `setTimeout` via a clock interface; use `@sinonjs/fake-timers`.
- Fake WS: an in-memory transport with `inject(patches)`, `simulateDisconnect()`, `simulateReconnect()`. Drives the same `ReliableWS` API.
- Test: disconnect mid-stream → reconnect → assert final state == state had no disconnect occurred.

**Playwright e2e.**
- **No flicker** check: use `page.evaluate` to install a `MutationObserver` on the message list and a `PerformanceObserver` for `layout-shift`. Assert: during a scripted stream of 500 tokens, total CLS < 0.01 and no DOM node with a stable key is removed.
- **Scroll anchor** check: prepend 50 history messages; assert `scrollContainer.scrollTop` of the anchor element is unchanged (±1 px).
- **Bottom-stick** check: scroll up 200 px; stream new messages; assert no auto-scroll.
- **Reconnect** check: simulate WS close mid-stream; assert text is identical after resume, no duplicate messages, no tool-call duplication.

**What NOT to test.** Don't test internal selector identities or memo hit rates — they're implementation details. Test observable behavior.

---

## (a) Target architecture (text diagram)

```
                       ┌────────────────────────────────────────────────────────┐
                       │                       Agent Gateway                    │
                       └──────────────────────┬─────────────────────────────────┘
                                              │  (SSE or WS, one-way patches)
                                              ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                       Local Middleware (Electron/Tauri side)                     │
│  - assigns/forwards server IDs, seq, epoch                                       │
│  - per-session bounded queue, backpressure, resync markers                       │
│  - persists patch cursor {sessionId, epoch, lastSeq}                             │
│  - exposes ONE multiplexed WS to the UI (frames carry sessionId)                 │
└──────────────────────────────┬───────────────────────────────────────────────────┘
                               │  WS (bidirectional)
                               ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                              React + TS UI                                        │
│                                                                                  │
│  ┌──────────────┐   patches    ┌─────────────────┐   notify   ┌────────────────┐ │
│  │ ReliableWS   │─────────────▶│  enqueue(patch) │───────────▶│  Listeners     │ │
│  │  ping/pong   │              │  rAF-coalesced  │            │ (uSES subs)    │ │
│  │  backoff+jit │              │   reducer       │            └───────┬────────┘ │
│  │  resume cur. │              │  (single        │                    │          │
│  └──────┬───────┘              │   writer)       │                    ▼          │
│         │   commands           └─────────┬───────┘            ┌────────────────┐ │
│         │◀─────────────────────          │                    │  Selectors     │ │
│         │                                ▼                    │ (stable refs)  │ │
│         │                       ┌────────────────┐            └───────┬────────┘ │
│         │                       │ Normalized     │                    │          │
│         │                       │ Store          │                    ▼          │
│         │                       │  messagesById  │            ┌────────────────┐ │
│         │                       │  toolCallsById │            │ MessageList    │ │
│         │                       │  orderBySess   │            │ (Virtuoso)     │ │
│         │                       │  epoch,lastSeq │            │   keyed by id  │ │
│         │                       │  appliedIds    │            └───────┬────────┘ │
│         │                       └────┬───────────┘                    │          │
│         │                            │ debounced write-through        ▼          │
│         │                            ▼                    ┌────────────────────┐ │
│         │                       ┌────────────┐            │ MessageRow (memo)  │ │
│         │                       │ IndexedDB  │            │  ├─ static parts   │ │
│         │                       │ (per-sess) │            │  └─ StreamingText  │ │
│         │                       │ epoch-keyed│            │      (rAF, DOM-    │ │
│         │                       └────────────┘            │       owned text)  │ │
│         │                                                 └────────────────────┘ │
│         │  user actions (send/cancel/switch session)                             │
│         ▼                                                                        │
│  Commands carry clientMsgId → server echoes same id → reducer upserts            │
└──────────────────────────────────────────────────────────────────────────────────┘
```

**Data flow invariants.**
1. Every patch passes through `enqueue → rAF batch → reduce → store → uSES notify → selectors → memo'd rows`.
2. Streaming text bypasses the React commit path entirely (DOM-owned).
3. Optimistic sends and echoes meet at the reducer, reconciled by `clientMsgId`.
4. On reconnect: ReliableWS resumes from `(epoch, lastSeq)`; reducer is idempotent; UI converges without user-visible change.

---

## (b) Top 8–10 patterns ranked by impact on *this* symptom set

| # | Pattern | Kills |
|---|---|---|
| 1 | **Normalized store + single writer reducer + `useSyncExternalStore`** | flicker, tearing, duplicate UI, race conditions, multi-session desync |
| 2 | **Stable server-assigned IDs as React keys (never index)** | blink on insert/delete, animation reset, scroll jump |
| 3 | **Idempotent reducer keyed by patch id; monotonic `(epoch, seq)`** | duplicated tool-call/thinking, order instability, replay safety |
| 4 | **Client-generated `clientMsgId` echoed by server; upsert reconciliation** | optimistic-vs-echo duplicate rows, send races |
| 5 | **rAF-coalesced patch batching in the reducer** | CPU melt during streaming, list flicker, long-task jank |
| 6 | **DOM-owned streaming text via rAF (decoupled from React)** | typewriter reset, list re-render storms during streaming |
| 7 | **Single virtualizer (react-virtuoso) with `firstItemIndex` + bottom-stick** | scroll jump on history prepend, jank, double-window bugs |
| 8 | **WS reliability stack: ping/pong + backoff+jitter + resume cursor + epoch** | WS unreliability, multi-session desync, dropped patches |
| 9 | **Layered cache (L1 normalized, L2 LRU pages, L3 IndexedDB) with cache-then-network and epoch-keyed invalidation** | laggy cache, cold-start blank screen, post-refetch duplicates |
| 10 | **Property-based reducer tests + characterization tests before refactor** | regression risk during the rewrite itself |

If you only ship four: **1, 2, 3, 6.** Those four alone eliminate ~80% of the reported symptoms.

---

## (c) Avoid this — anti-patterns and over-engineering

**Anti-patterns (don't do these).**
- Keying React lists by index, by array position, by `message-${i}`, or by `Date.now()`.
- Deriving the rendered message array inside a component via `.filter()` / `.map()` / `.sort()` without memoization.
- Storing `messages` as a plain array in component state and `setMessages([...prev, newMsg])` on each patch.
- Animating streaming text by `setState` per character or per token.
- Multiple scroll containers around the chat list.
- One WebSocket per session in the UI.
- Trying to achieve exactly-once delivery at the transport layer instead of idempotency at the reducer.
- Re-fetching the whole session after sending a message to "make sure it's there." The patch stream is the truth.
- Mutating store objects in place (even "just this once for perf").
- Reading the store via React Context that wraps the whole store object — guarantees full-tree re-render on any change.
- Using `useEffect` to sync derived state into more state ("setState ping-pong").
- Replacing optimistic messages by delete-then-insert rather than upsert by id.
- Reparsing the full Markdown of a streaming message on every token.

**Over-engineering to avoid.**
- **CRDTs (Yjs/Automerge) for chat.** You don't have concurrent multi-writer edits; you have one server as the source of truth. A monotonic sequence number is enough. CRDTs add weeks of work and a new class of bugs.
- **A custom virtualization engine.** Use react-virtuoso. Move on.
- **A custom binary protocol** between middleware and UI. JSON over WS is fine until profiling proves otherwise. MessagePack only if patch volume actually hurts.
- **Service worker as message bus** in Electron/Tauri. Use a plain module-level store. SW adds lifecycle bugs for no benefit here.
- **Redux Toolkit + RTK Query + Redux-Saga + Redux-Observable stack** for a chat. Pick one boring store (Zustand or bare uSES) and one reducer.
- **GraphQL subscriptions** wrapping your patch stream just to "have a schema." You already have a schema — define `Patch` in TypeScript.
- **Per-component throttling/debouncing of selectors.** Fix it once in the reducer's rAF batcher.
- **State machines (XState) for the whole chat.** Useful for the *send* flow (idle → sending → sent → failed), overkill for the message list itself.
- **Web Workers for the reducer** unless profiling shows main-thread stalls >16 ms. The transfer overhead and structured-clone cost usually outweigh the gain for a normalized store.
- **Multiple caching libraries layered together** (React Query + SWR + custom). One cache, owned by the store.
- **Custom rAF schedulers, priority queues, or "react-scheduler-like" abstractions.** `requestAnimationFrame` is the scheduler.
- **Speculative pre-rendering of future tokens.** No. Render what arrived.

---

**Bottom line.** The product's symptom list is the canonical fingerprint of three missing invariants: (1) a single normalized store updated by an idempotent reducer over a sequenced patch log, (2) stable server-assigned identity used as React keys, and (3) streaming text decoupled from React reconciliation. Add WS resume + epoch and a single virtualizer and the rest of the symptoms collapse. Everything else in this document is in service of those five things.
