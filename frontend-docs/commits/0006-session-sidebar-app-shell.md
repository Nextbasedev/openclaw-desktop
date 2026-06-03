# 0006 — Session sidebar + app shell

**Branch:** `v5`
**Scope:** `components/chat/ui/{SessionList,ChatApp}.tsx`, `sync/apiClient.ts`
(+`listChats`/`createChat`/`ChatSummary`), `components/AppPage.tsx`, `app/chat-v5/page.tsx`,
`components/chat/index.ts`.
**Status:** complete — tests green, typecheck/build green.
**Depends on:** 0005 (timeline UI)

---

## 1. Summary / why

Feedback: the root page showed a single hardcoded `agent:main` timeline with **no way
to see or pick a session** — confusing and contextless. The v5 branch had deleted the
whole sidebar. This adds a **session list sidebar** (from the middleware's `/api/chats`)
+ an **app shell** so you can browse, select, and create chats, with the timeline on the
right for the selected session.

## 2. What was added

- `sync/apiClient.ts` — `ChatSummary` type + `listChats()` (`GET /api/chats`) and
  `createChat()` (`POST /api/chats`).
- `ui/SessionList.tsx` — left sidebar: fetches chats, polls every 5s, shows name +
  last message + sessionKey, highlights the active one, "+ New" creates a chat. Surfaces
  a friendly error if the middleware isn't connected.
- `ui/ChatApp.tsx` — shell: `SessionList` + `ChatScreen`. Selecting a session **remounts
  `ChatScreen` via `key={selected}`** so the sync client tears down/recreates cleanly per
  session (matches the single-session sync design). Reads `?session=` to preselect.
- `AppPage.tsx` (root `/`) and `app/chat-v5/page.tsx` now render `<ChatApp/>`.
- Exports `ChatApp`/`SessionList` from the module index.

## 3. Workarounds / gotchas

- **Standalone API client for the sidebar.** The per-session `ChatApiClient` lives inside
  `ChatSyncProvider`; the sidebar isn't tied to a session, so it constructs its own
  `ChatApiClient(createMiddlewareTransport())` at module scope. Same transport/auth, no
  duplication.
- **Remount-on-switch is intentional.** `key={selected}` forces a fresh provider/sync
  client per session rather than mutating a live one — simpler and avoids cross-session
  state bleed. (If switch latency becomes an issue we can pool, but correctness first.)
- **Polling, not live, for the chat list.** The list refreshes every 5s; the middleware
  already serves cached compat state. Live list updates can come later via the patch
  stream's `session.upsert` if needed.

## 4. What improved

- The page now has context: a real, selectable list of sessions with names + previews.
- New-chat flow works end to end (`createChat` → select → timeline).
- Both the root `/` and `/chat-v5` show the full shell.

## 5. What to test

Automated: `vitest` (engine unchanged, green), `typecheck` clean, **production build
green** (no env var needed).

Manual (against a running middleware):
1. Open `/` → sidebar lists your chats; click one → its history loads.
2. "+ New" → creates a chat and selects it.
3. Send a message in the selected chat; switch chats and back — state is correct, no
   bleed.
4. Sidebar shows last-message preview and highlights the active chat; updates within ~5s.

## 6. Follow-ups
- Spaces/projects/topics grouping (middleware has `/api/spaces`,`/api/projects`,`/api/topics`).
- Rename/archive/pin/delete chat actions (compat endpoints exist).
- Live list updates via `session.upsert` patches instead of polling.
- Scroll-anchor on older-load + animations (still the 3c follow-up).
