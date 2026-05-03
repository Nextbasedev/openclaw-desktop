# Workspace How It Works Plan

## Why This File Exists

This document explains how the dashboard workspace works today in Ampere:

- where the UI lives
- which API methods it calls
- which backend endpoints are used
- how data moves from API to UI
- how to copy the same working pattern into another app

This is meant to be a reference file, not just a refactor note.

## Main Files

- Route page: `app/dashboard/workspace/page.tsx`
- Dashboard nav entry: `src/components/dashboard/DashboardLayout.tsx`
- API client: `src/lib/api.ts`

## Where Workspace Opens From

Workspace is opened from the dashboard sidebar.

- Nav item id: `workspace`
- Nav path: `/dashboard/workspace`
- Sidebar source: `src/components/dashboard/DashboardLayout.tsx`

So the user flow is:

1. User clicks `Workspace` in dashboard sidebar.
2. Next.js opens `/dashboard/workspace`.
3. `app/dashboard/workspace/page.tsx` mounts.
4. The page loads workspace data through `src/lib/api.ts`.

## Important Rule In This Project

Workspace page does not call `fetch` directly.

All backend communication goes through `src/lib/api.ts`.

That means the flow is always:

`UI page/component -> api client method -> backend endpoint -> response -> local page state -> rendered UI`

This is the same pattern you should reuse in another app.

## Exact API Methods Used By Workspace

These methods are already implemented in `src/lib/api.ts` and used by the workspace page:

- `listWorkspaceFilesAll()`
- `readWorkspaceFileAny(path)`
- `saveWorkspaceFile(path, content)`
- `deleteWorkspaceFile(path)`
- `getWorkspaceTemplates()`
- `moveWorkspaceFile(from, to)`
- `mkdirWorkspace(path)`
- `deleteWorkspaceDir(path, force)`
- `downloadWorkspaceFile(path)`
- `downloadWorkspaceDir(path)`

## Exact Backend Endpoints Behind Those Methods

These are the actual backend routes used by workspace:

- `GET /api/my/workspace/tree?all=true`
- `GET /api/my/workspace/files/{path}`
- `PUT /api/my/workspace/files/{path}`
- `DELETE /api/my/workspace/files/{path}`
- `GET /api/my/workspace/templates`
- `POST /api/my/workspace/move`
- `POST /api/my/workspace/mkdir`
- `DELETE /api/my/workspace/dir/{path}?force=true`
- `GET /api/my/workspace/download/{path}`
- `GET /api/my/workspace/download-dir/{path}`

## What Data Comes Back

### File tree response

`listWorkspaceFilesAll()` returns a flat list like:

```ts
[
  {
    path: "memory/notes.md",
    size: 1204,
    mtime: "2026-04-30T10:00:00Z",
    type: "file"
  },
  {
    path: "memory",
    size: 0,
    mtime: "2026-04-30T10:00:00Z",
    type: "dir"
  }
]
```

The page converts this flat list into a nested tree with `buildFileTree(files)`.

### File content response

`readWorkspaceFileAny(path)` returns:

```ts
{
  path: "SOUL.md",
  content: "...file content...",
  encoding: "utf8" | "base64",
  mimeType?: string
}
```

That is why the page can support:

- editable text files
- image preview
- binary-safe handling

## Current Workspace Runtime Flow

### 1. Page load

When `app/dashboard/workspace/page.tsx` mounts:

1. `loadFiles()` runs.
2. `loadFiles()` calls `api.listWorkspaceFilesAll()`.
3. Returned files are stored in `files` state.
4. If any path starts with `memory/`, the page auto-expands the `memory` folder.
5. If backend returns `404`, the page sets `instanceNotFound = true`.

In short:

`page mount -> listWorkspaceFilesAll() -> files state -> build tree -> render sidebar tree`

### 2. Tree rendering

The backend does not return nested folders directly for UI rendering.

Instead:

1. API returns a flat array of file metadata.
2. Frontend runs `buildFileTree(files)`.
3. Result becomes the folder/file tree shown in the left workspace panel.

This is important if you copy this to another app:

- keep backend response simple
- build UI tree in frontend

### 3. Selecting a file

When user clicks a file:

1. `selectedFile` is updated.
2. That file is added to `openFiles` tabs state if not already open.
3. A `useEffect` runs for `selectedFile`.
4. It calls `api.readWorkspaceFileAny(selectedFile)`.
5. Response is stored in `fileContent`.
6. If encoding is `utf8`, the page fills:
   - `editContent`
   - `originalContent`
7. If file is binary, editor content is cleared and the page avoids text editing flow.

In short:

`file click -> selectedFile -> readWorkspaceFileAny() -> fileContent/editContent -> editor or preview`

### 4. Editing and saving a file

The page tracks:

- `originalContent` = last saved/loaded content
- `editContent` = current editor content

Dirty state is:

`hasChanges = editContent !== originalContent`

When user saves:

1. `handleSave()` checks `selectedFile` and `hasChanges`.
2. It calls `api.saveWorkspaceFile(selectedFile, editContent)`.
3. On success, `originalContent` is updated.
4. Success toast is shown.
5. Analytics event is tracked.

Keyboard save is also supported:

- `Ctrl+S`
- `Cmd+S`

### 5. Creating a new file

When user creates a file:

1. UI builds final path from filename plus optional parent folder.
2. Page calls `api.getWorkspaceTemplates()`.
3. If filename matches a known template like `SOUL.md`, template content is used.
4. Page calls `api.saveWorkspaceFile(fileName, initialContent)`.
5. Page reloads tree with `loadFiles()`.
6. New file becomes selected and opened.

### 6. Initializing an empty workspace

If workspace is empty, the page can create default bootstrap files.

The current bootstrap list is:

- `SOUL.md`
- `USER.md`
- `IDENTITY.md`
- `MEMORY.md`
- `TOOLS.md`
- `HEARTBEAT.md`

Flow:

1. Call `api.getWorkspaceTemplates()`.
2. Loop over `BOOTSTRAP_FILES`.
3. Save each file using `api.saveWorkspaceFile(...)`.
4. Reload tree with `loadFiles()`.

### 7. Creating a folder

Flow:

1. User enters folder path.
2. Page calls `api.mkdirWorkspace(path)`.
3. Page reloads tree.
4. Parent folder and new folder are expanded.
5. Success toast is shown.

### 8. Renaming or moving

Flow:

1. User chooses rename.
2. Page calculates `from` and `to`.
3. Page calls `api.moveWorkspaceFile(from, to)`.
4. If renamed file is selected, `selectedFile` is updated.
5. `openFiles` tabs are updated to new path.
6. Page reloads tree.

Important point:

rename and move use the same backend endpoint.

### 9. Deleting

File delete:

1. Page opens confirm dialog.
2. On confirm it calls `api.deleteWorkspaceFile(path)`.
3. Selected file and tab state are cleaned up.
4. Page reloads tree.

Folder delete:

1. Page opens confirm dialog.
2. On confirm it calls `api.deleteWorkspaceDir(path, true)`.
3. Any selected or open file inside that folder is cleared.
4. Page reloads tree.

### 10. Downloading

For download, the API layer does a little more than a normal JSON request.

Flow:

1. API client gets auth token.
2. It calls download endpoint with auth header.
3. Browser receives blob.
4. API layer creates temporary blob URL.
5. API layer triggers anchor click to download.

That logic is already handled inside:

- `downloadWorkspaceFile(path)`
- `downloadWorkspaceDir(path)`

## Main Local State In The Page

The workspace page currently manages most behavior with local React state:

- `files`
- `selectedFile`
- `openFiles`
- `fileContent`
- `editContent`
- `originalContent`
- `isLoading`
- `isLoadingFile`
- `isSaving`
- `isDeleting`
- `isCreating`
- `expandedDirs`
- dialog state for create, rename, delete

This means the page is currently both:

- controller
- state manager
- renderer

## One Simple Mental Model

If you want to explain workspace in one line:

The workspace page is a frontend file manager that reads a flat file tree from `/api/my/workspace/*`, turns it into a nested UI tree, then uses dedicated API methods for read, save, create, rename, delete, and download actions.

## Copy This Same Pattern To Another App

If you want the same workspace feature in another app, reuse this structure:

### Layer 1. Route page

Create a page like:

- `app/dashboard/workspace/page.tsx`

Its job should be:

- load tree on mount
- hold selected file state
- render sidebar + tabs + editor
- call api methods only through client wrapper

### Layer 2. API client

Create a single API file like:

- `src/lib/api.ts`

Put all workspace methods there:

- list tree
- read file
- save file
- delete file
- create folder
- move file
- get templates
- download file
- download folder

Do not call backend directly from components.

### Layer 3. Backend contract

Your backend should expose the same kind of routes:

- tree list
- file read
- file save
- file delete
- templates
- move
- mkdir
- dir delete
- download

Keep response shape stable so UI stays simple.

### Layer 4. Frontend transformation

Let backend return a flat array:

```ts
{ path, size, mtime, type }
```

Then in frontend:

1. convert flat list to nested tree
2. render folders recursively
3. keep `selectedFile` and `openFiles`
4. load file content on selection

### Layer 5. Mutation pattern

For every action in any app, keep the same pattern:

1. set pending/loading state
2. call API method
3. update selected/open file state if needed
4. reload tree or patch local state
5. show toast
6. track analytics if needed

This is the core working process to apply elsewhere.

## Recommended Reusable Action Map

If you rebuild this in another app, use this exact mapping:

- page mount -> `listWorkspaceFilesAll()`
- file click -> `readWorkspaceFileAny(path)`
- save -> `saveWorkspaceFile(path, content)`
- create file -> `getWorkspaceTemplates()` then `saveWorkspaceFile(...)`
- initialize workspace -> `getWorkspaceTemplates()` then multiple `saveWorkspaceFile(...)`
- rename -> `moveWorkspaceFile(from, to)`
- create folder -> `mkdirWorkspace(path)`
- delete file -> `deleteWorkspaceFile(path)`
- delete folder -> `deleteWorkspaceDir(path, true)`
- download file -> `downloadWorkspaceFile(path)`
- download folder -> `downloadWorkspaceDir(path)`

## Things That Are Good In Current Ampere Design

- API access is centralized in `src/lib/api.ts`
- workspace supports text, image, and binary-aware file handling
- templates already exist for bootstrap files
- UI state is understandable even though large
- most actions already have toast feedback and analytics

## Current Weakness In Ampere Implementation

The main weakness is not the API design.

The main weakness is that `app/dashboard/workspace/page.tsx` is doing too much in one file:

- tree logic
- editor logic
- dialog logic
- action handlers
- layout logic
- preview logic

So if you build this in another app, keep the same API pattern but split the UI into smaller components and hooks earlier.

## Suggested Better Structure For Future Apps

If you want to implement the same workspace flow cleanly in another app, use this structure from the beginning:

- `page.tsx` for orchestration
- `WorkspaceFileTree.tsx`
- `WorkspaceTabs.tsx`
- `WorkspaceToolbar.tsx`
- `WorkspaceEditorPanel.tsx`
- `WorkspaceDialogs.tsx`
- `useWorkspaceFiles.ts`
- `useWorkspaceSelection.ts`
- `useWorkspaceEditor.ts`

That gives you the same behavior, but cleaner.

## Final Summary

Ampere workspace works by loading file metadata from `GET /api/my/workspace/tree?all=true`, rendering that data as a folder tree, then calling dedicated workspace API methods for file read, save, create, rename, delete, and download actions.

If you want the same working process in another app, copy the same architecture:

1. sidebar route to workspace page
2. page-level workspace state
3. one centralized API client
4. flat file-tree response from backend
5. frontend tree builder
6. one consistent mutation flow for every action

That is the main pattern to reuse.
