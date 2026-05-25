# UI Scroll Constraints

## Status

- **Group 09 complete** — PR #73 merged into `v3` (`e3cafb4`).
- Live validation confirmed first app open / refresh scrolls to the latest message.
- Remaining work in this file is constraint documentation, not active Group 09 implementation.

## Core Rules

1. **First chat open** → scroll to latest/bottom (via `historyLoadVersion` signal)
2. **User sends message** → force-scroll to bottom (smooth)
3. **Live assistant/tool/thinking updates** → follow-scroll ONLY if user is already near bottom
4. **User scrolls up** → preserve position, show jump-to-bottom button
5. **Load older messages** → preserve viewport position (no jump)
6. **Background/inactive split panes** → must NOT steal scroll

## Implementation

### Initial Bottom Position
- First open / refresh must land at latest/bottom after async warm-cache or bootstrap hydration.
- `ChatView` keeps Virtuoso `firstItemIndex` stable across warm-cache → bootstrap replacements.
- `firstItemIndex` only moves for real older-message prepends, never for appends or bootstrap refreshes.
- After first async data load, `ChatView` performs one guarded `scrollToIndex(LAST)` if the user has not scrolled.

### History Load Signal (`historyLoadVersion`)
- Initialized to `1` when warm/global cache messages exist on mount
- Incremented by `markHistoryLoaded()` on:
  - Warm cache hydration
  - Global session cache hydration
  - Fresh bootstrap completion
- `ChatView` watches history/data readiness and scrolls to bottom before/at first stable paint

### Scroll Ownership
- `ChatView` owns DOM scroll behavior (not `useChatMessages`)
- Uses `useLayoutEffect` + double `requestAnimationFrame` + settle timeout
- `bottomRef` included in layout effect deps for lint safety
- Guarded: skips scroll if `isBackgroundSession` or `renderedMessages.length === 0`

### Follow-Scroll
- `scrollToBottom(force: boolean)`:
  - `force=true` → always scroll (used for user-send)
  - `force=false` → only scroll if `isAtBottomRef.current` is true
- `isAtBottomRef` updated by scroll events with programmatic-scroll debounce (80ms/350ms)
- Live message updates use `scrollToBottom(false)` to avoid bounce

### Jump-to-Bottom Button
- Shown when user scrolls away from bottom
- Hidden during programmatic scrolls (debounce window)
- Click → `forceScrollToBottom(true)` with smooth behavior
