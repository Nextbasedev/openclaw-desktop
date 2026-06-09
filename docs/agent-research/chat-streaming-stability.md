# Research: chat streaming stability

## Goal
Fix remaining OpenClaw Desktop chat micro-render bugs on `v5-krish`:
- already-rendered streaming text/line still visually blinks while new text appends,
- after completion the viewport jumps upward/shocks and the full message appears to render again,
- sometimes the completed assistant response text disappears and only tool calls remain,
- verify cache/refetch/end-to-end behavior, not just patch the surface.

## Current behavior observed / reported
- Previous row-order/key fixes are present; current branch has recent chat fixes including `bcfa4969 fix(chat): stop streaming text blink`, `d3f9b0c2 fix(chat): suppress unchanged tool replay patches`, and `5d3f1b60 fix: keep disconnected app on connect page`.
- User reports text rendering is better but still sees line blinking, completion jump/re-render, and occasional text disappearance leaving tool calls.
- Middleware DB was reset earlier; current desktop middleware can be started fresh on Tailscale URL `http://100.89.161.96:8787` with pairing code `OCLECZT9`.

## Relevant files
- `packages/ui/components/ChatView/vercel-ui/OpenClawVercelChat.tsx` — active Vercel-style chat renderer, scroll anchor restore, older-history autoload, active streaming renderer selection.
- `packages/ui/components/ChatView/vercel-ui/useStableChatScroll.ts` — pinned-to-bottom behavior and scroll-to-bottom API.
- `packages/ui/components/ChatView/MarkdownContent.tsx` — markdown rendering + `streaming-text` class when reveal is active.
- `packages/ui/app/globals.css` — `.streaming-text` animates height and last-child opacity/filter, which can visually blink streaming lines.
- `packages/ui/lib/chat-engine-v2/timelineStore.ts` — warm/bootstrap/patch timeline store. `applyPatchMessage()` currently replaces same-id messages instead of merging text/tool state.
- `packages/ui/lib/chatMessageDedupe.ts` — dedupe merge logic already preserves longer assistant text when it has multiple rows to compare, but cannot help if the timeline store overwrites the only same-id row before dedupe sees both.
- `packages/ui/hooks/useChatMessages.ts` — writes local/global/bootstrap state into `ChatTimelineStore`; uses `timelineMessageChanged()` and can apply tool-only snapshots after text-bearing snapshots.
- `packages/ui/lib/chat-engine-v2/store.ts` — global live patch state; contains status/finalization guards and tool attachment logic.

## Data/control flow
1. Middleware/bootstrap/live patches produce `ChatMessage[]` and patch frames.
2. `useChatMessages` receives global state/bootstrap/cache updates, dedupes, persists warm cache, and writes messages to `ChatTimelineStore`.
3. `ChatTimelineStore` maintains a `messageMap` by `messageId`, applies warm cache, bootstrap, optimistic rows, and patch messages, then emits sorted/deduped snapshots.
4. `OpenClawVercelChat` converts messages with `buildStableVercelTimeline()` and renders `VercelMessage` rows.
5. During active generation, current code renders the last assistant as plain pre-wrapped text; when `isGenerating` flips false, that same message switches to `MarkdownContent`.
6. Scroll behavior is controlled by `useStableChatScroll` and older-history anchor restore inside `OpenClawVercelChat`.

## Findings
### F1: Completion renderer swap causes height/layout jump
`VercelMessage` renders active assistant text as plain pre-wrapped text while `isStreaming` is true, but switches to `MarkdownContent` immediately when generation finishes. Markdown headings/lists/paragraph margins differ from plain text layout, so the completed row can change height and appear to render again. If pinned or near older-load threshold, this height change can also shock-scroll the viewport.

### F2: Streaming CSS still creates blink/shimmer in paths using `MarkdownContent streaming`
`globals.css` defines `.streaming-text` with height transition and animates the last child from opacity 0.28 + blur + translate/scale on every streaming update. This can create the exact “line blinking” effect. Even if the Vercel active path bypasses Markdown while streaming, other paths (legacy `MessageBubble`, assistant-ui/subagent/thinking markdown) can still use it.

### F3: Same-id tool-only patch can erase text in `ChatTimelineStore`
`ChatTimelineStore.applyPatchMessage(message, cursor)` currently does `this.messageMap.set(message.messageId, message)`. If an existing assistant row has text and a later patch/bootstrap snapshot for the same `messageId` carries tool calls but empty text, the text is overwritten. `dedupeChatMessages()` would preserve longer text if it saw both rows, but the map replacement means it only sees the new empty-text row. This matches “completed text disappears, only tool calls visible.”

### F4: Bootstrap merge can also replace richer same-id rows
`ChatTimelineStore.mergeMessages()` replaces an existing message with incoming when `newSeq >= existingSeq`. That can downgrade text if bootstrap/replay produces a same-id tool-only or partial row with same/higher gateway index.

### F5: Older-history anchor restore should not run for normal completion
`settleVercelScrollAnchor()` is scoped to `pendingOlderAnchorRef`, so it should only run after older-history loads. However, completion-time renderer height changes can still affect bottom pinning and older-history autoload thresholds; preserving renderer layout at completion is safer than trying to fight scroll after the fact.

## Invariants
- Manual scroll-up must remain respected: auto-follow only when pinned/at bottom; do not force-scroll when user intentionally scrolled up.
- Sending from history should still jump to the new optimistic user message.
- Completed messages should still render Markdown, but not by remounting/shocking the visible active row at finalization.
- Tool cards must remain attached to the assistant turn and must not duplicate.
- Same-id updates should be monotonic for visible content: never replace longer assistant text with empty/shorter tool-only state.
- Warm/bootstrap/cache should not resurrect stale rows or delete newer live rows without explicit remove/prune patches.

## Tests/verification available
- `packages/ui/lib/chat-engine-v2/__tests__/timelineStore.test.ts` — best place for same-id text/tool merge regression.
- `packages/ui/lib/chat-engine-v2/__tests__/timelineStoreIntegration.test.ts` — warm/bootstrap/patch integration cases.
- `packages/ui/lib/chat-engine-v2/__tests__/store.test.ts` — global live patch/status/tool regression suite.
- `packages/ui/components/ChatView/useStreamingText.test.ts` — reveal behavior only.
- Browser/Playwright stress scripts in untracked `tmp-chat-stress/` can be extended for DOM row identity, scrollTop stability, and post-completion text presence.
- Build/type gates: `pnpm --filter ui typecheck`, `pnpm --filter ui build`.

## Risks / unknowns
- Active UI path is Vercel-style chat, but legacy `MessageBubble` still exists and should not regress.
- Disabling `.streaming-text` animation changes visual feel but should improve stability.
- Persistent renderer mode for active messages must be scoped per visible message id to avoid leaving all historical messages in plain text forever.
- Browser dev server can be resource-heavy; static export fallback may be required for verification.

## Second pass: active legacy renderer remaining issues (12:54 UTC)
- The active UI route observed in browser DOM is the legacy `ChatView/index.tsx` + `MessageBubble` path (`data-chat-message-row=true`), not only `OpenClawVercelChat` (`data-vercel-chat-message-row=true`).
- Remaining last-line blink/replay cause: `MessageBubble` used `MarkdownContent` with `streaming={animateAssistantText}` and `revealMode="buffered"` for active assistant text. This can lag/reveal the last lines while the user scrolls and can replay when a canonical/final message remounts.
- Remaining tool switching cause: `ToolCallSteps` sorted by mutable started/completed timestamps and used Framer Motion layout animations. Alternating websocket updates for two running tools can reorder/layout-animate the cards, making them appear to switch back and forth after they already rendered.
