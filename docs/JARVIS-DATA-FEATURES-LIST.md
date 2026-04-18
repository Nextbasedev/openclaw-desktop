# JARVIS-DATA-FEATURES-LIST.md

Purpose: list the **data-bearing features** Jarvis needs before deciding whether a database is required, and if yes, what should be stored.

This is intentionally **before** schema design.

## Rule for evaluation

For each feature, ask:
1. Does this feature create Jarvis-owned state?
2. Is that state already fully owned by OpenClaw?
3. Is that state purely local/transient UI state?
4. Does the state need persistence?
5. Does the state need sync across devices or environments?

Only after answering those should we decide:
- no DB needed
- local-only store
- Jarvis DB needed
- derive on demand from OpenClaw/system/git/files

---

## 1. Environment and connection features

### 1.1 Connection profiles
Data involved:
- profile name
- local/remote mode
- gateway URL
- auth reference/token handling strategy
- workspace root
- SSH/remote metadata
- last used target
- default target
- health/capability snapshot

Question:
- should Jarvis remember multiple environments and defaults?

### 1.2 Active environment session
Data involved:
- currently selected profile
- current connection state
- current capabilities
- temporary auth/session state

Question:
- is this transient runtime only, or should some of it persist?

### 1.3 Environment capability detection
Data involved:
- has OpenClaw
- has git
- has terminal access
- has file access
- has bootstrap capability

Question:
- store last known capability snapshot or always detect live?

---

## 2. Project-level product features

### 2.1 Projects
Data involved:
- project identity
- display name
- workspace root
- linked environment/profile
- linked repo metadata
- pinned agents/sessions/topics
- archive state

Question:
- are projects a first-class Jarvis concept or just derived from folder paths?

### 2.2 Project preferences
Data involved:
- default topic
- pinned panels
- preferred model/agent
- project-specific settings

Question:
- is this UI preference only, or important product state?

### 2.3 Project activity summary
Data involved:
- last activity time
- unread count
- active agent count

Question:
- persist summary, or compute from events/sessions?

---

## 3. Topic and navigation features

### 3.1 Topics
Data involved:
- topic identity
- topic name
- archive state
- linked project
- linked sessions
- unread state
- ordering/pinning

Question:
- do topics exist independently of OpenClaw sessions?

### 3.2 Sidebar/navigation model
Data involved:
- project order
- topic order
- pinned items
- collapsed/expanded state
- recent items

Question:
- what is just UI-local vs product-level navigation state?

---

## 4. Session and chat composition features

### 4.1 Session-to-project/topic mapping
Data involved:
- session key
- project link
- topic link
- pinning/visibility state

Question:
- since OpenClaw owns sessions, what extra mapping must Jarvis own?

### 4.2 Chat continuation / resume-by-context
Data involved:
- saved continuation context
- resume notes
- artifacts to include
- prior state snapshot

Question:
- is this ephemeral workflow state or persistent product history?

---

## 5. File features

### 6.1 File tree state
Data involved:
- expanded folders
- recent files
- open tabs
- pinned files
- cursor/scroll positions

Question:
- is this purely client-local?

### 6.2 File metadata cache
Data involved:
- path
- stat info
- indexing/cache timestamps
- content hash

Question:
- needed for performance, or derive live?

### 6.3 File search/indexing
Data involved:
- searchable file index
- embeddings/full-text index
- last indexed time

Question:
- if search must be fast across large repos, do we need indexed storage?

---

## 6. Git features

### 7.1 Repo identity and linkage
Data involved:
- repo root
- current branch
- remote URLs
- linked project

Question:
- store linkage only, or derive each time?

### 7.2 Git activity cache
Data involved:
- recent commits
- status snapshot
- branch list cache
- diff summary cache

Question:
- live derive vs cached persistence?

### 7.3 Git annotations
Data involved:
- user notes on commits/diffs
- project/topic linkage to commits (if needed later)

Question:
- is Jarvis adding product metadata on top of git?

---

## 7. Terminal features

### 8.1 Terminal sessions
Data involved:
- terminal id
- cwd
- profile/environment
- linked project
- tab state
- session lifecycle

Question:
- should terminal sessions survive app restart?

### 8.2 Terminal history/metadata
Data involved:
- command history
- title/name
- last activity
- linked project/topic

Question:
- persist or rely on shell history/runtime only?

---

## 8. Observability and activity features

### 9.1 Unified activity feed
Data involved:
- normalized events from chat/tools/cron/git/terminal
- event type
- actor
- timestamp
- project/topic/session links

Question:
- compute live or persist event stream?

### 9.2 Sub-agent tree model
Data involved:
- parent-child relationships
- statuses
- durations
- displayed hierarchy metadata

Question:
- reconstruct from sessions/events or store denormalized tree state?

### 9.3 Running processes model
Data involved:
- active tasks
- source system
- state
- ownership links

Question:
- is this runtime-only?

---

## 9. Notification and inbox features

### 10.1 Inbox items
Data involved:
- inbox item identity
- source event
- title/body
- read/unread state
- archive/dismiss state
- project/topic links

Question:
- if Jarvis has a true inbox, this likely needs persistence

### 10.2 Notification rules
Data involved:
- notify on approvals
- notify on failures
- per-project/per-topic rules

Question:
- local preference or synced product setting?

### 10.3 Unread counters
Data involved:
- unread counts by project/topic/inbox

Question:
- store or derive?

---

## 10. Memory features

### 11.1 Memory documents
Data involved:
- file path
- title/type
- tags
- ownership/project scope

Question:
- just filesystem-backed, or mirrored/indexed in Jarvis?

### 11.2 Memory search/index
Data involved:
- searchable chunks
- embeddings or FTS rows
- metadata
- reindex jobs

Question:
- if semantic search is real, this probably needs storage/indexing

### 11.3 Memory settings
Data involved:
- indexing preferences
- inclusion/exclusion rules
- scope

Question:
- local setting vs shared setting?

---

## 11. Bootstrap and install features

### 12.1 Bootstrap plans
Data involved:
- target profile
- install steps
- validation checks
- status
- logs

Question:
- do bootstrap runs need persistence/history?

### 12.2 Setup history
Data involved:
- previous setup attempts
- errors
- fixes applied
- timestamps

Question:
- useful product history or disposable logs?

---

## 12. UI-only local state features

These likely should **not** drive DB design first:
- panel open/closed state
- selected tab
- scroll position
- modal visibility
- temporary draft input
- hover/selection state
- ephemeral filters

These are usually:
- local state
- local storage
- session storage
- or in-memory only

---

## Strong candidates for real Jarvis persistence

These are the most likely to justify a DB or durable Jarvis store:
- connection profiles
- projects
- topics
- project/session/topic mappings
- inbox items and read state
- notification rules
- memory search index
- activity/event log if Jarvis wants a true historical feed
- bootstrap run history

## Likely derived or runtime-first features

These may not need DB first:
- raw OpenClaw sessions
- raw chat history
- model list
- cron jobs themselves
- skills state
- git status
- filesystem tree
- running process state
- terminal output stream

These can often be fetched/derived live and only cached if performance becomes a problem.

## Suggested next step

Before schema design, classify every feature into one of 4 buckets:

1. **Jarvis persistent entity**
2. **Derived from OpenClaw**
3. **Derived from system/git/files**
4. **Pure UI/local state**

After that, DB design becomes much cleaner and smaller.
