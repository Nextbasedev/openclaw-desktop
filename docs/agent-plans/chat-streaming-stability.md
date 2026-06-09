# Plan: chat streaming stability

## Summary
Make chat rendering monotonic and stable during/after assistant generation by:
1. removing streaming line blink animations,
2. avoiding same-turn renderer/layout swaps at completion,
3. making timeline-store same-id merges preserve richer text/tool content,
4. verifying with targeted unit tests plus browser DOM/scroll checks.

## Files to change
- `packages/ui/app/globals.css`
  - Remove/neutralize `.streaming-text` height/opacity/blur animation that causes line blinking.
- `packages/ui/components/ChatView/vercel-ui/OpenClawVercelChat.tsx`
  - Keep active assistant row in a stable text renderer through the completion settle window; only switch to Markdown after it is no longer the just-completed live row.
  - Avoid changing row key or message identity.
- `packages/ui/lib/chat-engine-v2/timelineStore.ts`
  - Add a merge helper for same-id messages that preserves longer assistant text, merges tool calls/attachments/metadata, and prevents tool-only updates from blanking text.
  - Use the helper in `applyPatchMessage()`, `applyBootstrap()`/`mergeMessages()`, and optimistic confirmation as appropriate.
- `packages/ui/lib/chat-engine-v2/__tests__/timelineStore.test.ts`
  - Add regression: same-id tool-only patch after text patch keeps text and merges tools.
  - Add regression: bootstrap/tool-only same-id row does not downgrade richer live text.
- Optional if needed: `packages/ui/lib/chat-engine-v2/__tests__/timelineStoreIntegration.test.ts`
  - Add integration coverage if unit tests are insufficient.

## Steps
1. Patch `.streaming-text` CSS so streaming updates do not animate opacity/blur/height. Keep cursor if useful, but avoid blinking already-rendered content.
2. In Vercel chat, track the just-completed assistant `uiId` and keep it in the stable plain-text renderer for a short settle window. This prevents immediate plain→Markdown height shock on terminal status.
3. Add `mergeTimelineMessage(existing, incoming)` in `timelineStore.ts`:
   - for assistant text: preserve/merge longer text using existing dedupe helper `mergeAssistantText`,
   - for tools: merge by tool id, preserving terminal state/result/duration,
   - preserve richer metadata without overwriting with undefined/empty values,
   - preserve attachments/embeds enough to avoid loss.
4. Replace direct same-id `messageMap.set()` in timeline store paths with the merge helper.
5. Add tests proving text cannot disappear when tool-only same-id updates arrive after text.
6. Run targeted tests:
   - `pnpm --filter ui exec vitest run lib/chat-engine-v2/__tests__/timelineStore.test.ts lib/chat-engine-v2/__tests__/timelineStoreIntegration.test.ts`
   - If store tests are too slow, run the single file first.
7. Run gates:
   - `pnpm --filter ui typecheck`
   - `pnpm --filter ui build`
8. Browser verification:
   - Use static export/dev fallback as needed.
   - Send a tool-using long prompt and a plain long prompt.
   - Verify row node identity remains stable, no duplicate row ids, post-completion text still present, and scrollTop does not jump upward after completion.
9. Commit and push to `origin/v5-krish`.

## Verification
- Unit tests for timeline merge regressions.
- Typecheck and UI build.
- Browser DOM/scroll observer with fresh middleware DB:
  - active assistant row not repeatedly removed/remounted,
  - text length never drops to zero after completion,
  - tool calls and text coexist on same assistant row,
  - viewport stays pinned or respects manual scroll.

## Risks
- Keeping just-completed row plain text for a settle window delays Markdown formatting very briefly; acceptable compared with visible shock/jump.
- If user reloads after completion, stored messages should render Markdown normally; do not persist “plain mode”.
- Timeline merging must not accidentally merge distinct assistant messages; only same-id replacement paths get the stronger merge.

## Non-goals
- Do not redesign chat UI.
- Do not alter middleware projection semantics unless UI-side monotonic merge is insufficient.
- Do not delete or commit `screenshots/` or `tmp-chat-stress/` artifacts unless explicitly requested.
- Do not touch assistant workspace memory/reference files for this code fix.

## Second-pass implementation addendum
- Patch `MessageBubble.tsx` so actively streaming assistant text renders as stable pre-wrapped plain text instead of buffered `MarkdownContent` reveal; completed/non-active assistant rows still render Markdown.
- Patch `ToolCallSteps.tsx` so tool cards retain first-seen order during a render lifecycle and remove layout-position animation from rows/container. Status/content may update, but rows should not visually swap on alternating websocket patches.
