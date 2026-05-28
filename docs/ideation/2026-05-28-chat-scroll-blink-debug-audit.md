---
title: Chat Large-Data Scroll / Blink Debug Audit
status: diagnosis-only
date: 2026-05-28
workflow: ce-debug
scope: OpenClaw Desktop ChatView large transcript scrolling and blink/jank issues
---

# Chat Large-Data Scroll / Blink Debug Audit

## Problem

Reported existing issues:
- Scrolling problems when chat has large data / long history / large outputs.
- Occasional visual blink or jump.

This audit is diagnosis-only. No code changes were made.

## Environment / Branch

- Repo: `/root/.openclaw/workspace/openclaw-desktop`
- Branch during audit: `v3`
- Existing untracked docs directory: `docs/ideation/`

## Files inspected

- `packages/ui/components/ChatView/index.tsx`
- `packages/ui/hooks/useChatMessages.ts`
- `packages/ui/components/ChatView/MessageBubble.tsx`
- `packages/ui/components/ChatView/MarkdownContent.tsx`
- `packages/ui/components/ChatView/useStreamingText.ts`
- `packages/ui/lib/chatToolDisplay.ts`
- `packages/ui/lib/messageActions.ts`
- `docs/constraints/ui-scroll.md`
- `docs/constraints/chat-engine.md`

## Constraints already documented

From `docs/constraints/ui-scroll.md`:
- Main transcript intentionally uses a plain DOM scroll container, not `react-virtuoso`.
- Virtualization was removed because live tool/status updates caused anchoring jumps.
- ChatView owns scroll behavior.
- Follow-scroll should happen only when user is near bottom.
- Older-message prepends must preserve viewport position by DOM scroll math.

These constraints are important: the fix should not simply reintroduce virtualization without a dedicated regression strategy.

## Confirmed Code-Level Findings

### 1. Large transcripts render every message on every update

Evidence:
- `ChatView/index.tsx:1754-1755` maps every `renderedMessages` entry directly into DOM.
- `renderedMessages` is currently the full visible message list: `ChatView/index.tsx:793-797`.

Causal chain:
1. Large chat loads many messages or a long history page is prepended.
2. `renderedMessages.map(...)` renders every visible message.
3. Streaming/status/tool updates cause ChatView to re-render often.
4. Even with memoized `MessageBubble`, ChatView still runs per-row render logic for the full list and React reconciles a large tree.
5. Browser main thread stalls; scroll can feel sticky, delayed, or jumpy.

Confidence: high.

### 2. Per-row render work contains O(n²)-style scans over `renderedMessages`

Evidence:
- For each assistant row, `renderMessageRow` scans later messages via `renderedMessages.slice(index + 1)` to determine `hasLaterAssistantInSameTurn`: `ChatView/index.tsx:1378-1386`.
- For each row, `filteredPending` checks whether each pending tool exists in message history using `renderedMessages.some(...)`: `ChatView/index.tsx:1393-1401`.
- Whole-list memos also scan messages on every list change: `groupAssistantToolCallsByMessage(renderedMessages)` at `ChatView/index.tsx:1206-1210`, `terminalToolStateById(renderedMessages, pendingTools)` at `ChatView/index.tsx:1212-1214`, and active turn scans at `ChatView/index.tsx:1217-1235`.

Causal chain:
1. Every message render can perform scans of the message list.
2. With hundreds/thousands of messages, work grows faster than linearly.
3. Streaming/tool patches keep invalidating `renderedMessages` or status-derived props.
4. Main-thread render cost spikes, causing scroll jank and possible visible blink during reconciliation.

Confidence: high.

Prediction to verify:
- Profiling a large transcript should show `ChatView` render and `renderMessageRow` consuming significant time even when only the latest assistant/tool state changes.

### 3. Scroll effects force layout reads/writes on frequent dependencies

Evidence:
- `syncJumpToBottomVisibility()` reads `scrollHeight`, `scrollTop`, and `clientHeight`: `ChatView/index.tsx:1015-1020`.
- An effect calls it whenever `pendingTools`, `renderedMessages`, `status`, or `statusLabel` changes: `ChatView/index.tsx:1022-1046`.
- A layout effect calls `bottomRef.current?.scrollIntoView(...)` whenever `renderedMessages.length`, `isGenerating`, `pendingTools.length`, `status`, or `statusLabel` changes, if `isAtBottomRef.current` is true: `ChatView/index.tsx:1062-1065`.

Causal chain:
1. Tool/status/stream updates are frequent during an active run.
2. Each update reads layout measurements and sometimes writes scroll position.
3. On a large DOM, layout measurement is expensive and can force style/layout calculation.
4. If content height is still changing due to markdown/code/images/iframes, `scrollIntoView` can fight natural layout settling.
5. Result: scroll jank or a visible bottom-area blink.

Confidence: high.

Prediction to verify:
- Performance trace should show layout/recalculate-style work around chat updates, especially near `scrollHeight` reads and `scrollIntoView` calls.

### 4. Older-message prepend preserves scroll only once, before async content heights settle

Evidence:
- `loadOlderMessages()` captures `previousScrollHeight`/`previousScrollTop`, prepends older messages, then in one `requestAnimationFrame` adjusts scrollTop by height delta: `useChatMessages.ts:2887-2889`, `2943-2976`.
- Markdown content can include syntax highlighting, images, and iframes whose final heights can settle after that one RAF. Examples: `MarkdownContent.tsx:81-127` for syntax-highlighted code blocks and `MarkdownContent.tsx:302-331` iframe embed height adjustment.

Causal chain:
1. User scrolls near top; older messages are prepended.
2. Code adjusts scrollTop once after React paints.
3. Some content changes height after that: syntax/highlight render, image load, iframe `onLoad`, markdown expansion, code fonts.
4. The original anchor position drifts after the single adjustment.
5. User sees a jump/blink after large history loads.

Confidence: medium-high.

Prediction to verify:
- Repro with older messages containing code blocks/images/embeds should jump more than plain-text older pages.

### 5. Streaming markdown reparses/rerenders large assistant text on updates

Evidence:
- `MessageBubble` passes active assistant text into `MarkdownContent` with `streaming={Boolean(isActivelyStreaming)}`: `MessageBubble.tsx:925-932`.
- `MarkdownContent` uses `useStreamingText(..., { mode: "immediate" })`: `MarkdownContent.tsx:378-382`.
- `useStreamingText` in immediate mode commits the full target on every changed target and toggles reveal state for 180ms: `useStreamingText.ts:100-112`.
- `MarkdownContent` then runs `ReactMarkdown` for each text part: `MarkdownContent.tsx:363-382` and the render below it.
- Code blocks use `react-syntax-highlighter`: `MarkdownContent.tsx:98-115`.

Causal chain:
1. Large assistant response streams or updates frequently.
2. The full markdown string is reparsed/rerendered repeatedly.
3. Large code blocks/tables amplify render cost via syntax highlighting and GFM parsing.
4. Frame budget is exceeded; scroll becomes janky.
5. The `streaming-text` class / reveal state can also create perceived blink during rapid changes.

Confidence: high for jank; medium for visible blink.

Prediction to verify:
- Long code-heavy assistant responses should jank more than same-length plain text.

### 6. `setMessages` does expensive write-through work on every message update

Evidence:
- `setMessages` dedupes messages, schedules warm-cache persistence, updates cached bootstrap messages, scans timeline store IDs, removes stale entries, and applies each changed message: `useChatMessages.ts:689-713`.
- Global chat subscription calls `setMessages(state.messages)` for every patch-state notification: `useChatMessages.ts:1788-1805` and `2037-2067`.

Causal chain:
1. Stream/patch bus emits frequent session state updates.
2. Each update passes the whole message array to `setMessages`.
3. `setMessages` does list-level dedupe and timeline-store reconciliation.
4. On large transcripts, this becomes expensive before React rendering even begins.
5. Expensive state update + expensive render compounds into scroll jank.

Confidence: medium-high.

Prediction to verify:
- Profiling should show time inside `dedupeChatMessages`, timeline store reconciliation, and `setLocalMessages` path during active runs on large histories.

### 7. Message-level memoization is helpful but incomplete for large-data rendering

Evidence:
- `MessageBubble` has a custom comparator: `MessageBubble.tsx:1203-1235`.
- It compares `messageId`, `text`, `role`, branch count, active branch, toolCalls length, and some UI props.
- It does not compare attachments, embeds, usage, reasoning text, tool status contents, or attachment/preview-related fields.

Causal chain:
1. Memoization can skip many stable bubbles.
2. But the parent still computes row-level data for every message.
3. Some message changes can be missed by the comparator if the message object changes but compared fields do not.
4. Missed updates are more likely to cause stale UI than blink; parent recomputation still causes jank.

Confidence: medium.

Prediction to verify:
- Attachment/embed-only updates may not refresh a bubble unless another compared prop changes.

## Most Likely Root Cause Summary

This appears to be a performance + scroll anchoring interaction, not one isolated bug.

Primary root cause:
- The main chat timeline renders the full visible history with expensive per-row and whole-list computations, while live streaming/tool/status updates happen frequently.

Secondary root cause:
- Scroll measurement and `scrollIntoView` run on frequent active-run dependencies, and older-message anchoring adjusts only once even though rich content heights can settle later.

Blink likely comes from one or more of:
- Full-list reconciliation under heavy render cost.
- Frequent bottom `scrollIntoView` while status/tool rows change height.
- Streaming markdown reveal class/state changes on large content.
- Older-message prepends followed by late height changes from syntax/code/images/iframes.

## Recommended Fix Strategy

Do not jump straight to virtualization. The repo already documents why naive virtualization regressed live updates.

Recommended order:

### Phase 1 — Instrument and reproduce

Add temporary/dev-only measurements around:
- ChatView render duration and `renderedMessages.length`.
- `renderMessageRow` loop cost.
- `groupAssistantToolCallsByMessage` and `terminalToolStateById` cost.
- `setMessages` duration and message count.
- Scroll effect calls: when they read layout, when they call `scrollIntoView`, and current distance from bottom.

Create or use a test/dev fixture with:
- 500+ short messages.
- 100+ tool calls.
- A few very large markdown/code messages.
- Older-message pagination with code/images/embeds.

### Phase 2 — Remove O(n²) render work first

Potential changes:
- Precompute per-message flags like `hasLaterAssistantInSameTurn` in one reverse pass instead of scanning forward per row.
- Precompute a `Set` of all displayed tool IDs once instead of `renderedMessages.some(...)` inside each row.
- Keep active-turn computations scoped to the current turn only.

Why first:
- Low product/design risk.
- Keeps current non-virtualized architecture.
- Directly attacks the large-data path.

### Phase 3 — Extract `useChatScrollAnchor`

Centralize:
- Initial bottom scroll.
- Pinned-to-bottom state.
- Jump-to-bottom visibility.
- Older-message prepend anchoring.
- Status/tool update follow-scroll.

Improve older-message anchoring:
- Anchor by first visible message ID + offset where possible, not only scrollHeight delta.
- Re-adjust after late layout settling for rich content, with a bounded second/third RAF or ResizeObserver during prepend only.

### Phase 4 — Reduce streaming markdown cost

Potential changes:
- For actively streaming large markdown, render plain/preformatted or lightly parsed text until the turn stabilizes, then render full `ReactMarkdown` + syntax highlighting.
- Defer syntax highlighting for code blocks until stream complete or block visible/expanded.
- Memoize markdown rendering by stable `messageId:textVersion` for non-streaming historical messages.

### Phase 5 — Consider bounded/windowed rendering only after the above

If the above is insufficient, consider a custom anchored windowing strategy rather than generic virtualized list:
- Keep current turn, nearby viewport, and anchor buffers mounted.
- Preserve tool/status updates in active turn.
- Add explicit regression tests for live tool/status anchoring before adopting.

## Recommended Tests / Verification

Automated where possible:
- Unit test for precomputed turn flags matching existing behavior.
- Unit test for displayed tool ID set / duplicate suppression.
- Test `loadOlderMessages` anchor preservation with synthetic height deltas if feasible.

Manual/performance smoke:
- Open 500+ message chat; scroll top/middle/bottom.
- Stream a large markdown/code response while pinned to bottom.
- Stream while user is scrolled away from bottom.
- Load older messages containing code blocks/images/embeds.
- Expand/collapse long tool stacks.
- Open subagent full chat with many messages and live updates.

Expected success criteria:
- No visible jump when loading older messages.
- No auto-scroll when user is intentionally reading older content.
- No blink when tool/status updates arrive during large transcript.
- Main-thread frame time stays under interactive threshold during large chat updates.

## Proposed Next Step

Create a focused branch and implement Phase 1 + Phase 2 only:
- Add temporary perf marks/logs if acceptable, or keep them behind a debug flag.
- Replace per-row O(n²) scans with precomputed maps/sets.
- Validate behavior remains identical with current chat/tool tests.

Then test against a large local fixture before touching scroll anchoring.
