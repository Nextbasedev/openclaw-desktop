# Plan: chat bootstrap visible history top-up

## Summary
Keep the raw bootstrap limit at `160`, but auto-top-up older raw history during initial bootstrap when the parsed visible transcript is still too short for tool-heavy sessions.

## Files to change
- `packages/ui/hooks/useChatMessages.ts`
- `packages/ui/lib/__tests__/useChatMessages.reconcile.test.ts`

## Steps
1. Add a bounded bootstrap top-up helper.
2. Reparse visible history after each older raw page.
3. Stop when visible rows reach a minimum threshold, no older history remains, or the max top-up page budget is hit.
4. Preserve the existing older-page path and session-scoped raw-history buffer.
5. Add regression coverage for top-up behavior.

## Verification
- `pnpm --filter ui exec vitest run lib/__tests__/useChatMessages.reconcile.test.ts`
- `pnpm --filter ui typecheck`
- `pnpm --filter ui exec vitest run`

## Non-goals
- Do not change backend page size again.
- Do not remove tool/result coalescing entirely.
