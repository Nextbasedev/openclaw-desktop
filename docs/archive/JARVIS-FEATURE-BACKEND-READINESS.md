# Jarvis Feature → OpenClaw Backend Readiness

Scope: **Jarvis docs only**.

Sources used:
- `Jarvis/docs/ARCHITECTURE.md`
- `Jarvis/docs/GATEWAY-PROTOCOL.md`
- `Jarvis/docs/DECISIONS.md`
- `Jarvis/docs/QUALITY.md`
- `Jarvis/docs/journal/DAY-0-FOUNDATION.md`
- `Jarvis/docs/designs/screens/*`
- backend reference: `Jarvis/.openclaw-src/src/gateway/*`

Important framing:
- Jarvis frontend is **not implemented yet**. `QUALITY.md` marks every domain as **F / Not started**.
- So this report does **not** audit current UI code.
- It audits the **planned frontend feature surface from Jarvis docs/designs**, then checks whether OpenClaw backend is ready for each planned feature.

## Status legend
- **READY** = backend support already exists and Jarvis can wire it directly
- **PARTIAL** = backend exists but does not cover the full planned feature cleanly
- **NOT READY** = backend support is missing for the feature as specified

## Feature Mapping

| Frontend Feature | Spec / Design Source | Backend Ready? | Backend Method(s) / Backend Area | Status Detail | Effort |
|---------|---------|---------|---------|---------|---------|
| Gateway connection manager | `ARCHITECTURE.md` (`Settings`, `Install`, `AuthProvider`, `WebSocketProvider`), `GATEWAY-PROTOCOL.md` | READY | Gateway WS handshake / `connect` flow | OpenClaw already supports authenticated WebSocket control-plane connection with token auth and feature negotiation. | Small |
| Chat send | `ARCHITECTURE.md` (`Chat Domain`), `GATEWAY-PROTOCOL.md` | READY | `chat.send` | Core chat prompt sending is already implemented server-side. | Small |
| Chat history loading | `ARCHITECTURE.md` (`Chat Domain`), `GATEWAY-PROTOCOL.md` | READY | `chat.history` | Transcript-backed chat history is already implemented. | Small |
| Abort generation / interrupt | `ARCHITECTURE.md` (`Interrupt & merge`), `GATEWAY-PROTOCOL.md` | READY | `chat.abort`, `sessions.abort` | Backend supports aborting active runs. | Small |
| Streaming chat responses | `ARCHITECTURE.md` (`Real-time messaging`, `streaming responses`), `GATEWAY-PROTOCOL.md` | READY | `chat` push events | Gateway already streams delta/final chat events over WS. | Small |
| Session list | `ARCHITECTURE.md` (`Sidebar`, `Chat`, multi-agent switching), `GATEWAY-PROTOCOL.md` | READY | `sessions.list` | Backend supports rich session listing and filtering. | Small |
| Session creation | `ARCHITECTURE.md` (`Chat`, `Sidebar`), `GATEWAY-PROTOCOL.md` | READY | `sessions.create` | Backend supports creating sessions directly. | Small |
| Session patching (model, thinking, elevated level, etc.) | `ARCHITECTURE.md` (`Settings`, `Intervention`, agent/session control), `GATEWAY-PROTOCOL.md` | READY | `sessions.patch` | Backend supports updating session settings such as model and exec-related fields. | Medium |
| Session reset / delete / compaction | `ARCHITECTURE.md` (chat/session lifecycle implied), `GATEWAY-PROTOCOL.md` | READY | `sessions.reset`, `sessions.delete`, `sessions.compact`, compaction APIs | Backend already has lifecycle and compaction operations. | Medium |
| Session event subscription | `ARCHITECTURE.md` (`Runtime`, `Sub-Agent Events`), `GATEWAY-PROTOCOL.md` | READY | `sessions.messages.subscribe`, `sessions.messages.unsubscribe` | Backend has explicit per-session message subscription support. | Small |
| Model picker | `ARCHITECTURE.md` (`Chat`, `Settings`), `GATEWAY-PROTOCOL.md` | READY | `models.list` | Backend already exposes available models. | Small |
| Cron jobs manager | `ARCHITECTURE.md` (`Cron Domain`), `GATEWAY-PROTOCOL.md` | READY | `cron.list`, `cron.add`, `cron.remove`, `cron.run`, `cron.status`, `cron.runs` | Planned cron UI is well-covered by backend APIs. | Medium |
| Skills browser / install / manage | `ARCHITECTURE.md` (`Skills Domain`), `GATEWAY-PROTOCOL.md` | READY | `skills.status`, `skills.search`, `skills.detail`, `skills.install`, `skills.update`, `skills.bins` | Backend already has the main skills management surface Jarvis needs. | Medium |
| Config editor | `ARCHITECTURE.md` (`Settings Domain`), `GATEWAY-PROTOCOL.md` | READY | `config.get`, `config.set`, `config.patch`, `config.apply`, `config.schema`, `config.schema.lookup` | Backend support is strong for a config editor with validation/schema-driven UI. | Medium |
| Connection settings (Gateway URL + token) | `ARCHITECTURE.md` (`Settings`, `Install`) | PARTIAL | Gateway connect auth exists, but no dedicated multi-profile API | For both **local** and **remote** users, connecting to an already-running Gateway is ready. What is missing is a first-class backend model for saved connection profiles, environment labels, and switching between multiple local/remote targets. This can still be handled client-side. | Small |
| Activity feed | `ARCHITECTURE.md` (`Observability Domain`), designs `chat-mission.png`, `sidebar.png` | PARTIAL | `logs.tail`, WS session/chat/tool events, `usage.status` | Backend has raw ingredients, but no single normalized `activity.feed` API for a polished observability timeline. | Medium |
| Live tool-call stream | `ARCHITECTURE.md` (`Observability Domain`, `tool calls streaming`) | PARTIAL | chat/session/agent events, approval/event streams | Backend emits events, but there is no documented single high-level “live tool feed” contract. Needs composition from lower-level events. | Medium |
| Sub-agent tree view | `ARCHITECTURE.md` (`Observability`, `Sub-agent tree view`) | PARTIAL | session metadata + child session data in session rows/events | Backend clearly understands parent/child session relationships, but there is no dedicated tree/query API specifically for sub-agent visualization. | Medium |
| Context window inspector | `ARCHITECTURE.md` (`Observability`, `token usage, what agent sees`) | PARTIAL | `usage.status`, `usage.cost`, `sessions.usage`, session row token/context fields | Token usage is available, but “what the agent sees” / full context inspector is not exposed as a first-class backend feature. | Medium |
| Running processes panel | `ARCHITECTURE.md` (`Observability`) | PARTIAL | session status, exec approval flows, logs | Backend exposes enough signals to infer active work, but no dedicated `processes.list` backend surface was found. | Medium |
| Approve / deny tool calls | `ARCHITECTURE.md` (`Intervention Domain`) | READY | `exec.approval.*`, `plugin.approval.*` | Approval workflows are already implemented backend-side. | Medium |
| Autonomy level selector | `ARCHITECTURE.md` (`Intervention Domain`) | PARTIAL | `sessions.patch` with `elevatedLevel`, related session fields | Some autonomy-related controls can be mapped onto existing session settings, but there is no dedicated high-level autonomy policy API. | Medium |
| Pause / resume agent execution | `ARCHITECTURE.md` (`Intervention Domain`) | NOT READY | none found | I found abort and approval controls, but no first-class pause/resume execution API in gateway methods. | Large |
| Kill running tasks / sub-agents | `ARCHITECTURE.md` (`Intervention Domain`) | PARTIAL | `sessions.abort`, `sessions.delete` | Backend can abort/delete sessions, but there is no clear dedicated “kill process/sub-agent tree” API for the richer intervention UX described. | Medium |
| File tree browser for workspace | `ARCHITECTURE.md` (`FileManager Domain`), designs `file-manager.png` | PARTIAL | `agents.files.list`, `agents.files.get`, `agents.files.set` | Backend only supports a restricted agent-workspace file set, not a generic workspace tree/file-browser API. | Large |
| File viewer | `ARCHITECTURE.md` (`FileManager Domain`) | PARTIAL | `agents.files.get` | Works only for limited allowed files, not arbitrary workspace files. | Medium |
| File editor | `ARCHITECTURE.md` (`FileManager Domain`) | PARTIAL | `agents.files.set` | Same limitation as above, restricted file set only. | Medium |
| Diff view for agent changes | `ARCHITECTURE.md` (`FileManager Domain`) | NOT READY | none found | No dedicated backend diff/history API for changed files was found in gateway methods. | Medium |
| Terminal / PTY shell | `ARCHITECTURE.md` (`Terminal Domain`) | NOT READY | none found in gateway method list | No first-class `terminal.*` or PTY gateway API surfaced in `server-methods-list.ts`. | Large |
| Multiple terminal tabs | `ARCHITECTURE.md` (`Terminal Domain`) | NOT READY | none found | Depends on a missing terminal backend surface. | Large |
| Split view alongside chat | `ARCHITECTURE.md` (`Terminal`, `Sidebar`) | PARTIAL | backend not required for layout, but terminal backend missing | UI layout itself is client-side, but the terminal half of the feature is blocked by missing backend PTY support. | Medium |
| Memory file view/edit | `ARCHITECTURE.md` (`Memory Domain`) | PARTIAL | doctor memory endpoints, session/memory-related backend pieces | There are some memory-related endpoints, but no clean full `memory.*` API family for file browse/edit flows. | Medium |
| Semantic memory search | `ARCHITECTURE.md` (`Memory Domain`) | NOT READY | no clear gateway `memory.search` API found | Jarvis spec asks for semantic search, but I did not find a first-class gateway memory-search API in the audited backend methods. | Large |
| Memory management settings | `ARCHITECTURE.md` (`Memory Domain`) | PARTIAL | limited doctor/config surfaces | Some adjacent config/doctor capabilities exist, but not a complete memory-settings product surface. | Medium |
| Theme switching | `ARCHITECTURE.md` (`ThemeProvider`, `Settings`), `DECISIONS.md` (dark + light themes) | NOT READY | no dedicated backend API required or found | This is mainly a client feature. If you want it backend-backed/synced, there is no dedicated backend theme API. | Small |
| Navigation state (active project/topic/agent) | `ARCHITECTURE.md` (`NavigationProvider`, `Sidebar`) | PARTIAL | sessions/agents exist, projects/topics do not | Agent/session state is supported, but project/topic as first-class entities are missing. | Medium |
| Project navigation | `ARCHITECTURE.md` (`Sidebar`, “Arc-style project/topic navigation”), designs `sidebar.png` | NOT READY | no `projects.*` API family found | Backend has no first-class projects model or project CRUD/list APIs. | Large |
| Topic navigation | `ARCHITECTURE.md` (`Sidebar`, project/topic navigation) | PARTIAL | topic-like session/thread handling only | Backend can carry thread/topic-like session IDs, but there is no first-class `topics.*` API for list/create/manage flows. | Large |
| Agent list with status indicators | `ARCHITECTURE.md` (`Sidebar`) | READY | `agents.list`, session status metadata | Backend already exposes agent listing and enough session status data for indicators. | Medium |
| Multi-agent switching | `ARCHITECTURE.md` (`Sidebar`) | READY | `agents.list`, `sessions.list`, `sessions.create`, `sessions.patch` | Existing session+agent APIs are enough to support multi-agent switching. | Medium |
| Notifications inbox | `ARCHITECTURE.md` (`Notifications Domain`) | NOT READY | no dedicated notifications API found | No unified backend inbox/notification namespace was found. | Medium |
| Unread indicators | `ARCHITECTURE.md` (`Notifications Domain`) | PARTIAL | can be inferred from events/session state | Possible to synthesize from event/session activity, but no first-class unread model exists. | Medium |
| Desktop notifications | `ARCHITECTURE.md` (`Notifications Domain`, Tauri shell) | PARTIAL | mostly local/Tauri feature, backend event sources exist | Backend can provide events to trigger notifications, but the notification delivery surface itself is local shell work, not a dedicated backend feature. | Small |
| SQLite local cache | `ARCHITECTURE.md` (`Shell`), `DECISIONS.md` | READY | local Tauri shell responsibility, backend compatible | Backend session/chat model is compatible with local caching. No backend blocker. | Small |
| System keychain token storage | `ARCHITECTURE.md` (`Shell`), `DECISIONS.md` | READY | local Tauri shell responsibility | This is a local desktop concern, not blocked by backend. | Small |
| Auto-updater | `ARCHITECTURE.md` (`Shell`) | NOT READY | not a gateway backend feature | This is outside the OpenClaw gateway backend surface. | Medium |
| URL scheme handler (`openclaw://`) | `ARCHITECTURE.md` (`Shell`) | NOT READY | local shell feature | Also outside gateway backend scope. | Small |
| First-run onboarding wizard | `ARCHITECTURE.md` (`Install Domain`), design `onboarding.png` | PARTIAL | backend connect/config methods available; install/provisioning differs by local vs remote mode | For a **local** user, onboarding can connect to a locally running Gateway with little backend help. For a **remote** user, onboarding can also connect once a remote Gateway already exists. But installation/provisioning orchestration is not a complete backend product surface yet, so the full wizard remains only partially covered. | Medium |
| OpenClaw detection and auto-install | `ARCHITECTURE.md` (`Install Domain`) | NOT READY | no gateway backend method family for local install orchestration | For **local mode**, automatic detection/install of OpenClaw is mainly a desktop shell concern and is not provided by gateway backend. For **remote mode**, this becomes remote provisioning/bootstrap, which also is not provided as a first-class backend API family here. | Large |
| Remote host connection setup | `ARCHITECTURE.md`, design `onboarding.png` | PARTIAL | gateway connection supported, remote provisioning not first-class | Important distinction: if the remote server already has OpenClaw running, backend is effectively ready because Jarvis only needs to connect. If Jarvis is expected to help set up/provision that remote host from scratch, backend is only partial because there is no first-class remote bootstrap/provisioning API. | Medium |

## What is clearly backend-ready for Jarvis right now

- Gateway connection and auth
- Core chat
- Streaming responses
- Sessions
- Models list
- Cron management
- Skills management
- Config editor
- Approval workflows
- Agent listing / multi-agent switching

## What is only partially covered by backend

- Observability views
- File manager
- Memory
- Topic navigation
- Connection profiles
- Running process views
- Kill/sub-agent control UX
- Onboarding/setup flows

## What is actually missing on backend for the planned Jarvis product

- Projects as a first-class entity
- Topics as a first-class managed entity
- Pause/resume execution API
- Terminal / PTY API
- Generic workspace file browser API
- Diff/history API for file changes
- Semantic memory search API (as a gateway-native desktop feature)
- Notifications inbox API

## Recommended split: keep in OpenClaw vs add in Jarvis middleware

### Keep in OpenClaw as-is

These are already solid runtime primitives and Jarvis should consume them directly:

- Gateway connection/auth handshake
- `chat.send`, `chat.history`, `chat.abort`
- streaming chat/session events
- `sessions.list`, `sessions.create`, `sessions.patch`, `sessions.reset`, `sessions.delete`, compaction flows
- `models.list`
- cron APIs
- skills APIs
- config/schema APIs
- approval APIs
- `agents.list`

### Build in Jarvis middleware

These should be treated as **Jarvis-owned product capabilities** rather than OpenClaw core changes:

- **Projects**
  - map sessions, agents, files, and git state into a product-level project model
- **Topics**
  - create a Jarvis-managed topic model on top of session/thread flows
- **Connection profiles**
  - saved local/remote targets, labels, defaults, health state, last-used state
- **Activity feed aggregation**
  - merge logs, chat/tool events, approvals, cron runs, git changes, and agent state into one UI-friendly stream
- **Sub-agent tree shaping**
  - transform raw parent/child session signals into a stable tree/query model for the frontend
- **Unread / notification inbox model**
  - maintain read state, unread counts, inbox grouping, notification routing
- **Sidebar/navigation composition**
  - return UI-ready project/topic/agent navigation payloads instead of forcing frontend stitching
- **Local vs remote environment abstraction**
  - present both modes through one Jarvis API contract
- **Terminal bridge**
  - use system/host access in middleware instead of requiring OpenClaw `terminal.*`
- **Workspace file access proxy**
  - use local/remote filesystem access through middleware instead of OpenClaw generic file APIs
- **Git integration**
  - diff/history/branch state should come from middleware git access, not new OpenClaw diff primitives
- **Resume-by-context strategy**
  - use stop + reconstructed context instead of requiring true runtime pause/resume in OpenClaw
- **Observability composition layer**
  - normalize OpenClaw low-level signals into stable Jarvis domain events

### Missing capabilities Jarvis still needs to build

These are not arguments for changing OpenClaw first. They are the actual capabilities Jarvis must implement in middleware/shell/runtime to fulfill the product:

- **Project registry and project metadata model**
- **Topic registry and topic-to-session mapping**
- **Saved connection/profile store**
- **Unified activity/event pipeline**
- **Sub-agent tree/query model**
- **Notification inbox and unread state model**
- **Terminal session manager**
- **Filesystem proxy for local + remote workspaces**
- **Git status/diff/history adapter**
- **Context reconstruction flow for stop/resume UX**
- **Remote environment bootstrap orchestration** when the server is not already running OpenClaw
- **Memory indexing/search layer** if semantic memory is part of the shipped product
- **UI-facing navigation/query APIs** so frontend reads one clean Jarvis surface instead of many raw OpenClaw methods

### OpenClaw changes not required right now

Given current decisions, these do **not** need to be added to OpenClaw first:

- Terminal / PTY API
- Generic workspace file browser API
- Pause/resume execution API
- File diff/history primitives
- Higher-level observability feed API

Jarvis can own these through middleware/system access/god-object composition without blocking on upstream changes.

## Build order for the 3-day full product push

1. **Jarvis middleware foundation**
   - connection profiles
   - local/remote abstraction
   - project model
   - topic model

2. **Jarvis core orchestration layer**
   - navigation composition
   - session-to-project/topic mapping

3. **Jarvis system integrations**
   - terminal bridge
   - filesystem proxy
   - git integration
   - remote bootstrap/setup orchestration

4. **Jarvis observability + inbox**
   - unified activity feed
   - sub-agent tree shaping
   - unread/notification model

5. **Jarvis advanced memory/resume UX**
   - memory indexing/search
   - stop/resume-by-context flow
   - richer context inspector

## Final takeaway

From **Jarvis docs only**, OpenClaw backend is already strong enough to provide the execution/runtime core for Jarvis:
- chat
- sessions
- model selection
- skills
- cron
- config/settings editor
- approval controls
- core multi-agent flows

For the actual Jarvis product, the main work is now **not "change OpenClaw first"**.
It is:
- **build the Jarvis middleware layer**
- **build the local/remote system integrations**
- **compose OpenClaw primitives into Jarvis product concepts**

So the real missing capabilities are mostly **Jarvis-owned capabilities**, not immediate OpenClaw blockers.
