---
title: Telegram-Inspired Long Chat Virtualization for OpenClaw Desktop
type: refactor
status: active
date: 2026-06-11
---

# Telegram-Inspired Long Chat Virtualization for OpenClaw Desktop

## Summary

Replace the current ad-hoc long-chat rendering, warm-cache, and older-history loading paths with an OpenClaw-native version of Telegram Desktop's long-chat invariants: bounded page windows, stable row identity, anchor-preserving prepends, measured variable-height virtualization, live patch mutation safety, and explicit cache layers.

This plan does **not** propose copying Telegram Desktop code. It proposes copying the load-bearing architecture in a React/Tauri/middleware shape that fits OpenClaw's streaming assistant/tool-log model.

---

## Problem Frame

OpenClaw Desktop currently has several overlapping mechanisms trying to keep long chat sessions smooth:

- frontend warm cache and persistent cache paths in `packages/ui/lib/warmChatCache.ts`, `packages/ui/lib/chat-engine-v2/store.ts`, `packages/ui/lib/chat-engine-v2/timelineStore.ts`, and `packages/ui/hooks/useChatMessages.ts`;
- non-virtualized full-array rendering in `packages/ui/components/ChatView/index.tsx` and `packages/ui/components/ChatView/vercel-ui/OpenClawVercelChat.tsx`;
- custom older-history autoload thresholds in `packages/ui/components/ChatView/chatHistoryAutoLoad.ts`;
- middleware local-first bootstrap, projection, backfill, and page APIs in `apps/middleware/src/features/chat/routes.ts`, `projection.ts`, `repo.messages.ts`, `live.ts`, and `apps/middleware/src/features/patches.ts`.

These pieces have accumulated protective fixes for flicker, duplicate rows, active-run preservation, stale cursor recovery, and bootstrap consistency. Removing them outright before replacement would regress live streaming and reload recovery. The replacement must therefore happen behind new contracts and tests, then retire old paths once parity is proven.

---

## Requirements

### User-visible behavior

- R1. Long sessions must open quickly from a bounded newest-message window instead of rendering or canonicalizing an unbounded transcript.
- R2. Scrolling upward must load older history before the user reaches the edge, without visible jump, blink, duplicate rows, or lost live rows.
- R3. Scrolling downward / staying at latest must preserve bottom-stick behavior during live assistant streaming, tool updates, and finalization.
- R4. Streaming assistant text, reasoning, tool calls, subagent cards, approvals, attachments, and logs must patch existing rows in place rather than remounting the conversation.
- R5. Search/jump-to-message must work for messages outside the loaded render window by loading around the target row and then centering it.
- R6. Offscreen expensive content, especially tool result bodies, syntax-highlighted markdown, images, embeds, and animation-heavy components, must be unloaded or collapsed without losing durable row state.

### Data and cache contracts

- R7. Middleware must expose deterministic page windows with durable sequence anchors: newest bootstrap, older page, newer page, and around-message page.
- R8. The frontend must treat middleware projection as the authoritative durable cache; browser warm cache may only be a preview layer and may not override fresher bootstrap or live patch state.
- R9. Local-first middleware cache must remain, but its contract must become explicit: bounded foreground page, known total/oldest/newest seq metadata, cache freshness, and background sync events.
- R10. Patch cursor replay must remain monotonic within a backend epoch and must reset safely when the backend epoch changes.
- R11. Active runs must never be finalized, hidden, or overwritten by stale bootstrap/cache data while live patches indicate the run is still active.

### Performance and stability

- R12. The chat UI must render only viewport rows plus overscan, with measured height cache for variable-height content.
- R13. Row identity must be stable across bootstrap, older pages, live patches, optimistic send confirmation, and cache hydration.
- R14. Request states must be split and deduped: initial bootstrap, load older, load newer, load around target, live replay recovery, active-run reconcile.
- R15. The system must be stress-tested with large sessions, streaming rows, tool-heavy rows, reloads, hidden-window restore, and backend restart/replay.

---

## Scope Boundaries

- Do not copy Telegram Desktop's Qt/C++ code into OpenClaw.
- Do not remove all current caching first. Retire current cache paths only after replacement contracts and parity tests exist.
- Do not change Gateway protocol semantics unless a middleware compatibility wrapper cannot provide the required page shape.
- Do not rewrite message bubble visual design as part of this plan.
- Do not require every historical row to stay mounted in React. Durable data stays in middleware/browser state; rendered rows are virtualized.
- Do not make browser warm cache authoritative. It is only an instant-paint preview.

---

## Key Technical Decisions

- KTD1. **OpenClaw-native Telegram invariants, not Telegram code:** Telegram's useful parts are the invariants: page windows, scroll anchor, visible-range rendering, heavy-part unloading. The implementation must use React/Tauri/middleware primitives.
- KTD2. **Middleware projection is the durable cache:** SQLite projection in `apps/middleware/src/features/chat/repo.messages.ts` is closer to Telegram's `History` than browser warm cache. Browser cache becomes a bounded preview layer only.
- KTD3. **Introduce a row-model layer between ChatMessage and rendering:** Current UI renders `ChatMessage[]` directly. The new system needs `ChatTimelineRow` records with `rowId`, `messageId`, `openclawSeq`, `rowKind`, `heightEstimate`, `heightVersion`, `heavyState`, and `mutationVersion`.
- KTD4. **Use measured variable-height virtualization:** Add a purpose-built virtualization layer, preferably `@tanstack/react-virtual`, or an equivalent internal hook if dependency policy blocks it. Fixed-height virtualization is not acceptable because markdown, tool logs, images, and streaming text are variable height.
- KTD5. **Anchor by row id plus pixel offset:** Preserve scroll using the first visible durable row id and offset, not raw `scrollTop`. This mirrors Telegram's `scrollTopItem + scrollTopOffset` and is required for stable prepends.
- KTD6. **Patch in place, never replace active windows blindly:** Live patches and active-run reconciles merge into existing rows. Bootstrap/page data can add missing durable rows but cannot delete newer live rows except through explicit remove/prune patches.
- KTD7. **Separate durable cache from render cache:** Durable cache is middleware projection + row store. Render cache is measured heights and heavy-content mount state. Warm browser cache is preview only.
- KTD8. **Phased retirement over hard deletion:** Current `useChatMessages`, `ChatTimelineStore`, warm cache, autoload logic, and non-virtualized render paths are retired after the new stack passes contract/stress tests.

---

## High-Level Technical Design

```mermaid
flowchart TB
  G[Gateway session history + live events] --> M[Middleware projection]
  M --> DB[(SQLite v2_messages / runs / projection events)]
  DB --> B[/api/chat/bootstrap newest window]
  DB --> P[/api/chat/page older newer around]
  DB --> S[/api/patches + stream/ws]

  B --> F[Frontend durable timeline store]
  P --> F
  S --> F
  WC[Browser warm preview cache] --> F

  F --> R[Chat row model]
  R --> V[Measured virtual list]
  V --> MB[MessageBubble / Tool rows / Subagent rows]
  V --> H[Height cache + heavy part lifecycle]
```

### New core concepts

- `ChatTimelineRow`: stable render row model derived from message projection.
- `ChatWindowState`: loaded seq range, known total, oldest/newest seq, page request state, active anchor, and history coverage.
- `ChatMeasurementCache`: row height estimates/actuals keyed by `rowId` and invalidated by row `heightVersion`.
- `ChatLiveCache`: in-memory authoritative row map for active session, merged from bootstrap/pages/patches.
- `ChatPreviewCache`: IndexedDB/local browser preview of last N rendered durable rows, never authoritative.
- `HeavyPartRegistry`: tracks offscreen large row sections and collapses/unmounts them outside overscan.

### Target API shape

Existing APIs can be evolved, but the target contract should look like:

```ts
type ChatPageRequest = {
  sessionKey: string
  direction: "latest" | "older" | "newer" | "around"
  beforeSeq?: number
  afterSeq?: number
  aroundSeq?: number
  aroundMessageId?: string
  limit?: number
}

type ChatPageResponse = {
  ok: true
  sessionKey: string
  source: "middleware-projection"
  projectionVersion: number
  page: {
    direction: "latest" | "older" | "newer" | "around"
    messages: ProjectedMessage[]
    oldestSeq: number | null
    newestSeq: number | null
    hasOlder: boolean
    hasNewer: boolean
    knownTotalMessages: number | null
    cursor: number
    cacheFreshness: "live" | "sqlite-fresh" | "sqlite-stale" | "gateway-backfilled"
  }
  activeRun: ActiveRunV2 | null
  tools: ToolCallProjectionV2[]
}
```

Existing `/api/chat/bootstrap` may remain as a compatibility alias for `direction=latest`. Existing `/api/chat/messages` may be replaced or wrapped by the new page endpoint.

---

## Implementation Units

### U1. Middleware page contract and projection metadata

- **Goal:** Make middleware expose Telegram-like deterministic windows with explicit range metadata.
- **Files:**
  - `apps/middleware/src/features/chat/routes.ts`
  - `apps/middleware/src/features/chat/projection.ts`
  - `apps/middleware/src/features/chat/repo.messages.ts`
  - `apps/middleware/src/features/chat/types.ts`
  - `apps/middleware/tests/projection.test.ts`
  - `apps/middleware/tests/chat-projection-contract.test.ts`
  - `apps/middleware/tests/live.test.ts`
- **Patterns to follow:** Existing `buildChatBootstrapSnapshot`, `/api/chat/bootstrap`, `/api/chat/messages`, `listMessages`, `countMessages`, `latestSessionCursor`.
- **Plan:**
  - Add a canonical page response builder separate from bootstrap compatibility.
  - Return `oldestSeq`, `newestSeq`, `hasOlder`, `hasNewer`, `knownTotalMessages`, `cursor`, and `cacheFreshness` on every page.
  - Support latest, older, newer, and around-message windows.
  - Keep local-first SQLite path, but stop hiding short local windows behind ambiguous `hasOlder` behavior.
  - Preserve active-run/tool projections in page responses.
- **Test scenarios:**
  - Latest page returns newest N rows and correct `hasOlder`.
  - Older page before seq returns previous rows in stable ascending render order.
  - Newer page after seq returns newer rows without duplicating anchor row.
  - Around-message page includes target row and both boundary flags.
  - Local-first short SQLite window backfills or reports incomplete range deterministically.
  - Active run and tool calls survive latest/page responses.
- **Verification:** `pnpm --filter @openclaw/desktop-middleware test` and targeted middleware tests above.

### U2. Frontend durable timeline store replacement

- **Goal:** Replace overlapping timeline/global/warm-cache ownership with one durable frontend timeline store fed by page responses and patches.
- **Files:**
  - `packages/ui/lib/chat-engine-v2/store.ts`
  - `packages/ui/lib/chat-engine-v2/timelineStore.ts`
  - `packages/ui/lib/chat-engine-v2/applyPatches.ts`
  - `packages/ui/lib/chat-engine-v2/types.ts`
  - `packages/ui/hooks/useChatMessages.ts`
  - `packages/ui/lib/chat-engine-v2/__tests__/store.test.ts`
  - `packages/ui/lib/chat-engine-v2/__tests__/timelineStore.test.ts`
  - `packages/ui/lib/chat-engine-v2/__tests__/applyPatches.test.ts`
  - `packages/ui/lib/chat-engine-v2/__tests__/timelineStoreIntegration.test.ts`
- **Patterns to follow:** Current cursor monotonicity, bootstrap merge protection, optimistic send confirmation, `applyBootstrap`, `applyPatchMessage`, active-run preservation.
- **Plan:**
  - Introduce `ChatWindowState` and row-range metadata to the store.
  - Make bootstrap/page/patch merge rules explicit and testable.
  - Page data may extend loaded ranges; it may not clear rows outside the requested window unless a reset/epoch event says so.
  - Patches always merge by durable row identity and advance cursor.
  - Optimistic rows become confirmed rows without changing visible row identity.
- **Test scenarios:**
  - Warm preview arrives, then bootstrap replaces/merges without flicker.
  - Patch arrives before bootstrap; bootstrap cannot delete newer patch row.
  - Older page prepends rows without duplicate user/assistant turns.
  - Active streaming assistant row patches text in place.
  - Tool running -> success patch preserves row id and result state.
  - Backend epoch reset clears stale cursor and reloads latest page.
- **Verification:** `pnpm --filter ui test -- chat-engine-v2` or equivalent targeted vitest invocation.

### U3. Browser warm cache demotion and redesign

- **Goal:** Replace current warm cache as a partial source of truth with a bounded preview cache.
- **Files:**
  - `packages/ui/lib/warmChatCache.ts`
  - `packages/ui/hooks/useChatMessages.ts`
  - `packages/ui/lib/chat-engine-v2/store.ts`
  - `packages/ui/lib/chat-engine-v2/__tests__/store.test.ts`
  - `packages/ui/lib/__tests__/chatSessionLoad.test.ts`
- **Patterns to follow:** Current `WARM_CHAT_MAX_MESSAGES`, split preview/run entries, cache truncation, `stripTransientChatMessagesState`.
- **Plan:**
  - Keep only a small newest-row preview and active-run summary in IndexedDB.
  - Remove any code path where warm cache can override bootstrap/page/patch state.
  - Store cache freshness and source in state for diagnostics.
  - Persist only durable row projections, not expanded heavy render state.
- **Test scenarios:**
  - Stale warm cache paints briefly but is replaced by bootstrap.
  - Warm cache with terminal status cannot hide an active run from patches.
  - Warm cache never clears messages received from live stream.
  - Large tool results are truncated in preview cache but recover from middleware page/tool-result fetch.
- **Verification:** targeted warm cache/store tests plus UI typecheck.

### U4. Chat row model and stable identity layer

- **Goal:** Create a stable row model that can be virtualized independently of message storage.
- **Files:**
  - `packages/ui/components/ChatView/types.ts`
  - `packages/ui/components/ChatView/chatStableIds.ts`
  - `packages/ui/lib/chat-engine-v2/types.ts`
  - new `packages/ui/lib/chat-engine-v2/rowModel.ts`
  - new `packages/ui/lib/chat-engine-v2/__tests__/rowModel.test.ts`
- **Patterns to follow:** Existing `buildStableChatRows`, `dedupeChatMessages`, `mergeAssistantText`, tool-call merge rules.
- **Plan:**
  - Define `ChatTimelineRow` with durable row id independent of render index.
  - Split row kinds if needed: `message`, `tool-stack`, `status`, `date-divider`, `load-boundary`, `edit-preview`.
  - Preserve compatibility with `MessageBubble` by adapting rows back to current props during initial migration.
  - Track `heightVersion` for text/tool/image changes.
- **Test scenarios:**
  - Same message across warm/bootstrap/patch yields same `rowId`.
  - Optimistic user row confirmed by Gateway keeps row id.
  - Assistant streaming chunks update same assistant row.
  - Tool-only rows do not create duplicate assistant rows.
  - Subagent rows anchor to correct triggering user/assistant row.
- **Verification:** new row model tests and existing chat stable id tests.

### U5. Measured virtual list component

- **Goal:** Replace full `renderedMessages.map` rendering with viewport + overscan rendering.
- **Files:**
  - `packages/ui/components/ChatView/index.tsx`
  - `packages/ui/components/ChatView/vercel-ui/OpenClawVercelChat.tsx`
  - new `packages/ui/components/ChatView/VirtualChatList.tsx`
  - new `packages/ui/components/ChatView/useChatVirtualizer.ts`
  - new `packages/ui/components/ChatView/chatScrollAnchor.ts`
  - `packages/ui/components/ChatView/useStableChatScroll.ts` or `vercel-ui/useStableChatScroll.ts`
  - `packages/ui/components/ChatView/__tests__/chatScrollAnchor.test.ts`
- **Patterns to follow:** Current capture/settle anchor code in `index.tsx` and `OpenClawVercelChat.tsx`; current `MessageBubble` rendering; Telegram's visible-range binary search concept.
- **Plan:**
  - Add `@tanstack/react-virtual` if allowed; otherwise implement a small measured virtualizer.
  - Render rows by `rowId`, not array index.
  - Overscan at least 2-3 viewports for chat smoothness.
  - Measure row heights after render and when `heightVersion` changes.
  - Maintain bottom-stick mode when user is near latest.
  - Preserve anchor before prepending older rows and restore after measurement settles.
- **Test scenarios:**
  - 10k synthetic rows render bounded DOM count.
  - Prepending older rows keeps anchor row at same viewport position.
  - Streaming last assistant row grows while bottom-stuck without jitter.
  - User scrolled up does not get forced to bottom by live patches.
  - Hidden-window restore repaints existing virtual rows.
- **Verification:** component/unit tests plus browser/manual stress page evidence.

### U6. Heavy-part lifecycle for tool logs and rich content

- **Goal:** Match Telegram's heavy-resource unloading in a React-safe way.
- **Files:**
  - `packages/ui/components/ChatView/MessageBubble.tsx`
  - `packages/ui/components/ChatView/ToolCallDetails.tsx`
  - `packages/ui/components/ChatView/MarkdownContent.tsx`
  - `packages/ui/components/ChatView/RichContentPreview.tsx`
  - new `packages/ui/components/ChatView/useHeavyRowParts.ts`
  - tests near affected components if present, otherwise new targeted tests.
- **Patterns to follow:** Existing collapsed tool stack behavior and result truncation in `warmChatCache.ts`.
- **Plan:**
  - Keep lightweight summary mounted for offscreen rows.
  - Unmount/collapse expensive bodies outside virtualizer overscan.
  - Persist expansion state by `rowId` and tool id, not component instance.
  - Lazy-fetch full tool result via existing `/api/chat/tool-result` only when expanded/visible.
- **Test scenarios:**
  - Expanded tool state survives scroll away/back.
  - Offscreen large tool result unmounts heavy body but keeps summary.
  - Returning onscreen restores body without duplicate fetch when cached.
  - Markdown/code blocks do not rerender all rows on one streaming update.
- **Verification:** targeted component tests and long-chat browser audit.

### U7. History loading triggers and request state machine

- **Goal:** Replace threshold-only autoload with explicit Telegram-like request states and page gates.
- **Files:**
  - `packages/ui/components/ChatView/chatHistoryAutoLoad.ts`
  - `packages/ui/hooks/useChatMessages.ts`
  - `packages/ui/components/ChatView/index.tsx`
  - `packages/ui/components/ChatView/vercel-ui/OpenClawVercelChat.tsx`
  - `packages/ui/lib/__tests__/chatHistoryAutoLoad.test.ts`
- **Patterns to follow:** Existing `shouldAutoLoadOlderHistory`, current in-flight guards, Telegram's `firstLoad/preload/preloadDown/delayedShowAt` split.
- **Plan:**
  - Define request states: `initial`, `older`, `newer`, `around`, `replayRecovery`, `activeReconcile`.
  - Only one request per direction at a time; allow live patches concurrently.
  - Use virtualizer range, not raw `scrollTop` only, to trigger older/newer pages.
  - Block auto older loads during active generation unless user explicitly requests older history.
  - Add load-around for search/jump.
- **Test scenarios:**
  - Rapid scroll to top coalesces older requests.
  - Fast upward scroll preloads before edge.
  - Active generation blocks automatic older load but not manual load.
  - Around-message load cancels/reconciles with pending older load safely.
- **Verification:** autoload unit tests and UI integration tests.

### U8. Search, pin, and jump-to-message across unloaded ranges

- **Goal:** Make navigation work when target rows are not currently loaded/rendered.
- **Files:**
  - `packages/ui/components/ChatView/ChatSearch.tsx`
  - `packages/ui/components/ChatView/PinnedMessagesPopover.tsx`
  - `packages/ui/components/ChatView/index.tsx`
  - `packages/ui/lib/api/chats.ts`
  - `apps/middleware/src/features/chat/routes.ts`
  - related tests for search if present, otherwise new tests.
- **Patterns to follow:** Current `scrollToRenderedMessage`, middleware `searchMessages`, and page by seq.
- **Plan:**
  - If target row is rendered, scroll virtualizer to it.
  - If target row is known by seq but not loaded, call around-page endpoint, merge page, then scroll.
  - If only message id is known, middleware resolves id to seq then returns around page.
  - Highlight target after virtualizer measurement completes.
- **Test scenarios:**
  - Search result already rendered scrolls immediately.
  - Search result outside loaded window loads around and centers target.
  - Pinned message navigation works for older unloaded message.
  - Missing/deleted target shows clear fallback instead of no-op.
- **Verification:** targeted tests and browser check.

### U9. Migration cleanup and old-system removal

- **Goal:** Remove old virtualization/caching/autoload paths after the new system is proven.
- **Files:**
  - `packages/ui/hooks/useChatMessages.ts`
  - `packages/ui/lib/chatSessionStore.ts`
  - `packages/ui/lib/chatListCache.ts`
  - `packages/ui/lib/warmChatCache.ts`
  - `packages/ui/lib/chat-engine-v2/timelineStore.ts`
  - `packages/ui/components/ChatView/chatHistoryAutoLoad.ts`
  - `packages/ui/components/ChatView/index.tsx`
  - `packages/ui/components/ChatView/vercel-ui/OpenClawVercelChat.tsx`
- **Patterns to follow:** Existing tests must be migrated, not deleted blindly.
- **Plan:**
  - Keep compatibility shims until both ChatView modes use `VirtualChatList`.
  - Remove duplicate global session caches that can fight the new durable timeline store.
  - Remove old threshold-only anchor logic after virtualizer anchor tests pass.
  - Remove old warm-cache authority paths after preview-cache tests pass.
  - Delete or rewrite obsolete tests to assert new contracts.
- **Test scenarios:**
  - No stale old cache can override new page/patch state.
  - Both default and Vercel/assistant UI modes render through the same virtual row model.
  - Existing send/edit/abort/retry behavior remains intact.
- **Verification:** full UI test/typecheck/build gates.

### U10. Stress/audit harness

- **Goal:** Prove the MVP under realistic long-session conditions.
- **Files:**
  - `packages/ui/app/audit-long-chat/page.tsx`
  - new or updated `packages/ui/lib/chat-engine-v2/__tests__/longSessionVirtualization.test.ts`
  - `apps/middleware/tests/chat-projection-contract.test.ts`
  - `apps/middleware/tests/patch-stream.test.ts`
  - optional browser/Webwright scripts under existing test/audit locations.
- **Patterns to follow:** Existing `audit-long-chat` route and chat engine tests.
- **Plan:**
  - Generate synthetic sessions with 10k, 50k, and 100k rows.
  - Include variable-height markdown/code/tool/image rows.
  - Simulate live streaming while scrolled at bottom and while scrolled up.
  - Simulate middleware restart/patch replay cursor reset.
  - Record DOM row count, long tasks, scroll anchor drift, duplicate ids, and dropped patches.
- **Test scenarios:**
  - Initial paint stays bounded.
  - DOM rows remain near viewport + overscan, not total messages.
  - Anchor drift after prepend stays within a small pixel tolerance.
  - No duplicate durable row ids after bootstrap + pages + patches.
  - Backend restart recovers via bootstrap without blank/flicker.
- **Verification:** automated tests plus a browser audit note or screenshot/video evidence before shipping.

---

## Acceptance Examples

- AE1. **Open huge chat:** Given a session with 50k projected messages, when the user opens it, then the UI displays newest messages quickly, renders bounded DOM rows, reports `hasOlder=true`, and does not freeze while canonicalizing all 50k rows.
- AE2. **Prepend older history:** Given the user is reading message row `R`, when older history loads above it, then `R` remains at the same visual position after layout settles.
- AE3. **Live stream at bottom:** Given the user is at latest, when assistant text and tool patches stream in, then the virtual list remains bottom-stuck and patches the same rows without remount flicker.
- AE4. **Live stream while scrolled up:** Given the user is reading older history, when new live patches arrive, then the viewport does not jump to bottom and a latest/jump affordance remains available.
- AE5. **Search unloaded target:** Given search returns a message outside the loaded row range, when the user selects it, then the client loads an around page and centers/highlights the row.
- AE6. **Warm cache stale:** Given browser warm preview is stale and middleware has newer projection rows, when bootstrap completes, then stale preview cannot delete or overwrite newer rows.
- AE7. **Tool-heavy session:** Given a chat has many large tool results, when most are offscreen, then heavy bodies are unmounted/collapsed while summaries and expansion state remain stable.

---

## System-Wide Impact

- Frontend chat state ownership changes from many partially overlapping stores to one durable timeline/row store.
- Browser persistent cache becomes preview-only, reducing cache races but requiring bootstrap/page contracts to be fast and reliable.
- Middleware page metadata becomes a hard contract for frontend virtualization.
- Patch replay and active-run preservation remain critical and must be integrated, not bypassed.
- Existing ChatView and Vercel/assistant UI modes should converge on the same virtual row model to avoid duplicate bug surfaces.

---

## Risks & Dependencies

- **Risk: variable-height measurement instability.** Streaming markdown/tool rows change height frequently. Mitigation: heightVersion invalidation, resize observer batching, and anchor restoration after measurement settles.
- **Risk: deleting protective old code too early.** Mitigation: feature-flag/new path first, parity tests, then remove old paths in U9.
- **Risk: warm cache regressions.** Mitigation: demote warm cache to preview-only and assert it cannot overwrite fresher cursor/page state.
- **Risk: active run data loss.** Mitigation: preserve current active-run tests and add patch-before-bootstrap scenarios.
- **Risk: dependency choice.** If `@tanstack/react-virtual` is added, lock behavior with tests. If not, internal virtualizer must implement measured heights, overscan, scrollToIndex, and anchor preservation.
- **Risk: search/jump API gaps.** Around-message load may require middleware message-id-to-seq lookup. Plan U8 covers this explicitly.

---

## Rollout / Migration Strategy

1. Add middleware page contract and tests while keeping existing `/api/chat/bootstrap` and `/api/chat/messages` compatible.
2. Add new frontend row store and row model behind a feature flag or internal switch.
3. Add `VirtualChatList` and route one chat UI mode through it in audit/development first.
4. Pass synthetic long-chat audit with new path.
5. Route both existing ChatView modes through the virtual row model.
6. Demote warm cache and remove authority paths.
7. Remove old autoload/anchor/render map paths.
8. Run full middleware + UI gates before merge.

---

## Verification Gates

- Middleware:
  - `pnpm --filter @openclaw/desktop-middleware typecheck`
  - `pnpm --filter @openclaw/desktop-middleware test`
- UI targeted:
  - chat-engine-v2 tests
  - chat history autoload/anchor tests
  - row model tests
  - warm cache tests
- UI broad:
  - `pnpm --filter ui typecheck`
  - `pnpm --filter ui build`
- Browser/manual:
  - `audit-long-chat` route with 10k/50k/100k rows
  - live stream while at bottom
  - live stream while scrolled up
  - search/jump to unloaded row
  - middleware restart/recovery

---

## Sources / Research

- Telegram Desktop analysis: `../external/tdesktop/LONG_CHAT_VIRTUALIZATION_ANALYSIS.md`
- OpenClaw frontend chat hook: `packages/ui/hooks/useChatMessages.ts`
- OpenClaw frontend render path: `packages/ui/components/ChatView/index.tsx`
- OpenClaw Vercel/assistant render path: `packages/ui/components/ChatView/vercel-ui/OpenClawVercelChat.tsx`
- Current older-load trigger: `packages/ui/components/ChatView/chatHistoryAutoLoad.ts`
- Current frontend chat engine: `packages/ui/lib/chat-engine-v2/store.ts`, `packages/ui/lib/chat-engine-v2/timelineStore.ts`, `packages/ui/lib/chat-engine-v2/types.ts`
- Browser warm cache: `packages/ui/lib/warmChatCache.ts`
- Middleware bootstrap/page routes: `apps/middleware/src/features/chat/routes.ts`
- Middleware projection contract: `apps/middleware/src/features/chat/projection.ts`
- Middleware message repository: `apps/middleware/src/features/chat/repo.messages.ts`
- Middleware live ingest: `apps/middleware/src/features/chat/live.ts`
