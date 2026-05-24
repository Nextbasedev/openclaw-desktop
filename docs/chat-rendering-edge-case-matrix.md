# Chat Rendering — Edge Case Matrix

## Rendering Pipeline

```
messages[] (from useChatMessages)
  → visibleMessages() (filter deleted/hidden)
  → renderedMessages (windowed: last 20 of N)
  → .map(renderMessageRow)
      → per message:
          ├─ ThinkingBlock (if assistant + reasoningText)
          ├─ ToolCallSteps (if assistant + toolCalls)
          ├─ MessageBubble
          │   ├─ MarkdownContent (react-markdown + syntax-highlighter + mermaid)
          │   ├─ Attachments
          │   ├─ Actions (edit/reply/pin/fork/delete)
          │   └─ SendStatus (if optimistic)
          └─ SubagentCard (if user + spawned subagents)
```

## Component Stats

| Component | Lines | Memoized | JSX Elements | Re-render triggers |
|-----------|-------|----------|--------------|-------------------|
| ChatView | 1672 | No (root) | ~50 | 14 useState, 13 useEffect |
| MessageBubble | 1191 | **No** ⚠️ | 136 | 10 useState, 5 useEffect |
| MarkdownContent | 430 | **No** ⚠️ | ~40 | syntax-highlighter + mermaid |
| ToolCallSteps | 372 | **No** ⚠️ | ~30 | 5 useState |
| ThinkingBlock | 51 | **No** ⚠️ | ~5 | 2 useState |
| SubagentCard | 81 | **No** ⚠️ | ~10 | 2 useState |

**Key finding: NONE of the per-message components are memoized.** Every state change in ChatView re-renders ALL visible messages.

## Current Windowed Rendering

- Initial render: **20 messages** (of 60-160 total)
- Expands by 20 when scrolling near top
- Resets to 20 on session change
- No virtualization library — simple `.slice(-renderWindow)`

## Edge Cases

### 1. Windowed Rendering

| Scenario | Risk | Severity | Mitigation |
|----------|------|----------|------------|
| User scrolls to top of 20-message window | Shows "empty" above, no loading indicator | Medium | expandRenderWindow adds 20 more; but no visual indicator that more exist above |
| User searches for message not in render window | Search won't find it in DOM | Medium | Search should query all `visibleAllMessages`, not just rendered |
| Scroll-to-message (pin click, reply click) targets message outside window | Can't scroll to it — not in DOM | Medium | expandRenderWindow should expand to include target message |
| 160 messages all expanded (all tool outputs open) | Even 20 messages could be thousands of DOM nodes | Low | Tool output is collapsed by default; user must manually expand |
| User scrolls up, window expands to 40, then switches chat and comes back | Window resets to 20 — loses scroll position | Low | Acceptable — new chat starts at bottom |

### 2. Message Re-rendering

| Scenario | Risk | Severity | Mitigation |
|----------|------|----------|------------|
| Status change (idle→thinking) re-renders ALL 20 messages | Unnecessary work | High | **Fix: memoize MessageBubble** — only re-render if message props change |
| New message appended → all 20 re-render | Unnecessary | High | Same fix: React.memo on MessageBubble |
| Tool call update → all messages re-render | Unnecessary | High | ToolCallSteps should be memoized too |
| Typing indicator toggle → all re-render | Unnecessary | Medium | Isolate typing state from message list |
| Popover open/close → all re-render | `activePopoverId` state lives in ChatView | Medium | Move popover state into MessageBubble |
| Pin toggle → all re-render | pinnedIds in messageActionState | Low | Memoize MessageBubble with pinnedIds check |

### 3. Heavy Content Rendering

| Scenario | Risk | Severity | Mitigation |
|----------|------|----------|------------|
| Message with large code block → syntax highlighting | SyntaxHighlighter is expensive (~50ms per block) | Medium | Already lazy via MarkdownContent; could add React.lazy |
| Message with mermaid diagram | Mermaid renders SVG on mount (~100ms) | Medium | Already handled; could defer to intersection observer |
| Tool output with 100KB+ JSON | Full JSON rendered in DOM | High | Should truncate/collapse large outputs |
| 20 messages each with 3 tool calls = 60 ToolCallSteps | 60 unoptimized components | High | Memoize ToolCallSteps + collapse by default |
| Assistant message streaming (text animation) | Re-renders during animation | Medium | `animateText` flag limits to streaming messages only |

### 4. Scroll Behavior

| Scenario | Risk | Severity | Mitigation |
|----------|------|----------|------------|
| New message added while user scrolled up | Auto-scroll fights user's scroll position | Low | Already handled: only scroll if near bottom |
| Window expands (20→40) while user is reading | Scroll position jumps as messages prepend | Medium | Need scroll anchor preservation when prepending |
| Rapid status changes during scroll | Layout thrash from re-renders | Medium | Memoize message components |
| Older messages loaded (pagination) + window expansion | Two sources of prepended messages | Low | Pagination is separate from window expansion |

### 5. Warm Cache → Bootstrap Transition

| Scenario | Risk | Severity | Mitigation |
|----------|------|----------|------------|
| Warm cache has 60 msgs, bootstrap returns 85 | Message count jumps 60→85 → DOM grows | Low | dedupeChatMessages merges; no duplicates |
| Warm cache has old message text, bootstrap has cleaned version | Message content flickers (metadata stripped) | Cosmetic | Brief visual change; user unlikely to notice |
| Warm cache has status='done', bootstrap says status='thinking' | Status flickers done→thinking | Low | Patch stream already delivers real-time status first |
| Warm cache messages render, then bootstrap replaces with different order | Possible scroll jump | Low | Messages ordered by openclaw_seq — order should be stable |

### 6. Optimistic Message Rendering

| Scenario | Risk | Severity | Mitigation |
|----------|------|----------|------------|
| Optimistic user message shown, then confirmed by Gateway echo | Message flickers (optimistic→confirmed) | None | dedupeChatMessages handles; messageId matches |
| Optimistic message shown with sendStatus='sending' while pending | Visual indicator correct | None | Working as designed |
| Optimistic message fails → sendStatus='failed' → retry button | Retry re-sends; original optimistic preserved | None | Working as designed |
| Send during warm cache → optimistic added to 60-msg warm list | 61 messages, still within 20-message window | None | Optimistic appends to end; visible in window |

### 7. Patch Stream Updates During Render

| Scenario | Risk | Severity | Mitigation |
|----------|------|----------|------------|
| 90 tool.update patches arrive in 1 second | 90 state updates → 90 re-renders of 20 messages | High | **Fix needed: batch patch updates** |
| Assistant message streaming (text deltas) | Frequent text updates → frequent re-renders | Medium | animateText flag; but no batching |
| Subagent status changes (working→completed) | Re-render all messages to update SubagentCard | Low | Subagent state is separate from message state |
| Multiple sessions receive patches simultaneously | Only active session's patches affect render | None | Global store isolates sessions |

## Priority Fixes

### Must Fix (High Impact):
1. **Memoize MessageBubble** — `React.memo` with custom equality check on message props
2. **Memoize ToolCallSteps** — prevent re-render when tool data unchanged
3. **Batch patch stream updates** — coalesce multiple patches within 16ms (one frame)
4. **Scroll anchor on window expansion** — preserve scroll position when prepending messages

### Should Fix (Medium Impact):
5. Memoize MarkdownContent — expensive syntax highlighting + mermaid
6. Memoize ThinkingBlock
7. Add visual indicator when windowed (show "N more messages above")
8. Truncate large tool outputs (>10KB) with expand button

### Can Defer:
9. Full virtualization (react-virtuoso) — windowed rendering is sufficient for now
10. Intersection observer for heavy content (code blocks, mermaid)
11. Search across full message list (not just rendered window)
12. Move popover state into MessageBubble to isolate re-renders
