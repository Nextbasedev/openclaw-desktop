# Live Assistant Text Animation

## Problem
Assistant response text currently uses the same `streaming` render path for both active generation and persisted `message.animateText` flags. That can make historical/reloaded assistant messages eligible for reveal styling if the flag survives in state/cache. The requested behavior is stricter: animate assistant text only while the current response is actively generating, and do not affect tool-call rendering or chat caching.

## Current Flow
- `packages/ui/components/ChatView/index.tsx` computes `isActivelyStreaming` only for the last assistant message while `isGenerating` is true.
- `packages/ui/components/ChatView/MessageBubble.tsx` passes `streaming={isActivelyStreaming || message.animateText}` into `MarkdownContent`.
- `packages/ui/components/ChatView/MarkdownContent.tsx` uses `useStreamingText(..., streaming, ..., { mode: "immediate" })`, then applies `streaming-text` styling while revealing.
- Tool calls render separately through `ToolCallSteps`; assistant Markdown text is only rendered inside `MessageBubble` when `msg.text` exists.
- Cache/state layers may keep `animateText` flags for assistant messages; this feature should not depend on or mutate those caches.

## Proposed Fix
1. Scope assistant text animation to `isActivelyStreaming` only in `MessageBubble`.
2. Keep tool-call rendering untouched: no changes to `ToolCallSteps`, pending tool filters, or tool message merge logic.
3. Keep cache/state behavior untouched: no changes to warm cache, chat engine store, patch projection, or persistence.
4. Upgrade the CSS animation behind `streaming-text` to a FlowToken-inspired blur/fade/slide reveal for the newest rendered Markdown block.
5. Preserve `prefers-reduced-motion: reduce` behavior.

## Files to Change
- `packages/ui/components/ChatView/MessageBubble.tsx` — pass active-generation-only streaming flags to assistant Markdown/error text.
- `packages/ui/app/globals.css` — improve live text reveal animation CSS while preserving reduced-motion handling.

## Risks
- Markdown structure means animation applies to the latest rendered Markdown block rather than every individual word/token. This avoids breaking code blocks, tables, links, and custom Markdown rendering.
- If `message.animateText` is still present in state/cache, it will no longer trigger visual animation in history. That is intentional for this request.
- Long responses should remain performant because no per-token DOM wrapping is added.

## Testing
- `pnpm --filter ui typecheck`
- `pnpm --filter ui build`
- Inspect diff to confirm no tool-call, warm-cache, or chat-engine persistence files changed.
