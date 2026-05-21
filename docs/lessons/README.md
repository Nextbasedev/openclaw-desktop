# Lessons Learned

Post-incident and post-bug learnings. Each lesson links the bug to its root cause, fix, and the constraint it validates.

## Template

```markdown
# Lesson: [Short title]

**Date:** YYYY-MM-DD
**Severity:** Critical / High / Medium / Low
**PR:** #NNN

## Bug
What happened. Concrete user-visible symptom.

## Root Cause
Why it happened. Trace from trigger to broken behavior.

## Fix
What was changed. Include file paths and key code changes.

## Constraint Validated
Which invariant or constraint from AGENTS.md / docs/constraints/ this validates.

## Prevention
How to prevent recurrence. Could be a test, lint rule, or process change.
```

## Lessons

### 2026-05-21: Cross-window chat bleed
- **Bug:** Two desktop windows on different chats would eventually show each other's chat
- **Root cause:** Layout cache used a single shared key across all windows
- **Fix:** Per-window `openclawWindowId` scoping for layout cache keys (PR #39)
- **Constraint:** Per-window layout isolation (AGENTS.md invariant #4, `docs/constraints/sessions.md`)

### 2026-05-21: Chat opens at top instead of latest
- **Bug:** First opening a chat started at the first/oldest message
- **Root cause:** `historyLoadVersion` started at 0; warm/global cache rendered before the hook signaled scroll
- **Fix:** Seed `historyLoadVersion` to 1 when warm messages exist; move scroll to `useLayoutEffect` in ChatView (PR #44)
- **Constraint:** Scroll-to-bottom on initial open (`docs/constraints/ui-scroll.md`)

### 2026-05-21: Image attachments fail with "try again"
- **Bug:** Users sending images got generic "Message failed to send. Try again."
- **Root cause:** Fastify default body limit (1 MB) rejected base64-encoded image JSON payloads
- **Fix:** Raised middleware body limit to 25 MB; added clear PAYLOAD_TOO_LARGE error (PR #46)
- **Constraint:** Middleware body limit (AGENTS.md invariant #6, `docs/constraints/middleware.md`)

### 2026-05-21: Stale gateway sessions persist after sync
- **Bug:** Old gateway-only sessions from previous OCPlatform versions appeared in session list
- **Root cause:** Session sync cleaned stale chats but not stale sessions
- **Fix:** Added stale gateway-only session cleanup alongside chat cleanup (PR #41)
- **Constraint:** Session sync preserves local-only sessions (AGENTS.md invariant #5, `docs/constraints/sessions.md`)
