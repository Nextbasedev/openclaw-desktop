# Chat Stabilization Reliability Plan

## Goal
Make OpenClaw Desktop chat feel fully stable before manual review: no blinking, no remount flicker, no wrong reload position, no older-history jump, no duplicate/missing tool cards, no slow/fetching flashes, and no middleware/frontend state desync.

This work happens on branch `krish-imp`, created from `krish-3` after merging latest `origin/v3`.

## Current Baseline
- Main checkout must remain untouched: `/root/.openclaw/workspace/openclaw-desktop`.
- Work checkout: `/root/.openclaw/workspace/tmp/openclaw-desktop-v3-temp`.
- `krish-3` was merged with latest `origin/v3` before `krish-imp` was created.
- Current chat has two render paths:
  - normal `ChatView` DOM timeline
  - flagged Vercel-style `OpenClawVercelChat`
- Middleware changes from `v3` include reliable subagent lifecycle work and must be preserved.

## Problem
The visible chat bugs are frontend symptoms, but the root can be split across frontend, middleware, and their contract.

Known risks:
1. Reload/open may not always land at latest message.
2. Older-history prepend can move the visible message.
3. Live/final message IDs can change and break DOM anchors.
4. Duplicate user text can shift content-derived UI IDs.
5. Auto-load near top can fire multiple pages and look like an upward jump.
6. Fixed 900ms anchor locks can miss late markdown/image/tool-card layout changes.
7. Normal and Vercel paths duplicate scroll logic.
8. Tool cards can regress if middleware backfill/replay replaces richer live state.
9. Long chats still need performance protection without virtualization.
10. E2E proof is incomplete because local Chrome was missing during prior audit.

## Current Flow

### Send / Live Update
1. UI `ChatBox` sends through `useChatMessages.handleSend`.
2. Middleware `POST /api/chat/send` creates optimistic patches and forwards to Gateway.
3. Gateway emits session/tool/message events.
4. Middleware projects events into patch bus.
5. UI patch stream updates global chat store and visible state.
6. Chat rows re-render and scroll logic decides whether to follow bottom.

### Bootstrap / Reload
1. UI tries warm cache/global cache for fast paint.
2. UI fetches `/api/chat/bootstrap` for authoritative state.
3. Patch stream opens/resumes with cursor.
4. Chat must end at latest if user has not scrolled.

### Older History
1. UI calls `loadOlderMessages()` with `beforeSeq` from oldest loaded seq.
2. Middleware returns older projected rows.
3. UI prepends/dedupes and seeds global session to avoid later patches wiping history.
4. UI must keep the same visible row at the same screen position.

## Proposed Fix

### Phase 1 — Baseline and Diagnostics
**Files**
- `packages/ui/components/ChatView/index.tsx`
- `packages/ui/components/ChatView/vercel-ui/OpenClawVercelChat.tsx`
- `packages/ui/hooks/useChatMessages.ts`
- `packages/ui/lib/chat-engine-v2/store.ts`
- `apps/middleware/src/features/chat/routes.ts`
- `apps/middleware/src/features/chat/live.ts`

**Changes**
- Add minimal structured debug logs behind a local flag, not noisy production logs.
- Log scroll anchor capture/restore: row id, row top, scrollTop, scrollHeight, delta, reason.
- Log older-page request/result: beforeSeq, returned count, deduped count, oldest seq, hasMore.
- Log patch replay/backfill decisions when a shorter snapshot is rejected/preserved.

**Beginner check**
- We need to see exactly when scroll moves, not guess.

### Phase 2 — One Canonical Stable Row Identity
**Files**
- `packages/ui/lib/chatStableIds.ts` new
- `packages/ui/components/ChatView/vercel-ui/timeline.ts`
- `packages/ui/components/ChatView/index.tsx`
- `packages/ui/lib/__tests__/vercelTimeline.test.ts`

**Changes**
- Create one stable UI row id algorithm shared by normal and Vercel paths.
- Prefer immutable seq/turn identity when available: `openclawSeq`, `gatewayIndex`, run/turn boundary.
- Use backend `messageId` only as data metadata, not as the DOM anchor source.
- Handle duplicate same-text user messages without occurrence shifting after prepend.
- Add tests for:
  - optimistic user -> confirmed user keeps same row id
  - live assistant -> final assistant keeps same row id
  - older prepend keeps existing rows same ids
  - duplicate same-text users keep their ids after prepend

### Phase 3 — Unified Scroll Controller
**Files**
- `packages/ui/components/ChatView/useChatScrollController.ts` new
- `packages/ui/components/ChatView/index.tsx`
- `packages/ui/components/ChatView/vercel-ui/useStableChatScroll.ts`
- `packages/ui/components/ChatView/vercel-ui/OpenClawVercelChat.tsx`

**Changes**
- Replace duplicated scroll logic with one hook.
- Responsibilities:
  - initial/reload bottom settle
  - user-send force bottom
  - live update follows only if already near bottom
  - older prepend anchor capture/restore
  - jump-to-bottom visibility
  - one-page-per-user-scroll older loading guard
- Disable browser route scroll restoration for chat while mounted.
- Restore anchor until stable for at least two animation frames, with max cap.
- Do not use fixed 900ms as the only correctness mechanism.

### Phase 4 — Middleware Contract Hardening
**Files**
- `apps/middleware/src/features/chat/routes.ts`
- `apps/middleware/src/features/chat/live.ts`
- `apps/middleware/src/features/chat/projection.ts`
- `apps/middleware/tests/*chat*`
- `packages/ui/lib/chat-engine-v2/store.ts`
- `packages/ui/lib/chat-engine-v2/applyPatches.ts`

**Changes**
- Confirm middleware never sends a shorter canonical/backfill snapshot that wipes richer live UI state.
- Ensure optimistic/live/final messages expose enough stable identifiers for UI reconciliation.
- Ensure pagination contract is stable:
  - `beforeSeq` means strictly older than seq
  - response ordered by `openclaw_seq`
  - clear `hasMore`/`messageCount` behavior
- Ensure tool-call lifecycle is run-scoped and terminal states do not downgrade to stale running states.

### Phase 5 — Render Performance and Flicker Removal
**Files**
- `packages/ui/components/ChatView/MessageBubble.tsx`
- `packages/ui/components/ChatView/ToolCallSteps.tsx`
- `packages/ui/components/ChatView/MarkdownContent.tsx`
- `packages/ui/components/ChatView/index.tsx`

**Changes**
- Memoize message row parts where props are stable.
- Keep status/footer height stable.
- Remove/avoid entrance animations that cause row remount blink.
- Keep markdown reveal immediate for stable path unless explicitly reintroduced with tests.
- Preserve tool-card open/closed state across live updates.

### Phase 6 — E2E Test Harness
**Files**
- `scripts/sandbox/verify-ui.mjs`
- `scripts/sandbox/audit-chat-stability.mjs` new
- `packages/ui/app/*` or test-only fixture route if appropriate
- `docs/chat-rendering-edge-case-matrix.md`

**Changes**
- Add a repeatable chat stability audit script.
- Required scenarios:
  1. Open long chat -> lands at latest.
  2. Refresh same chat -> lands at latest.
  3. Scroll near top -> load 240 older -> same visible row top stays within 2px.
  4. Live assistant text updates -> no remount blink, bottom follows only if near bottom.
  5. User scrolled up -> live updates do not steal scroll.
  6. Running tool -> result -> final text: one card, no duplicate, no stale spinner.
  7. Approval tool card renders and resolves.
  8. Duplicate same-text user messages survive prepend without row id shift.
  9. Attachments/images/markdown/code blocks load without late scroll jump.
  10. Subagent bar/tool lifecycle from latest `v3` still works.

## Continuous Stabilization Loop
Run this loop after each fix. If any case fails, stop, fix the first failure, and restart from the top.

1. `git status --short`
2. `pnpm --filter ui typecheck`
3. Focused UI tests:
   - `pnpm --filter ui exec vitest run lib/__tests__/vercelTimeline.test.ts lib/__tests__/assistantUiAdapter.test.ts components/ChatView/useStreamingText.test.ts lib/chatToolDisplay.test.ts lib/liveToolCalls.test.ts --reporter=dot`
4. New scroll-controller/stable-id tests.
5. Middleware chat tests:
   - subagent lifecycle tests from latest `v3`
   - chat projection/backfill tests
   - pagination tests
6. `pnpm --filter ui build`
7. Targeted ESLint on touched files.
8. Browser E2E chat stability audit. If Chrome is missing, install/fix Chrome or explicitly mark blocked.
9. Inspect debug logs for:
   - no repeated older-load chain
   - no anchor restore delta drift
   - no shorter snapshot wiping messages
   - no tool downgrade
10. Commit only after all checks pass.
11. Repeat the whole loop from step 1.

## Definition of Done
- Reload/open always lands at latest when user has not scrolled.
- Loading older messages preserves the same visible row within 2px.
- Sending and receiving messages never blinks/remounts existing rows.
- Live/final assistant reconciliation keeps one stable assistant row.
- Tool cards never duplicate, disappear, or stay stuck in stale running state.
- User-scrolled-up position is never stolen by live updates.
- Long chats remain responsive without virtualization.
- Middleware backfill/replay cannot wipe richer UI state.
- All typecheck/tests/build/lint/browser E2E pass.
- Debug logs are minimal and useful, not noisy.

## Risks
- Over-fixing frontend without middleware contract checks may hide root causes.
- Reintroducing virtualization or `content-visibility` can bring back blink/jump bugs.
- Aggressive auto-load can make correct anchoring look broken.
- Memoization with unstable callbacks can fail silently and give no performance benefit.
- Test fixtures must represent real middleware patch behavior, not only idealized UI state.

## First Implementation Order
1. Build stable-id tests first.
2. Implement shared stable row id utility.
3. Build scroll-controller unit/fixture tests.
4. Replace duplicated scroll logic with shared hook.
5. Add middleware contract tests for backfill/pagination/tool downgrade.
6. Fix middleware/UI gaps found by tests.
7. Add browser E2E stability audit.
8. Run continuous loop until clean.
