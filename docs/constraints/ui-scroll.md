# UI Scroll Constraints

## Status

- **Group 09 complete** — PR #73 merged into `v3` (`e3cafb4`).
- Live validation confirmed first app open / refresh scrolls to the latest message.
- **2026-05-26 update:** Chat timeline no longer uses `react-virtuoso`; `ChatView` renders a plain DOM scroll container to avoid virtualizer anchoring jumps during live tool/status updates.
- Remaining work in this file is constraint documentation, not active Group 09 implementation.

## Core Rules

1. **First chat open** → scroll to latest/bottom (via `historyLoadVersion` signal)
2. **User sends message** → force-scroll to bottom (smooth)
3. **Live assistant/tool/thinking updates** → follow-scroll ONLY if user is already near bottom
4. **User scrolls up** → preserve position, show jump-to-bottom button
5. **Load older messages** → preserve viewport position (no jump)
6. **Background/inactive split panes** → must NOT steal scroll

## Implementation

### Chat Timeline Rendering
- The main chat transcript must use a normal DOM scroll container (`overflow-y-auto`), not a virtualized list.
- Do not reintroduce `react-virtuoso`/virtualized timeline rendering for the main chat without a specific regression test for live tool-card/status updates.
- Short chats should top-align normally; do not use bottom-alignment wrappers such as `justify-end` that move the thinking/status row toward the center.
- The status/footer row must reserve stable height so `Thinking`, `Running tool`, and `Responding` transitions do not shift the transcript.

### Initial Bottom Position
- First open / refresh must land at latest/bottom after async warm-cache or bootstrap hydration.
- After first async data load, `ChatView` performs one guarded `bottomRef.scrollIntoView({ block: "end" })` if the user has not scrolled.

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
- Older-message prepends must preserve viewport position by DOM scroll math, not virtualizer index offsets.

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
