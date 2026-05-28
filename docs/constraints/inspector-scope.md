# Inspector Workspace/Git Scope Constraints

These constraints protect the Desktop inspector Workspace and Git tabs from scope leaks, accidental project mutations, and confusing first-run UX.

## Scope ownership

- Normal/direct chats default to Global Workspace.
- Normal/direct chats may explicitly override to a Chat Workspace.
- Project/topic chats use the active project scope; route/topic `projectId` wins over any stored direct-chat scope.
- Direct chat scope is stored per `sessionKey`, never as one global user-wide override.
- Workspace and Git use the same selected inspector scope, but keep separate roots:
  - `workspaceRoot` = folder shown/used by Workspace.
  - `repoRoot` = Git repository root used by Git.

## Workspace behavior

- Workspace is folder-first: any normal folder is a valid workspace selection, even when Git is not initialized.
- Selecting a folder inside a Git repo must preserve the exact selected folder as `workspaceRoot` and store the detected parent repo as `repoRoot`.
- Selecting a folder without Git must set `workspaceRoot` and leave `repoRoot` null/undefined.
- Git connection/change must never overwrite `workspaceRoot`.
- Explicit `projectId: null` / `workspaceBasePath(null)` means the real Global Workspace and must not fall back to localStorage or stale chat state.

## Picker UX

- The picker is an explicit-change UI, not a blocking first screen for normal chats.
- Exception: a true project/topic chat with missing project workspace may block and ask for a folder.
- Normal chats should “just work” with Global Workspace by default.
- Production picker UX stays simple:
  - single folder list
  - no project sidebar/list
  - no `PROJECT`, `GIT`, or `NO GIT YET` badges
  - neutral folder/source-control icons
  - lazy-load large folder trees
  - hide noisy folders by default: `node_modules`, `.git`, `.next`, `dist`, `build`, vendor caches

## Git tab behavior

- Git is optional metadata on top of Workspace.
- Git tab manages only `repoRoot`.
- Git tab must show “No Git repository connected” / connect state when there is no repo.
- Git actions:
  - Connect repository
  - Change repository
  - Disconnect repository
- Disconnecting Git clears only `repoRoot`; it must not clear or mutate `workspaceRoot`.

## State safety

- Workspace/Git must never silently target a different chat/session than the active visible chat.
- Direct chats must not share mounted component state/cache just because backend Global Workspace is shared.
- Clearing browser test state should remove stale keys matching `openclaw.inspectorScope.v1:*`.
