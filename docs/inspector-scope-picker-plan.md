# Inspector Scope Picker Plan

## Problem

Group 06 is about finishing Workspace/Git inspector isolation between chats and windows. Direct chats currently have no `projectId`, so the inspector silently falls back to shared/global state instead of asking the user which workspace/git scope this chat should use.

The desired product behavior is:

- If a chat already has a `projectId`, Workspace and Git open directly scoped to that project.
- If a chat has no `projectId`, Workspace and Git show an explicit scope picker:
  - **Use Global Workspace**
  - **Connect Existing Project**
- Selecting either option applies one shared inspector scope to the chat, so Workspace and Git stay in sync.
- `global` must mean the selected backend/global workspace scope for this chat, not shared UI/cache state across every direct chat.

Current problems found in code:

- `InspectorView` keys Workspace and Git by `projectId ?? "global"`, so unrelated direct chats reuse the same component/cache key (`packages/ui/components/inspector/InspectorView.tsx:173-184`).
- `WorkspaceTab` initializes from `globalWorkspaceSessionKeyCache ?? sessionKey`, so a previous chat can seed the next direct chat's effective workspace session (`packages/ui/components/inspector/WorkspaceTab.tsx:967-992`). It also auto-discovers an arbitrary fallback session when no session key exists (`WorkspaceTab.tsx:1006-1040`) instead of requiring an explicit scope choice.
- `WorkspaceTab` currently has mismatch diagnostics (`inspector.session_mismatch`) but only logs after state already diverged (`WorkspaceTab.tsx:996-1004`).
- Workspace async guards exist for tree/capabilities (`WorkspaceTab.tsx:1155-1181`) and refresh timers (`WorkspaceTab.tsx:1249-1278`), but the scope identity is still derived from potentially stale `effectiveSessionKey` + `projectId` rather than an explicit chat inspector scope.
- Workspace's repo picker update path only works when `projectId` already exists; direct chats cannot use it to connect a project scope (`WorkspaceTab.tsx:1410-1434`).
- Git has one persisted selection key, `openclaw.gitTab.selectedProject.v1`, plus a module cache, which can leak repo/project selection across chats and windows (`packages/ui/components/inspector/GitTab.tsx:15-59`).
- Git already shows a "No project selected" state with a project/repo picker for direct chats (`GitTab.tsx:298-321`), but this state is local to Git and does not establish a shared Workspace+Git inspector scope.
- `AppPage` passes only `activeTopic?.projectId` into Inspector, so direct chats always appear projectless even if the user has chosen an inspector scope for that chat (`packages/ui/components/AppPage.tsx:2755-2768`, `2776-2788`).
- Opening a subagent sets Activity selection but does not explicitly switch the user's persistent Inspector tab to Activity; `InspectorPanel` only derives `displayedTab` from `focusedToolCallId`, not `activeAgentId` (`AppPage.tsx:1021-1024`, `InspectorPanel.tsx:58-64`).

## Current Flow

### Project/topic chat

1. Active chat/topic has `activeTopic?.projectId`.
2. `AppPage` passes that as `projectId` to `InspectorPanel` and full-screen inspector.
3. `InspectorView` renders Workspace/Git with `key={projectId ?? "global"}`.
4. `WorkspaceTab` uses `sessionKey` and `projectId` to call workspace APIs.
5. `GitTab` uses `projectId` to call project Git APIs.

This is mostly correct, except component keys and persisted selections still need robust scoping.

### Direct chat with no project

1. `AppPage` passes `projectId={null}`.
2. `InspectorView` keys Workspace/Git as `"global"` for every direct chat.
3. `WorkspaceTab` uses `globalWorkspaceSessionKeyCache`, current `sessionKey`, or an arbitrary fallback session. The user does not explicitly choose global vs project.
4. `GitTab` reads global/session/local storage selection from `openclaw.gitTab.selectedProject.v1` and may show a repo from another chat/window.
5. Workspace and Git can disagree: Git may be connected to a repo/project while Workspace still targets a different session/global workspace.

## Proposed Fix

Introduce one explicit **inspector scope** per visible chat/session and make Workspace/Git consume it.

### Scope model

Add a shared UI type near inspector code, e.g. `packages/ui/components/inspector/inspectorScope.ts`:

```ts
export type InspectorScope =
  | { kind: "unset" }
  | { kind: "project"; projectId: string }
  | { kind: "global" }
```

Add helpers:

- `inspectorScopeStorageKey(sessionKey, windowId?)`
- `readInspectorScope(sessionKey)`
- `writeInspectorScope(sessionKey, scope)`
- `inspectorScopeKey({ sessionKey, projectId, scope, windowId })`

Rules:

- If `projectId` is passed from the active topic/project, effective scope is always `{ kind: "project", projectId }`.
- If no `projectId` and session has persisted scope, use it.
- If no `projectId` and no persisted scope, scope is `{ kind: "unset" }` and Workspace/Git show the picker.
- Persist direct-chat scope by `sessionKey`, not one global key.
- Local UI state/cache keys include at least `sessionKey`; include `windowId` where state is window-specific.

### UX

Create a small shared component, e.g. `InspectorScopePicker`, used by both Workspace and Git when scope is unset.

It should show:

- Title: "Choose workspace for this chat"
- Button: **Use Global Workspace**
- Button: **Connect Existing Project**
- Short text explaining that this choice applies to both Workspace and Git for the current chat.

Behavior:

- **Use Global Workspace** writes `{ kind: "global" }` for this `sessionKey`.
- **Connect Existing Project** opens the project/repo picker. After selection, write `{ kind: "project", projectId }` if a project is selected. If only a raw repo path is selected and no project id is available, either:
  - create/resolve a project first if existing APIs support it, or
  - keep Git repo-path mode as a follow-up and document the limitation.

Recommendation: use existing project selection if available; avoid inventing project creation in this PR.

### Data flow

1. `AppPage` owns `inspectorScopeBySession` state for the active session and passes `inspectorScope`, `onInspectorScopeChange` to `InspectorPanel` / full-screen inspector.
2. `InspectorPanel` passes it to `InspectorView`.
3. `InspectorView` passes it to `WorkspaceTab` and `GitTab`.
4. Workspace and Git render the picker when scope is unset and no `projectId` exists.
5. When one tab changes scope, both tabs update because the scope is owned above them.

### Keying/isolation

Change Workspace/Git keys from:

```tsx
key={projectId ?? "global"}
```

to a scope-aware key such as:

```tsx
key={inspectorScopeKey({ sessionKey, projectId, scope, windowId })}
```

This prevents direct chat A, direct chat B, and secondary windows from sharing mounted inspector state accidentally.

### Workspace behavior

- Remove/stop relying on module-level `globalWorkspaceSessionKeyCache` for cross-chat scope.
- If scope is unset, do not auto-select an arbitrary fallback session. Show `InspectorScopePicker`.
- If scope is global, use the current chat `sessionKey` as the workspace session key where possible; if backend global workspace requires a separate session, make that explicit in a helper and persist it per chat scope.
- If scope is project, call workspace APIs with `projectId` and the current session key.
- Reset tree, selected file, expanded folders, capabilities, and pending refresh timers when `inspectorScopeKey` changes.

### Git behavior

- Replace `openclaw.gitTab.selectedProject.v1` with scoped storage keys.
- Existing persisted data can be read as legacy fallback only for main/global scope, then migrated to the scoped key.
- `GitTabSelection` should be derived from shared inspector scope, not an independent global module cache.
- If Workspace chooses a project, Git should show that project immediately. If Git chooses a project, Workspace should show that project immediately.

### Subagent open behavior

When user opens a subagent:

- Open inspector if closed.
- Switch inspector tab to Activity explicitly.
- Set active agent selection.

This should be real tab state, not just a temporary `displayedTab` override, so the user sees the expected Activity panel.

## Files to Change

- `packages/ui/components/inspector/inspectorScope.ts` — new type + storage/key helpers.
- `packages/ui/components/inspector/InspectorScopePicker.tsx` — shared picker UI for unset direct-chat scope.
- `packages/ui/components/AppPage.tsx` — own active chat inspector scope; load/save per session; pass scope to panel/overlay; switch tab to Activity on subagent open.
- `packages/ui/components/inspector/InspectorPanel.tsx` — accept/pass `inspectorScope`, `onInspectorScopeChange`, and controlled tab change if needed.
- `packages/ui/components/inspector/InspectorView.tsx` — use scope-aware keys; pass scope into Workspace/Git; emit mismatch diagnostics.
- `packages/ui/components/inspector/WorkspaceTab.tsx` — remove global fallback behavior; show picker for unset scope; reset on scope changes; use explicit scope for API calls.
- `packages/ui/components/inspector/GitTab.tsx` — scope persisted selection; use shared scope; keep repo picker but have it update shared scope.
- `packages/ui/lib/workspaceLayoutPersistence.ts` — likely only read for `currentWorkspaceLayoutWindowId()` or export a small window-id helper if needed; do not change layout cache behavior unless necessary.
- Tests near inspector components/helpers — add focused helper tests at minimum; component tests if existing setup supports them.

## Risks

- **Global workspace semantics:** current Workspace uses session-based workspace APIs. If "global" backend scope is not a first-class API concept, the PR must define exactly which session/root global means. Avoid silently picking an arbitrary fallback session.
- **RepoPicker output:** current Git repo picker may return only `{ name, path }`, not an existing `projectId`. If so, project connection may need a separate existing-project picker or a follow-up.
- **Persisted selection migration:** changing Git storage keys can make old selections disappear. Acceptable if scoped fallback/migration is implemented.
- **Window scope:** Some state should be per chat, some per window. Git selected repo/project should be per chat scope; transient selected commit/file/sidebar UI should be per mounted component/window.
- **Async race regressions:** Workspace and Git already use request counters; new scope changes must invalidate in-flight tree/capability/git requests and delayed refresh timers.
- **Focused/full-screen inspector:** Full-screen inspector receives the same session/project/scope as side inspector; do not create a second independent scope store.

Constraints checked:

- `docs/constraints/async-ui-state.md`: responses must match current session/project/root; delayed workspace refreshes must no-op after scope changes.
- `docs/constraints/sessions.md`: per-window layout isolation must not regress; use window id only for UI state that should not cross windows.
- `docs/constraints/api-routes.md`: Workspace has global `/api/workspace/*` and project `/api/projects/:id/workspace/*`; Git has repo and project modes.
- `edge-cases/groups/06-inspector-workspace-git-scope.md`: expected invariant is that Inspector never silently targets a different chat/session than the active visible chat.

## Testing

Minimum checks:

- `pnpm --filter ui typecheck`
- Add/run tests for `inspectorScope` helpers:
  - project scope wins over stored direct-chat scope
  - direct chat with no stored scope returns unset
  - selecting global persists under the session key
  - selecting project persists under the session key
  - storage key differs between direct chat A and direct chat B
  - scoped Git selection does not read another chat's selection

Manual validation:

1. Open direct chat A → Workspace/Git show picker.
2. Choose **Use Global Workspace** → Workspace/Git both use global scope for chat A.
3. Open direct chat B → picker appears again; A's global selection does not leak.
4. In chat B, choose project X from Git → Workspace also shows project X.
5. Switch back to chat A → still global, not project X.
6. Open project/topic chat → Workspace/Git open project-scoped with no picker.
7. Open focused/full-screen inspector → same active chat scope, no cross-window repo leak.
8. Start a workspace load, rapidly switch chats → old tree/capability response does not overwrite new chat.
9. Open a subagent while inspector is on Git/Workspace → inspector switches to Activity and selects the subagent.
