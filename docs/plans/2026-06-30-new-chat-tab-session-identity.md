# Plan: New-chat tab ↔ sidebar selection identity

Branch: `master-fixes` · Owner: chat UX · Status: SPEC (await Krish sign-off before coding)

## 1. The problem (Krish's words, decoded)

After clicking `+` and sending the first message:

1. The session is created and renders in the header tab (name now updates — fixed earlier).
2. **The new session is NOT highlighted/selected in the sidebar.**
3. **Clicking that same session in the sidebar opens it AGAIN as a second tab** next to the one already open in the header — even though they are the **same session**.

Net: the header's open tab and the sidebar row are treated as two different things instead of one.

## 2. Identity model today (verified in code)

- Canonical id = `chat.id`. Everything keys off it:
  - Editor tab id = `chat:${chat.id}` (`editorGroups.ts`).
  - Sidebar highlight = `activeChat?.id === chat.id` (`ChatsSection/index.tsx:169`).
  - Tab dedup = by tab id in `ADD_TAB` (`editorGroups.ts`).
- Secondary id = `sessionKey` (gateway session). Currently NOT used for tab dedup or sidebar highlight.
- Server (`middleware_chats_create`, compat routes.ts:4936) **honors a client-provided `chatId`** (`id: String(input.chatId || id("chat"))`).

### Two creation paths (inconsistent)
- **A. `handleQuickSend`** (blank `+` composer → type → send): client pre-generates `chatId` + `sessionKey`, passes both to create. Tab/activeChat/route all use the client `chatId`. Names the tab from the message.
- **B. `ensureDraftSessionForModelSelect`** (model picked / prompt drafted BEFORE first message): create WITHOUT a client `chatId` → server generates its own. Chat literally named "New Chat" until first message autonames it.

## 3. Root-cause hypotheses (a duplicate tab REQUIRES sidebar `chat.id` ≠ open-tab `chat.id`)

- **H1 (most likely): the running middleware does not honor the client `chatId`.** The desktop *compat* route honors it, but if the active gateway/middleware build returns its own id in `result.chat.id`, then: optimistic tab/activeChat/route commit to the *client* id, the autoname block + sidebar use the *server* id → no highlight + duplicate on click. Quick-send has **no reconciliation** for `result.chat.id !== chatId`.
- **H2: space mismatch.** New chat's `spaceId` (write space) ≠ the sidebar's `activeSpaceId` filter → row shows under a different id/space or fails to highlight.
- **H3: sessionKey normalization.** Server returns a different/normalized `sessionKey`; the open tab keeps the client one. Doesn't alone cause a duplicate (same tab id) but breaks session-level dedup if we move identity to sessionKey.

→ One verification settles H1: capture, on a single repro, the client `chatId` vs `result.chat.id` (and the sidebar row id). That's the only runtime-invisible piece.

## 4. Desired behavior (the spec to lock)

1. **Single identity.** A chat has exactly ONE id from creation onward; the optimistic tab, `activeChat`, route, sidebar row, and autoname rename ALL use that same id. If the server ever returns a different id, the client reconciles every surface to the server id atomically.
2. **Sidebar selection.** Whenever a chat is the open/active session, its sidebar row is highlighted (`activeChat.id === row.id`), including immediately after first-message creation.
3. **No duplicate tabs.** Selecting a chat that is already open (from sidebar, route, deep link, anywhere) FOCUSES the existing tab. Dedup must hold even if ids momentarily differ — fall back to `sessionKey` match.
4. **Draft replacement (already shipped, keep).** The `+` draft tab is replaced by the session tab, never left beside it.

## 5. Implementation plan (after H1 confirmed)

- **P1 — id reconciliation in `handleQuickSend`.** After `middleware_chats_create`, if `result.chat.id !== chatId`: migrate tab id `chat:${chatId}` → `chat:${result.chat.id}`, update `activeChat.id`, `resolvedChatCacheRef` key, route, and the optimistic run registry key. One helper, used by both create paths.
- **P2 — sessionKey-based tab dedup (safety net).** In `editorGroupsReducer.ADD_TAB`, before adding a chat tab, if a tab in the target group already has the same `chat.sessionKey`, FOCUS/replace it instead of adding. Guarantees spec #3 even under transient id skew.
- **P3 — sidebar highlight hardening.** Highlight when `activeChat.id === row.id` OR `activeChat.sessionKey === row.sessionKey`, so a brief id skew doesn't drop the selection.
- **P4 — single canonical select path.** Route every "open this chat" through one function (the existing `handleChatSelect`) so create, sidebar-click, route-restore, and deep-link share identical dedup + selection logic (the "one common function" rule).
- **P5 — tests.** Reducer: same-sessionKey ADD_TAB focuses not duplicates; id-reconciliation migrates the tab in place. Selection: highlight by id and by sessionKey.

## 6. Open questions for Krish
- Q1: Does the bug repro on BOTH paths (plain `+`→type→send AND model-picked-first) or only one?
- Q2: OK to treat `sessionKey` as the dedup fallback (P2/P3), or keep `chat.id` strictly canonical?
- Q3: Confirm the `result.chat.id` vs client `chatId` values from one repro (the H1 check) — or I add a temporary `frontendLog` line to capture it.
