# Inspector Scope Picker Handoff

Branch at time of handoff: `plan/inspector-scope-picker`  
Base branch: `v3`  
Last known head: `a22b323 Document folder picker design`

## Why this handoff exists

Dixit may switch branches and rebuild this UI/logic again. This doc captures what was already done, what should be reused, what should be redesigned, and the edge cases that must not be missed.

The important correction from the current branch is:

> Workspace is folder-first. Git is repo-first. Git is optional metadata on top of a workspace folder.

Do **not** rebuild the picker as Git-only. Users can create/connect a project from a normal folder before Git is initialized.

## Commits on this branch

- `c3c311b Plan inspector scope picker`
  - Created `docs/inspector-scope-picker-plan.md`.
- `e7c2d73 Implement inspector scope picker`
  - Added initial explicit per-chat inspector scope implementation.
- `ced8e80 Show detected folders in inspector scope picker`
  - Fixed mismatch where Git showed many repo folders but Workspace only showed existing projects.
  - Shared picker started showing detected repos/folders too.
- `a22b323 Document folder picker design`
  - Added the corrected folder-first UI design and edge-case list to the plan doc.

## Files changed / created

### Docs

- `docs/inspector-scope-picker-plan.md`
  - Main plan/design document.
  - Includes problem, current flow, proposed fix, folder picker UI, edge cases, files, risks, testing.

- `docs/inspector-scope-picker-handoff.md`
  - This handoff doc.

### New UI/helper files

- `packages/ui/components/inspector/inspectorScope.ts`
  - Defines:
    - `InspectorScope = unset | global | project`
    - storage helpers
    - effective scope helper
    - render key helper
  - Core rule: project route scope wins over stored direct-chat scope.

- `packages/ui/components/inspector/inspectorScope.test.ts`
  - Tests direct-chat scope isolation and storage.

- `packages/ui/components/inspector/InspectorScopePicker.tsx`
  - Current picker implementation.
  - Important: this is an interim implementation, not the final best UI.
  - It currently lists existing projects plus detected repos/folders from repo scanner.
  - It does **not yet** implement the full folder tree/browser design.

### Modified UI files

- `packages/ui/components/AppPage.tsx`
  - Owns `inspectorScope` state for the active chat/session.
  - Loads stored scope per direct-chat `sessionKey`.
  - Project/topic `projectId` overrides stored direct-chat scope.
  - Passes scope to side inspector and full-screen inspector.
  - Subagent open switches Inspector to Activity.

- `packages/ui/components/inspector/InspectorPanel.tsx`
  - Accepts `inspectorScope`, `onInspectorScopeChange`.
  - Accepts controlled active tab props.

- `packages/ui/components/inspector/InspectorView.tsx`
  - Passes scope to Workspace/Git.
  - Uses scope-aware keys instead of `projectId ?? "global"`.
  - Resets Git selection when scope key changes.

- `packages/ui/components/inspector/WorkspaceTab.tsx`
  - Uses explicit inspector scope instead of module-level global fallback.
  - Shows `InspectorScopePicker` when direct chat has unset scope.
  - Uses effective project id from scope when scope is project.
  - Removes prior arbitrary fallback session behavior.

- `packages/ui/components/inspector/GitTab.tsx`
  - Uses same inspector scope.
  - Shows picker when direct chat has unset scope.
  - Scopes Git persisted selection by scope key instead of one global storage key.

- `packages/ui/components/inspector/workspace-api.ts`
  - Important bug fix: `workspaceBasePath(null)` now means real global workspace, not fallback to `localStorage.openclaw.activeProjectId`.
  - `workspaceBasePath(undefined)` keeps legacy active-project fallback.

## Current design decision

### Scope model

Every visible chat/session should have one inspector scope:

```ts
type InspectorScope =
  | { kind: "unset" }
  | { kind: "global" }
  | { kind: "project"; projectId: string }
```

Rules:

- Topic/project chat: effective scope is always `project:<projectId>`.
- Direct chat with stored scope: use stored scope.
- Direct chat without stored scope: show picker.
- `global` is an explicit user choice, not a silent fallback.
- Workspace and Git must read the same scope.

## Correct final UX direction

The final picker should be split by mode:

### Workspace picker — folder-first

Purpose: choose a folder for Workspace. Git is optional.

Should show:

- Global Workspace option.
- Existing projects.
- Folder browser under configured workspace root.
- Recent folders/repos as shortcuts.
- Search by folder/project name and path.
- Lazy-loaded folders.
- Subfolder selection.

Badges:

- `Project` for existing project roots.
- `Git` when folder contains/is inside a Git repo.
- `No Git yet` for normal folders.

Selecting a folder:

- If folder already belongs to an existing project, connect that project.
- Else create/connect a project scope:
  - `workspaceRoot = selectedFolder`
  - `repoRoot = gitRoot` if Git exists
  - `repoRoot = null` if no Git

### Git picker — repo-first

Purpose: choose Git repo metadata for the same chat scope.

Should show:

- Git repos first.
- Folders with `No Git yet` second.
- If the active Workspace folder has no Git, show:
  - `No repository connected`
  - actions: `Initialize Git`, `Choose repository`

## Recommended final layout

```text
┌────────────────────────────────────────────────────────────┐
│ Choose workspace for this chat                         ×   │
│ This controls Workspace and Git for this chat.             │
├────────────────────────────────────────────────────────────┤
│ [Search folders/projects…                              ]   │
├──────────────────────────────┬─────────────────────────────┤
│ Sources                      │ Folder browser              │
│                              │                             │
│ ○ Global Workspace           │ /root/.openclaw/workspace   │
│ ○ Existing Projects          │ ├─ ampere-sh            Git │
│ ○ Recent Folders             │ ├─ marketplace_frontend Git │
│ ○ Browse Workspace Root      │ ├─ experiments       No Git │
│                              │ │  ├─ landing-pages No Git  │
│                              │ │  └─ prompts       No Git  │
│                              │ └─ openclaw-desktop    Git  │
├──────────────────────────────┴─────────────────────────────┤
│ Selected: /root/.openclaw/workspace/experiments/prompts     │
│ Status: No Git yet · Workspace will work, Git can be added  │
│                              [Cancel] [Use this folder]     │
└────────────────────────────────────────────────────────────┘
```

## Edge cases that must be handled

- Folder has no `.git`: valid Workspace folder; Git tab should say no repo connected.
- User selects subfolder inside a Git repo: Workspace root = subfolder, Git root = parent repo root.
- Existing project already uses selected folder: connect existing project, do not create duplicate.
- Huge folder tree: lazy-load children, no full recursive scan on open.
- Hidden/noisy folders: hide `node_modules`, `.git`, `.next`, `dist`, `build`, caches by default; add toggle to show hidden/ignored.
- Permission denied: disabled row with reason; picker must not crash.
- Symlinks: mark and resolve safely server-side; prevent path escapes.
- Folder deleted while picker is open: revalidate on confirm, show error.
- Folder outside allowed root: block unless backend explicitly marks it selectable.
- Long paths: truncate middle, keep folder name visible, full path in tooltip/title.
- Windows paths: support drive letters/backslashes.
- Double click / concurrent create: disable confirm while creating/updating project.
- Chat switch while picker is open: close/reset picker; stale selected folder must not apply to new chat.
- Side inspector and full-screen inspector: share chat scope, but do not leak transient expanded-tree UI across windows.

## Current implementation limitations / things to redo

The current `InspectorScopePicker.tsx` is **not final**.

Current limitation:

- It still uses repo scanner (`middleware_repos_scan` / `middleware_repos_recent`) as folder source.
- That finds Git repos well, but may miss plain folders that are not Git repos.
- It does not yet have a true folder tree browser.
- It creates a project when selecting a detected repo/folder, but the final version should allow selecting any browsable subfolder.

Recommended next implementation step:

1. Add backend folder browser/scan support if existing workspace tree endpoint is not enough:
   - global folder tree under configured workspace root
   - list folders only
   - optional metadata: `hasGit`, `gitRoot`, `isProjectRoot`, `projectId`, `isSymlink`, `disabledReason`
2. Replace current `InspectorScopePicker` content with a proper folder picker component.
3. Keep `InspectorScope` model and App/Inspector wiring from current branch.
4. Keep `workspace-api.ts` null-vs-undefined fix.
5. Keep scoped Git storage logic.

## Backend/API notes

Existing useful endpoints/commands:

- `middleware_repos_scan` / `/api/repos/scan`
  - Finds Git repos. Not enough for plain folders.
- `/api/workspace/tree`
  - Lists global workspace tree, but current UI uses it for Workspace tab file browser.
  - May be reused for folder picker if it can list folders lazily and safely.
- `/api/projects`
  - `middleware_projects_create` creates projects.
  - Project can store `workspaceRoot` and `repoRoot`.

Potential new endpoint/command:

- `middleware_folders_tree` or `/api/folders/tree`
  - Input: `{ root?: string, path?: string, includeHidden?: boolean }`
  - Output: `{ root, entries: [{ name, path, type: "directory", hasGit, gitRoot, projectId, disabledReason }] }`

## Validation already run on current implementation

Passed on branch `plan/inspector-scope-picker`:

- `pnpm --filter ui exec vitest run components/inspector/inspectorScope.test.ts components/inspector/GitTab.test.ts components/inspector/WorkspaceTab.test.ts`
- `pnpm --filter ui typecheck`
- `pnpm --filter ui build`

Known build warnings are existing Next export/root warnings:

- rewrites/redirects/headers not applied with static export
- workspace root inferred from `/root/package-lock.json`

## If recreating from another branch

Recommended cherry-pick order:

1. `c3c311b` — plan doc only
2. `e7c2d73` — scope model/wiring implementation
3. `ced8e80` — interim detected folders in picker
4. `a22b323` — final folder picker design doc

But if you are rebuilding cleanly, do not blindly keep the interim picker UI from `ced8e80`; use the folder-browser design from `a22b323` / this handoff instead.

Minimum files worth copying forward:

- `packages/ui/components/inspector/inspectorScope.ts`
- `packages/ui/components/inspector/inspectorScope.test.ts`
- App/Inspector scope wiring from:
  - `AppPage.tsx`
  - `InspectorPanel.tsx`
  - `InspectorView.tsx`
- `workspace-api.ts` null/undefined fix
- Git scoped persistence changes from `GitTab.tsx`

Files likely worth redesigning rather than copying exactly:

- `InspectorScopePicker.tsx`
  - Replace with final folder-browser picker.

## Open question

Should selecting a plain folder automatically create a full Project visible in the sidebar, or should it create a lighter-weight per-chat workspace scope first?

Current implementation creates a Project because existing Workspace/Git APIs already understand project scope. This is practical, but product-wise a lightweight per-chat folder scope may be cleaner later.
