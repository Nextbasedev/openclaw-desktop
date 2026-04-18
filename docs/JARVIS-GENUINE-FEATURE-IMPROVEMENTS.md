# JARVIS-GENUINE-FEATURE-IMPROVEMENTS.md

Purpose: identify **genuine**, non-overkill feature improvements for Jarvis based on the current docs and the product bar of competing with Codex-style desktop workflow and Telegram-style fast communication.

Rule: only include improvements that noticeably improve usability, continuity, speed, or trust.

---

## 1. Stronger terminal continuity

Current state:
- terminal exists in architecture/docs
- middleware covers terminal create/write/resize/close/list
- true continuity across app restarts is not yet clearly designed

Why it matters:
- Codex-like tools feel powerful because terminal work is persistent
- if user closes Jarvis and reopens it, losing all terminal context feels weak

Improvement:
- add terminal session continuity as an explicit capability
- support reconnecting to running sessions when possible
- likely later via `tmux` or a session manager

Why this is genuine:
- high user value
- directly affects daily use
- not cosmetic

Priority:
- high

---

## 2. Better session resume, not just chat history

Current state:
- docs mention resume-by-context
- but the product should make it extremely easy to continue work

Improvement:
- one-click resume for a project/topic/session
- show:
  - last active files
  - recent terminal sessions
  - recent agent activity
  - last unfinished work
- allow “continue where I left off” from sidebar/home

Why it matters:
- Telegram wins on quick re-entry
- Codex wins on working continuity
- Jarvis needs both

Why this is genuine:
- reduces friction every single session
- avoids user having to mentally reconstruct context

Priority:
- very high

---

## 3. Better project landing view

Current state:
- project exists conceptually
- sidebar/nav is planned
- but project home value is not yet sharp enough

Improvement:
- each project should have a simple useful landing view with:
  - recent topics
  - active sessions
  - git status summary
  - unread items
  - recent files
  - active terminals

Why it matters:
- projects should feel alive, not just a label around sessions
- this becomes the main orientation screen

Why this is genuine:
- high clarity
- low conceptual overhead
- helps both new and returning users

Priority:
- high

---

## 4. Unread model must be simple and reliable

Current state:
- unread/inbox is in the plan
- but unread can become messy fast if overdesigned

Improvement:
- define unread only for a few real surfaces:
  - topics
  - inbox items
  - project aggregate count
- avoid unread for everything
- mark-read behavior must feel obvious and automatic where possible

Why it matters:
- Telegram-like products live or die on notification clarity
- noisy unread destroys trust

Why this is genuine:
- strong UX value
- avoids product confusion
- small scope if kept disciplined

Priority:
- very high

---

## 5. Approvals need a much better UX layer

Current state:
- OpenClaw already has approvals
- Jarvis can surface them

Improvement:
- give approvals a dedicated, polished intervention UX:
  - clear reason
  - exact command/action
  - affected project/session
  - approve once / always / deny
  - recent approvals history

Why it matters:
- supervised execution is a core trust surface
- poor approval UX makes the whole app feel unsafe or annoying

Why this is genuine:
- high trust impact
- already backed by real OpenClaw primitives
- mostly a product/UI win

Priority:
- high

---

## 6. Session grouping should feel smarter

Current state:
- topics exist as a grouping model above sessions

Improvement:
- better automatic grouping and sorting of sessions inside topics/projects:
  - running first
  - recently active next
  - completed/idle later
- suggest topic attachment for uncategorized sessions
- easy move session between topics

Why it matters:
- raw session lists become chaotic quickly
- this is one of the biggest differences between a dev tool and a polished workspace

Why this is genuine:
- major organization value
- not heavy to implement conceptually

Priority:
- high

---

## 7. Better observability summary, not only event firehose

Current state:
- activity feed and agent tree are planned
- risk: too much raw activity, not enough meaning

Improvement:
- add a summarized top layer:
  - what is currently running
  - what finished recently
  - what failed
  - what needs approval
- keep raw event stream below it

Why it matters:
- users need signal first, logs second
- especially important if multiple agents are active

Why this is genuine:
- improves clarity immediately
- avoids overwhelming the user

Priority:
- high

---

## 8. File manager should focus on task flow, not become VS Code clone

Current state:
- file tree, viewer, editor, diff are in architecture

Improvement:
- keep file manager intentionally narrow:
  - recent files
  - changed files
  - files mentioned in chat
  - files changed by agent
- do not overbuild generic IDE chrome at first

Why it matters:
- Jarvis should help users act faster, not rebuild a whole editor badly
- this keeps it competitive without bloat

Why this is genuine:
- lowers complexity
- keeps focus on AI workflow

Priority:
- medium-high

---

## 9. Connection profiles need “it just works” quality

Current state:
- profiles are planned well

Improvement:
- add quality details:
  - last success / last failure
  - capability snapshot
  - default profile
  - reconnect fast path
  - clear local vs remote labeling

Why it matters:
- local/remote confusion will hurt trust fast
- profile friction can make the whole app feel fragile

Why this is genuine:
- operationally important
- not feature bloat

Priority:
- high

---

## 10. Install/setup should be short and confidence-building

Current state:
- onboarding/install exists in architecture
- setup/bootstrap history is under consideration

Improvement:
- keep first-run setup minimal:
  - detect OpenClaw
  - connect or install
  - verify files/git/terminal support
  - enter first project
- show a clean success/failure checklist

Why it matters:
- first-run trust is everything
- if setup feels uncertain, users leave before seeing value

Why this is genuine:
- high conversion impact
- not overkill

Priority:
- very high

---

## 11. Topic UX should be closer to chat threads than folders

Current state:
- topics are a planned product concept

Improvement:
- topics should feel lightweight:
  - fast create
  - rename easily
  - attach sessions quickly
  - recent activity visible
  - unread count visible
- avoid making topics feel like heavyweight project management objects

Why it matters:
- Telegram-style speed depends on lightweight containers
- if topics feel heavy, people stop organizing

Why this is genuine:
- better organization without complexity

Priority:
- high

---

## 12. Need a “Now” surface

Current state:
- docs have many strong domains, but there is no sharply defined “what needs my attention right now?” surface

Improvement:
- add a compact “Now” view showing:
  - active sessions
  - approvals waiting
  - unread items
  - failed tasks
  - active terminals

Why it matters:
- this is the fastest re-entry point
- especially good for a busy user switching contexts often

Why this is genuine:
- very practical
- creates product clarity fast

Priority:
- high

---

## Improvements I would NOT add now

These feel overkill for current stage:
- full mission/task system
- very advanced file annotations everywhere
- deep semantic memory product before basic navigation is solid
- full IDE replacement behaviors
- complex notification rule engines
- too many unread categories
- elaborate multi-pane customization before core workflow is stable

---

## Best genuine priorities

If I had to pick the most important non-overkill improvements:

1. terminal continuity
2. resume/continue-where-I-left-off
3. very clean unread + inbox model
4. strong project landing view
5. summarized observability
6. polished approvals UX
7. lightweight topic UX
8. frictionless connection/setup

These would make Jarvis feel materially stronger without bloating the product.
