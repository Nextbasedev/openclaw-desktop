# Jarvis Sync PRD

## Goal
Keep Jarvis sidebar state consistent across devices through OpenClaw Gateway sessions while preserving local-only runtime data.

Sync must be reliable for:
- projects
- topics
- chats
- chat/session placement inside projects/topics
- delete/archive/pin/rename/reorder metadata

## Non-goals
- Full message history sync beyond the Gateway session itself
- Git workspace/repo path sync as authoritative remote state
- Real-time collaborative editing with merge UI
- Syncing secrets, local filesystem paths, or device-specific config

## Source of Truth
Local SQLite is the working source of truth. Gateway sessions are the transport/remote snapshot layer.

Each synced entity emits a compact JSON payload hidden inside Gateway session labels:
- project/topic anchor sessions use sentinel-only labels
- chat sessions use visible chat name + sentinel + payload

## Entities

### Project
Fields synced:
- id
- name
- archived
- pinned
- sortOrderKey
- updatedAt
- updatedBy
- deletedAt

Local-only fields:
- profile_id
- workspace_root
- repo_root
- unread_count
- repo metadata

### Topic
Fields synced:
- id
- projectId
- name
- archived
- sortOrderKey
- updatedAt
- updatedBy
- deletedAt

### Chat
Fields synced:
- id
- sessionKey
- projectId
- topicId
- name
- agentId
- archived
- pinned
- sortOrderKey
- lastActiveAt
- updatedAt
- updatedBy
- deletedAt

## Core Flows

### Create / rename / pin / archive
1. Local DB changes.
2. Row is marked dirty.
3. Outbox upsert is enqueued.
4. Sync engine pushes payload to Gateway.
5. On success, outbox item is removed and local dirty flag is cleared.

### Move chat between topic/project
1. `session_mappings` update changes topic/project placement.
2. Owning chat must be enqueued for upsert.
3. Push payload includes the new `topicId`/`projectId`.

### Delete
1. Capture enough remote identity before local deletion.
2. Record tombstone.
3. Enqueue delete task with preserved session/anchor key.
4. Push deletes corresponding Gateway session.
5. Tombstone prevents stale remote payload from resurrecting deleted local row.

### Pull
1. List all Gateway sessions containing sync payloads.
2. Decode and validate payload schema.
3. Ignore stale payloads older than local row or tombstone.
4. Apply newer payloads locally with `sync_dirty = 0`.
5. Remember anchor mappings.

## Conflict Rules
- Primary rule: latest `updatedAt` wins.
- Equal timestamp: ignore remote to avoid oscillation.
- Tombstone wins over older remote payloads.
- Future improvement: device tie-break using `updatedBy` for exact timestamp collisions.

## Edge Cases Required
- Offline gateway: outbox retries with exponential backoff.
- Gateway reconnect: immediately push and pull.
- Delete after local row removal must still delete remote session.
- Topic delete must detach/move chats predictably and sync affected chats.
- Project delete must remove project/topic/chat remote anchors/sessions.
- More than one device editing same entity: newest update wins.
- Pulling remote delete must not leave dangling topic/session mappings.
- Pulling chat with missing project should not crash; either create placeholder project or skip safely.
- Pull limit must not silently miss sessions where pagination/limits exist.
- Dirty count should mean unsynced local changes, not historical pushed rows.
- Bad/corrupt labels should be skipped without breaking pull.

## API/Test Checklist
- `syncStatus` dirty counts before/after enqueue/push.
- outbox retry after failure.
- project upsert push clears dirty.
- topic upsert push clears dirty.
- chat upsert push clears dirty.
- chat delete deletes remote even after local row is gone.
- topic attach/detach enqueues chat sync.
- pull newer project/topic/chat applies locally.
- pull stale payload is ignored.
- pull delete does not resurrect tombstoned rows.
- corrupt label is skipped.
