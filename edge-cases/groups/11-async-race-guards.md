# Group 11 — Async Race Guards

## Connected issues

- `useSpaces` active workspace race.
- Workspace capability stale overwrite.
- Workspace delayed refresh after session switch.
- Git diff/commit stale response.
- ChatSearch stale result.
- ConfigTab stale file read.

## Files to touch first

- `packages/ui/hooks/useSpaces.ts`
- `packages/ui/components/inspector/WorkspaceTab.tsx`
- `packages/ui/components/inspector/GitTab.tsx`
- `packages/ui/components/ChatView/ChatSearch.tsx`
- `packages/ui/components/settings/tabs/ConfigTab.tsx`

## Touch order

1. Add scoped request guards to `ChatSearch` and `ConfigTab`.
2. Add request guards to Git diff/commit detail views.
3. Guard Workspace capabilities and delayed refresh timers by current workspace scope.
4. Guard `useSpaces` fresh/bootstrap/mutation responses so old loads cannot overwrite active space.
5. Typecheck and run targeted rapid-switch manual checks.

## Expected invariant

Async responses may update UI state only if they still belong to the latest visible scope/request.

Older responses must be ignored, not allowed to overwrite the current chat, workspace, git repo, config file, active space, sidebar list, or route selection.

See:

- `docs/constraints/async-ui-state.md` for durable async UI state rules.
- `docs/plans/group-11-async-race-guards.md` for the detailed implementation plan.
