# JARVIS-DATA-CLASSIFICATION.md

Purpose: classify Jarvis feature data into:
1. **OpenClaw-owned**
2. **Closed / not now**
3. **Jarvis must store**
4. **Derived, not stored first**

Keep this practical. This is for DB planning, not theory.

---

## 1. OpenClaw-owned

Jarvis should reference these, not create a second source of truth.

### Runtime / session
- sessions
- session metadata
- chat history / transcripts
- tool-call history tied to sessions
- sub-agent/session parent-child runtime state
- compaction/checkpoints
- model/provider used per session
- session token/cost/runtime stats

### Agent / config
- agents
- agent workspace/bootstrap files
- config
- approvals policy/state
- pairing/auth state
- cron jobs
- skills state
- model list

### Memory raw content
- raw memory files
- workspace memory documents

Decision:
- **do not DB these again in Jarvis**
- store references only when needed

---

## 2. Closed / not now

These are intentionally out of the current DB scope.

- missions / mission steps / mission timelines
- mission-to-session links
- mission-to-git links
- mission unread / mission notifications
- deep notification rule engine
- full IDE-style file metadata system
- advanced semantic memory product model beyond basic indexing need
- full terminal persistence model if not implemented yet
- overly complex layout customization model
- anything built only for hypothetical future workflows

Decision:
- **do not design DB tables for these now**

---

## 3. Jarvis must store

These are the main candidates for the Jarvis DB.

### A. Connection profiles
Store:
- `id`
- `name`
- `mode` (local/remote)
- `gateway_url`
- `workspace_root`
- `auth reference` or secure token reference
- `is_default`
- `last_used_at`
- `last_status`
- `capability_snapshot`

Why:
- this is Jarvis product state
- not owned by OpenClaw as a UX model

### B. Projects
Store:
- `id`
- `name`
- `profile_id`
- `workspace_root`
- `repo_root`
- `archived`
- `created_at`
- `updated_at`
- optional display metadata

Why:
- first-class Jarvis product concept

### C. Topics
Store:
- `id`
- `project_id`
- `name`
- `archived`
- `sort_order`
- `created_at`
- `updated_at`

Why:
- first-class Jarvis organization layer

### D. Session mapping
Store:
- `id`
- `project_id`
- `topic_id`
- `session_key`
- `pinned`
- `hidden`
- `last_seen_at`

Why:
- OpenClaw owns sessions, but Jarvis owns where they appear in product structure

### E. Inbox items
Store:
- `id`
- `source_type`
- `source_id`
- `project_id`
- `topic_id`
- `title`
- `body`
- `status` (unread/read/archived)
- `created_at`
- `read_at`

Why:
- this is Jarvis product UX state

### F. Unread state
Store:
- unread counts or unread markers for:
  - topics
  - inbox items
  - project aggregate
- last-read markers if needed

Why:
- Telegram-like clarity needs Jarvis-owned read/unread rules

### G. Terminal product metadata
Store:
- `id`
- `project_id`
- `topic_id` optional
- `session_runtime_id` or tmux/session reference
- `title`
- `last_cwd`
- `last_active_at`
- `is_pinned`

Why:
- not shell history itself
- just Jarvis-side organization and restore metadata

### H. Setup / bootstrap history
Store:
- `id`
- `profile_id`
- `run_type`
- `status`
- `started_at`
- `ended_at`
- `summary`
- `error_summary`

Why:
- useful product history
- not clearly OpenClaw-owned as Jarvis UX state

### I. Basic local preferences that matter across app restarts
Store:
- active profile
- last active project/topic
- selected UI mode
- `show_existing_sessions` toggle (default off)
- maybe last open panels

Why:
- practical UX continuity
- controls whether users see prior OpenClaw sessions or only Jarvis-native/new sessions
- keep this small

---

## 4. Derived, not stored first

These should come from system/OpenClaw/git/files and only be cached later if needed.

### From OpenClaw
- raw session list
- raw chat history
- agent statuses
- model list
- cron runtime state
- approval runtime events
- live activity stream

### From filesystem
- raw file contents
- raw file tree
- stat info

### From git
- git status
- branch list
- commit history
- diffs

### From terminal/system
- shell command history
- live terminal output
- process list

Decision:
- **do not make DB tables for these first**
- fetch live, cache later only if performance demands it

---

## Recommended DB-first set

If we keep the first schema tight, Jarvis DB should start with only these groups:

1. `profiles`
2. `projects`
3. `topics`
4. `project_sessions` or `session_mappings`
5. `inbox_items`
6. `unread_state`
7. `terminal_metadata`
8. `bootstrap_history`
9. `app_state` or `preferences`

That is enough to support the current feature direction without overbuilding.

---

## Simple rule

### Store in Jarvis DB
If it is:
- product structure
- product read/unread state
- product organization metadata
- setup history
- restore/re-entry metadata

### Do not store in Jarvis DB
If it is:
- already owned by OpenClaw
- already owned by filesystem/git/system
- not part of the current build
- speculative future workflow
