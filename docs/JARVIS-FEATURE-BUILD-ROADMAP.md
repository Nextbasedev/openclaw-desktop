# JARVIS-FEATURE-BUILD-ROADMAP.md

Purpose: define the practical build order for Jarvis so we know what to build first, second, third, and why.

This is based on:
- current agreed feature scope
- OpenClaw vs Jarvis ownership split
- 3-day execution mindset
- focus on usable product flow before polish

---

## Core rule

Build in this order:
1. **Foundations that unlock everything else**
2. **Core user loop**
3. **Product organization**
4. **Power features**
5. **Polish and competitive improvements**

Do not build in “feature excitement” order.
Build in **dependency order + user value order**.

---

# Phase 0. Foundation decisions

## Goal
Lock the minimum architecture so implementation does not drift.

## Build
- middleware contract shape
- local vs remote environment abstraction
- DB schema for Jarvis-owned entities
- OpenClaw integration boundaries
- event model for activity/inbox/unread

## Output
- stable data model
- stable API surface
- stable ownership split

## Why first
Without this, later work becomes rewrite-heavy.

---

# Phase 1. Environment + connection foundation

## Goal
Make Jarvis able to connect reliably to a real environment.

## Build first
### 1. Profiles
- create profile
- edit profile
- delete profile
- default profile
- local vs remote mode

### 2. Environment connect flow
- connect to OpenClaw Gateway
- auth/token handling
- connection status
- reconnect behavior
- capability detection

### 3. Setup/onboarding basics
- detect local OpenClaw
- manual connect flow
- clear success/failure states

## Why this is first
Nothing else matters if the app cannot connect reliably.

## Definition of done
- user can open app
- connect local or remote target
- see status clearly
- reconnect works

---

# Phase 2. Core chat loop

## Goal
Make Jarvis useful as an actual agent app, not just a shell.

## Build second
### 1. Session lifecycle
- list Jarvis-visible sessions
- create session
- open existing session only when enabled in settings
- reset/delete session
- default behavior: focus on new Jarvis-created sessions, not all historical sessions

### 2. Chat
- send message
- receive streaming response
- show thinking state
- show tool-call state
- show markdown/code rendering

### 3. Interrupt flow
- interrupt current generation
- merge follow-up message
- restart with new context

### 4. Basic agent switching
- choose agent
- see agent status

## Why this comes second
This is the minimum value loop of the product.

## Definition of done
- user can start work immediately after connecting
- chat feels real-time and reliable
- active work can be interrupted cleanly

---

# Phase 3. Project + topic organization

## Goal
Turn raw sessions into a usable workspace.

## Build third
### 1. Projects
- create project
- list projects
- update/archive project
- attach workspace root + profile

### 2. Topics
- create topic
- rename/archive topic
- attach/detach sessions

### 3. Session mapping
- map sessions into project/topic structure
- pin/hide sessions if needed
- recent session ordering

### 4. Sidebar/navigation
- project list
- topics per project
- sessions per topic/project
- active selection state

## Why this comes third
Without this, the product feels like a flat session client.
This is what starts replacing Telegram.

## Definition of done
- work is organized by project and topic
- switching contexts is fast
- session chaos is reduced

---

# Phase 4. Activity + unread + inbox

## Goal
Make the app easy to return to and trust.

## Build fourth
### 1. Activity feed
- normalized activity items from OpenClaw/session/runtime events
- per-project activity view
- running/completed/failed visibility

### 2. Inbox
- create inbox items from important events
- read/unread/archive state
- deep link into related topic/session

### 3. Unread model
- topic unread
- inbox unread
- project aggregate unread
- clear mark-read rules

### 4. “Now” / return-to-work surface
- active sessions
- pending approvals
- unread items
- failed recent work
- recent active topics

## Why this comes fourth
This is what makes Jarvis sticky and competitive with Telegram.

## Definition of done
- user can leave and come back without feeling lost
- app clearly shows what needs attention
- unread feels trustworthy, not noisy

---

# Phase 5. Files + git basics

## Goal
Connect work conversations to real project artifacts.

## Build fifth
### 1. File browser basics
- tree/list files
- open/read file
- edit/save text file
- recent files

### 2. File usefulness layer
- changed files
- agent-touched files
- referenced files

### 3. Git basics
- status
- branch
- recent commits
- diff view

## Why this comes here
Useful, but secondary to connection/chat/organization.
The app should already work before it behaves like a workspace tool.

## Definition of done
- user can move from chat to files quickly
- user can inspect code changes without leaving app

---

# Phase 6. Terminal basics

## Goal
Give users execution power inside the product.

## Build sixth
### 1. Embedded terminal
- create terminal session
- write/resize/close
- list active terminals

### 2. Project-linked terminal metadata
- title
- last active
- project/topic association

### 3. Basic continuity direction
- reconnect to still-running terminal if possible
- if not possible, at least preserve metadata and recent access

## Why this is after files/git basics
Terminal is powerful, but it is easier to place correctly once projects/topics/files already exist.

## Definition of done
- user can work from terminal inside Jarvis
- terminal is tied to project context

---

# Phase 7. Approvals + intervention

## Goal
Give users control and trust during agent execution.

## Build seventh
### 1. Approval UX
- show approval requests clearly
- approve once / always / deny
- show exact command/action
- link to session/project

### 2. Intervention controls
- cancel task
- kill sub-agent
- steer running sub-agent if available

### 3. Autonomy controls
- supervised/manual/full-auto mode
- per-session or global setting

## Why this comes here
Once users are actively using the app, trust/control becomes critical.

## Definition of done
- user understands what the agent is trying to do
- user can safely intervene

---

# Phase 8. Observability upgrade

## Goal
Make multi-agent work understandable, not just visible.

## Build eighth
### 1. Better activity summary
- what is running now
- what finished
- what failed
- what needs action

### 2. Sub-agent tree
- parent-child hierarchy
- statuses
- click-through details

### 3. Running processes panel
- active exec/background tasks
- session linkage

### 4. Optional deeper detail
- token/cost panel
- context inspector
- timeline/waterfall later

## Why this is later
The raw product loop matters more than deep introspection.

## Definition of done
- user can understand agent work at a glance
- deep detail exists when needed

---

# Phase 9. Settings + cron + memory surfaces

## Goal
Complete the product with important secondary areas.

## Build ninth
### 1. Settings
- connection manager
- config editor
- UI mode
- shortcuts/basic preferences

### 2. Cron panel
- list/manage/run/delete jobs
- job history if available

### 3. Memory browser basics
- list memory files
- open/edit/save
- search if feasible

## Why this comes later
Important, but not the first thing that makes the app feel alive.

## Definition of done
- users can manage environment and supporting features without leaving Jarvis

---

# Phase 10. Competitive improvement pass

## Goal
Use final pass to make Jarvis feel strong, not just complete.

## Improve tenth
### Highest-value improvements
- stronger resume/continue flow
- better project landing view
- smarter session grouping
- better terminal continuity
- cleaner unread behavior
- sharper approval UX
- better connection fast path

### Things to avoid in this pass
- overbuilding layout customization
- overcomplicated notification logic
- speculative future systems
- full IDE clone behavior

## Why last
These improvements matter most after the real end-to-end product exists.

---

# Recommended immediate build order

If we are starting now, the exact order should be:

## Step 1
- profiles
- environment connect
- capability detection
- onboarding/connect flow

## Step 2
- sessions
- chat send/stream/history
- interrupt flow
- agent switching basics

## Step 3
- projects
- topics
- session mapping
- sidebar/navigation

## Step 4
- unread
- inbox
- activity feed
- Now/return-to-work surface

## Step 5
- files basic
- git basic

## Step 6
- terminal basic
- terminal metadata

## Step 7
- approvals
- intervention controls
- autonomy mode

## Step 8
- observability deepening
- sub-agent tree
- processes panel

## Step 9
- settings
- cron
- memory browser

## Step 10
- competitive polish pass

---

# If compressed into 3 days

## Day 1
- Step 1
- Step 2
- start Step 3

## Day 2
- finish Step 3
- Step 4
- Step 5
- start Step 6

## Day 3
- finish Step 6
- Step 7
- selective Step 8
- competitive polish pass

Hold for later if time is tight:
- deep memory features
- advanced cron history
- deep context inspector
- waterfall/timeline
- heavy customization

---

# Final principle

Build the product in the order the user experiences it:

1. can I connect?
2. can I talk?
3. can I organize my work?
4. can I return without confusion?
5. can I act on files/terminal?
6. can I trust and control the agent?
7. can I go deeper when needed?

That is the roadmap Jarvis should follow.
