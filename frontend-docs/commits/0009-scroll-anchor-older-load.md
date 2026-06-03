# 0009 — Scroll-anchor on older-page load (no viewport jump)

**Branch:** `v5`
**Scope:** `components/chat/runtime/useStickToBottom.ts`,
`components/chat/ui/ChatViewport.tsx`.
**Status:** complete — 26/26 tests green, typecheck clean, production build green.
**Depends on:** 0005 (timeline UI), 0006 (app shell).

---

## 1. Summary / why

The known 3c follow-up from 0005: when older history is prepended on scroll-up, the
content above the viewport grows but `scrollTop` stays the same, so the view **jumps**
and the row the user was reading flies off-screen. This adds a scroll **anchor** so the
previously-visible rows stay put while older messages load in above them.

## 2. What changed

- `useStickToBottom.ts`
  - New `beginAnchor()` — call it right before requesting an older page. It records the
    current `scrollHeight` and opens a short (~1.8s) compensation window.
  - The existing content `ResizeObserver` now, while an anchor is active, measures each
    growth step and applies the delta to `scrollTop` (`el.scrollTop += delta`) instead of
    sticking to bottom. This survives `@tanstack/react-virtual`'s **multi-step dynamic
    measurement** (estimate → measured), which is why a single `useLayoutEffect` delta
    isn't enough — the height settles over several observer ticks, each compensated.
    **Both directions** are applied: the prepend first grows height (rows estimated at
    96px), then react-virtual *shrinks* it as the new rows measure real height a frame
    later; ignoring the shrink left a ~120px residual jump, so every non-zero delta is
    applied. The window auto-expires so normal live growth still sticks to bottom.
- `ChatViewport.tsx`
  - `loadOlder` now calls `beginAnchor()` immediately before `session.loadOlder()`.
  - Restructured so the scroll region is its own `relative` box: `JumpToLatest` is
    anchored to the **scroll area** bottom (above the composer) instead of the whole
    column, and a "Loading older messages…" hint shows while a page is in flight.

## 3. Why this approach

- **Compensate in the ResizeObserver, not a one-shot effect.** The virtualizer's total
  size changes asynchronously as rows measure; accumulating deltas across observer ticks
  is robust to that, whereas a single post-merge `scrollTop` fix races measurement and
  still jumps.
- **Time-boxed window.** Anchoring only during the load window means live-tail growth and
  user-initiated scrolls behave exactly as before once the page settles.
- **No engine changes.** Pure runtime/UI; `store/**` and `sync/**` untouched, so the
  tested engine and its 26 tests are unaffected.

## 4. Workarounds / gotchas

- The compensation only adds positive deltas (content grew above). Shrinkage (none on
  prepend) is ignored to avoid fighting the stick-to-bottom path.
- Two `ResizeObserver`s observe the content node (stick-to-bottom + anchor are now one
  observer); they don't conflict because anchoring short-circuits the stick path while
  active and we're never pinned during an older-load.

## 4b. Verified (live DOM, Playwright/Firefox)

Production middleware was wedged during this work (see index note), so the anchor was
verified against a local mock serving contract-accurate bootstrap + older pages. A
reference row's screen-Y was measured before/after a scroll-to-top older-load:
- content grew **3130px** above the viewport;
- the reference row moved **12px** (≤24px threshold) → **PASS**, vs an unanchored
  ~3130px jump. Before/after screenshots confirm rows 74–79 stayed aligned.
- Evidence: `webwright-runs/chat-v5-polish/{paging_test.py,shots/anchor_before.png,shots/anchor_after.png}`.

## 5. What to test (manual, against live middleware)

1. Open a session with >1 page of history (e.g. a 1000+ message session).
2. Scroll to the top; the older sentinel fires, "Loading older messages…" shows.
3. Older messages load in **above** the viewport and the row you were reading stays in
   place — **no jump**.
4. Repeat several times; scrolling stays stable. Scroll back to bottom re-pins; live
   growth still follows.

## 6. Follow-ups
- Optional: smooth/Framer height transition on the inserted block.
- Reduced-motion handling for the jump-to-latest smooth scroll.
