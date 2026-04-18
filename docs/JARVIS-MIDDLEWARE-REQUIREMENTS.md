# JARVIS-MIDDLEWARE-REQUIREMENTS.md

Scope: define the Jarvis middleware layer that sits between the Jarvis frontend and the underlying execution systems.

This doc assumes:
- OpenClaw stays mostly unchanged
- Jarvis owns product-level composition
- Jarvis supports both **local** and **remote** environments
- the frontend should talk to **one stable Jarvis API surface** regardless of environment mode

## Core answer: local vs remote file/git access

### Local mode
If OpenClaw and the workspace are on the same machine as Jarvis Desktop:
- you usually **do not need a network proxy** for file access
- you usually **do not need a network proxy** for git access
- Jarvis can use local system access through the desktop shell / middleware runtime

But you still want a **middleware abstraction layer** so the frontend calls the same interface in both modes.

Example:
- local mode implementation: direct filesystem + direct git CLI/system library
- remote mode implementation: SSH/agent bridge/API tunnel/proxy
- frontend call stays the same: `jarvis.project.files.list(projectId, path)`

### Remote mode
If OpenClaw/workspace is on another machine:
- Jarvis needs a **remote transport layer** for files
- Jarvis needs a **remote transport layer** for git operations
- this is where a real proxy/bridge matters

So the right model is:
- **local = direct adapter**
- **remote = proxy adapter**
- **frontend = same Jarvis middleware contract**

## Architecture role of middleware

Jarvis middleware should:
1. call OpenClaw for runtime/agent/session features
2. call local system services when running locally
3. call remote system bridges when running remotely
4. normalize all of that into Jarvis product concepts
5. expose one clean frontend API

## What stays in OpenClaw

OpenClaw remains the runtime core for:
- chat send/history/abort
- streaming events
- sessions lifecycle
- model listing
- skills
- cron
- config/schema
- approvals
- agents

## What Jarvis middleware must own

### 1. Connection and environment abstraction
Jarvis must support:
- local environment target
- remote environment target
- saved connection profiles
- health checks
- active target selection
- capability detection per target

Required concepts:
- `EnvironmentTarget`
- `ConnectionProfile`
- `EnvironmentCapabilities`

Suggested API surface:
- `profiles.list()`
- `profiles.create()`
- `profiles.update()`
- `profiles.delete()`
- `environment.connect(profileId)`
- `environment.status(profileId)`
- `environment.detect(profileId)`

### 2. Project model
Jarvis needs a first-class product model for projects.

A project should map:
- workspace root
- environment target
- linked OpenClaw sessions
- linked topics
- git repository metadata
- recent work items/tasks (if added later)

Required concepts:
- `Project`
- `ProjectWorkspace`
- `ProjectSessionLink`
- `ProjectTopicLink`

Suggested API surface:
- `projects.list()`
- `projects.get(projectId)`
- `projects.create()`
- `projects.update()`
- `projects.archive()`
- `projects.sidebar(projectId)`

### 3. Topic model
Jarvis should not rely only on raw session keys for topic UX.

Required concepts:
- `Topic`
- `TopicSessionLink`
- `TopicState`

Suggested API surface:
- `topics.list(projectId)`
- `topics.create(projectId)`
- `topics.rename(topicId)`
- `topics.archive(topicId)`
- `topics.attachSession(topicId, sessionKey)`
- `topics.detachSession(topicId, sessionKey)`

### 4. Navigation composition layer
Frontend should not compose raw projects/topics/sessions/agents itself.

Middleware should return ready-to-render navigation payloads.

Suggested API surface:
- `navigation.sidebar()`
- `navigation.project(projectId)`
- `navigation.topic(topicId)`

Example payload:
- projects
- topics per project
- pinned sessions
- agents with status
- unread counts

### 5. File access layer
This is an abstraction, not always a proxy.

#### Local implementation
- direct filesystem access via desktop shell/runtime

#### Remote implementation
- SSH/tunnel/proxy/bridge access

Required concepts:
- `FileNode`
- `FileDocument`
- `FileStat`
- `FileChange`

Suggested API surface:
- `files.tree(projectId, path)`
- `files.read(projectId, path)`
- `files.write(projectId, path, content)`
- `files.mkdir(projectId, path)`
- `files.rename(projectId, from, to)`
- `files.delete(projectId, path)`
- `files.search(projectId, query)`

## 6. Git integration layer
Again:
- local mode = direct git access
- remote mode = remote git bridge/proxy

Required concepts:
- `GitStatus`
- `GitDiffSummary`
- `GitCommit`
- `GitBranch`

Suggested API surface:
- `git.status(projectId)`
- `git.diff(projectId, refA, refB?)`
- `git.history(projectId, path?)`
- `git.branches(projectId)`
- `git.checkout(projectId, branch)`
- `git.commit(projectId, message)`

### 7. Terminal bridge
Jarvis can own terminal instead of requiring OpenClaw terminal APIs.

#### Local implementation
- direct PTY/session manager in desktop/runtime

#### Remote implementation
- remote shell bridge over SSH/tunnel

Required concepts:
- `TerminalSession`
- `TerminalTab`
- `TerminalOutputChunk`

Suggested API surface:
- `terminal.create(projectId)`
- `terminal.write(sessionId, data)`
- `terminal.resize(sessionId, cols, rows)`
- `terminal.close(sessionId)`
- `terminal.list(projectId)`

### 8. Activity and observability aggregation
Jarvis should compose a product-friendly event stream from:
- OpenClaw chat events
- session events
- approvals
- cron runs
- git changes
- terminal activity

Required concepts:
- `ActivityEvent`
- `ActivityFeed`
- `AgentTreeNode`
- `ProcessSummary`

Suggested API surface:
- `activity.feed(projectId)`
- `activity.subscribe(projectId)`
- `agents.tree(projectId)`
- `processes.list(projectId)`

### 9. Notifications and inbox model
Jarvis should own:
- unread counts
- read state
- inbox grouping
- notification routing

Required concepts:
- `InboxItem`
- `NotificationRule`
- `UnreadState`

Suggested API surface:
- `inbox.list()`
- `inbox.markRead(itemId)`
- `inbox.unreadCounts()`
- `notifications.rules()`

### 10. Memory layer
If Jarvis ships memory as a real product area, middleware should own indexing and search.

Required concepts:
- `MemoryDocument`
- `MemorySearchHit`
- `MemoryIndexJob`

Suggested API surface:
- `memory.list(projectId?)`
- `memory.read(path)`
- `memory.write(path, content)`
- `memory.search(query)`
- `memory.reindex()`

### 11. Resume-by-context layer
Jarvis can implement resume UX without true runtime pause/resume.

Flow:
1. stop current run
2. capture visible state, artifacts, and context
3. create continuation payload
4. send new run with reconstructed context

Required concepts:
- `ContinuationContext`
- `ResumePlan`

Suggested API surface:
- `resume.prepare(sessionKey)`
- `resume.execute(sessionKey, plan)`

### 12. Remote bootstrap/setup orchestration
Needed when remote target does not already have OpenClaw ready.

Required concepts:
- `BootstrapPlan`
- `BootstrapStep`
- `BootstrapResult`

Suggested API surface:
- `bootstrap.inspect(profileId)`
- `bootstrap.plan(profileId)`
- `bootstrap.run(profileId)`
- `bootstrap.logs(runId)`

## Storage requirements

Jarvis middleware likely needs its own persistence layer for product concepts.

Suggested tables/collections:
- `profiles`
- `projects`
- `topics`
- `project_sessions`
- `topic_sessions`
- `activity_events`
- `inbox_items`
- `unread_state`
- `terminal_sessions`
- `memory_index`

## Capability matrix

| Capability | Local | Remote |
|---------|---------|---------|
| OpenClaw chat/sessions | direct to local Gateway | direct to remote Gateway |
| File access | direct adapter | proxy/bridge adapter |
| Git access | direct adapter | proxy/bridge adapter |
| Terminal | direct PTY adapter | remote shell adapter |
| Bootstrap/setup | local installer/runtime checks | remote provisioning/orchestration |

## Recommended implementation order

1. profiles + environment abstraction
2. projects + topics + navigation composition
3. file adapter + git adapter
4. terminal adapter
5. activity aggregation + inbox
6. memory indexing/search
7. bootstrap orchestration
8. resume-by-context flows

## Final recommendation

Yes, your instinct is right:
- **file proxy** and **git proxy** are mainly a **remote-mode concern**
- but Jarvis still needs a **middleware abstraction** in both modes
- because the frontend should not care whether the implementation is local-direct or remote-proxied

That abstraction layer is what will keep the product clean.
