# UI Scroll Constraints

## Core Rules

1. **First chat open** → scroll to latest/bottom (via `historyLoadVersion` signal)
2. **User sends message** → force-scroll to bottom (smooth)
3. **Live assistant/tool/thinking updates** → follow-scroll ONLY if user is already near bottom
4. **User scrolls up** → preserve position, show jump-to-bottom button
5. **Load older messages** → preserve viewport position (no jump)
6. **Background/inactive split panes** → must NOT steal scroll

## Implementation

### History Load Signal (`historyLoadVersion`)
- Initialized to `1` when warm/global cache messages exist on mount
- Incremented by `markHistoryLoaded()` on:
  - Warm cache hydration
  - Global session cache hydration
  - Fresh bootstrap completion
- `ChatView` watches this via `useLayoutEffect` → scrolls to bottom before paint

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
