# Feature Migration: Memory, Skills, Sync, Usage

## Memory

Agent memory stored as markdown files on disk.

| Command | Args |
|---------|------|
| `middleware_memory_list` | `{ projectId? }` |
| `middleware_memory_read` | `{ path, startLine?, endLine? }` |
| `middleware_memory_write` | `{ path, content, category?, importance? }` |
| `middleware_memory_search` | `{ query, limit? }` |
| `middleware_memory_store` | `{ content, category?, importance?, tags? }` |
| `middleware_memory_recall` | `{ path?, limit? }` |
| `middleware_memory_reindex` | `{}` |

### Memory file location

Files stored in `~/.openclaw/memory/` directory.

### Categories

`"preference"` | `"fact"` | `"decision"` | `"entity"` | `"other"`

### Importance

Float from `0` to `1`.

```typescript
import { invoke } from "@/lib/ipc"

const { files } = await invoke("middleware_memory_list", {})
const { content } = await invoke("middleware_memory_read", {
  path: "decisions/use-react.md"
})
await invoke("middleware_memory_store", {
  content: "User prefers dark mode for all editors",
  category: "preference",
  importance: 0.8,
  tags: ["ui", "editor"]
})
```

---

## Skills

Discover and install agent skills.

| Command | Args |
|---------|------|
| `middleware_skills_discover` | `{ query?, limit?, includeLocal?, includeClawHub?, includeGithubProbe? }` |
| `middleware_skills_install` | `{ source, slug?, version?, repoUrl?, gitRef?, localPath?, scope?, force? }` |

### skillsDiscover response

```json
{
  "skills": [
    {
      "slug": "code-review",
      "name": "Code Review",
      "description": "Automated code review skill",
      "source": "local",
      "version": "1.0.0",
      "path": "/home/user/.openclaw/skills/code-review"
    }
  ]
}
```

```typescript
import { invoke } from "@/lib/ipc"

const { skills } = await invoke("middleware_skills_discover", {
  query: "code",
  includeLocal: true
})

await invoke("middleware_skills_install", {
  source: "local",
  localPath: "/path/to/skill"
})
```

**Already migrated in:** `components/SkillPage/index.tsx`

---

## Sync

Track dirty state for cross-device sync.

| Command | Args |
|---------|------|
| `middleware_sync_status` | `{}` |
| `middleware_sync_mark_clean` | `{ table, ids }` |
| `middleware_sync_purge_tombstones` | `{}` |
| `middleware_sync_set_device_id` | `{ deviceId }` |

### syncStatus response

```json
{
  "breakdown": {
    "projects": { "dirty": 2, "total": 10 },
    "topics": { "dirty": 0, "total": 25 },
    "session_mappings": { "dirty": 1, "total": 50 },
    "branches": { "dirty": 0, "total": 8 }
  },
  "tombstones": 3
}
```

### Valid tables for syncMarkClean

`"projects"` | `"topics"` | `"session_mappings"` | `"branches"`

```typescript
import { invoke } from "@/lib/ipc"

const { breakdown, tombstones } = await invoke("middleware_sync_status")
await invoke("middleware_sync_mark_clean", {
  table: "projects",
  ids: ["proj_abc", "proj_def"]
})
await invoke("middleware_sync_purge_tombstones")
```

---

## Usage (Gateway Required)

Track AI usage, costs, and limits.

| Command | Args |
|---------|------|
| `middleware_usage_current` | `{}` |
| `middleware_usage_history` | `{ period? }` |
| `middleware_usage_limits` | `{}` |
| `middleware_usage_estimate` | `{ model?, tokens? }` |

```typescript
import { invoke } from "@/lib/ipc"

const usage = await invoke("middleware_usage_current")
const history = await invoke("middleware_usage_history", { period: "30d" })
const limits = await invoke("middleware_usage_limits")
const estimate = await invoke("middleware_usage_estimate", {
  model: "claude-3",
  tokens: 10000
})
```

All usage commands proxy to the Gateway — responses match the Gateway's format.
