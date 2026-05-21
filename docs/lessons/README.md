# Lessons Learned

This directory captures key learnings from incidents, PR reviews, and debugging sessions. Each lesson prevents the same bug from being re-introduced.

## Format

```markdown
# YYYY-MM-DD — Brief title

## Bug / Issue
What happened, who was affected.

## Root cause
Why it happened — the code path, the assumption that was wrong.

## Fix
What was done — PR number, code change.

## Constraint added
What rule now prevents this from recurring. Reference the constraint file if one was updated.

## Files
Which source files are relevant.
```

## How to Add

After any PR that fixes a non-trivial bug:
1. Create `YYYY-MM-DD-brief-slug.md` in this directory (or add to the index below)
2. Follow the format above
3. If the fix reveals a new invariant, add it to the relevant `docs/constraints/*.md` file

## Index

Lessons listed newest-first.

---

### 2026-05-21 — Image attachments fail with "try again"
- **Bug:** Users sending images got generic "Message failed to send. Try again."
- **Root cause:** Fastify default body limit (1 MB) rejected base64-encoded image JSON payloads. UI allows 10 MB attachments, but base64 + JSON overhead pushes payloads past 1 MB for images >750 KB.
- **Fix:** Raised middleware body limit to 25 MB (`MIDDLEWARE_BODY_LIMIT_BYTES`); added clear `PAYLOAD_TOO_LARGE` error code and user-facing message. PR #46.
- **Constraint:** Middleware body limit (AGENTS.md invariant #6, `docs/constraints/middleware.md`)
- **Files:** `apps/middleware/src/app.ts`, `apps/middleware/src/lib/errors.ts`

### 2026-05-21 — Chat opens at top instead of latest message
- **Bug:** First opening a chat started at the first/oldest message instead of the latest.
- **Root cause:** `historyLoadVersion` started at 0. Warm/global cache messages rendered before the hook signaled scroll, so `ChatView`'s layout effect never fired on first paint.
- **Fix:** Seed `historyLoadVersion` to 1 when warm messages exist on mount; move scroll ownership to `useLayoutEffect` in ChatView. PR #44.
- **Constraint:** Scroll-to-bottom on initial open (`docs/constraints/ui-scroll.md`)
- **Files:** `packages/ui/hooks/useChatMessages.ts`, `packages/ui/components/ChatView/index.tsx`

### 2026-05-21 — Cross-window chat bleed
- **Bug:** Two desktop windows on different chats would eventually show each other's chat content.
- **Root cause:** Layout cache used a single shared key (`workspace:last-layout:v1`) across all Tauri/browser windows.
- **Fix:** Per-window `openclawWindowId` scoping for layout cache keys. Secondary windows tagged via `openRouteInNewWindow()` with unique ID. Main window uses stable `"main"` scope with legacy fallback. PR #39.
- **Constraint:** Per-window layout isolation (AGENTS.md invariant #4, `docs/constraints/sessions.md`)
- **Files:** `packages/ui/lib/openRouteWindow.ts`, `packages/ui/lib/workspaceLayoutPersistence.ts`

### 2026-05-21 — Stale gateway sessions persist after sync
- **Bug:** Old gateway-only sessions from previous OCPlatform versions appeared in session list after sync.
- **Root cause:** Session sync cleaned stale chats but not stale sessions. Gateway-only sessions without active chats were orphaned.
- **Fix:** Added stale gateway-only session cleanup alongside chat cleanup, preserving imported/manual/local/desktop sessions. PR #41.
- **Constraint:** Session sync preserves local-only sessions (AGENTS.md invariant #5, `docs/constraints/sessions.md`)
- **Files:** `apps/middleware/src/features/compat/routes.ts`

### 2026-05-21 — Telegram import naming loses uniqueness
- **Bug:** Importing Telegram groups with duplicate topic names could create sessions with identical labels.
- **Root cause:** Import code preferred raw `topicName` over unique `proposedName`.
- **Fix:** Changed import to prefer `proposedName` so duplicate topic names get unique suffixes. PR #41.
- **Constraint:** Telegram import naming (`docs/constraints/sessions.md`)
- **Files:** `apps/middleware/src/features/compat/routes.ts`
