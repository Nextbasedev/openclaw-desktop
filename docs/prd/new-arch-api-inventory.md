# New Architecture API Inventory

Source audit for `new-arch` based on:

- `packages/server/src/dispatch/registry.ts`
- `packages/ui` grep for `middleware_*` usage, excluding `node_modules`, `.next`, `dist`, and `build`
- Architecture target in `docs/prd/new-architecture-middleware-service.md`

## Decision legend

- `move-to-middleware`: implement as a first-class HTTP/SSE/WebSocket API in the external Node.js Middleware Service; Desktop becomes a thin client.
- `desktop-only`: keep in Desktop/Tauri/local UI layer because it stores local connection settings or opens OS/browser surfaces.
- `legacy-compat`: keep as an adapter while UI call sites migrate; do not treat the current command name/shape as the future contract.
- `delete-later`: remove after migration because it is unsafe, dev-only, duplicated, or tied to the old local Gateway setup flow.

## Summary

- Registry commands: 193
- `move-to-middleware`: 143
- `desktop-only`: 2
- `legacy-compat`: 19
- `delete-later`: 29
- UI-referenced registry commands: 91
- Registry commands with no current UI reference: 102
- UI `middleware_*` names not present in registry: 2

## Domain counts

- Runtime: 6
- Profiles: 7
- Environment: 3
- Projects: 8
- Topics: 8
- Sessions: 4
- Branches: 7
- Files (project-scoped): 8
- Filesystem (raw, absolute paths): 9
- Git: 9
- Memory: 7
- Skills: 16
- Standalone Chats: 9
- Auto-naming: 2
- Recent feed: 1
- Chat (Gateway-dependent): 12
- Cron (Gateway-dependent): 14
- Sync: 7
- Usage (Gateway-dependent): 2
- Onboarding: 22
- Connect: 6
- Terminal: 5
- PTY (ephemeral): 4
- Models (Gateway-dependent): 3
- Repos: 4
- Workspace (remote, gateway-backed): 3
- Version: 1
- Sandbox: 1
- Pinned Messages: 3
- Feedback: 2

## Recommended API shape by domain

- Runtime/version: `GET /health`, `GET /api/runtime`, `GET /api/version`.
- Projects/topics/chats/sessions/branches/pins/feedback: REST resources owned by Middleware SQLite and synced where needed.
- Git/repos/files/workspace/terminal/pty: remote-host APIs executed by Middleware on the machine that owns the repos and OpenClaw workspace.
- Chat/cron/usage/models/skills/memory: Gateway-backed APIs proxied/normalized by Middleware; streams use SSE/WebSocket endpoints rather than generic IPC.
- Connect/onboarding: Desktop stores Middleware URL/token and calls Middleware health/onboarding APIs. Old Gateway-local setup commands are temporary or removable.
- Raw filesystem: do not carry forward as a frontend-facing absolute-path API; use scoped project/repo/workspace routes.

## Full registry inventory

### Runtime

| Command | Decision | Handler | Input shape from registry | Proposed new endpoint | UI usage | Notes |
|---|---|---|---|---|---:|---|
| `middleware_runtime_info` | `move-to-middleware` | `runtime.runtimeInfo` | `{}` | `/health or /api/runtime/*` | 0 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_openclaw_bot_name` | `legacy-compat` | `runtime.botName` | `{}` | `/health or /api/runtime/*` | 0 | Keep temporary adapter during UI migration; collapse/rename once new HTTP contract is adopted. |
| `middleware_openclaw_bot_name_get` | `move-to-middleware` | `runtime.botNameGet` | `{}` | `/health or /api/runtime/*` | 1 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_openclaw_bot_name_set` | `move-to-middleware` | `runtime.botNameSet` | `{ botName: string }` | `/health or /api/runtime/*` | 1 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_request_admin_access` | `legacy-compat` | `runtime.requestAdminAccess` | `{ actionId: string; actionLabel?: string }` | `/health or /api/runtime/*` | 0 | Keep temporary adapter during UI migration; collapse/rename once new HTTP contract is adopted. |
| `middleware_approve_admin_access` | `legacy-compat` | `runtime.approveAdminAccess` | `{ actionId: string }` | `/health or /api/runtime/*` | 0 | Keep temporary adapter during UI migration; collapse/rename once new HTTP contract is adopted. |

### Profiles

| Command | Decision | Handler | Input shape from registry | Proposed new endpoint | UI usage | Notes |
|---|---|---|---|---|---:|---|
| `middleware_profiles_list` | `legacy-compat` | `profiles.profilesList` | `{}` | `/api/profiles/* if multi-profile survives` | 4 | Keep temporary adapter during UI migration; collapse/rename once new HTTP contract is adopted. |
| `middleware_profiles_create` | `legacy-compat` | `profiles.profilesCreate` | `Parameters<typeof profiles.profilesCreate>[0]` | `/api/profiles/* if multi-profile survives` | 0 | Keep temporary adapter during UI migration; collapse/rename once new HTTP contract is adopted. |
| `middleware_profiles_update` | `legacy-compat` | `profiles.profilesUpdate` | `Parameters<typeof profiles.profilesUpdate>[0]` | `/api/profiles/* if multi-profile survives` | 0 | Keep temporary adapter during UI migration; collapse/rename once new HTTP contract is adopted. |
| `middleware_profiles_delete` | `legacy-compat` | `profiles.profilesDelete` | `{ profileId: string }` | `/api/profiles/* if multi-profile survives` | 0 | Keep temporary adapter during UI migration; collapse/rename once new HTTP contract is adopted. |
| `middleware_profile_token_set` | `delete-later` | `profiles.profileTokenSet` | `{ profileId: string; token: string }` | `/api/profiles/* if multi-profile survives` | 0 | Raw token get/set/delete should not remain frontend-facing; secrets belong in secure Desktop storage or Middleware config. |
| `middleware_profile_token_get` | `delete-later` | `profiles.profileTokenGet` | `{ profileId: string }` | `/api/profiles/* if multi-profile survives` | 0 | Raw token get/set/delete should not remain frontend-facing; secrets belong in secure Desktop storage or Middleware config. |
| `middleware_profile_token_delete` | `delete-later` | `profiles.profileTokenDelete` | `{ profileId: string }` | `/api/profiles/* if multi-profile survives` | 0 | Raw token get/set/delete should not remain frontend-facing; secrets belong in secure Desktop storage or Middleware config. |

### Environment

| Command | Decision | Handler | Input shape from registry | Proposed new endpoint | UI usage | Notes |
|---|---|---|---|---|---:|---|
| `middleware_environment_connect` | `legacy-compat` | `profiles.environmentConnect` | `{ profileId: string }` | `/api/profiles/* if multi-profile survives` | 0 | Keep temporary adapter during UI migration; collapse/rename once new HTTP contract is adopted. |
| `middleware_environment_status` | `legacy-compat` | `profiles.environmentStatus` | `{ profileId: string }` | `/api/profiles/* if multi-profile survives` | 0 | Keep temporary adapter during UI migration; collapse/rename once new HTTP contract is adopted. |
| `middleware_environment_detect` | `legacy-compat` | `profiles.environmentDetect` | `{ profileId: string }` | `/api/profiles/* if multi-profile survives` | 0 | Keep temporary adapter during UI migration; collapse/rename once new HTTP contract is adopted. |

### Projects

| Command | Decision | Handler | Input shape from registry | Proposed new endpoint | UI usage | Notes |
|---|---|---|---|---|---:|---|
| `middleware_projects_list` | `move-to-middleware` | `projects.projectsList` | `{}` | `/api/projects, /api/projects/:projectId` | 8 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_projects_create` | `move-to-middleware` | `projects.projectsCreate` | `Parameters<typeof projects.projectsCreate>[0]` | `/api/projects, /api/projects/:projectId` | 3 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_projects_get` | `move-to-middleware` | `projects.projectsGet` | `{ projectId: string }` | `/api/projects, /api/projects/:projectId` | 0 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_projects_update` | `move-to-middleware` | `projects.projectsUpdate` | `Parameters<typeof projects.projectsUpdate>[0]` | `/api/projects, /api/projects/:projectId` | 2 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_projects_archive` | `move-to-middleware` | `projects.projectsArchive` | `{ projectId: string; archived?: boolean }` | `/api/projects, /api/projects/:projectId` | 2 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_projects_pin` | `move-to-middleware` | `projects.projectsPin` | `{ projectId: string; pinned?: boolean }` | `/api/projects, /api/projects/:projectId` | 0 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_projects_delete` | `move-to-middleware` | `projects.projectsDelete` | `{ projectId: string }` | `/api/projects, /api/projects/:projectId` | 1 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_projects_sidebar` | `move-to-middleware` | `projects.projectsSidebar` | `{ projectId: string }` | `/api/projects, /api/projects/:projectId` | 0 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |

### Topics

| Command | Decision | Handler | Input shape from registry | Proposed new endpoint | UI usage | Notes |
|---|---|---|---|---|---:|---|
| `middleware_topics_list` | `move-to-middleware` | `topics.topicsList` | `{ projectId: string }` | `/api/projects/:projectId/topics or /api/topics/:topicId` | 5 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_topics_create` | `move-to-middleware` | `topics.topicsCreate` | `{ projectId: string; name: string }` | `/api/projects/:projectId/topics or /api/topics/:topicId` | 3 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_topics_update` | `move-to-middleware` | `topics.topicsUpdate` | `Parameters<typeof topics.topicsUpdate>[0]` | `/api/projects/:projectId/topics or /api/topics/:topicId` | 1 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_topics_archive` | `move-to-middleware` | `topics.topicsArchive` | `{ topicId: string; archived?: boolean }` | `/api/projects/:projectId/topics or /api/topics/:topicId` | 2 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_topics_delete` | `move-to-middleware` | `topics.topicsDelete` | `{ topicId: string }` | `/api/projects/:projectId/topics or /api/topics/:topicId` | 1 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_topics_attach_session` | `move-to-middleware` | `topics.topicsAttachSession` | `{ topicId: string; sessionKey: string }` | `/api/projects/:projectId/topics or /api/topics/:topicId` | 0 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_topics_rename` | `move-to-middleware` | `topics.topicsRename` | `{ topicId: string; name: string }` | `/api/projects/:projectId/topics or /api/topics/:topicId` | 0 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_topics_detach_session` | `move-to-middleware` | `topics.topicsDetachSession` | `{ topicId: string; sessionKey: string }` | `/api/projects/:projectId/topics or /api/topics/:topicId` | 0 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |

### Sessions

| Command | Decision | Handler | Input shape from registry | Proposed new endpoint | UI usage | Notes |
|---|---|---|---|---|---:|---|
| `middleware_sessions_list` | `move-to-middleware` | `sessions.sessionsList` | `Parameters<typeof sessions.sessionsList>[0]` | `/api/sessions or /api/projects/:projectId/sessions` | 6 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_sessions_create` | `move-to-middleware` | `sessions.sessionsCreate` | `Parameters<typeof sessions.sessionsCreate>[0]` | `/api/sessions or /api/projects/:projectId/sessions` | 5 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_sessions_update` | `move-to-middleware` | `sessions.sessionsUpdate` | `Parameters<typeof sessions.sessionsUpdate>[0]` | `/api/sessions or /api/projects/:projectId/sessions` | 0 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_sessions_delete` | `move-to-middleware` | `sessions.sessionsDelete` | `{ sessionKey: string }` | `/api/sessions or /api/projects/:projectId/sessions` | 0 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |

### Branches

| Command | Decision | Handler | Input shape from registry | Proposed new endpoint | UI usage | Notes |
|---|---|---|---|---|---:|---|
| `middleware_branch_create` | `move-to-middleware` | `branches.branchCreate` | `Parameters<typeof branches.branchCreate>[0]` | `/api/chat/branches/*` | 0 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_branch_list` | `move-to-middleware` | `branches.branchList` | `{ sourceSessionKey: string }` | `/api/chat/branches/*` | 2 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_branch_get` | `move-to-middleware` | `branches.branchGet` | `{ branchSessionKey: string }` | `/api/chat/branches/*` | 0 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_branch_delete` | `move-to-middleware` | `branches.branchDelete` | `{ branchSessionKey: string }` | `/api/chat/branches/*` | 0 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_branch_from_regenerate` | `move-to-middleware` | `branches.branchFromRegenerate` | `Parameters<typeof branches.branchFromRegenerate>[0]` | `/api/chat/branches/*` | 0 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_branch_from_edit` | `move-to-middleware` | `branches.branchFromEdit` | `Parameters<typeof branches.branchFromEdit>[0]` | `/api/chat/branches/*` | 0 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_branch_create_thread` | `move-to-middleware` | `branches.branchCreateThread` | `Parameters<typeof branches.branchCreateThread>[0]` | `/api/chat/branches/*` | 0 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |

### Files (project-scoped)

| Command | Decision | Handler | Input shape from registry | Proposed new endpoint | UI usage | Notes |
|---|---|---|---|---|---:|---|
| `middleware_files_tree` | `move-to-middleware` | `files.filesTree` | `{ projectId: string; path: string }` | `/api/projects/:projectId/files/*` | 0 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_files_read` | `move-to-middleware` | `files.filesRead` | `{ projectId: string; path: string }` | `/api/projects/:projectId/files/*` | 0 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_files_prepare_attachment` | `move-to-middleware` | `files.filesPrepareAttachment` | `{ projectId: string; path: string }` | `/api/projects/:projectId/files/*` | 0 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_files_write` | `move-to-middleware` | `files.filesWrite` | `{ projectId: string; path: string; content: string }` | `/api/projects/:projectId/files/*` | 0 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_files_mkdir` | `move-to-middleware` | `files.filesMkdir` | `{ projectId: string; path: string }` | `/api/projects/:projectId/files/*` | 0 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_files_rename` | `move-to-middleware` | `files.filesRename` | `{ projectId: string; from: string; to: string }` | `/api/projects/:projectId/files/*` | 0 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_files_delete` | `move-to-middleware` | `files.filesDelete` | `{ projectId: string; path: string }` | `/api/projects/:projectId/files/*` | 0 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_files_search` | `move-to-middleware` | `files.filesSearch` | `{ projectId: string; query: string }` | `/api/projects/:projectId/files/*` | 0 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |

### Filesystem (raw, absolute paths)

| Command | Decision | Handler | Input shape from registry | Proposed new endpoint | UI usage | Notes |
|---|---|---|---|---|---:|---|
| `middleware_fs_read_dir` | `delete-later` | `fsRaw.fsReadDir` | `{ path: string }` | `none; replace with scoped repo/project selectors` | 1 | Absolute host filesystem API is unsafe/confusing for remote-first architecture; replace with scoped project/repo/workspace APIs. |
| `middleware_fs_read_file` | `delete-later` | `fsRaw.fsReadFile` | `{ path: string }` | `none; replace with scoped repo/project selectors` | 0 | Absolute host filesystem API is unsafe/confusing for remote-first architecture; replace with scoped project/repo/workspace APIs. |
| `middleware_fs_prepare_attachment` | `delete-later` | `fsRaw.fsPrepareAttachment` | `{ path: string }` | `none; replace with scoped repo/project selectors` | 0 | Absolute host filesystem API is unsafe/confusing for remote-first architecture; replace with scoped project/repo/workspace APIs. |
| `middleware_fs_write_file` | `delete-later` | `fsRaw.fsWriteFile` | `{ path: string; content: string }` | `none; replace with scoped repo/project selectors` | 0 | Absolute host filesystem API is unsafe/confusing for remote-first architecture; replace with scoped project/repo/workspace APIs. |
| `middleware_fs_create_dir` | `delete-later` | `fsRaw.fsCreateDir` | `{ path: string; recursive?: boolean }` | `none; replace with scoped repo/project selectors` | 0 | Absolute host filesystem API is unsafe/confusing for remote-first architecture; replace with scoped project/repo/workspace APIs. |
| `middleware_fs_remove` | `delete-later` | `fsRaw.fsRemove` | `{ path: string; recursive?: boolean }` | `none; replace with scoped repo/project selectors` | 0 | Absolute host filesystem API is unsafe/confusing for remote-first architecture; replace with scoped project/repo/workspace APIs. |
| `middleware_fs_rename` | `delete-later` | `fsRaw.fsRename` | `{ oldPath: string; newPath: string }` | `none; replace with scoped repo/project selectors` | 0 | Absolute host filesystem API is unsafe/confusing for remote-first architecture; replace with scoped project/repo/workspace APIs. |
| `middleware_fs_metadata` | `delete-later` | `fsRaw.fsMetadata` | `{ path: string }` | `none; replace with scoped repo/project selectors` | 0 | Absolute host filesystem API is unsafe/confusing for remote-first architecture; replace with scoped project/repo/workspace APIs. |
| `middleware_fs_search` | `delete-later` | `fsRaw.fsSearch` | `{ path: string; query: string; maxResults?: number }` | `none; replace with scoped repo/project selectors` | 0 | Absolute host filesystem API is unsafe/confusing for remote-first architecture; replace with scoped project/repo/workspace APIs. |

### Git

| Command | Decision | Handler | Input shape from registry | Proposed new endpoint | UI usage | Notes |
|---|---|---|---|---|---:|---|
| `middleware_git_remote_add` | `move-to-middleware` | `git.gitRemoteAdd` | `Parameters<typeof git.gitRemoteAdd>[0]` | `/api/projects/:projectId/git/*` | 0 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_git_remote_list` | `move-to-middleware` | `git.gitRemoteList` | `{ projectId: string }` | `/api/projects/:projectId/git/*` | 0 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_git_remote_remove` | `move-to-middleware` | `git.gitRemoteRemove` | `Parameters<typeof git.gitRemoteRemove>[0]` | `/api/projects/:projectId/git/*` | 0 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_git_status` | `move-to-middleware` | `git.gitStatus` | `{ projectId: string }` | `/api/projects/:projectId/git/*` | 1 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_git_diff` | `move-to-middleware` | `git.gitDiff` | `{ projectId: string; path: string }` | `/api/projects/:projectId/git/*` | 1 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_git_context` | `move-to-middleware` | `git.gitContext` | `{ projectId?: string; topicId?: string }` | `/api/projects/:projectId/git/*` | 0 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_git_switch_branch` | `move-to-middleware` | `git.gitSwitchBranch` | `Parameters<typeof git.gitSwitchBranch>[0]` | `/api/projects/:projectId/git/*` | 1 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_git_branches` | `move-to-middleware` | `git.gitBranches` | `{ projectId: string }` | `/api/projects/:projectId/git/*` | 1 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_git_commit_details` | `move-to-middleware` | `git.gitCommitDetails` | `{ projectId: string; hash: string }` | `/api/projects/:projectId/git/*` | 1 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |

### Memory

| Command | Decision | Handler | Input shape from registry | Proposed new endpoint | UI usage | Notes |
|---|---|---|---|---|---:|---|
| `middleware_memory_list` | `move-to-middleware` | `memory.memoryList` | `{ projectId?: string }` | `/api/memory/*` | 1 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_memory_read` | `move-to-middleware` | `memory.memoryRead` | `Parameters<typeof memory.memoryRead>[0]` | `/api/memory/*` | 1 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_memory_write` | `move-to-middleware` | `memory.memoryWrite` | `Parameters<typeof memory.memoryWrite>[0]` | `/api/memory/*` | 1 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_memory_search` | `move-to-middleware` | `memory.memorySearch` | `Parameters<typeof memory.memorySearch>[0]` | `/api/memory/*` | 0 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_memory_store` | `move-to-middleware` | `memory.memoryStore` | `Parameters<typeof memory.memoryStore>[0]` | `/api/memory/*` | 1 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_memory_recall` | `move-to-middleware` | `memory.memoryRecall` | `Parameters<typeof memory.memoryRecall>[0]` | `/api/memory/*` | 1 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_memory_reindex` | `move-to-middleware` | `memory.memoryReindex` | `{}` | `/api/memory/*` | 0 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |

### Skills

| Command | Decision | Handler | Input shape from registry | Proposed new endpoint | UI usage | Notes |
|---|---|---|---|---|---:|---|
| `middleware_skills_discover` | `move-to-middleware` | `skills.skillsDiscover` | `Parameters<typeof skills.skillsDiscover>[0]` | `/api/skills/* or /api/tools/*` | 2 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_skills_detail` | `move-to-middleware` | `skills.skillsDetail` | `{ slug: string }` | `/api/skills/* or /api/tools/*` | 1 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_skills_versions` | `move-to-middleware` | `skills.skillsVersions` | `{ slug: string; limit?: number; cursor?: string }` | `/api/skills/* or /api/tools/*` | 1 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_skills_install` | `move-to-middleware` | `skills.skillsInstall` | `Parameters<typeof skills.skillsInstall>[0]` | `/api/skills/* or /api/tools/*` | 2 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_skills_installed` | `move-to-middleware` | `skills.skillsInstalled` | `Parameters<typeof skills.skillsInstalled>[0]` | `/api/skills/* or /api/tools/*` | 0 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_skills_installed_local` | `legacy-compat` | `skillsInstalled.skillsInstalledLocal` | `Parameters<typeof skillsInstalled.skillsInstalledLocal>[0]` | `/api/skills/* or /api/tools/*` | 2 | Keep temporary adapter during UI migration; collapse/rename once new HTTP contract is adopted. |
| `middleware_skills_search_hub` | `move-to-middleware` | `skills.skillsSearchHub` | `Parameters<typeof skills.skillsSearchHub>[0]` | `/api/skills/* or /api/tools/*` | 0 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_skills_catalog` | `legacy-compat` | `skills.getSkillCatalog` | `{}` | `/api/skills/* or /api/tools/*` | 0 | Keep temporary adapter during UI migration; collapse/rename once new HTTP contract is adopted. |
| `middleware_skills_catalog_add` | `legacy-compat` | `skills.addSkillToCatalog` | `Parameters<typeof skills.addSkillToCatalog>[0]` | `/api/skills/* or /api/tools/*` | 0 | Keep temporary adapter during UI migration; collapse/rename once new HTTP contract is adopted. |
| `middleware_skills_catalog_remove` | `legacy-compat` | `skills.removeSkillFromCatalog` | `{ slug: string }` | `/api/skills/* or /api/tools/*` | 0 | Keep temporary adapter during UI migration; collapse/rename once new HTTP contract is adopted. |
| `middleware_skills_uninstall` | `move-to-middleware` | `skills.uninstallSkill` | `{ slug: string }` | `/api/skills/* or /api/tools/*` | 2 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_skills_active` | `legacy-compat` | `skillRuntime.getInstalledSkills` | `{}` | `/api/skills/* or /api/tools/*` | 0 | Keep temporary adapter during UI migration; collapse/rename once new HTTP contract is adopted. |
| `middleware_skills_toggle` | `legacy-compat` | `skillRuntime.setSkillEnabled` | `{ slug: string; enabled: boolean }` | `/api/skills/* or /api/tools/*` | 1 | Keep temporary adapter during UI migration; collapse/rename once new HTTP contract is adopted. |
| `middleware_skills_enabled_map` | `legacy-compat` | `skillRuntime.getSkillEnabledMap` | `{}` | `/api/skills/* or /api/tools/*` | 0 | Keep temporary adapter during UI migration; collapse/rename once new HTTP contract is adopted. |
| `middleware_commands_list` | `move-to-middleware` | `skills.commandsList` | `Parameters<typeof skills.commandsList>[0]` | `/api/skills/* or /api/tools/*` | 1 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_tools_catalog` | `move-to-middleware` | `skills.toolsCatalog` | `Parameters<typeof skills.toolsCatalog>[0]` | `/api/skills/* or /api/tools/*` | 0 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |

### Standalone Chats

| Command | Decision | Handler | Input shape from registry | Proposed new endpoint | UI usage | Notes |
|---|---|---|---|---|---:|---|
| `middleware_chats_list` | `move-to-middleware` | `chats.chatsList` | `{ archived?: boolean }` | `/api/chats/*` | 6 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_chats_create` | `move-to-middleware` | `chats.chatsCreate` | `Parameters<typeof chats.chatsCreate>[0]` | `/api/chats/*` | 3 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_chats_get` | `move-to-middleware` | `chats.chatsGet` | `{ chatId: string }` | `/api/chats/*` | 0 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_chats_update` | `move-to-middleware` | `chats.chatsUpdate` | `Parameters<typeof chats.chatsUpdate>[0]` | `/api/chats/*` | 1 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_chats_rename` | `move-to-middleware` | `chats.chatsRename` | `{ chatId: string; name: string }` | `/api/chats/*` | 4 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_chats_archive` | `move-to-middleware` | `chats.chatsArchive` | `{ chatId: string; archived?: boolean }` | `/api/chats/*` | 1 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_chats_delete` | `move-to-middleware` | `chats.chatsDelete` | `{ chatId: string }` | `/api/chats/*` | 1 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_chats_attach_session` | `move-to-middleware` | `chats.chatsAttachSession` | `{ chatId: string; sessionKey: string }` | `/api/chats/*` | 3 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_chats_update_activity` | `move-to-middleware` | `chats.chatsUpdateActivity` | `{ chatId: string }` | `/api/chats/*` | 0 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |

### Auto-naming

| Command | Decision | Handler | Input shape from registry | Proposed new endpoint | UI usage | Notes |
|---|---|---|---|---|---:|---|
| `middleware_autonaming_generate` | `legacy-compat` | `autonaming.generateConversationName` | `{ sessionKey: string; firstMessage: string }` | `/api/autonaming/*` | 0 | Keep temporary adapter during UI migration; collapse/rename once new HTTP contract is adopted. |
| `middleware_autonaming_quick` | `legacy-compat` | `autonaming.quickName` | `{ text: string }` | `/api/autonaming/*` | 2 | Keep temporary adapter during UI migration; collapse/rename once new HTTP contract is adopted. |

### Recent feed

| Command | Decision | Handler | Input shape from registry | Proposed new endpoint | UI usage | Notes |
|---|---|---|---|---|---:|---|
| `middleware_recent_list` | `move-to-middleware` | `recent.recentList` | `{ limit?: number; includeArchived?: boolean }` | `/api/recent` | 0 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |

### Chat (Gateway-dependent)

| Command | Decision | Handler | Input shape from registry | Proposed new endpoint | UI usage | Notes |
|---|---|---|---|---|---:|---|
| `middleware_chat_create_session` | `move-to-middleware` | `chat.chatCreateSession` | `Parameters<typeof chat.chatCreateSession>[0]` | `/api/chat/sessions/* plus SSE stream` | 0 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_chat_delete_session` | `move-to-middleware` | `chat.chatDeleteSession` | `{ sessionKey: string }` | `/api/chat/sessions/* plus SSE stream` | 0 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_chat_send` | `move-to-middleware` | `chat.chatSend` | `Parameters<typeof chat.chatSend>[0]` | `/api/chat/sessions/* plus SSE stream` | 5 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_chat_stop` | `move-to-middleware` | `chat.chatStop` | `{ sessionKey: string }` | `/api/chat/sessions/* plus SSE stream` | 2 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_chat_history` | `move-to-middleware` | `chat.chatHistory` | `{ sessionKey: string }` | `/api/chat/sessions/* plus SSE stream` | 6 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_chat_edit_and_resend` | `move-to-middleware` | `chat.chatEditAndResend` | `Parameters<typeof chat.chatEditAndResend>[0]` | `/api/chat/sessions/* plus SSE stream` | 0 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_chat_edit_last_preview` | `move-to-middleware` | `chat.chatEditLastPreview` | `Parameters<typeof chat.chatEditLastPreview>[0]` | `/api/chat/sessions/* plus SSE stream` | 1 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_chat_select_edit_branch` | `move-to-middleware` | `chat.chatSelectEditBranch` | `Parameters<typeof chat.chatSelectEditBranch>[0]` | `/api/chat/sessions/* plus SSE stream` | 1 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_chat_regenerate` | `move-to-middleware` | `chat.chatRegenerate` | `Parameters<typeof chat.chatRegenerate>[0]` | `/api/chat/sessions/* plus SSE stream` | 1 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_chat_start_subagent_stream` | `move-to-middleware` | `chat.chatStartSubagentStream` | `{ sessionKey: string }` | `/api/chat/sessions/* plus SSE stream` | 0 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_chat_fork` | `move-to-middleware` | `chat.chatFork` | `Parameters<typeof chat.chatFork>[0]` | `/api/chat/sessions/* plus SSE stream` | 1 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_chat_fork_history` | `move-to-middleware` | `chat.chatForkHistory` | `{ sessionKey: string }` | `/api/chat/sessions/* plus SSE stream` | 0 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |

### Cron (Gateway-dependent)

| Command | Decision | Handler | Input shape from registry | Proposed new endpoint | UI usage | Notes |
|---|---|---|---|---|---:|---|
| `middleware_cron_list_jobs` | `move-to-middleware` | `cron.cronListJobs` | `{}` | `/api/cron/* plus SSE stream` | 4 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_cron_recent_activity` | `move-to-middleware` | `cron.cronRecentActivity` | `{ limit?: number }` | `/api/cron/* plus SSE stream` | 3 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_cron_get_job` | `move-to-middleware` | `cron.cronGetJob` | `{ jobId: string }` | `/api/cron/* plus SSE stream` | 1 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_cron_create_job` | `move-to-middleware` | `cron.cronCreateJob` | `Parameters<typeof cron.cronCreateJob>[0]` | `/api/cron/* plus SSE stream` | 2 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_cron_update_job` | `move-to-middleware` | `cron.cronUpdateJob` | `Parameters<typeof cron.cronUpdateJob>[0]` | `/api/cron/* plus SSE stream` | 3 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_cron_delete_job` | `move-to-middleware` | `cron.cronDeleteJob` | `{ jobId: string }` | `/api/cron/* plus SSE stream` | 2 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_cron_run_job` | `move-to-middleware` | `cron.cronRunJob` | `Parameters<typeof cron.cronRunJob>[0]` | `/api/cron/* plus SSE stream` | 2 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_cron_job_status` | `move-to-middleware` | `cron.cronJobStatus` | `{ jobId: string }` | `/api/cron/* plus SSE stream` | 0 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_cron_list_runs` | `move-to-middleware` | `cron.cronListRuns` | `Parameters<typeof cron.cronListRuns>[0]` | `/api/cron/* plus SSE stream` | 2 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_cron_get_run` | `move-to-middleware` | `cron.cronGetRun` | `Parameters<typeof cron.cronGetRun>[0]` | `/api/cron/* plus SSE stream` | 0 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_cron_pause_job` | `move-to-middleware` | `cron.cronPauseJob` | `{ jobId: string; paused: boolean }` | `/api/cron/* plus SSE stream` | 2 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_cron_poll_run_completion` | `move-to-middleware` | `cron.cronPollRunCompletion` | `Parameters<typeof cron.cronPollRunCompletion>[0]` | `/api/cron/* plus SSE stream` | 0 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_cron_create_notification_job` | `move-to-middleware` | `cron.cronCreateNotificationJob` | `Parameters<typeof cron.cronCreateNotificationJob>[0]` | `/api/cron/* plus SSE stream` | 0 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_cron_job_conversation` | `move-to-middleware` | `cron.cronJobConversation` | `{ jobId: string }` | `/api/cron/* plus SSE stream` | 2 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |

### Sync

| Command | Decision | Handler | Input shape from registry | Proposed new endpoint | UI usage | Notes |
|---|---|---|---|---|---:|---|
| `middleware_sync_status` | `move-to-middleware` | `sync.syncStatus` | `{}` | `/api/sync/* (internal/admin)` | 0 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_sync_mark_clean` | `move-to-middleware` | `sync.syncMarkClean` | `{ table: string; ids: string[] }` | `/api/sync/* (internal/admin)` | 0 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_sync_purge_tombstones` | `move-to-middleware` | `sync.syncPurgeTombstones` | `{}` | `/api/sync/* (internal/admin)` | 0 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_sync_set_device_id` | `move-to-middleware` | `sync.syncSetDeviceId` | `{ deviceId: string }` | `/api/sync/* (internal/admin)` | 0 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_sync_pull_now` | `move-to-middleware` | `sync.syncPullNow` | `{}` | `/api/sync/* (internal/admin)` | 2 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_sync_push_now` | `move-to-middleware` | `sync.syncPushNow` | `{ limit?: number }` | `/api/sync/* (internal/admin)` | 0 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_sync_backfill_now` | `move-to-middleware` | `sync.syncBackfillNow` | `{}` | `/api/sync/* (internal/admin)` | 0 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |

### Usage (Gateway-dependent)

| Command | Decision | Handler | Input shape from registry | Proposed new endpoint | UI usage | Notes |
|---|---|---|---|---|---:|---|
| `middleware_usage` | `move-to-middleware` | `usage.usage` | `{ days?: number }` | `/api/usage/*` | 1 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_usage_daily` | `move-to-middleware` | `usage.usageDaily` | `{ days?: number }` | `/api/usage/*` | 1 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |

### Onboarding

| Command | Decision | Handler | Input shape from registry | Proposed new endpoint | UI usage | Notes |
|---|---|---|---|---|---:|---|
| `middleware_onboarding_status` | `delete-later` | `onboarding.onboardingStatus` | `{}` | `/api/onboarding/* or Desktop connection settings` | 0 | Old Gateway-local setup path; replace with Middleware installer/connect flow. |
| `middleware_onboarding_set_step` | `delete-later` | `onboarding.onboardingSetStep` | `{ step: string }` | `/api/onboarding/* or Desktop connection settings` | 0 | Old Gateway-local setup path; replace with Middleware installer/connect flow. |
| `middleware_onboarding_complete` | `delete-later` | `onboarding.onboardingComplete` | `{}` | `/api/onboarding/* or Desktop connection settings` | 0 | Old Gateway-local setup path; replace with Middleware installer/connect flow. |
| `middleware_onboarding_reset` | `delete-later` | `onboarding.onboardingReset` | `{}` | `/api/onboarding/* or Desktop connection settings` | 0 | Old Gateway-local setup path; replace with Middleware installer/connect flow. |
| `middleware_onboarding_check_gateway` | `delete-later` | `onboarding.onboardingCheckGateway` | `{}` | `/api/onboarding/* or Desktop connection settings` | 0 | Old Gateway-local setup path; replace with Middleware installer/connect flow. |
| `middleware_onboarding_check_identity` | `delete-later` | `onboarding.onboardingCheckIdentity` | `{}` | `/api/onboarding/* or Desktop connection settings` | 0 | Old Gateway-local setup path; replace with Middleware installer/connect flow. |
| `middleware_onboarding_check_workspace` | `delete-later` | `onboarding.onboardingCheckWorkspace` | `{}` | `/api/onboarding/* or Desktop connection settings` | 0 | Old Gateway-local setup path; replace with Middleware installer/connect flow. |
| `middleware_onboarding_validate_gateway_url` | `delete-later` | `onboarding.onboardingValidateGatewayUrl` | `{ url: string }` | `/api/onboarding/* or Desktop connection settings` | 0 | Old Gateway-local setup path; replace with Middleware installer/connect flow. |
| `middleware_onboarding_create_workspace` | `delete-later` | `onboarding.onboardingCreateWorkspace` | `{}` | `/api/onboarding/* or Desktop connection settings` | 0 | Old Gateway-local setup path; replace with Middleware installer/connect flow. |
| `middleware_onboarding_check_dependencies` | `delete-later` | `onboarding.onboardingCheckDependencies` | `{}` | `/api/onboarding/* or Desktop connection settings` | 0 | Old Gateway-local setup path; replace with Middleware installer/connect flow. |
| `middleware_onboarding_save_gateway_config` | `delete-later` | `onboarding.onboardingSaveGatewayConfig` | `{ gatewayUrl: string; token?: string }` | `/api/onboarding/* or Desktop connection settings` | 3 | Old Gateway-local setup path; replace with Middleware installer/connect flow. |
| `middleware_onboarding_generate_identity` | `delete-later` | `onboarding.onboardingGenerateIdentity` | `{}` | `/api/onboarding/* or Desktop connection settings` | 3 | Old Gateway-local setup path; replace with Middleware installer/connect flow. |
| `middleware_onboarding_core` | `move-to-middleware` | `onboarding.onboardingCore` | `{ action?: string; gatewayUrl?: string }` | `/api/onboarding/* or Desktop connection settings` | 1 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_onboarding_providers` | `move-to-middleware` | `onboarding.onboardingProviders` | `{}` | `/api/onboarding/* or Desktop connection settings` | 1 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_onboarding_provider_types` | `move-to-middleware` | `onboarding.onboardingProviderTypes` | `{}` | `/api/onboarding/* or Desktop connection settings` | 0 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_onboarding_provider_details` | `move-to-middleware` | `onboarding.onboardingProviderDetails` | `{ providerId: string }` | `/api/onboarding/* or Desktop connection settings` | 1 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_onboarding_provider_submit` | `move-to-middleware` | `onboarding.onboardingProviderSubmit` | `Parameters<typeof onboarding.onboardingProviderSubmit>[0]` | `/api/onboarding/* or Desktop connection settings` | 1 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_onboarding_model_contract` | `move-to-middleware` | `onboarding.onboardingModelContract` | `{ providerId?: string }` | `/api/onboarding/* or Desktop connection settings` | 1 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_onboarding_model_submit` | `move-to-middleware` | `onboarding.onboardingModelSubmit` | `Parameters<typeof onboarding.onboardingModelSubmit>[0]` | `/api/onboarding/* or Desktop connection settings` | 1 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_onboarding_flow` | `move-to-middleware` | `onboarding.onboardingFlow` | `{ action?: string; gatewayUrl?: string }` | `/api/onboarding/* or Desktop connection settings` | 1 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_onboarding_sign_out` | `move-to-middleware` | `onboarding.onboardingSignOut` | `{}` | `/api/onboarding/* or Desktop connection settings` | 1 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_onboarding_delete_account` | `move-to-middleware` | `onboarding.onboardingDeleteAccount` | `{}` | `/api/onboarding/* or Desktop connection settings` | 1 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |

### Connect

| Command | Decision | Handler | Input shape from registry | Proposed new endpoint | UI usage | Notes |
|---|---|---|---|---|---:|---|
| `middleware_connect_status` | `desktop-only` | `connect.connectStatus` | `{}` | `Desktop local connection store + GET /health` | 5 | Desktop shell concern: manage saved Middleware URL/token and health-test the selected service, not OpenClaw Gateway directly. |
| `middleware_connect_test` | `desktop-only` | `connect.connectTest` | `{}` | `Desktop local connection store + GET /health` | 1 | Desktop shell concern: manage saved Middleware URL/token and health-test the selected service, not OpenClaw Gateway directly. |
| `middleware_connect_disconnect` | `delete-later` | `connect.connectDisconnect` | `{}` | `Desktop local connection store + GET /health` | 1 | Old OpenClaw Gateway connect lifecycle; replaced by Middleware connection health and config. |
| `middleware_connect_bootstrap` | `delete-later` | `connect.connectBootstrap` | `{}` | `Desktop local connection store + GET /health` | 2 | Old OpenClaw Gateway connect lifecycle; replaced by Middleware connection health and config. |
| `middleware_connect_reset` | `delete-later` | `connect.connectReset` | `{}` | `Desktop local connection store + GET /health` | 0 | Old OpenClaw Gateway connect lifecycle; replaced by Middleware connection health and config. |
| `middleware_connect_delete_all` | `delete-later` | `connect.connectDeleteAll` | `{}` | `Desktop local connection store + GET /health` | 0 | Old OpenClaw Gateway connect lifecycle; replaced by Middleware connection health and config. |

### Terminal

| Command | Decision | Handler | Input shape from registry | Proposed new endpoint | UI usage | Notes |
|---|---|---|---|---|---:|---|
| `middleware_terminal_create` | `move-to-middleware` | `terminal.terminalCreate` | `Parameters<typeof terminal.terminalCreate>[0]` | `/api/projects/:projectId/terminal/* plus stream` | 0 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_terminal_list` | `move-to-middleware` | `terminal.terminalList` | `{ projectId: string }` | `/api/projects/:projectId/terminal/* plus stream` | 0 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_terminal_write` | `move-to-middleware` | `terminal.terminalWrite` | `{ sessionId: string; data: string }` | `/api/projects/:projectId/terminal/* plus stream` | 0 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_terminal_resize` | `move-to-middleware` | `terminal.terminalResize` | `{ sessionId: string; cols: number; rows: number }` | `/api/projects/:projectId/terminal/* plus stream` | 0 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_terminal_close` | `move-to-middleware` | `terminal.terminalClose` | `{ sessionId: string }` | `/api/projects/:projectId/terminal/* plus stream` | 0 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |

### PTY (ephemeral)

| Command | Decision | Handler | Input shape from registry | Proposed new endpoint | UI usage | Notes |
|---|---|---|---|---|---:|---|
| `middleware_pty_spawn` | `move-to-middleware` | `ptyService.ptySpawn` | `Parameters<typeof ptyService.ptySpawn>[0]` | `/api/pty/* or terminal v2 stream` | 2 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_pty_write` | `move-to-middleware` | `ptyService.ptyWrite` | `{ ptyId: string; data: string }` | `/api/pty/* or terminal v2 stream` | 2 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_pty_resize` | `move-to-middleware` | `ptyService.ptyResize` | `{ ptyId: string; cols: number; rows: number }` | `/api/pty/* or terminal v2 stream` | 2 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_pty_kill` | `move-to-middleware` | `ptyService.ptyKill` | `{ ptyId: string }` | `/api/pty/* or terminal v2 stream` | 3 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |

### Models (Gateway-dependent)

| Command | Decision | Handler | Input shape from registry | Proposed new endpoint | UI usage | Notes |
|---|---|---|---|---|---:|---|
| `middleware_models_list` | `move-to-middleware` | `models.modelsList` | `{}` | `/api/models/*` | 1 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_models_auth_status` | `move-to-middleware` | `models.modelsAuthStatus` | `{}` | `/api/models/*` | 0 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_models_set_default` | `move-to-middleware` | `models.modelsSetDefault` | `{ modelId: string }` | `/api/models/*` | 1 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |

### Repos

| Command | Decision | Handler | Input shape from registry | Proposed new endpoint | UI usage | Notes |
|---|---|---|---|---|---:|---|
| `middleware_repos_scan` | `move-to-middleware` | `repos.reposScan` | `{ extraPaths?: string[] }` | `/api/repos/*` | 0 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_repos_recent` | `move-to-middleware` | `repos.reposRecent` | `{ limit?: number }` | `/api/repos/*` | 0 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_repos_select` | `move-to-middleware` | `repos.reposSelect` | `{ path: string; name: string }` | `/api/repos/*` | 2 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_repos_clone` | `move-to-middleware` | `repos.reposClone` | `{ url: string; name?: string; targetDir?: string }` | `/api/repos/*` | 0 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |

### Workspace (remote, gateway-backed)

| Command | Decision | Handler | Input shape from registry | Proposed new endpoint | UI usage | Notes |
|---|---|---|---|---|---:|---|
| `middleware_workspace_tree` | `move-to-middleware` | `workspace.workspaceTree` | `{ sessionKey: string; path?: string }` | `/api/workspace/* or /api/chat/sessions/:sessionKey/workspace/*` | 0 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_workspace_read` | `move-to-middleware` | `workspace.workspaceRead` | `{ sessionKey: string; path: string }` | `/api/workspace/* or /api/chat/sessions/:sessionKey/workspace/*` | 0 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_workspace_write` | `move-to-middleware` | `workspace.workspaceWrite` | `{ sessionKey: string; path: string; content: string }` | `/api/workspace/* or /api/chat/sessions/:sessionKey/workspace/*` | 0 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |

### Version

| Command | Decision | Handler | Input shape from registry | Proposed new endpoint | UI usage | Notes |
|---|---|---|---|---|---:|---|
| `middleware_version_info` | `move-to-middleware` | `version.versionInfo` | `{}` | `/api/version or /health` | 1 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |

### Sandbox

| Command | Decision | Handler | Input shape from registry | Proposed new endpoint | UI usage | Notes |
|---|---|---|---|---|---:|---|
| `middleware_sandbox_cleanup_audit_data` | `delete-later` | `sandbox.sandboxCleanupAuditData` | `{ dryRun?: boolean }` | `none; dev/test-only admin tool` | 0 | Audit smoke-test cleanup helper should not be part of production Middleware contract. |

### Pinned Messages

| Command | Decision | Handler | Input shape from registry | Proposed new endpoint | UI usage | Notes |
|---|---|---|---|---|---:|---|
| `middleware_pins_list` | `move-to-middleware` | `pins.pinsList` | `{ sessionKey: string }` | `/api/chat/sessions/:sessionKey/pins/*` | 1 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_pins_add` | `move-to-middleware` | `pins.pinsAdd` | `{ sessionKey: string; messageId: string; messageText: string }` | `/api/chat/sessions/:sessionKey/pins/*` | 1 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_pins_remove` | `move-to-middleware` | `pins.pinsRemove` | `{ sessionKey: string; messageId: string; messageText?: string }` | `/api/chat/sessions/:sessionKey/pins/*` | 1 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |

### Feedback

| Command | Decision | Handler | Input shape from registry | Proposed new endpoint | UI usage | Notes |
|---|---|---|---|---|---:|---|
| `middleware_message_feedback` | `move-to-middleware` | `feedback.messageFeedback` | `{}` | `/api/feedback/messages/*` | 2 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |
| `middleware_message_feedback_delete` | `move-to-middleware` | `feedback.deleteMessageFeedback` | `{}` | `/api/feedback/messages/*` | 1 | Server-side state, Gateway access, filesystem, or remote-host execution should live in Middleware; Desktop calls HTTP client. |

## UI usage details

Counts include fixtures, because fixture cases are migration work too.

- `middleware_autonaming_quick` (registry, `legacy-compat`, 2 refs): packages/ui/app/page.tsx:778, packages/ui/app/page.tsx:875
- `middleware_branch_list` (registry, `move-to-middleware`, 2 refs): packages/ui/app/api/ipc/[command]/fixtures.ts:350, packages/ui/hooks/useChatMessages.ts:90
- `middleware_chat_edit_last_preview` (registry, `move-to-middleware`, 1 refs): packages/ui/hooks/useChatMessages.ts:1226
- `middleware_chat_fork` (registry, `move-to-middleware`, 1 refs): packages/ui/components/ChatView/index.tsx:623
- `middleware_chat_history` (registry, `move-to-middleware`, 6 refs): packages/ui/app/api/ipc/[command]/fixtures.ts:340, packages/ui/hooks/useSubagentMessages.ts:165, packages/ui/hooks/useAgentActivity.ts:110, packages/ui/hooks/useAgentActivity.ts:401, packages/ui/hooks/useChatMessages.ts:87, packages/ui/hooks/useChatMessages.ts:1025
- `middleware_chat_regenerate` (registry, `move-to-middleware`, 1 refs): packages/ui/hooks/useChatMessages.ts:1176
- `middleware_chat_select_edit_branch` (registry, `move-to-middleware`, 1 refs): packages/ui/hooks/useChatMessages.ts:1297
- `middleware_chat_send` (registry, `move-to-middleware`, 5 refs): packages/ui/components/TopicView/index.tsx:83, packages/ui/app/page.tsx:865, packages/ui/app/page.tsx:947, packages/ui/hooks/useQuickChat.ts:56, packages/ui/hooks/useChatMessages.ts:1118
- `middleware_chat_stop` (registry, `move-to-middleware`, 2 refs): packages/ui/hooks/useChatMessages.ts:1116, packages/ui/hooks/useChatMessages.ts:1198
- `middleware_chats_archive` (registry, `move-to-middleware`, 1 refs): packages/ui/hooks/useChatsData/index.ts:149
- `middleware_chats_attach_session` (registry, `move-to-middleware`, 3 refs): packages/ui/lib/sessionNavigation.ts:65, packages/ui/app/page.tsx:838, packages/ui/app/api/ipc/[command]/fixtures.ts:319
- `middleware_chats_create` (registry, `move-to-middleware`, 3 refs): packages/ui/lib/sessionNavigation.ts:145, packages/ui/app/page.tsx:831, packages/ui/app/api/ipc/[command]/fixtures.ts:308
- `middleware_chats_delete` (registry, `move-to-middleware`, 1 refs): packages/ui/hooks/useChatsData/index.ts:193
- `middleware_chats_list` (registry, `move-to-middleware`, 6 refs): packages/ui/lib/sessionNavigation.ts:117, packages/ui/components/CommandPalette.tsx:132, packages/ui/app/page.tsx:302, packages/ui/app/page.tsx:588, packages/ui/app/api/ipc/[command]/fixtures.ts:306, packages/ui/hooks/useChatsData/index.ts:66
- `middleware_chats_rename` (registry, `move-to-middleware`, 4 refs): packages/ui/app/page.tsx:782, packages/ui/app/page.tsx:799, packages/ui/app/page.tsx:879, packages/ui/hooks/useChatsData/index.ts:171
- `middleware_chats_update` (registry, `move-to-middleware`, 1 refs): packages/ui/hooks/useChatsData/index.ts:136
- `middleware_commands_list` (registry, `move-to-middleware`, 1 refs): packages/ui/hooks/useSlashCommands.ts:97
- `middleware_connect_bootstrap` (registry, `delete-later`, 2 refs): packages/ui/components/ConnectPage.tsx:92, packages/ui/app/page.tsx:189
- `middleware_connect_disconnect` (registry, `delete-later`, 1 refs): packages/ui/components/ConnectPage.tsx:251
- `middleware_connect_status` (registry, `desktop-only`, 5 refs): packages/ui/lib/toast.ts:29, packages/ui/components/ConnectPage.tsx:73, packages/ui/components/ConnectPage.tsx:110, packages/ui/app/page.tsx:93, packages/ui/app/page.tsx:183
- `middleware_connect_test` (registry, `desktop-only`, 1 refs): packages/ui/components/ConnectPage.tsx:207
- `middleware_cron_create_job` (registry, `move-to-middleware`, 2 refs): packages/ui/components/notifications/tabs/CronJobsTab.tsx:703, packages/ui/app/api/ipc/[command]/fixtures.ts:220
- `middleware_cron_delete_job` (registry, `move-to-middleware`, 2 refs): packages/ui/components/notifications/tabs/CronJobsTab.tsx:602, packages/ui/app/api/ipc/[command]/fixtures.ts:297
- `middleware_cron_get_job` (registry, `move-to-middleware`, 1 refs): packages/ui/app/page.tsx:645
- `middleware_cron_job_conversation` (registry, `move-to-middleware`, 2 refs): packages/ui/components/notifications/CronJobChat.tsx:208, packages/ui/app/api/ipc/[command]/fixtures.ts:300
- `middleware_cron_list_jobs` (registry, `move-to-middleware`, 4 refs): packages/ui/components/notifications/NotificationPopover.tsx:235, packages/ui/components/notifications/tabs/ActivityTab.tsx:146, packages/ui/components/notifications/tabs/CronJobsTab.tsx:503, packages/ui/app/api/ipc/[command]/fixtures.ts:195
- `middleware_cron_list_runs` (registry, `move-to-middleware`, 2 refs): packages/ui/components/notifications/tabs/CronJobRow.tsx:157, packages/ui/app/api/ipc/[command]/fixtures.ts:199
- `middleware_cron_pause_job` (registry, `move-to-middleware`, 2 refs): packages/ui/components/notifications/tabs/CronJobsTab.tsx:579, packages/ui/app/api/ipc/[command]/fixtures.ts:286
- `middleware_cron_recent_activity` (registry, `move-to-middleware`, 3 refs): packages/ui/components/notifications/NotificationPopover.tsx:239, packages/ui/components/notifications/tabs/ActivityTab.tsx:149, packages/ui/app/api/ipc/[command]/fixtures.ts:197
- `middleware_cron_reset_fixtures` (not in registry, 1 refs): packages/ui/app/api/ipc/[command]/fixtures.ts:192
- `middleware_cron_run_job` (registry, `move-to-middleware`, 2 refs): packages/ui/components/notifications/tabs/CronJobsTab.tsx:617, packages/ui/app/api/ipc/[command]/fixtures.ts:201
- `middleware_cron_update_job` (registry, `move-to-middleware`, 3 refs): packages/ui/components/notifications/tabs/CronJobsTab.tsx:556, packages/ui/components/notifications/tabs/CronJobsTab.tsx:676, packages/ui/app/api/ipc/[command]/fixtures.ts:254
- `middleware_fs_read_dir` (registry, `delete-later`, 1 refs): packages/ui/components/sidebar/RepoPickerDialog.tsx:49
- `middleware_git_branches` (registry, `move-to-middleware`, 1 refs): packages/ui/components/inspector/GitTab.tsx:59
- `middleware_git_commit_details` (registry, `move-to-middleware`, 1 refs): packages/ui/components/inspector/GitTab.tsx:457
- `middleware_git_diff` (registry, `move-to-middleware`, 1 refs): packages/ui/components/inspector/GitTab.tsx:646
- `middleware_git_status` (registry, `move-to-middleware`, 1 refs): packages/ui/components/inspector/GitTab.tsx:53
- `middleware_git_switch_branch` (registry, `move-to-middleware`, 1 refs): packages/ui/components/inspector/GitTab.tsx:98
- `middleware_memory_list` (registry, `move-to-middleware`, 1 refs): packages/ui/components/settings/tabs/MemoryDocuments.tsx:33
- `middleware_memory_read` (registry, `move-to-middleware`, 1 refs): packages/ui/components/settings/tabs/MemoryDocuments.tsx:56
- `middleware_memory_recall` (registry, `move-to-middleware`, 1 refs): packages/ui/components/settings/tabs/MemoryRecall.tsx:124
- `middleware_memory_store` (registry, `move-to-middleware`, 1 refs): packages/ui/components/settings/tabs/MemoryEntryViews.tsx:131
- `middleware_memory_write` (registry, `move-to-middleware`, 1 refs): packages/ui/components/settings/tabs/MemoryEntryViews.tsx:52
- `middleware_message_feedback` (registry, `move-to-middleware`, 2 refs): packages/ui/components/ChatView/index.tsx:517, packages/ui/components/ChatView/index.tsx:604
- `middleware_message_feedback_delete` (registry, `move-to-middleware`, 1 refs): packages/ui/components/ChatView/index.tsx:482
- `middleware_models_list` (registry, `move-to-middleware`, 1 refs): packages/ui/hooks/useModels.ts:45
- `middleware_models_set_default` (registry, `move-to-middleware`, 1 refs): packages/ui/components/sidebar/ModelSelector.tsx:38
- `middleware_onboarding_core` (registry, `move-to-middleware`, 1 refs): packages/ui/components/onboarding/useOnboardingFlow.ts:139
- `middleware_onboarding_delete_account` (registry, `move-to-middleware`, 1 refs): packages/ui/components/onboarding/useOnboardingFlow.ts:181
- `middleware_onboarding_flow` (registry, `move-to-middleware`, 1 refs): packages/ui/components/onboarding/useOnboardingFlow.ts:116
- `middleware_onboarding_generate_identity` (registry, `delete-later`, 3 refs): packages/ui/components/ConnectPage.tsx:134, packages/ui/components/ConnectPage.tsx:203, packages/ui/components/ConnectPage.tsx:232
- `middleware_onboarding_model_contract` (registry, `move-to-middleware`, 1 refs): packages/ui/components/onboarding/useOnboardingFlow.ts:165
- `middleware_onboarding_model_submit` (registry, `move-to-middleware`, 1 refs): packages/ui/components/onboarding/useOnboardingFlow.ts:171
- `middleware_onboarding_provider_details` (registry, `move-to-middleware`, 1 refs): packages/ui/components/onboarding/useOnboardingFlow.ts:155
- `middleware_onboarding_provider_submit` (registry, `move-to-middleware`, 1 refs): packages/ui/components/onboarding/useOnboardingFlow.ts:159
- `middleware_onboarding_providers` (registry, `move-to-middleware`, 1 refs): packages/ui/components/onboarding/useOnboardingFlow.ts:151
- `middleware_onboarding_save_gateway_config` (registry, `delete-later`, 3 refs): packages/ui/components/ConnectPage.tsx:126, packages/ui/components/ConnectPage.tsx:200, packages/ui/components/ConnectPage.tsx:229
- `middleware_onboarding_sign_out` (registry, `move-to-middleware`, 1 refs): packages/ui/components/onboarding/useOnboardingFlow.ts:177
- `middleware_open_url` (not in registry, 1 refs): packages/ui/lib/ipc.ts:117
- `middleware_openclaw_bot_name_get` (registry, `move-to-middleware`, 1 refs): packages/ui/components/onboarding/useOnboardingFlow.ts:143
- `middleware_openclaw_bot_name_set` (registry, `move-to-middleware`, 1 refs): packages/ui/components/onboarding/useOnboardingFlow.ts:147
- `middleware_pins_add` (registry, `move-to-middleware`, 1 refs): packages/ui/components/ChatView/index.tsx:452
- `middleware_pins_list` (registry, `move-to-middleware`, 1 refs): packages/ui/components/ChatView/index.tsx:259
- `middleware_pins_remove` (registry, `move-to-middleware`, 1 refs): packages/ui/components/ChatView/index.tsx:438
- `middleware_profiles_list` (registry, `legacy-compat`, 4 refs): packages/ui/components/inspector/GitTab.tsx:127, packages/ui/app/api/ipc/[command]/fixtures.ts:329, packages/ui/hooks/useQuickChat.ts:25, packages/ui/hooks/useProjectsData/index.ts:312
- `middleware_projects_archive` (registry, `move-to-middleware`, 2 refs): packages/ui/lib/api/projects.ts:31, packages/ui/hooks/useProjectsData/index.ts:507
- `middleware_projects_create` (registry, `move-to-middleware`, 3 refs): packages/ui/components/inspector/GitTab.tsx:136, packages/ui/hooks/useQuickChat.ts:37, packages/ui/hooks/useProjectsData/index.ts:318
- `middleware_projects_delete` (registry, `move-to-middleware`, 1 refs): packages/ui/hooks/useProjectsData/index.ts:464
- `middleware_projects_list` (registry, `move-to-middleware`, 8 refs): packages/ui/lib/sessionNavigation.ts:91, packages/ui/lib/api/projects.ts:22, packages/ui/components/inspector/GitTab.tsx:113, packages/ui/components/sidebar/RepoPickerDialog.tsx:40, packages/ui/app/page.tsx:348, packages/ui/app/api/ipc/[command]/fixtures.ts:325, packages/ui/hooks/useQuickChat.ts:31, packages/ui/hooks/useProjectsData/index.ts:164
- `middleware_projects_update` (registry, `move-to-middleware`, 2 refs): packages/ui/components/inspector/GitTab.tsx:156, packages/ui/hooks/useProjectsData/index.ts:423
- `middleware_pty_kill` (registry, `move-to-middleware`, 3 refs): packages/ui/components/terminal/usePty.ts:37, packages/ui/components/terminal/usePty.ts:52, packages/ui/app/api/ipc/[command]/fixtures.ts:336
- `middleware_pty_resize` (registry, `move-to-middleware`, 2 refs): packages/ui/components/terminal/usePty.ts:85, packages/ui/app/api/ipc/[command]/fixtures.ts:338
- `middleware_pty_spawn` (registry, `move-to-middleware`, 2 refs): packages/ui/components/terminal/usePty.ts:47, packages/ui/app/api/ipc/[command]/fixtures.ts:331
- `middleware_pty_write` (registry, `move-to-middleware`, 2 refs): packages/ui/components/terminal/usePty.ts:78, packages/ui/app/api/ipc/[command]/fixtures.ts:337
- `middleware_repos_select` (registry, `move-to-middleware`, 2 refs): packages/ui/components/inspector/GitTab.tsx:163, packages/ui/hooks/useProjectsData/index.ts:145
- `middleware_sessions_create` (registry, `move-to-middleware`, 5 refs): packages/ui/lib/sessionNavigation.ts:49, packages/ui/components/TopicView/index.tsx:79, packages/ui/app/page.tsx:835, packages/ui/app/page.tsx:919, packages/ui/hooks/useQuickChat.ts:52
- `middleware_sessions_list` (registry, `move-to-middleware`, 6 refs): packages/ui/lib/sessionNavigation.ts:78, packages/ui/components/CommandPalette.tsx:115, packages/ui/components/inspector/WorkspaceTab.tsx:949, packages/ui/components/inspector/WorkspaceTab.tsx:1102, packages/ui/components/TopicView/index.tsx:59, packages/ui/hooks/useTopicSession.ts:31
- `middleware_skills_detail` (registry, `move-to-middleware`, 1 refs): packages/ui/components/SkillPage/hooks.ts:175
- `middleware_skills_discover` (registry, `move-to-middleware`, 2 refs): packages/ui/components/SkillPage/hooks.ts:41, packages/ui/hooks/useSlashCommands.ts:64
- `middleware_skills_install` (registry, `move-to-middleware`, 2 refs): packages/ui/components/SkillPage/SkillDetailView.tsx:40, packages/ui/components/SkillPage/index.tsx:59
- `middleware_skills_installed_local` (registry, `legacy-compat`, 2 refs): packages/ui/components/SkillPage/hooks.ts:40, packages/ui/components/SkillPage/hooks.ts:78
- `middleware_skills_toggle` (registry, `legacy-compat`, 1 refs): packages/ui/components/SkillPage/index.tsx:120
- `middleware_skills_uninstall` (registry, `move-to-middleware`, 2 refs): packages/ui/components/SkillPage/SkillDetailView.tsx:57, packages/ui/components/SkillPage/index.tsx:87
- `middleware_skills_versions` (registry, `move-to-middleware`, 1 refs): packages/ui/components/SkillPage/hooks.ts:179
- `middleware_sync_pull_now` (registry, `move-to-middleware`, 2 refs): packages/ui/components/ConnectPage.tsx:95, packages/ui/app/page.tsx:192
- `middleware_topics_archive` (registry, `move-to-middleware`, 2 refs): packages/ui/lib/api/topics.ts:32, packages/ui/hooks/useProjectsData/index.ts:525
- `middleware_topics_create` (registry, `move-to-middleware`, 3 refs): packages/ui/hooks/useQuickChat.ts:46, packages/ui/hooks/useProjectsData/index.ts:332, packages/ui/hooks/useProjectsData/index.ts:390
- `middleware_topics_delete` (registry, `move-to-middleware`, 1 refs): packages/ui/hooks/useProjectsData/index.ts:491
- `middleware_topics_list` (registry, `move-to-middleware`, 5 refs): packages/ui/lib/sessionNavigation.ts:100, packages/ui/lib/api/topics.ts:23, packages/ui/app/page.tsx:362, packages/ui/app/api/ipc/[command]/fixtures.ts:327, packages/ui/hooks/useProjectsData/index.ts:213
- `middleware_topics_update` (registry, `move-to-middleware`, 1 refs): packages/ui/hooks/useProjectsData/index.ts:445
- `middleware_usage` (registry, `move-to-middleware`, 1 refs): packages/ui/components/settings/tabs/usage/useUsageData.ts:56
- `middleware_usage_daily` (registry, `move-to-middleware`, 1 refs): packages/ui/components/settings/tabs/usage/useUsageData.ts:59
- `middleware_version_info` (registry, `move-to-middleware`, 1 refs): packages/ui/common/Header/index.tsx:76

## UI names not present in registry

- `middleware_cron_reset_fixtures`: delete-later: fixture-only test command; keep out of production API.
- `middleware_open_url`: desktop-only: replace with a Tauri/shell `openExternal` helper, not Middleware.

## Registry commands with no current UI usage

These may still be needed by future UI, tests, or direct API callers, but should not block first migration slices unless a domain requires them.

- Runtime: `middleware_runtime_info`, `middleware_openclaw_bot_name`, `middleware_request_admin_access`, `middleware_approve_admin_access`
- Profiles: `middleware_profiles_create`, `middleware_profiles_update`, `middleware_profiles_delete`, `middleware_profile_token_set`, `middleware_profile_token_get`, `middleware_profile_token_delete`
- Environment: `middleware_environment_connect`, `middleware_environment_status`, `middleware_environment_detect`
- Projects: `middleware_projects_get`, `middleware_projects_pin`, `middleware_projects_sidebar`
- Topics: `middleware_topics_attach_session`, `middleware_topics_rename`, `middleware_topics_detach_session`
- Sessions: `middleware_sessions_update`, `middleware_sessions_delete`
- Branches: `middleware_branch_create`, `middleware_branch_get`, `middleware_branch_delete`, `middleware_branch_from_regenerate`, `middleware_branch_from_edit`, `middleware_branch_create_thread`
- Files (project-scoped): `middleware_files_tree`, `middleware_files_read`, `middleware_files_prepare_attachment`, `middleware_files_write`, `middleware_files_mkdir`, `middleware_files_rename`, `middleware_files_delete`, `middleware_files_search`
- Filesystem (raw, absolute paths): `middleware_fs_read_file`, `middleware_fs_prepare_attachment`, `middleware_fs_write_file`, `middleware_fs_create_dir`, `middleware_fs_remove`, `middleware_fs_rename`, `middleware_fs_metadata`, `middleware_fs_search`
- Git: `middleware_git_remote_add`, `middleware_git_remote_list`, `middleware_git_remote_remove`, `middleware_git_context`
- Memory: `middleware_memory_search`, `middleware_memory_reindex`
- Skills: `middleware_skills_installed`, `middleware_skills_search_hub`, `middleware_skills_catalog`, `middleware_skills_catalog_add`, `middleware_skills_catalog_remove`, `middleware_skills_active`, `middleware_skills_enabled_map`, `middleware_tools_catalog`
- Standalone Chats: `middleware_chats_get`, `middleware_chats_update_activity`
- Auto-naming: `middleware_autonaming_generate`
- Recent feed: `middleware_recent_list`
- Chat (Gateway-dependent): `middleware_chat_create_session`, `middleware_chat_delete_session`, `middleware_chat_edit_and_resend`, `middleware_chat_start_subagent_stream`, `middleware_chat_fork_history`
- Cron (Gateway-dependent): `middleware_cron_job_status`, `middleware_cron_get_run`, `middleware_cron_poll_run_completion`, `middleware_cron_create_notification_job`
- Sync: `middleware_sync_status`, `middleware_sync_mark_clean`, `middleware_sync_purge_tombstones`, `middleware_sync_set_device_id`, `middleware_sync_push_now`, `middleware_sync_backfill_now`
- Onboarding: `middleware_onboarding_status`, `middleware_onboarding_set_step`, `middleware_onboarding_complete`, `middleware_onboarding_reset`, `middleware_onboarding_check_gateway`, `middleware_onboarding_check_identity`, `middleware_onboarding_check_workspace`, `middleware_onboarding_validate_gateway_url`, `middleware_onboarding_create_workspace`, `middleware_onboarding_check_dependencies`, `middleware_onboarding_provider_types`
- Connect: `middleware_connect_reset`, `middleware_connect_delete_all`
- Terminal: `middleware_terminal_create`, `middleware_terminal_list`, `middleware_terminal_write`, `middleware_terminal_resize`, `middleware_terminal_close`
- Models (Gateway-dependent): `middleware_models_auth_status`
- Repos: `middleware_repos_scan`, `middleware_repos_recent`, `middleware_repos_clone`
- Workspace (remote, gateway-backed): `middleware_workspace_tree`, `middleware_workspace_read`, `middleware_workspace_write`
- Sandbox: `middleware_sandbox_cleanup_audit_data`

## Migration order recommendation

1. Desktop connection shell: replace old `middleware_connect_*` and Gateway onboarding calls with saved Middleware URL/token plus `GET /health`.
2. Projects/repos/git: migrate the current high-visibility remote-host confusion first (`projects`, `repos`, `git`).
3. Chat/session/chats/topics/branches/pins/feedback: move durable conversation state and streaming behind explicit `/api/chat/*` and SSE/WebSocket routes.
4. Terminal/pty/workspace/files: migrate dangerous remote-host operations with scoped APIs, audit logging, and permission prompts.
5. Skills/models/usage/cron/memory/sync: migrate Gateway-backed/product surfaces after the core project/chat loop is stable.
6. Delete old raw filesystem, fixture, sandbox, and Gateway-local onboarding commands after UI callers and tests are migrated.

