# Plan: chat history autoload stability

## Summary
Fix two exact causes of unstable history loading:
1. remove synchronous bootstrap visible top-up from the blocking first-load path
2. replace total-height-ratio older-load triggering with stable near-top distance rules

## Files to change
- `packages/ui/hooks/useChatMessages.ts`
- `packages/ui/components/ChatView/chatHistoryAutoLoad.ts`
- `packages/ui/lib/__tests__/chatHistoryAutoLoad.test.ts`
- `packages/ui/lib/__tests__/useChatMessages.reconcile.test.ts`

## Steps
1. Stop blocking bootstrap on visible top-up pages.
2. Keep the combined-raw-history pagination fix.
3. Replace ratio thresholds with absolute top-distance thresholds plus fast upward-scroll prefetch.
4. Add regression tests showing trigger behavior is consistent across different total scroll heights.
5. Run targeted and broad UI verification.

## Verification
- `pnpm --filter ui exec vitest run lib/__tests__/chatHistoryAutoLoad.test.ts lib/__tests__/useChatMessages.reconcile.test.ts`
- `pnpm --filter ui typecheck`
- `pnpm --filter ui exec vitest run`

## Non-goals
- Do not change backend bootstrap page size again.
- Do not remove assistant/tool coalescing in this pass.
