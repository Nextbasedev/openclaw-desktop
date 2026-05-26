# Group 11 — Async Race Guards Plan

## Status

Planning branch: `fix/group-11-async-race-guards`
Base: latest `v3` as of 2026-05-25.

## Goal

Stop stale async responses from older tabs/sessions/requests overwriting the currently visible UI state.

This group is not about adding new features. It is about enforcing one invariant everywhere async UI data is loaded:

> Only the latest request for the current scope may update state.

A request scope is usually one of:
- `spaceId`
- `sessionKey`
- `projectId`
- `repoPath`
- selected file/path/hash
- selected config file path
- search query + session key

## Target Bugs

1. **`useSpaces` active workspace race**
   - `loadSpaces()` can apply startup bootstrap, then `loadSpacesFresh()` later applies server state.
   - `switchSpace()` optimistically sets active space, then a slower refresh from an earlier load can overwrite `activeSpaceId`.
   - `localSyncSubscribeBootstrap()` can also overwrite active space with stale bootstrap while a switch/update is in flight.

2. **Workspace capability stale overwrite**
   - `WorkspaceTab` loads capabilities with `fetchRemoteWorkspaceCapabilities(projectId)` independently from `loadRoot()`.
   - On session/project switch, an older capability response can set capabilities for the wrong workspace.
   - `loadRoot()` already has `loadRequestRef`, but capabilities does not share the same guard.

3. **Workspace delayed refresh after session switch**
   - `scheduleRefresh()` captures `workspaceRoot`/`loadRoot`; a delayed timer can fire after session/project changes.
   - It can reload the old root for a new visible session or update tree with stale scope.

4. **Git diff/commit stale response**
   - `CommitDetailView` and `ChangedFileDiffView` issue async git requests without request ids/abort guards.
   - Switching selected file/commit/repo can allow an older diff response to overwrite the current detail panel.

5. **ChatSearch stale result**
   - Debounced search calls middleware with `sessionKey` + query.
   - If session changes, search closes/opens, or query changes quickly, an older server/local fallback result can set matches and scroll/highlight the wrong message.

6. **ConfigTab stale file read**
   - Clicking config files quickly can allow a slower read from the previous file to overwrite `content`/`draft` for the new selected file.
   - Save should also be scoped to the selected file at save start.

## Files to Change

Primary:
- `packages/ui/hooks/useSpaces.ts`
- `packages/ui/components/inspector/WorkspaceTab.tsx`
- `packages/ui/components/inspector/GitTab.tsx`
- `packages/ui/components/ChatView/ChatSearch.tsx`
- `packages/ui/components/settings/tabs/ConfigTab.tsx`

Likely tests:
- `packages/ui/hooks/useSpaces.test.ts`
- Add focused tests if existing harness supports components/hooks; otherwise use typecheck plus targeted manual/browser checks.

## Implementation Plan

### 1. Add request-scope guard pattern

Use small local refs, not a broad framework rewrite:

- Incrementing request id refs:
  - `const requestRef = useRef(0)`
  - `const requestId = ++requestRef.current`
  - after `await`, only update state if `requestRef.current === requestId`
- Scope tokens where identity matters:
  - `${sessionKey ?? ""}:${projectId ?? ""}:${path ?? ""}`
  - check token before setting state or calling scroll/highlight callbacks
- Clear timers on scope changes.

### 2. `useSpaces` guard

- Add `spacesRequestRef` and `activeSpaceOverrideRef`/`mutationVersionRef`.
- Every `loadSpacesFresh()` gets a request id.
- Do not let older loads update `spaces` or `activeSpaceId` after a newer request/mutation.
- After `switchSpace(spaceId)`, keep `activeSpaceId=spaceId` authoritative unless the fresh response explicitly says otherwise for the latest request.
- Ignore bootstrap subscription active-space updates while a newer mutation/load is in flight, or only apply if no local active selection exists.

Acceptance:
- Rapid A → B space switching cannot bounce active space back to A when an older request resolves.

### 3. WorkspaceTab capability + delayed refresh guards

- Add a single `workspaceScopeKey = `${effectiveSessionKey ?? ""}:${projectId ?? ""}``.
- Increment `loadRequestRef` on scope changes as today, but also guard capabilities with a `capabilityRequestRef` or the same scope token.
- Before `setCapabilities`, verify scope still matches.
- Make `scheduleRefresh()` capture the scope key and root at scheduling time.
- When timer fires, verify current scope/root are still the same before `loadRoot()`.
- Clear pending refresh timer on `effectiveSessionKey`/`projectId` changes.

Acceptance:
- Switching chat/session while workspace refresh is queued cannot update tree/capabilities for the wrong chat.

### 4. Git diff/commit stale guards

- In `CommitDetailView`, guard async `middleware_git_commit_details` by `projectId/repoPath/hash` request token.
- In `ChangedFileDiffView`, guard async `middleware_git_diff(_for_repo)` by `projectId/repoPath/file.path` token.
- Reset detail state at the start of each latest request only.
- Ignore stale responses and stale errors.

Acceptance:
- Clicking file A then file B quickly cannot show A's diff under B's header.
- Opening commit A then commit B quickly cannot show A's commit details under B.

### 5. ChatSearch stale guards

- Track latest search token: `${sessionKey}:${query}` plus a sequence id.
- Clear debounce on unmount/open close/session change.
- Before setting `matches`, scrolling, highlighting, or `setSearching(false)`, verify token is still latest and `open` is still true.
- Include `onHighlightMessage` in hook deps where needed.
- Clear DOM highlight on session change/close.

Acceptance:
- Search results from previous session/query cannot scroll/highlight the current chat.

### 6. ConfigTab stale file read/write guards

- Add `loadRequestRef` and selected path token.
- `loadFile(file)` should only set content/draft/error/loading if it is still the latest request and `file.path` is still selected/current token.
- On save, capture `selected.path` and `draft` at save start; only update content/status if selected path is unchanged when save resolves.

Acceptance:
- Rapidly clicking config files cannot show `MEMORY.md` content while `TOOLS.md` is selected.
- Save completion for a previous file cannot mark current file as saved.

## Verification Plan

Required:
- `pnpm --filter ui typecheck`

Recommended focused checks:
- Rapidly switch spaces and ensure active space does not bounce.
- Rapidly switch chats with Workspace open and confirm capabilities/tree do not mismatch active session.
- In Git tab, click changed files/commits quickly and confirm detail content matches header.
- Search in chat A, switch to chat B before result returns; confirm no scroll/highlight in B from A.
- In Config tab, click multiple files quickly; final content must match final selected file.

## Patch Order

1. `ChatSearch` + `ConfigTab` first — smallest, self-contained race guards.
2. Git diff/commit guards.
3. Workspace capability and delayed refresh guards.
4. `useSpaces` guard last because it has the broadest app impact.
5. Typecheck and manual/runtime verification.
