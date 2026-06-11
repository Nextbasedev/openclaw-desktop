# Plan: chat history pagination parse boundary instability

## Summary
Fix older-history loading so transcript parsing is stable across pagination boundaries. Instead of parsing each page separately and merging parsed chat messages, retain the loaded raw history window and reparse the combined raw history after prepending an older page.

## Files to change
- `packages/ui/hooks/useChatMessages.ts`
- `packages/ui/lib/__tests__/useChatMessages.reconcile.test.ts`
- optionally a small new helper file if extraction keeps the hook readable

## Steps
1. Add a hook-level raw-history buffer/ref for the loaded canonical history window.
2. On bootstrap success, store the raw bootstrap rows in that buffer.
3. On older-page load:
   - convert page rows to raw messages
   - prepend them to the stored raw history window
   - reparse the combined raw history in one pass
   - hydrate attachments / strip transient state / dedupe
   - preserve any current optimistic/live-only rows when applying the reparsed transcript
4. Reset the raw-history buffer when session/view changes.
5. Add regression coverage for a page boundary that splits one assistant turn across two pages.

## Verification
- targeted UI test covering separate-page vs combined-raw parsing
- `pnpm --filter ui typecheck`
- `pnpm --filter ui exec vitest run ...`
- if needed, live curl-backed inspection again for the previously problematic session

## Risks
- More reparse work per older-page load.
- Need to avoid dropping current optimistic/live rows that are not represented in canonical raw history.

## Non-goals
- Do not change backend page size again.
- Do not redesign the mature renderer row model unless this fix still leaves a separate issue.
- Do not touch unrelated generated output or untracked folders.