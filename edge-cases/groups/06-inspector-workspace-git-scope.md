# Group 06 — Inspector Workspace/Git Scope

## Connected issues

- Workspace can stay bound to old session.
- Workspace/Git direct chats share `global` key.
- Git repo selection leaks across windows via localStorage.
- Subagent open can set Activity selection while inspector remains on another tab.

## Files to touch first

- `packages/ui/components/inspector/InspectorView.tsx`
- `packages/ui/components/inspector/WorkspaceTab.tsx`
- `packages/ui/components/inspector/GitTab.tsx`
- `packages/ui/components/AppPage.tsx`
- `packages/ui/lib/workspaceLayoutPersistence.ts`

## Touch order

1. Add `inspector.session_mismatch` diagnostics.
2. Change Workspace/Git keys from `projectId ?? "global"` to a session-aware key for direct chats:
   - `projectId ? projectId : sessionKey ?? "global"`
3. In `WorkspaceTab`, reset `workspaceSessionKey` when prop `sessionKey` changes meaningfully.
4. Scope Git persisted selection by project/session/window instead of one global localStorage key.
5. In subagent open handler, switch inspector tab to Activity.
6. Add tests for direct chat A → direct chat B inspector state isolation.

## Expected invariant

Inspector state should never silently target a different chat/session than the active visible chat.
