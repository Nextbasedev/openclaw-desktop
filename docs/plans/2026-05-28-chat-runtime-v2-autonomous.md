---
title: Chat Runtime V2 Autonomous Production Pass
type: refactor
status: completed
date: 2026-05-28
origin: user directive in Desktop task B
---

# Chat Runtime V2 Autonomous Production Pass

## Goal

Create a production-ready path away from the fragile giant `useChatMessages` + `ChatView` surface without deleting proven backend/middleware contracts. Build, test, and iterate until the chat area is credible under real stress: tab switching, long chat rendering, fast sends, streaming output without blink, tool/subagent visibility, and scroll stability.

## Non-negotiable criteria

- Multi-tab / multi-session switching does not show wrong messages, stale status, or cross-session tool state.
- Long chat rendering remains responsive enough to scroll and interact.
- Sending messages is fast and does not block on unrelated history/cache work.
- Streaming output does not visibly blink or yank scroll when the user is reading older content.
- Tool calls, approvals, and subagents remain understandable and correctly scoped to their turn.
- Existing parser/dedupe/patch contracts remain compatible unless an issue is explicitly diagnosed and tested.
- No naive full rewrite of Gateway/middleware contracts.
- No naive virtualization without specific regression coverage.

## Operating mode

Use Compound Engineering workflow artifacts and subagents for focused audit/work, but keep orchestration and final review in this main session. Subagents may investigate and propose patches; this session owns integration, tests, and production-readiness judgment.

## Strategy

1. Stabilize current branch from latest `v3`.
2. Define acceptance gates and tests before deep rewrites.
3. Split runtime responsibilities gradually:
   - bootstrap/patch subscription
   - timeline normalization/reconcile
   - run/tool/subagent state
   - pagination
   - composer actions
   - scroll anchoring
4. Introduce V2 shell behind a flag or low-risk internal boundary before deleting old code.
5. Use browser/Webwright-style regression checks for visual/interaction claims.
6. Keep looping: implement → run tests/build/browser checks → inspect failures → fix → repeat.

## Initial workstreams

- WS1. Runtime architecture audit: identify seams in `useChatMessages`, required contracts, and safe extraction order.
- WS2. Regression harness: create deterministic fixtures/checks for long chats, tab switching, fast send, streaming/no blink, and tool/subagent display.
- WS3. UI shell: isolate transcript/message/work-spine/composer/scroll behavior so the giant components can shrink.
- WS4. Scroll/performance: remove full-list render hot spots and add instrumentation where useful.
- WS5. Production review: validate gates, update docs, and only then PR.

## Completed pass

- Added `packages/ui/lib/chat-runtime-v2/initialSnapshot.ts` for pure startup snapshot selection.
- Added `packages/ui/lib/chat-runtime-v2/reconcile.ts` for pure optimistic/canonical merge and active-run reconcile guards.
- Kept `useChatMessages` as the compatibility shell while moving fragile pure logic under the Chat Runtime V2 namespace.
- Strengthened optimistic echo dedupe by matching cleaned user text plus attachment names when canonical ids differ.
- Removed the stale `workspaceControls` Header prop that blocked UI typecheck/build.

## Validation gates passed

- `pnpm --filter ui typecheck`
- `pnpm --filter ui exec vitest run lib/chat-runtime-v2/__tests__/initialSnapshot.test.ts lib/chat-runtime-v2/__tests__/reconcile.test.ts lib/__tests__/useChatMessages.reconcile.test.ts lib/chat-engine-v2/__tests__/store.test.ts lib/__tests__/tabSwitchRequests.test.ts lib/chatRowMetadata.test.ts lib/chatToolDisplay.test.ts lib/__tests__/chatStatus.test.ts`
- `pnpm --filter ui exec eslint hooks/useChatMessages.ts lib/chat-runtime-v2/initialSnapshot.ts lib/chat-runtime-v2/reconcile.ts lib/chat-runtime-v2/__tests__/initialSnapshot.test.ts lib/chat-runtime-v2/__tests__/reconcile.test.ts components/AppPage.tsx` (0 errors; pre-existing warnings remain)
- `pnpm --filter ui build`
- `pnpm --filter ui exec tsx ../../scripts/e2e/v2-chat-human-flow.ts`

Browser harness covered:
- same-session cross-tab thinking state
- different-session isolation
- refresh before assistant starts preserves user + thinking
- final answer delivery after refresh
- Chat A generating while Chat B is open remains isolated
- close tab mid-run and reconnect keeps user + thinking and receives answer
- stale cursor backlog recovery beyond websocket replay window
- rapid split-pane reload stress across same/different sessions
- live tool/subagent patches render and survive refresh
- approval result patch renders and survives refresh
