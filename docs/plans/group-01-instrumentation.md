# Group 01 — Instrumentation Plan

## Problem

The desktop edge-case work spans focused/new chat windows, chat state bootstrap/replay, subagent rendering, Activity tab loading, and inspector state. Before behavior changes, we need durable diagnostics to confirm which source of state is winning and where counts/cursors diverge.

## Current Flow

Relevant paths:

- Focused/new chat window initializes through `packages/ui/components/AppPage.tsx` and `packages/ui/hooks/useChatMessages.ts`.
- Chat state is seeded/updated through `packages/ui/lib/chat-engine-v2/store.ts`.
- Warm cache is applied before fresh bootstrap in `useChatMessages.ts`.
- Subagent display in ChatView uses both session-global `spawnedSubagents` and message/turn-derived maps in `packages/ui/components/ChatView/index.tsx`.
- Activity tab reads from `packages/ui/hooks/useAgentActivity.ts` and performs history/backfill work.
- Workspace inspector effective session state is held in `packages/ui/components/inspector/WorkspaceTab.tsx`.

## Proposed Fix

Instrumentation only:

1. Log focused bootstrap application with cursor/message/subagent counts.
2. Log patch cursor relation when a patch arrives before local state exists.
3. Log subagent render scope counts without classifying mismatches as bugs yet.
4. Log Activity first paint and history/subagent-history request counters.
5. Log duplicate user-message candidates without raw user text.
6. Log Workspace effective session mismatch.

## Files Changed

- `packages/ui/lib/clientLogs.ts`
  - Add categories for upcoming diagnostics.
  - Add runtime-salted text hash helper for duplicate-message grouping.

- `packages/ui/hooks/useChatMessages.ts`
  - Add warm-cache/bootstrap duplicate candidate diagnostics.
  - Add `focused.bootstrap.applied` diagnostics.

- `packages/ui/lib/chat-engine-v2/store.ts`
  - Add `patch_stream.cursor_relation` diagnostics.

- `packages/ui/components/ChatView/index.tsx`
  - Add memoized subagent render scope diagnostics.

- `packages/ui/hooks/useAgentActivity.ts`
  - Add `activity.open` mount/first-paint diagnostics.

- `packages/ui/components/inspector/WorkspaceTab.tsx`
  - Add `inspector.session_mismatch` diagnostics.

## Risks

- Log volume can increase during streaming and re-render-heavy flows.
- Duplicate-message candidate hashes must not expose raw user text.
- Warning-level diagnostics can mislead later debugging if they classify expected state differences too early.

Mitigations applied:

- ChatView subagent grouping is memoized.
- Broad subagent mismatch classification is logged at `debug`, not `warn`.
- User text is represented via runtime-salted hash, not raw text.

## Testing

Checks run on PR #67:

- `pnpm --filter ui typecheck`
- `pnpm --filter ui build`
- `pnpm --filter ui lint` was also checked, but repo has existing unrelated lint failures.

## PR

- PR #67: `https://github.com/Nextbasedev/openclaw-desktop/pull/67`
- Branch: `fix/group-01-instrumentation`

## Follow-up

After Group 01 lands, Group 02 should use these logs to verify focused/new window bootstrap, warm cache, and patch replay before changing behavior.
