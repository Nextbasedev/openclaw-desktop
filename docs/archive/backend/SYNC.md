# SYNC.md

Scope: document the backend/middleware contract for Jarvis multi-device sync APIs.

Source of truth:
- `packages/desktop/src-tauri/src/middleware.rs`
- local SQLite `sync_dirty` columns and `sync_tombstones` table
- sync state file (`.jarvis-sync.json` for local mode, Gateway `agents.files` for remote mode)

Current Tauri commands:
- `middleware_sync_full`
- `middleware_sync_status`
- `middleware_sync_enable`
- `middleware_sync_devices`

## Overview

Jarvis stores projects, topics, session mappings, and branches in a local SQLite database per installation. When two desktops connect to the same OpenClaw Gateway, they have isolated local state. The sync system bridges this gap using a dual-path approach.

## Sync architecture

### Dual-path I/O

- **Local mode** (same machine as Gateway): reads/writes `.jarvis-sync.json` directly in the workspace root via filesystem I/O
- **Remote mode** (different machine): creates a `jarvis-sync` agent via the Gateway WebSocket API and stores sync state in the agent's `memory.md` file (JSON wrapped in markdown code fence)

### Conflict resolution

Last-Writer-Wins (LWW) using `updatedAt` timestamps per entity. The most recent timestamp wins on conflicts.

### Tombstones

Deletes are tracked in the `sync_tombstones` SQLite table with a 30-day TTL. A tombstone newer than an entity's `updatedAt` causes the entity to be deleted on sync.

### Dirty tracking

All syncable tables have a `sync_dirty INTEGER NOT NULL DEFAULT 1` column. New rows default to dirty. Mutations set `sync_dirty = 1`. After a successful sync cycle, all dirty flags are cleared.

## `middleware_sync_enable`

### Input
```json
{
  "enabled": true,
  "deviceName": "My Laptop"
}
```

`deviceName` is optional. Falls back to the `HOSTNAME` environment variable.

### Behavior
- When enabling: generates a unique device ID (stored in `app_settings`), stores device name
- When disabling: sets `sync.enabled` to `"false"` in app settings
- Does not delete existing sync state or device ID

### Output
```json
{ "ok": true }
```

## `middleware_sync_status`

### Input
No input required (empty object or omitted).

### Behavior
- Reads sync settings from `app_settings` table
- Counts dirty entities across all 4 tables

### Output
```json
{
  "enabled": true,
  "deviceId": "device_abc123",
  "deviceName": "My Laptop",
  "lastSyncAt": "2026-04-17T21:00:00Z",
  "dirtyCount": 3
}
```

`deviceId`, `deviceName`, and `lastSyncAt` are `null` when sync has never been enabled.

## `middleware_sync_full`

### Input
```json
{
  "profileId": "profile_abc123"
}
```

### Behavior

Full bidirectional sync cycle:

1. Reads profile to determine mode (local/remote) and workspace root
2. Snapshots all dirty local entities
3. Reads remote sync state (from filesystem or Gateway agents.files)
4. Merges local + remote using LWW
5. Applies pulled changes to local SQLite (upserts + tombstone deletes)
6. Writes merged state back to remote
7. Clears `sync_dirty` flags on all entities
8. Prunes expired tombstones

### Output
```json
{
  "ok": true,
  "pulled": 5,
  "pushed": 3,
  "conflicts": 0
}
```

### Error cases
- Sync not enabled: returns error string
- Profile not found: returns error string
- Gateway unreachable (remote mode): returns error string

## `middleware_sync_devices`

### Input
```json
{
  "profileId": "profile_abc123"
}
```

### Behavior
- Reads the remote sync state file
- Extracts unique device IDs from the `lastWriter` field and all entity `updatedBy` fields

### Output
```json
{
  "devices": [
    {
      "deviceId": "device_abc123",
      "deviceName": "My Laptop",
      "lastSeen": "2026-04-17T21:00:00Z"
    },
    {
      "deviceId": "device_def456",
      "deviceName": "My Desktop",
      "lastSeen": "2026-04-17T20:30:00Z"
    }
  ]
}
```

## Sync state schema

The sync state file has this structure:

```json
{
  "schemaVersion": 1,
  "lastWriter": {
    "deviceId": "device_abc123",
    "deviceName": "My Laptop",
    "writtenAt": "2026-04-17T21:00:00Z"
  },
  "projects": { "<id>": { "id": "...", "name": "...", "profileId": "...", "workspaceRoot": "...", "repoRoot": null, "archived": false, "updatedAt": "...", "updatedBy": "device_abc123" } },
  "topics": { "<id>": { "id": "...", "projectId": "...", "name": "...", "archived": false, "sortOrder": 0, "updatedAt": "...", "updatedBy": "device_abc123" } },
  "sessionMappings": { "<key>": { "sessionKey": "...", "sessionId": null, "projectId": "...", "topicId": "...", "agentId": "main", "label": "...", "status": "idle", "pinned": false, "hidden": false, "source": "jarvis", "updatedAt": "...", "updatedBy": "device_abc123" } },
  "branches": { "<key>": { "id": "...", "sourceSessionKey": "...", "sourceMessageId": "...", "branchSessionKey": "...", "branchTopicId": null, "branchReason": null, "createdAt": "...", "updatedAt": "...", "updatedBy": "device_abc123" } },
  "tombstones": [
    { "entityType": "session_mapping", "entityId": "...", "deletedAt": "...", "deletedBy": "device_abc123", "expiresAt": "..." }
  ]
}
```

## What is NOT synced

- **Profiles**: contain machine-specific paths, gateway URLs, tokens
- **Terminal sessions**: runtime-only, machine-specific
- **Unread counts**: local UI state, not meaningful across devices

## TypeScript contracts

Defined in `packages/shared/src/api/sync.ts`:
- `syncStatusSchema` / `SyncStatus`
- `syncResultSchema` / `SyncResult`
- `syncDeviceSchema` / `SyncDevice`
- `syncEnableRequestSchema` / `SyncEnableRequest`
- `syncFullRequestSchema` / `SyncFullRequest`
- `syncDevicesRequestSchema` / `SyncDevicesRequest`
- `syncDevicesResponseSchema` / `SyncDevicesResponse`

Registered in `registry.ts` under operation IDs:
- `sync.full`
- `sync.status`
- `sync.enable`
- `sync.devices`
