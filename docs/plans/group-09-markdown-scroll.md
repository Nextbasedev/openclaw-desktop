# Group 09 — Markdown Nesting + Scroll Fix

## Problem

1. `MarkdownParagraph` always renders as `<p>`. When code blocks (which render as `<div><pre>...</pre></div>`) are children, the HTML is invalid (`<p>` cannot contain block elements). Browsers auto-close the `<p>`, creating broken DOM that corrupts scroll height calculations.

2. `scrollToBottom` uses `requestAnimationFrame` which doesn't fire when the window is backgrounded. Messages arrive via patch stream, component re-renders, but scroll never happens. When user returns, they can't see the latest answer.

## Current Code Flow

### Markdown (MarkdownContent.tsx:196-217)
- `MarkdownParagraph` receives `children` from react-markdown parser
- Always renders `<p className="...">{content}</p>`
- Code blocks inside paragraphs become `<p><div class="group/code"><pre>...</pre></div></p>`
- Browser auto-closes `<p>` → broken DOM → wrong `scrollHeight`

### Scroll (useChatMessages.ts:821-861)
- `scrollToBottom` checks `isAtBottomRef.current` → if false, returns (no-op)
- Uses `requestAnimationFrame(scroll)` → doesn't fire when `document.hidden = true`
- No handler for `visibilitychange` or `focus` to recover scroll position

## Fix

### Markdown
- Added `hasBlockChildren()` that checks if any child is a block-level element (div, pre, table, CodeBlock, MermaidBlock)
- `MarkdownParagraph` renders as `<div>` when block children detected, `<p>` otherwise

### Scroll
- Added `useEffect` that listens to `visibilitychange` and `focus`
- On regain: calls `forceScrollToBottom(false)` if generation finished while backgrounded or is still active

## Files Changed

- `packages/ui/components/ChatView/MarkdownContent.tsx`
- `packages/ui/hooks/useChatMessages.ts`

## Risks

- `hasBlockChildren` uses `React.Children.toArray` + element type checks. If a custom component doesn't match by name, it falls through to `<p>`. Safe fallback — same behavior as before.
- Scroll-on-focus fires unconditionally when `isGenerating` or status is `done`. Could scroll when user intentionally scrolled up to read history. Acceptable tradeoff — `forceScrollToBottom` is what the existing send flow uses.

## Verification

- `pnpm --filter ui typecheck` ✅
- `pnpm --filter ui build` ✅
- Manual: send message, switch to another window, come back → should auto-scroll to answer
