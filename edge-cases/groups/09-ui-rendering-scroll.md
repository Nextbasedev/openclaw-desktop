# Group 09 — UI Rendering & Scroll Bugs

## Connected issues

- Chat can't scroll to latest answer after message arrives while window is blurred/backgrounded
- Markdown code blocks inside paragraphs create invalid HTML (`<div>`/`<pre>` inside `<p>`)
- Broken DOM layout causes scroll height miscalculation
- Activity tab re-renders on every patch (layout thrashing)
- Terminal xterm doesn't auto-scroll on hidden/backgrounded tabs

## Bug inventory

### 1. MarkdownParagraph renders block elements inside `<p>` (HIGH)

**File:** `packages/ui/components/ChatView/MarkdownContent.tsx:196-217`

**Problem:** `MarkdownParagraph` always renders as `<p>`. When the markdown parser places a code block inside a paragraph (common with inline backtick-fenced code that gets promoted to block), the rendered HTML is `<p><div class="group/code..."><pre>...</pre></div></p>`. This is invalid HTML.

**Effect:** Browser auto-closes the `<p>` before the `<div>`, creating broken DOM structure. This corrupts layout height calculations, causing scroll containers to report wrong heights.

**Fix:** Detect block-level children (CodeBlock, table, div) and render as `<div>` instead of `<p>`.

### 2. scrollToBottom uses rAF which doesn't fire when backgrounded (HIGH)

**File:** `packages/ui/hooks/useChatMessages.ts:821-861`

**Problem:** `scrollToBottom` uses `requestAnimationFrame(scroll)`. When the window is blurred/backgrounded (user opened a new window, switched tabs), rAF doesn't fire. Messages arrive via patch stream, component re-renders with new messages, but scroll never happens.

When user returns to the window, `isAtBottomRef.current` may be `false` (because the new content pushed the viewport away from bottom without a scroll event), so future `scrollToBottom` calls are no-ops.

**Fix:** 
- On visibility change to "visible", check if new messages arrived and force scroll
- Or use `setTimeout` fallback when `document.hidden` is true
- Reset `isAtBottomRef.current = true` when new messages arrive from patch stream while generating

### 3. Batch notification uses rAF + 100ms timeout (MEDIUM)

**File:** `packages/ui/lib/chat-engine-v2/store.ts:1068-1097`

**Problem:** `notify()` uses `requestAnimationFrame` to batch listener calls, with a 100ms `setTimeout` fallback. When the window is backgrounded, rAF doesn't fire and notifications accumulate until the 100ms timeout or until the `visibilitychange` handler flushes them. This creates a burst of state updates on tab focus.

**Effect:** When user returns to the window, all accumulated patches flush at once → multiple re-renders → scroll position jumps → layout recalculation storm.

**Already mitigated:** `visibilitychange` handler flushes on foreground (store.ts line ~1090). But the burst can still overwhelm React's batching.

### 4. Activity tab re-renders on every global session update (MEDIUM)

**File:** `packages/ui/hooks/useAgentActivity.ts:777-780`

**Problem:** `subscribeGlobalChatSession` callback runs `syncGlobalActivity()` on every state change. This walks all `pendingTools` and `spawnedSubagents`, does JSON.stringify comparisons, and calls `syncState()` which triggers `setState`. On busy sessions with many tool updates (every 30s tick), this causes continuous re-renders of the activity tree.

**Effect:** Layout thrashing in the inspector panel, especially when multiple tool cards expand/collapse.

### 5. Terminal xterm doesn't handle resize on hidden tab (LOW)

**File:** `packages/ui/components/terminal/XTerminal.tsx:98`

**Problem:** xterm `onResize` sends PTY resize, but if the terminal tab is hidden (zero-height container), resize events may fire with incorrect dimensions. No guard against hidden-tab resize.

**Effect:** Terminal can get stuck at wrong column width after switching away and back.

### 6. Sidebar chat list not virtualized (LOW)

**File:** `packages/ui/components/sidebar/` (chat list components)

**Problem:** All chat entries render in DOM regardless of visibility. With 28+ sessions, this means 28+ React components in the sidebar, each potentially re-rendering when sidebar data refreshes.

**Effect:** Slower initial render, more GC pressure, minor contribution to re-render storms during patch bursts.

## Files to touch

- `packages/ui/components/ChatView/MarkdownContent.tsx` — MarkdownParagraph fix
- `packages/ui/hooks/useChatMessages.ts` — scroll-on-focus, rAF fallback
- `packages/ui/lib/chat-engine-v2/store.ts` — notification batching (optional)
- `packages/ui/hooks/useAgentActivity.ts` — throttle syncGlobalActivity
- `packages/ui/components/terminal/XTerminal.tsx` — hidden-tab resize guard

## Must happen after

- Group 02 (focused window bootstrap) — scroll bugs are more visible once messages arrive correctly
- Group 05 (activity hydration) — activity re-render fix overlaps

## Priority order within this group

1. MarkdownParagraph `<p>` → `<div>` for block children (fixes scroll height)
2. scrollToBottom visibility/focus handler (fixes can't-scroll-after-background)
3. Activity syncGlobalActivity throttle (reduces re-render storms)
4. Terminal resize guard (minor)
5. Sidebar virtualization (optimization, not bug)
