# Group 02 — Canonical Chat State + Focused Window Bootstrap

## Problem

Focused/new chat windows run in a fresh JS realm. They do not inherit the main window's in-memory global chat state, patch stream connection, timeline store, or current active subagent/tool maps.

Current risk: `useChatMessages()` can open the global patch stream before the focused window has seeded the active session cursor from warm cache or canonical `/api/chat/bootstrap`. If persisted `globalCursor` is ahead because another window/session advanced it, the new focused window may connect after that cursor and skip active-session patches between the active bootstrap cursor and the persisted global cursor.

This is especially risky for focused windows because their local `states` map starts empty.

## Current Flow

Files traced:

- `packages/ui/components/AppPage.tsx`
  - `FocusedChatWindowPage` resolves `chatId` → `sessionKey` and renders `ChatView` with a key of `chatId:sessionKey`.

- `packages/ui/hooks/useChatMessages.ts`
  - Reads possible initial state from:
    - `getGlobalChatSession(sessionKey)`
    - React Query bootstrap cache
    - sync warm cache
  - Later applies async persisted warm cache from IndexedDB.
  - Calls `ensureGlobalChatEngine(queryClient)` before the fresh bootstrap path settles.
  - Applies canonical bootstrap and seeds `seedGlobalChatSession()`.

- `packages/ui/lib/chat-engine-v2/store.ts`
  - `ensureGlobalChatEngine()` restores persisted `globalCursor` and opens `/api/stream/ws?afterCursor=<globalCursor>`.
  - `handlePatch()` drops replayed patches below `globalCursor` for sessions without local state, except `chat.bootstrap`.
  - `seedGlobalChatSession()` raises `globalCursor` to the seeded cursor.

## Root Cause

The stream cursor is globally persisted, but focused/new windows need a session-safe replay point for the active session.

If `globalCursor = 1000` from another window/session and focused bootstrap for active session returns `cursor = 900`, opening the stream with `afterCursor=1000` can skip active-session events `901..1000` that this fresh JS realm never saw.

## Proposed Fix

1. Add an optional `replayFromCursor` parameter to `ensureGlobalChatEngine()`.
2. Before opening the stream, if a lower active-session bootstrap/warm cursor is known, lower the initial stream cursor to that session-safe cursor. Other sessions with newer local state will reject stale replayed patches by their own cursors.
3. In `useChatMessages()`, do not eagerly open the patch stream before there is a known active-session cursor unless the global engine already has state.
4. Ensure the stream after:
   - sync warm/global/bootstrap cache seeding when cursor exists
   - persisted warm-cache seeding when cursor exists
   - canonical bootstrap seeding
   - initial optimistic-message skip path
   - bootstrap failure fallback
5. Keep bootstrap as the authoritative source for messages/tools/subagents.
6. Keep warm cache as preview only; it must not override canonical bootstrap.

## Files to Change

- `packages/ui/lib/chat-engine-v2/store.ts`
  - Extend `ensureGlobalChatEngine()` with options for session-safe replay cursor.
  - Log whether the stream cursor was lowered for a fresh local state.

- `packages/ui/hooks/useChatMessages.ts`
  - Replace eager `ensureGlobalChatEngine(queryClient)` with a small local `ensureEngine(reason)` helper.
  - Call `ensureEngine()` only after active-session cursor seeding where possible.

## Risks

- Lowering stream cursor can replay more global patches in a fresh window. This is acceptable because patches are monotonic/deduped and bootstrap remains canonical.
- Delaying stream open until bootstrap can theoretically miss live events during the bootstrap request. Patch backlog replay after the bootstrap cursor should cover that gap.
- Existing main-window behavior must not regress. Only fresh/local-empty stream start should lower replay cursor.

## Testing

- `pnpm --filter ui typecheck`
- `pnpm --filter ui build`
- Targeted review of stream logs:
  - `global-chat-engine.connect.start`
  - `global-chat-engine.replay-cursor.lowered`
  - `focused.bootstrap.applied`
  - `patch_stream.cursor_relation`

## Manual Verification

- Open same running chat in main and focused/new window.
- Focused window should reconstruct same canonical message/cursor/status after bootstrap settles.
- Focused window should not skip active-session patches because unrelated sessions advanced global cursor.
