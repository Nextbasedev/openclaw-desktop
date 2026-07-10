# Imported Session 160-Message Window — Verified Plan

**Date:** 2026-07-09
**Branch:** `telegram-integrate`
**Author:** Krish Munjapara
**Status:** Plan (verified via CodeGraph end-to-end trace; implementation-ready)

## Goal (unchanged from user intent)

For every imported Telegram/Discord session, the **frontend renders only the latest 160 messages** on open — never the full (potentially 20k+) conversation. The full transcript stays intact on the Gateway side (unchanged session identity, unchanged context). After open, the session behaves **exactly like any other app session**: caching, virtualization, older-page paging, live tail, tool calls, and streaming all apply identically.

## VERIFIED ROOT-CAUSE ANALYSIS (end-to-end, via CodeGraph)

Before any change, every linked function was traced. Findings:

### RC-1 — Continue-chat context for imported sessions: ALREADY CORRECT ✅
- `importTelegramSession` (`apps/middleware/src/features/compat/routes.ts:2496`) calls gateway `sessions.create` with the `desktop:migrated-telegram-*` key, then `copyHistoryMessagesToTranscript(transcriptPath, sourceMessages)` copies the **full** source into the gateway transcript. `sessionId` is stored in the session.
- Send path (`apps/middleware/src/features/chat/routes.ts:1402`) calls gateway `chat.send` with `input.sessionKey` directly → gateway has the full transcript context.
- **Conclusion:** No change needed. Full agent context is preserved by construction.

### RC-2 — UI virtualization is ALREADY session-agnostic ✅
- `useChatMessages` (`packages/ui/hooks/useChatMessages.ts`) applies bootstrap via `seedGlobalChatSession` and trims via `trimSessionMessageWindow` using `WINDOW_SIZE` (200) / `WINDOW_PAGE_SIZE` (100) for **every** session. There is **no `if (imported)` branch** anywhere in the window/load/trim path.
- Imported sessions already get: sliding window, older-paging (100), live-tail, scroll-anchor, optimistic protection — identical to normal sessions.
- **Conclusion:** The user's assumption ("imported sessions don't virtualize") is **false**. They already virtualize. No imported-specific virtualization work is needed. The only issue is constant drift (see RC-6).

### RC-3 — Where open actually breaks for long imports: hydrate/import WRITE cost, NOT windowing ⚠️
- Bootstrap returns `limit: 160, latest: true` (`routes.ts:1834`) → ≤160 rows read. Windowing is fine.
- Real cost: `persistImportedChatMessages` (`compat/routes.ts:2049`) upserts **all** source rows into SQLite on import; `hydrateImportedPlatformSessionMessages` (`compat/routes.ts:2089`) re-persists **all** rows when the projection is empty on first open. For a 20k Telegram session this is a slow one-time write, but it does **not** block the 160-row window read.
- **Critical guard already exists:** bootstrap prune (`pruneSegmentToCanonicalMessages`, `repo.messages.ts:626`) is skipped when `normalized.length === 0` (`routes.ts:1828`) — i.e. for imported sessions where gateway history is empty. Imported local history is **never pruned**. ✅

### RC-4 — Caching is session-agnostic ✅
- Warm cache (`setWarmChatCache` / `getWarmChatCache`), bootstrap preview (`warmBootstrapMessages`), and page cache (`createPageCache`) key by `sessionKey` only — no imported special-case. Imported sessions benefit identically.

### RC-5 — Tool-call projection for imported sessions ✅
- `projectCanonicalBootstrapToolCalls` runs on `normalized` (the 160 windowed bootstrap messages), not the full projection. Imported transcripts rarely carry tool calls, but if they do, they project correctly within the window.

### RC-6 — Constant drift 160 vs 200 (the ONLY real correctness-adjacent issue) ⚠️
- UI bootstrap request: `CHAT_BOOTSTRAP_INITIAL_LIMIT = 160` (`client.ts:144`).
- Middleware bootstrap: `DEFAULT_BOOTSTRAP_LIMIT = 160` (`routes.ts:206`).
- Store window: `WINDOW_SIZE = 200` (`messageWindow.ts:27`).
- ChatView window: `MAX_LOADED = 160` (`ChatView/messageWindow.ts`).
- This drift affects **all** sessions equally (not imported-specific). It can cause a 160 bootstrap to be trimmed toward 200 then evicted back — minor, but worth unifying to one source of truth.

### RC-7 — `/api/chat/messages` gateway-refill is wasteful for imported sessions ⚠️
- `routes.ts:1924`: when `beforeSeq` is set and local is empty, it calls gateway `chat.history` with `limit: refillLimit` (up to 10k). For imported sessions, gateway history is empty → wasted call returning nothing. Harmless but wasteful.

## CORRECTED DESIGN PRINCIPLES

1. **Do NOT add any imported-specific branch** in windowing, virtualization, caching, streaming, or tool-call code. The existing generic path already handles imported sessions correctly (RC-2, RC-4, RC-5). Adding special cases would risk breaking the working path.
2. **Full context off the React tree.** Gateway transcript = agent truth. SQLite projection = local index. UI = bounded window only.
3. **Initial render = latest 160.** Already the case (RC-3). Unify the constant so store and ChatView agree (RC-6).
4. **Import success ≠ "UI has all rows."** Import success = session + space + transcript + enough projection to open the tail.
5. **Do not truncate gateway transcript for UI reasons.**
6. **Only optimize the WRITE side** (import/hydrate persistence) — never the READ/window side — so first-open of a huge import stays fast without changing what the UI sees.

## IMPLEMENTATION PLAN (minimal, zero-risk to existing sessions)

### Phase 0 — Unify window constant (applies to ALL sessions)
- Create `packages/ui/lib/chat-engine-v2/constants.ts`:
  ```ts
  /** Single source of truth for the initial chat window size (messages). */
  export const UI_INITIAL_WINDOW = 160
  ```
- `packages/ui/lib/chat-engine-v2/client.ts:144`: `const CHAT_BOOTSTRAP_INITIAL_LIMIT = UI_INITIAL_WINDOW`
- `packages/ui/components/ChatView/messageWindow.ts`: `export const MAX_LOADED = UI_INITIAL_WINDOW` (import from constants) — or keep 160 locally but document it equals `UI_INITIAL_WINDOW`.
- `packages/ui/lib/chat-engine-v2/messageWindow.ts`: keep `WINDOW_SIZE` as the *in-memory cap during scroll* (200 is fine for smooth paging) but ensure bootstrap never exceeds `UI_INITIAL_WINDOW`. The drift is cosmetic; the safest fix is to make `useChatMessages` enforce `UI_INITIAL_WINDOW` as the hard cap right after bootstrap seed, then let scroll paging use `WINDOW_SIZE` for buffer headroom. **Decision: keep both, but document; the 160 bootstrap is the contract.**

### Phase 1 — Skip gateway-refill for imported sessions (cheap guard, RC-7)
- In `/api/chat/messages` (`routes.ts:1924`), before the gateway refill, check `context.compat?.importedPlatformSessionLink?.(sessionKey)`. If it returns a link, **skip** the refill (there is no gateway history to refill from; the source of truth is the local projection / source file). This avoids a wasted 10k `chat.history` call on every older-page fetch for imported sessions.

### Phase 2 — Tail-first hydrate (optional perf, WRITE-side only, RC-3)
- `hydrateImportedPlatformSessionMessages` (`compat/routes.ts:2089`): instead of persisting ALL source messages on first open, persist only the **last `UI_INITIAL_WINDOW`** messages into the active segment, and set `importedHistoryHydratedTail: true` in session data. A background job backfills the remaining older messages in chunks (e.g. 500 rows/chunk) so the full projection eventually exists for "scroll all the way up."
- **READ path unchanged:** UI still only ever reads windowed APIs (`limit`/`beforeSeq`), so it never sees the un-backfilled gap. `hasOlder` is computed from the source total / seq range, not from what's projected.
- **Idempotent:** re-hydrate must not re-dump rows already projected.

### Phase 3 — Import write chunking (optional perf, RC-3)
- `persistImportedChatMessages` (`compat/routes.ts:2049`): for very large `input.messages`, upsert in chunks (e.g. 500 rows/chunk) so the import call returns faster and the UI isn't blocked. Pure write-side optimization.

### Phase 4 — Regression tests (prove no regression)
- `apps/middleware/tests/app.test.ts`:
  - Import a 5k-message Telegram session → `GET /api/chat/bootstrap` returns `messages.length <= 160` and `hasOlder === true`.
  - Bootstrap prune is NOT called for the imported session (assert projection row count unchanged after bootstrap).
  - `/api/chat/messages?beforeSeq=…&limit=100` pages older correctly; gateway-refill skipped for imported.
  - Reimport twice → no duplicate storm; same `desktopSessionKey`.
  - Send a message to the imported session → gateway `chat.send` uses the same key (full context preserved).
- `packages/ui/lib/chat-engine-v2/__tests__/messageWindow.test.ts`: assert `WINDOW_SIZE` and bootstrap limit agree on `UI_INITIAL_WINDOW` intent.

## WHAT WE WILL NOT DO (explicit)
- ❌ Add any `if (imported)` branch in `useChatMessages`, `ChatView`, caching, streaming, or tool-call code.
- ❌ Create a new session per open to "reduce history."
- ❌ Truncate the gateway transcript so the model "forgets" early Telegram turns.
- ❌ Load full history into React "then virtualize DOM only."
- ❌ Change the bootstrap read path for imported sessions (it already returns 160).

## CASE: Continue on imported session preserves the initial 160 tail (Option B + scroll-up)

This is an explicit invariant for imported Telegram/Discord sessions, layered on top of the generic virtualization path (RC-2). It must NOT introduce any imported-specific branch — it documents the expected behavior of the already-correct generic path.

### State on open (imported session only)
1. Render **only the latest 160 messages** — the **tail** (most recent) of the imported conversation.
2. No "before history" is on screen yet (user has not scrolled up). `hasOlder = true` because more exists above.
3. These 160 are the **end of the current session's rendered messages** — the visible base. There is no imported history rendered above them at this point.

### Rule on continue (user sends a message / session goes active)
- The new user + assistant turn **appends AFTER** the 160 imported messages. The window is **never reset** and the imported 160 is **never cleared** on continue.
- The window stays bounded (160–200 rows). When over cap, the **oldest imported rows at the top** are evicted by the generic `trimSessionMessageWindow` logic — but `hasOlder` remains `true`, so they are not lost, only dropped from in-memory buffer.
- This is identical to how a normal session behaves after open; no special handling.

### Rule on scroll-up (older direction) — connects through the initial 160
- Virtualization fires `loadOlder` → `GET /api/chat/messages?beforeSeq=<oldestLoadedSeq>&limit=100`.
- Each page **prepends 100 older messages** and evicts 100 from the **bottom** (newer end) to stay bounded.
- This continues **page by page, all the way up through the imported history**, until `seq = 1` (true start of the Telegram/Discord conversation).
- The initial 160 is just the **starting window**. Scrolling up seamlessly connects to the rest of the imported conversation above it, with **no gap/hole at the boundary** between the initial 160 and the first older page (seq continuity is guaranteed by `openclaw_seq` ordering, per AGENTS.md invariant #1).
- When the true start is reached, `hasOlder` becomes `false` and paging stops.

### Why no special code is needed
- `useChatMessages` already appends on send (no window reset) and already prepends older pages on scroll-up with `hasOlder` gating. The initial 160 is simply the bootstrap window; the generic path treats it exactly like a normal session's initial window. Adding an imported branch would risk breaking this already-correct flow.

## SUCCESS CRITERIA
| Check | Pass condition |
|-------|----------------|
| Open long imported chat | First paint ≤ ~1–2s, ≤160 messages, no freeze |
| Scroll | Smooth older pages (100), no jump, no seq holes — **same as normal sessions** |
| `hasOlder` | `true` when more history exists; `false` at true start |
| Reimport / reopen | No duplicate storm; same session |
| Continue chat | Same sessionKey; agent answers with full transcript context |
| Continue preserves initial 160 | New turns append AFTER the 160; window never reset/cleared on continue |
| Scroll-up through imported | Older pages load until `seq=1`; no gap at the 160 boundary; `hasOlder`→false at true start |
| Virtualization | Identical to normal sessions (no special code) |
| Bootstrap | Never returns "all messages" for huge imports (already true) |
| Normal (non-imported) sessions | **Zero behavioral change** — all existing virtualization/caching/streaming/tool-call logic untouched |

## FILES TO TOUCH (summary)
| File | Change | Risk |
|------|--------|------|
| `packages/ui/lib/chat-engine-v2/constants.ts` (new) | `UI_INITIAL_WINDOW = 160` | None |
| `packages/ui/lib/chat-engine-v2/client.ts` | Use shared constant | None |
| `packages/ui/components/ChatView/messageWindow.ts` | Align `MAX_LOADED` to constant (doc) | None |
| `apps/middleware/src/features/chat/routes.ts` | Skip gateway-refill for imported (RC-7) | Low (guard only) |
| `apps/middleware/src/features/compat/routes.ts` | Tail-first hydrate (optional), import chunking (optional) | Low (write-side) |
| `apps/middleware/tests/app.test.ts` | Regression suite | None |

## VERIFICATION LOOP
```bash
pnpm --filter @openclaw/desktop-middleware test -- --runInBand   # middleware regression
pnpm --filter ui typecheck                                      # UI types
pnpm --filter ui build                                          # UI build
```
Manual: import a long Telegram session → open (≤160, fast) → scroll older (smooth) → reimport twice (no dup) → send message (agent remembers early context, UI shows tail window) → confirm a NORMAL session still works identically (virtualization, caching, streaming, tool calls).

We only guarantee the **initial paint and the in-memory window** stay bounded at 160, and that the projection/hydrate paths never force a full dump into the UI on open.

## Current behavior (verified via CodeGraph)

| Layer | Constant | Value | Location |
|-------|----------|-------|----------|
| UI bootstrap request | `CHAT_BOOTSTRAP_INITIAL_LIMIT` | **160** | `packages/ui/lib/chat-engine-v2/client.ts:144` |
| Middleware bootstrap | `DEFAULT_BOOTSTRAP_LIMIT` | **160** | `apps/middleware/src/features/chat/routes.ts:206` |
| Store window | `WINDOW_SIZE` (`PAGE_SIZE 100 × WINDOW_PAGES 2`) | **200** | `packages/ui/lib/chat-engine-v2/messageWindow.ts:27` |
| ChatView window | `MAX_LOADED` / `INITIAL_PAGE` / `OLDER_PAGE` | **160 / 160 / 100** | `packages/ui/components/ChatView/messageWindow.ts` |

Key facts from the code:
- `GET /api/chat/bootstrap?limit=160` → `listMessages(sessionKey, { limit: 160, latest: true })` (`routes.ts:1834`). Returns `historyCoverage: "windowed"` + `hasOlder` when `firstVisibleSeq > 1`.
- `persistImportedChatMessages` (`compat/routes.ts:2049`) upserts **ALL** normalized source messages into the active segment on import. This is fine for the projection (full history lives in SQLite), but it means the projection can be huge.
- `hydrateImportedChatHistory` (`compat/routes.ts:4616`) → `hydrateImportedPlatformSessionMessages` (`compat/routes.ts:2089`) re-persists **ALL** source messages when a bootstrap/messages read finds an empty projection. This is the expensive path on first open of an old import.
- Bootstrap prune: `pruneSegmentToCanonicalMessages` (`repo.messages.ts:626`) runs only when `normalized.length > 0` (i.e. gateway returned history). For imported sessions where gateway history is empty, `normalized.length === 0`, so **prune is skipped** — imported projection is preserved. Good.
- `/api/chat/messages` (`routes.ts:1880`) is already windowed when `beforeSeq`/`afterSeq`/`limit` are present; only falls back to `listAllMessages` when no window params. The UI always passes window params, so this is safe.

## Design principles (non-negotiable)

1. **Same session always.** No fork, no new session per open. Continue chat uses the same `desktop:migrated-*` key.
2. **Full context off the React tree.** Gateway transcript = agent truth. SQLite projection = local index. UI = bounded window only.
3. **Initial render = latest 160.** Open → jump to bottom with ≤160 rows. Scroll up → older pages of 100. Send/live → tail only.
4. **Import success ≠ "UI has all rows."** Import success = session + space + transcript + enough projection to open the tail.
5. **Do not truncate gateway transcript for UI reasons.**

## Target model

```
Telegram/Discord source (huge)
        │
Import once (already done)
  ├─ FULL copy → gateway session transcript   ← agent context (untouched)
  ├─ FULL projection into v2_messages          ← local index (kept, but UI never reads all at once)
  └─ sidebar entry + same sessionKey
        │
User opens imported chat
  ├─ bootstrap returns ONLY last 160 (windowed)   ← already the case
  ├─ hasOlder = true (firstVisibleSeq > 1)        ← already the case
  └─ UI mounts ≤ 160 rows
        │
User scrolls up
  └─ GET /api/chat/messages?beforeSeq=…&limit=100  (page, never full dump)
        │
User sends new message
  └─ same sessionKey → gateway uses full transcript context
     UI appends on live tail window only
```

## Implementation plan

### Phase 0 — Unify window constants (small, do first)

Two competing window systems cause drift (160 vs 200). Pick one source of truth.

- **Decision:** Keep `MAX_LOADED = 160` as the single in-memory cap. Align the store-level `WINDOW_SIZE` to 160 as well, OR have `useChatMessages` trim to `MAX_LOADED` after every bootstrap/load.
- Files:
  - `packages/ui/lib/chat-engine-v2/messageWindow.ts` — set `WINDOW_PAGES = 1` (so `WINDOW_SIZE = 100`)? **No** — that breaks the 160 initial. Instead: keep `INITIAL_PAGE = 160` authoritative and make `useChatMessages` enforce `MAX_LOADED` as the hard cap after each mutation.
  - `packages/ui/components/ChatView/messageWindow.ts` — already 160. Keep.
- Add a single exported `UI_INITIAL_WINDOW = 160` constant in one shared module (e.g. `packages/ui/lib/chat-engine-v2/constants.ts`) and reference it from both `client.ts` (`CHAT_BOOTSTRAP_INITIAL_LIMIT`) and `messageWindow.ts` (`MAX_LOADED`/`INITIAL_PAGE`).

### Phase 1 — Guarantee imported sessions open windowed (highest impact)

The projection already supports windowed reads. The risk is the **hydrate-on-empty** path re-persisting everything and the **bootstrap prune** logic. Verify and harden:

1. **Bootstrap for imported sessions** (`routes.ts:1780`):
   - Already returns `limit: 160, latest: true`. Confirm `hasOlder` is computed correctly: `firstVisibleSeq > 1`. For imported sessions with full projection, `firstVisibleSeq` will be large → `hasOlder = true`. ✅ No change needed, but add a regression test asserting `hasOlder === true` and `messages.length <= 160` for a 5k-message imported session.
   - **Prune guard:** ensure `pruneSegmentToCanonicalMessages` is NEVER called for imported sessions when gateway history is empty. Current code: `normalized.length === 0 || findLatestPendingRun` → prune skipped. ✅ Safe. Add a test that an imported session's projection is not pruned on bootstrap.

2. **Hydrate-on-empty** (`compat/routes.ts:2089` `hydrateImportedPlatformSessionMessages`):
   - This re-persists ALL source messages. For a 20k Telegram session, this is slow on first open but only happens once (projection then exists). Acceptable, but:
   - **Optimization (optional, Phase 3):** hydrate only the tail (last 160) on first open, set a flag `importedHistoryHydratedTail: true` in session data, and backfill the rest in a background job. This keeps first-open fast. The UI only ever reads windowed APIs, so it doesn't care if the full projection isn't there yet.
   - **Must not call `listAllMessages` for imported sessions.** The `/api/chat/messages` fallback (`routes.ts:1966`) only triggers when no window params. UI always passes window params. ✅ Safe.

3. **`/api/chat/messages` refill path** (`routes.ts:1924`): when `beforeSeq` is set and local is empty, it pulls `chat.history` from gateway with `limit: refillLimit` (up to 10k). For imported sessions, gateway history may be empty/short, so this is a no-op. ✅ Safe. But add a guard: if the session is an imported platform session (`importedPlatformSessionLink` returns a link), skip the gateway refill entirely — there is no gateway history to refill from; the source of truth is the local projection / source file.

### Phase 2 — UI virtualization consistency (single policy)

Wire the 160 window consistently through the render path:

- `useChatMessages.ts` (`packages/ui/hooks/useChatMessages.ts`):
  - After bootstrap, enforce `state.messages.length <= MAX_LOADED` (160). If bootstrap returns 160, this is already satisfied.
  - On `loadOlder`, prepend 100, evict from tail if over 160, preserve scroll anchor (existing `planDropFromBottom` logic in `chat-engine-v2/messageWindow.ts` already does this).
  - On send/live tail: only append when `hasNewer === false` (user at bottom). If user is deep in history, buffer or pin-to-bottom on send (existing behavior).
- `ChatView/messageWindow.ts`: already correct (160/160/100). Keep as the ChatView-level source of truth.
- Remove the dual 200 (`WINDOW_SIZE`) vs 160 (`MAX_LOADED`) ambiguity: have `useChatMessages` import `MAX_LOADED` from `ChatView/messageWindow.ts` (or the shared constants module) and use it as the hard cap instead of `WINDOW_SIZE`.

### Phase 3 — Continue chat = same session (verify, don't redesign)

Already intended. Add regression tests:
- After importing a large Telegram session, send a message → agent still answers with full transcript context (gateway-side). UI shows only last 160 + new turns.
- Document: "UI empty older pages ≠ context lost."

### Phase 4 — Hardening for very long threads (optional)

- **Tail-first hydrate:** `hydrateImportedPlatformSessionMessages` persists only last 160 on first open; background job backfills the rest. Keeps first-open ≤1–2s.
- **Import progress / non-blocking:** for multi-thousand message sessions, run `persistImportedChatMessages` in chunks (e.g. 500 rows/chunk) so the import call returns fast and the UI isn't blocked.
- **Cap serialized payload per message** in the UI window (tool/media-heavy rows) — separate from count window.

## What we will NOT do

- Create a new session per open to "reduce history."
- Truncate the gateway transcript so the model "forgets" early Telegram turns.
- Load full history into React "then virtualize DOM only."
- Special-case Telegram UI forever — use generic windowed sessions (imported or not).

## Success criteria

| Check | Pass condition |
|-------|----------------|
| Open long imported chat | First paint ≤ ~1–2s, ≤160 messages, no freeze |
| Scroll | Smooth older pages (100), no jump, no seq holes |
| `hasOlder` | `true` when more history exists; `false` at true start |
| Reimport / reopen | No duplicate storm; same session |
| Continue chat | Same sessionKey; agent answers with full transcript context |
| Virtualization | `state.messages.length` stays ≤ `MAX_LOADED` (160) after settle |
| Bootstrap | Never returns / never hydrates "all messages" for huge imports on the open path |

## Files to touch (summary)

| File | Change |
|------|--------|
| `packages/ui/lib/chat-engine-v2/constants.ts` (new) | Single `UI_INITIAL_WINDOW = 160` |
| `packages/ui/lib/chat-engine-v2/client.ts` | Use shared constant for `CHAT_BOOTSTRAP_INITIAL_LIMIT` |
| `packages/ui/lib/chat-engine-v2/messageWindow.ts` | Align `WINDOW_SIZE` to 160 or document `MAX_LOADED` as hard cap |
| `packages/ui/hooks/useChatMessages.ts` | Enforce `MAX_LOADED` cap; use shared constant |
| `apps/middleware/src/features/chat/routes.ts` | Guard gateway-refill for imported sessions; add tests |
| `apps/middleware/src/features/compat/routes.ts` | (Optional) tail-first hydrate; skip `listAllMessages` for imported |
| `apps/middleware/tests/app.test.ts` | Regression: 5k-message imported session → bootstrap ≤160, `hasOlder=true`, no prune |

## Verification

```bash
pnpm --filter @openclaw/desktop-middleware test -- --runInBand
pnpm --filter ui typecheck
pnpm --filter ui build
```

Manual: import a long Telegram session → open → scroll older → reimport twice → send a message → confirm agent "remembers" early context while UI shows only the tail window.
