# JARVIS-OPENCLAW-DATA-OWNERSHIP.md

Purpose: decide **what OpenClaw already stores** vs **what Jarvis must store itself or derive elsewhere**.

This is the input to database planning.

---

## Summary

OpenClaw already stores a lot of **runtime/system state**:
- agent workspaces and bootstrap files
- session metadata and transcripts
- session compaction/checkpoints
- config
- cron jobs
- approval policy/state
- pairing / allow-from style identity state
- memory as files in the workspace

OpenClaw does **not** natively own Jarvis product entities like:
- projects
- topics
- inbox
- unread model across product surfaces
- connection profiles as a Jarvis UX concept
- file browser metadata/product annotations
- git annotations / project-topic linkage
- unified cross-surface activity model

So Jarvis should treat OpenClaw as the owner of **agent runtime + session/config execution state**, not as the owner of the full Jarvis product model.

---

## ✅ Data OpenClaw already stores

## 1. Agent workspace files

OpenClaw manages agent workspaces and known files like:
- `AGENTS.md`
- `SOUL.md`
- `TOOLS.md`
- `USER.md`
- `HEARTBEAT.md`
- `BOOTSTRAP.md`
- `MEMORY.md` / alternate memory file

Meaning:
- memory content is already durably stored as files
- agent identity/bootstrap state already exists
- Jarvis does **not** need its own DB just to store these raw documents

But:
- Jarvis may still need metadata/indexing/search over them

---

## 2. Session store

OpenClaw already stores session-level durable state, including:
- session keys / ids
- labels / display names
- channel/source metadata
- parent/child session relationships
- spawned/forked metadata
- model/provider used
- reasoning / verbosity / elevated settings
- token usage / estimated cost
- status, start/end timestamps, runtime
- delivery metadata
- compaction counters/checkpoints

Meaning:
- Jarvis should not create its own replacement store for raw OpenClaw sessions
- Jarvis should reference OpenClaw sessions by key

---

## 3. Session transcripts / messages

OpenClaw already stores and reads session messages/transcripts.
That includes:
- conversation history
- tool-call history tied to sessions
- compaction summaries/checkpoints
- preview/history data derived from transcript files

Meaning:
- chat history is already OpenClaw-owned
- Jarvis should not duplicate raw transcript storage unless needed for search/indexing/cache

---

## 4. Config

OpenClaw already stores durable config state via its config file, including:
- gateway config
- model config
- plugin/tool config
- approvals config
- runtime defaults
- agent defaults

Meaning:
- global/system config is already owned by OpenClaw
- Jarvis should call config APIs instead of inventing parallel storage for the same settings

---

## 5. Cron jobs

OpenClaw already stores cron definitions durably in its cron store.
That includes:
- jobs
- schedules
- job payload/config
- backups of cron store

Meaning:
- cron definitions are already OpenClaw-owned
- Jarvis should treat cron as an external owned resource

---

## 6. Approval state and approval policy

OpenClaw already stores approval-related state, including:
- exec approval defaults
- per-agent approval rules / allowlists
- approval socket/token config
- plugin approval request/resolution flow

Meaning:
- Jarvis should not create another approval policy source of truth
- Jarvis can present/aggregate this, but OpenClaw owns it

---

## 7. Pairing / allow-from identity state

OpenClaw already stores channel pairing / allow-from style authorization state.

Meaning:
- user/channel authorization state for OpenClaw access already exists
- Jarvis should not duplicate this unless it has a separate product auth layer

---

## 8. Agent registry / agent definitions

OpenClaw already stores agent definitions/config entries, including:
- known agent ids
- workspace linkage
- identity/bootstrap file access
- agent config entries

Meaning:
- OpenClaw owns agent runtime identity/config
- Jarvis can select/filter/present agents, but should not redefine them as a separate source of truth

---

## 9. Memory as filesystem content

OpenClaw already works with memory files in workspaces.

Meaning:
- raw memory docs themselves do not need a Jarvis DB
- what Jarvis may need is only:
  - index/search
  - tagging/metadata
  - cross-project scoping

---

## 10. Runtime/live execution state

OpenClaw already owns live runtime state for:
- chat execution
- active sessions
- subagent/session relationships
- model usage data
- approval events
- streaming events

Meaning:
- Jarvis should derive this from OpenClaw, not persist a second authoritative runtime system

---

## ❌ Data OpenClaw does not natively store as first-class product entities

## 1. Projects

OpenClaw does not appear to have a first-class Jarvis-style project model with:
- project id
- display name
- project grouping rules
- pinned repo/workspace association
- project-level nav state
- project-level unread/inbox state

Decision:
- **Jarvis-owned**

---

## 2. Topics

OpenClaw has sessions, but not a first-class product topic model with:
- topic entity
- topic ordering/pinning
- topic unread state
- project-topic navigation
- topic lifecycle independent from sessions

Decision:
- **Jarvis-owned**

---

## 3. Connection profiles as a Jarvis UX entity

OpenClaw has config and gateway connection behavior, but not necessarily Jarvis product profiles like:
- saved targets list
- preferred local vs remote modes
- recent environments
- environment chooser UX metadata

Decision:
- **Jarvis-owned**

---

## 4. Unified inbox / notifications model

OpenClaw emits events and has approvals/runtime state, but not a full Jarvis inbox entity with:
- normalized inbox item ids
- read/unread/archive state across all product events
- notification preferences by project/topic

Decision:
- **Jarvis-owned**

---

## 5. Unified activity feed across all surfaces

OpenClaw has session/runtime events, but not necessarily a durable Jarvis product feed combining:
- chat
- cron
- git
- file changes
- terminal
- project/topic context

Decision:
- likely **Jarvis-owned aggregation**
- maybe partly derived, maybe partly persisted

---

## 6. Session-to-project/topic mapping

OpenClaw stores sessions, but not Jarvis product mapping like:
- session belongs to project X
- session belongs to topic Y
- pin/hide/board placement inside Jarvis product UI

Decision:
- **Jarvis-owned**

---

## 7. File browser product state

OpenClaw does not provide a first-class generic product file browser model with:
- open tabs
- pinned files
- file favorites
- project-specific recent files
- per-file Jarvis annotations

Decision:
- mostly **Jarvis-owned** or local-client-owned

Note:
- raw files are filesystem-owned, not DB-owned

---

## 8. Git product metadata

OpenClaw does not appear to own Jarvis-specific git product metadata like:
- project/topic-linked annotations on commits if needed later
- review state linked to branch
- annotations on diffs/commits
- product-level repo cards/history views

Decision:
- raw git data is **derived from git**
- Jarvis annotations are **Jarvis-owned**

---

## 9. Terminal product metadata

OpenClaw is not the first-class owner of terminal-as-a-product data like:
- saved terminal tabs/workspaces in Jarvis
- terminal linked to project/topic
- terminal layout preferences

Decision:
- runtime terminal process may be system-owned
- product metadata is **Jarvis-owned**

---

## 10. Memory index / semantic search index

OpenClaw stores memory files, but not a clear first-class gateway-native persistent semantic memory index for Jarvis product use.

Decision:
- raw memory docs = OpenClaw/filesystem-owned
- semantic index / search metadata = **Jarvis-owned** if needed

---

## 11. Bootstrap/install history as a Jarvis product feature

OpenClaw can perform/configure setup-related behavior, but a full Jarvis install/setup history model is not a native product entity.

Decision:
- if Jarvis wants historical setup runs, validations, retry history: **Jarvis-owned**

---

## Practical ownership split

## OpenClaw should remain source of truth for
- agents
- agent workspace bootstrap files
- raw memory files
- sessions
- transcripts/messages
- compaction/checkpoints
- config
- cron jobs
- approval state/policy
- pairing/allow-from auth state
- live runtime/streaming/session execution state

## Jarvis should own
- projects
- topics
- session/project/topic mappings
- connection profiles
- inbox/notifications
- unread model
- activity aggregation model
- file browser product metadata
- git annotations / project-topic linkage
- terminal product metadata
- memory indexing/search metadata
- setup/bootstrap history if productized

## Jarvis should derive, not store first, for
- raw file contents
- raw git status/log/diff
- raw terminal output
- raw OpenClaw chat history
- raw model list
- raw runtime session state

---

## Recommendation before DB schema

Use this rule:

### Put in Jarvis DB only if at least one is true
- it is a Jarvis-native product entity
- it must persist independently of OpenClaw runtime
- it adds metadata OpenClaw/system/git do not own
- it needs cross-device/product sync
- it needs read/unread/order/pinning/history semantics owned by Jarvis

### Do not put in Jarvis DB if
- OpenClaw is already the clear source of truth
- filesystem/git/system is already the source of truth
- it is transient UI state
- it can be derived cheaply on demand

---

## Immediate next step

Now that ownership is clearer, the next document should be:
- `JARVIS-DATA-CLASSIFICATION.md`

That doc should classify every feature into:
1. OpenClaw-owned
2. Jarvis-DB-owned
3. System/git/files-derived
4. UI-local only
