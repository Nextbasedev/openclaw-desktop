# Plan: Telegram-Style Lightweight Chat Windows

## Problem

Opening a chat in a new window currently creates a full new Tauri `WebviewWindow` that loads the whole web app again.

Current code:
- `packages/ui/lib/openRouteWindow.ts` creates a brand-new `WebviewWindow` with a new random label and `openclawWindowId`.
- `packages/ui/components/AppPage.tsx` calls `openRouteInNewWindow()` from tab/window actions.
- New webview remounts `AppPage`, `useChatsData`, `useProjectsData`, `useSpaces`, and `useChatMessages`.
- New webview opens its own `openPatchStreamV2()` WebSocket to `/api/stream/ws`.
- Chat mount calls `/api/chat/bootstrap` even if another window already has the same chat state in memory.

There are caches:
- `/api/bootstrap` has `localSyncGetBootstrap()` + `persistentCache` + request dedupe.
- Chat state has global store + warm cache.
- Patch cursor is stored in localStorage.

But each new window is still a separate JS runtime, so in-memory React/global store is not shared. The result is extra API calls, extra WebSocket connections, and more boot time.

## Goal

Implement a Telegram-style “open chat in new window” flow:

- New window opens directly into the selected chat.
- It shows chat + activity/tools + terminal/options for that chat.
- It should not reload the whole desktop shell/sidebar/project tree if not needed.
- It should avoid duplicate windows for the same chat when possible.
- It should avoid repeated full API bootstrap calls and repeated patch stream connections where possible.

## Telegram Reference

Telegram Desktop does this with a native shared process model:

- Context menu calls `showInNewWindow(SeparateId(...))`.
- `SeparateId` is a structured window identity: type + account/thread.
- `Core::App().ensureSeparateWindowFor(id, msgId)` checks if a window with that `SeparateId` already exists.
- If it exists, Telegram activates that window instead of creating another.
- If not, it creates a new controller over the same shared in-memory account/session.

Important concept to copy: **window identity + reuse/focus existing window**.

We cannot copy Telegram exactly because our Tauri windows are separate webviews / JS runtimes. But we can approximate it with a Tauri-side registry + middleware-backed shared state.

## Proposed Architecture

### 1. Add chat window identity

Create a stable window identity for each separate chat window:

```ts
type ChatWindowIdentity = {
  kind: "chat"
  sessionKey: string
  chatId: string
  mode: "focused-chat"
}
```

Window labels should be deterministic for the same chat/session:

```ts
openclaw-chat-${safeSessionKeyOrChatId}
```

Not random labels like current:

```ts
openclaw-chat-${Date.now()}-${Math.random()}
```

### 2. Ensure-or-focus instead of always create

Add a new API in `packages/ui/lib/openRouteWindow.ts`:

```ts
export async function openChatInFocusedWindow(input: {
  chatId: string
  sessionKey?: string
  title?: string
})
```

Behavior:

1. Build deterministic window label.
2. In Tauri mode:
   - Try `WebviewWindow.getByLabel(label)`.
   - If exists: `show()`, `setFocus()`, optionally emit event to navigate to chat.
   - If missing: create new `WebviewWindow(label, { url: focused chat route })`.
3. Browser fallback: use named `window.open(url, label)` instead of `_blank` so browser also reuses the same tab/window.

### 3. Add focused chat route

Add a route mode that renders only the chat workspace, not full app bootstrap/sidebar.

Example URL:

```txt
/#/chat-window/:chatId?sessionKey=...&openclawWindowId=...
```

or keep current hash route but add mode param:

```txt
/?openclawWindowId=...&openclawWindowMode=focused-chat#/chat-id
```

`AppPage` should detect `openclawWindowMode=focused-chat` and render a lightweight shell:

```tsx
<FocusedChatWindow
  chatId={chatId}
  sessionKey={sessionKey}
/>
```

This shell contains:
- ChatView
- Activity/tools panel for that run/session
- Terminal/options if needed
- Minimal title/header controls

It should NOT mount:
- Full sidebar
- Project/topic tree loaders
- Full editor groups restore
- Full workspace layout restoration

### 4. Pass enough data to avoid `/api/bootstrap`

When opening the window from an existing tab, pass the already-known chat/session metadata:

```ts
openChatInFocusedWindow({
  chatId: tab.chat.id,
  sessionKey: tab.chat.sessionKey,
  title: tab.title,
})
```

The focused window should not need `/api/bootstrap` just to resolve chat/session metadata.

It can start with:
- `chatId`
- `sessionKey`
- `title`
- optional serialized recent message preview key

### 5. Use middleware as shared truth, not per-window full app state

Since JS memory is not shared across webviews, the focused window should use a small shared bootstrap path:

Option A — minimal immediate improvement:
- Focused window calls only `/api/chat/bootstrap?sessionKey=...`.
- It skips `/api/bootstrap`, `/api/chats`, `/api/projects`, etc.
- It still opens its own patch stream.
- This is easy and already a big reduction.

Option B — better Telegram-style shared state:
- Add a middleware endpoint:

```http
GET /api/chat/window-state?sessionKey=...
```

Returns exactly what the focused window needs:
- chat metadata
- latest messages
- active run status
- pending tools
- spawned subagents
- terminal/session options
- latest patch cursor

This avoids full app bootstrap and keeps the focused window small.

Option C — single shared patch stream per desktop app:
- Tauri backend owns one patch stream to middleware.
- Webviews subscribe via Tauri events.
- This prevents every window from opening its own `/api/stream/ws`.
- Bigger change, but closest to Telegram’s shared process model.

Recommended staged approach: **A → B → C**.

## Implementation Plan

### Phase 1: Focused chat window route (largest win, lowest risk)

Files:
- `packages/ui/lib/openRouteWindow.ts`
- `packages/ui/components/AppPage.tsx`
- `packages/ui/common/Header/index.tsx`
- `packages/ui/components/ChatView/index.tsx` if layout props needed

Steps:
1. Add deterministic window label helper:
   ```ts
   chatWindowLabel(chatIdOrSessionKey: string): string
   ```
2. Add `openChatInFocusedWindow()` with ensure-or-focus behavior.
3. Add `openclawWindowMode=focused-chat` URL param.
4. In `AppPage`, if focused-chat mode:
   - skip full sidebar/editor groups boot
   - render `FocusedChatWindow`
5. `FocusedChatWindow` mounts `ChatView` directly with known `sessionKey`.
6. Update tab double-click / open-window actions to call `openChatInFocusedWindow()` instead of generic `openRouteInNewWindow()`.
7. Browser fallback uses named `window.open(url, label)` so duplicate chat window is reused.

Expected result:
- New chat window no longer mounts full app shell.
- No `/api/bootstrap` for focused chat window.
- Duplicate open focuses existing window.
- It may still call `/api/chat/bootstrap` and open its own patch stream.

### Phase 2: Focused window state endpoint

Files:
- `apps/middleware/src/features/chat/routes.ts`
- `apps/middleware/tests/app.test.ts` or new focused-window test
- `packages/ui/lib/chat-engine-v2/client.ts`
- `packages/ui/hooks/useChatMessages.ts` or focused shell hook

Add:

```http
GET /api/chat/window-state?sessionKey=...
```

This endpoint reads from middleware SQLite projection and returns:
- latest messages (same normalization as bootstrap)
- messageCount
- active run
- pending tools
- spawned subagents
- cursor
- status/statusLabel

Focused window uses this endpoint for initial state instead of full `/api/chat/bootstrap` if possible.

Expected result:
- Faster first paint in focused windows.
- Endpoint is tailored to window needs.
- Still supports fallback to `/api/chat/bootstrap`.

### Phase 3: Shared Tauri patch stream fanout

Files:
- `packages/desktop/src-tauri/src/backend.rs` or new Rust module
- `packages/ui/lib/chat-engine-v2/client.ts`
- `packages/ui/lib/chat-engine-v2/store.ts`
- `packages/ui/lib/ipc.ts`

Design:
1. Tauri backend opens one WebSocket to middleware `/api/stream/ws`.
2. It broadcasts patch events to all webviews using Tauri events.
3. UI store consumes Tauri events instead of opening per-window WebSockets.
4. Browser/dev fallback continues to use `openPatchStreamV2()`.

Expected result:
- One patch stream per desktop app process, not per window.
- Closest to Telegram’s shared session/controller model.

## Files to Change

### Phase 1
- `packages/ui/lib/openRouteWindow.ts`
  - deterministic labels
  - ensure-or-focus logic
  - focused-chat URL params
- `packages/ui/components/AppPage.tsx`
  - route-mode detection
  - render focused chat shell
  - skip full startup bootstrap for focused windows
- `packages/ui/common/Header/index.tsx`
  - call new focused window helper
- `packages/ui/components/ChatView/index.tsx`
  - maybe expose compact/focused layout props

### Phase 2
- `apps/middleware/src/features/chat/routes.ts`
  - add `/api/chat/window-state`
- `apps/middleware/tests/app.test.ts`
  - endpoint tests
- `packages/ui/lib/chat-engine-v2/client.ts`
  - add `fetchChatWindowStateV2()`
- `packages/ui/components/FocusedChatWindow.tsx` (new)

### Phase 3
- `packages/desktop/src-tauri/src/backend.rs`
- `packages/ui/lib/ipc.ts`
- `packages/ui/lib/chat-engine-v2/store.ts`

## Constraints Checked

- `docs/constraints/sessions.md`
  - per-window isolation must preserve `openclawWindowId`
  - layout cache must not bleed across windows
- `docs/constraints/chat-engine.md`
  - middleware projection remains source of truth
  - warm cache is preview only
  - message order by `openclaw_seq`
- `docs/constraints/middleware.md`
  - patch bus remains the real-time truth source
- `docs/constraints/api-routes.md`
  - adding `/api/chat/window-state` must be documented if implemented

## Risks

1. **Skipping full `AppPage` bootstrap may skip required global setup.**
   - Mitigation: focused shell still initializes middleware connection, query client, and chat engine.

2. **Duplicate window label collisions.**
   - Mitigation: label derived from stable sanitized sessionKey/chatId and mode.

3. **Existing window focus API differences across platforms.**
   - Mitigation: use Tauri `WebviewWindow.getByLabel()` + `show()` + `setFocus()`; browser fallback uses named `window.open()`.

4. **Focused window missing sidebar-derived metadata.**
   - Mitigation: pass title/sessionKey in URL or use `/api/chat/window-state`.

5. **Phase 3 shared patch stream may be complex.**
   - Mitigation: ship Phase 1 first; Phase 3 is optional optimization.

## Testing

### Unit tests
- `packages/ui/lib/openRouteWindow.test.ts`
  - deterministic labels
  - existing Tauri window is focused instead of creating new
  - browser fallback uses named window target
  - `openclawWindowId` preserved
  - `openclawWindowMode=focused-chat` emitted

- `packages/ui/lib/workspaceLayoutPersistence.test.ts`
  - focused-chat windows still get isolated layout scope

- Middleware tests if Phase 2:
  - `/api/chat/window-state` returns messages/tools/status for session
  - unknown session returns empty safe payload or 404 (choose contract)

### Manual test
1. Open chat A in main window.
2. Open chat A in new window.
   - Existing A window focuses if already open.
   - No duplicate A window.
3. Open chat B in new window.
   - New B window opens independently.
4. In network logs:
   - Focused window should not call `/api/bootstrap`.
   - Phase 1 may call `/api/chat/bootstrap` once.
   - Phase 3 should not open second `/api/stream/ws`.
5. Send message in main window.
   - Focused window receives activity/tool/status updates.
6. Send message in focused window.
   - Main window sees updates.
7. Close/reopen focused window.
   - Layout/session isolation preserved.

## Recommendation

Implement in phases.

**Phase 1 first:** focused chat window route + ensure-or-focus. This solves the biggest UX issue quickly and reduces unnecessary full-app API calls.

**Phase 2 next:** tailored `/api/chat/window-state` endpoint if Phase 1 still feels heavy.

**Phase 3 later:** shared Tauri patch stream. This is the most Telegram-like architecture, but it touches Rust/Tauri + UI store and should be a separate PR.
