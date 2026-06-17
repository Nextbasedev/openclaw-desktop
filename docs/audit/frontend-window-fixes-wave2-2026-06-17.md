# Frontend Window Foundation Fixes — Wave 2 — 2026-06-17

**Branch:** `v6-1-krish-window-stabilize`
**Agent:** W2 (frontend)
**Scope:** `packages/ui/` only

## Commit

| SHA | Subject |
| --- | --- |
| `b2627729` | fix(chat): strict newer-page eviction with bottom-proximity guard (BUG-2) |

## BUG-2 — status: **fixed**

### Root cause confirmed

`packages/ui/components/ChatView/index.tsx:2046-2072` (pre-fix line numbers): the newer-page-fetch resolve path computed `reachedLiveTail = responseCount < OLDER_PAGE` and only evicted when that branch was true. Any "mid-scroll" full page (responseCount === 100) deliberately set `evictedFromStart = 0`, letting the buffer grow 160 → 260 → 360 → … unbounded. The revert `c6c01183` introduced this exception to avoid a visible scroll jolt; the cost was the buffer ceiling.

### Fix

Two layered guards:

1. **Newer-page FETCH** (`fetchNewerPage` callback). Replaced the `reachedLiveTail ? compute : 0` branch with an unconditional call to the new pure helper `computeNewerPageEvictedFromStart({ currentLength, appendedCount, maxLoaded })`. Always evicts overflow back to `MAX_LOADED`. The user has intentionally scrolled forward, and `captureFirstVisibleRowAnchor()` + the `pendingScrollAnchorRef` consumer in `useLayoutEffect` already exist for this code path (untouched since pre-revert) — restoring scroll position around the evicted head is automatic.
2. **Live-append at tail** (the SSE patch handler's `appendedAtTail && length > MAX_LOADED` branch). Added new pure helper `canEvictOnLiveAppend({ windowLength, atBottom, maxLoaded, maxBuffer })`:
   - Returns `true` only when length has overflowed AND `atBottom === true` (user is at the live tail). In that case the caller strict-evicts back to `MAX_LOADED` — invisible because the user reads the tail, not the head.
   - Returns `false` otherwise. Caller defers eviction, allowing the buffer to grow up to `MAX_BUFFER = 400`. Past `MAX_BUFFER`, the caller force-evicts to `MAX_BUFFER` regardless of proximity — bounded heap.
   - `atBottom` is read from `shouldFollowScrollRef.current`, which the existing scroll listener already maintains via `isNearScrollBottom(element, FOLLOW_SCROLL_THRESHOLD_PX=96)`. No new scroll plumbing required.

The data-safety check `canEvictFromStartOnLiveAppend(prevState)` (hasOlder=true) is still gated separately — we never evict from start when `hasOlder=false` because that would destroy unrecoverable history. If `hasOlder=false`, we still allow growth up to `MAX_BUFFER` and the ceiling check fires, but the eviction is skipped (warn-logged); in practice this state only happens when the entire chat is loaded (≤ MAX_LOADED rows), so the ceiling case is unreachable in that branch.

### Files changed

```
packages/ui/components/ChatView/__tests__/messageWindow.test.ts    | +183 -2
packages/ui/components/ChatView/__tests__/windowInvariants.test.ts | +28 -10
packages/ui/components/ChatView/index.tsx                          | ~90 changed
packages/ui/components/ChatView/messageWindow.ts                   | +97 added
packages/ui/components/ChatView/windowInvariants.ts                | ~14 changed
```

### Invariant module update (windowInvariants.ts)

Rule 1's ceiling was raised from `MAX_LOADED` (160) to `MAX_BUFFER` (400). With BUG-2's deferred-eviction policy, the buffer may legitimately grow above 160 during live-append while the user is scrolled away from bottom. Exceeding `MAX_BUFFER` is now the real violation — it means the ceiling-evict logic failed to fire. Updated docs in the module + 3 corresponding tests in `windowInvariants.test.ts` (length-violation throws moved to `MAX_BUFFER + 1`; added two happy-path tests at `MAX_LOADED + 1` and exactly `MAX_BUFFER`; production-warn test now asserts rule text contains "MAX_BUFFER").

## Tests added

| File | Test | What it asserts |
| --- | --- | --- |
| `messageWindow.test.ts` | `MAX_BUFFER is 400 (2.5x MAX_LOADED)` | constant ships at documented value |
| `messageWindow.test.ts` | `MAX_BUFFER >= MAX_LOADED` | structural invariant |
| `messageWindow.test.ts` | **Test A**: `160 + 100 fetched: evicts 100 (no reachedLiveTail exception)` | strict newer-page fetch eviction; documents removed exception |
| `messageWindow.test.ts` | `full-page / partial-page / under-cap matrix` | newer-page eviction math correct across return sizes |
| `messageWindow.test.ts` | `custom maxLoaded respected` | helper parameterization |
| `messageWindow.test.ts` | **Test B**: `161 rows + atBottom=true → evict to MAX_LOADED` | proximity guard ON triggers strict eviction |
| `messageWindow.test.ts` | `length <= maxLoaded → false (no need to evict)` | helper short-circuit on under-cap |
| `messageWindow.test.ts` | **Test C**: `161 rows + atBottom=false → defer eviction (allow growth)` | proximity guard OFF defers eviction |
| `messageWindow.test.ts` | `any length between MAX_LOADED+1 and MAX_BUFFER + atBottom=false → false` | deferral consistent across the 161..400 band |
| `messageWindow.test.ts` | **Test D**: `401 rows + atBottom=false → ceiling forces evict to MAX_BUFFER` | ceiling enforced regardless of proximity |
| `messageWindow.test.ts` | `atBottom=true + over ceiling: proximity wins (MAX_LOADED)` | proximity beats ceiling when both apply |
| `windowInvariants.test.ts` | `MAX_LOADED+1 rows is allowed (BUG-2 deferred eviction)` | new happy path: deferred-eviction buffer is OK |
| `windowInvariants.test.ts` | `exactly MAX_BUFFER rows is allowed (at ceiling)` | ceiling itself is OK, not a violation |
| `windowInvariants.test.ts` | (updated) `messages.length exceeds MAX_BUFFER throws in dev` | new ceiling enforced |
| `windowInvariants.test.ts` | (updated) prod warn asserts rule text contains MAX_BUFFER | message label tracks new rule |

Net: **+11 new tests + 3 updated tests** in this wave. Total messageWindow.test.ts test count: 80 (was 69). Total windowInvariants.test.ts: 16 (was 14, net +2 after 1 was reworded).

## Failing-first confirmation

Before implementation: ran `vitest run components/ChatView/__tests__/messageWindow.test.ts` against the test additions with no helper changes. **11 tests failed** with `TypeError: canEvictOnLiveAppend is not a function` and equivalent `computeNewerPageEvictedFromStart is not a function`. Logged tail:

```
Test Files  1 failed (1)
Tests       11 failed | 69 passed (80)
```

After implementation: all 80 pass.

## Verification

- **typecheck:** `tsc --noEmit` → exit 0, clean.
- **targeted vitest** (the parent's exact command set):
  ```
  components/ChatView/__tests__/messageWindow.test.ts        80 passed
  components/ChatView/__tests__/cursorNamespaceDrop.test.ts   7 passed
  components/ChatView/__tests__/seqfulGatewayIndex.test.ts   10 passed
  components/ChatView/__tests__/windowInvariants.test.ts     16 passed
  lib/chat-engine-v2/__tests__/applyPatches.test.ts          34 passed
  lib/chat-engine-v2/__tests__/longConversation.test.ts       5 passed
  ── total: 152 passed / 0 failed (6 files)
  ```
- **build:** skipped (Wave 1 documented host OOM on `pnpm build`; no reason to expect that changed and BUG-2 doesn't touch the build pipeline).

## Is `MAX_BUFFER = 400` the right ceiling?

**Recommendation: yes, keep at 400.** Rationale documented inline in `messageWindow.ts`:

- **160 (1× MAX_LOADED)** — equals the target, gives the proximity guard zero headroom. Defeats the purpose.
- **320 (2×)** — too tight. A single moderately long tool run (≥160 stream patches without the user reaching bottom) trips the ceiling mid-stream, producing the very jolt the deferral is supposed to avoid.
- **400 (2.5×)** — chosen. Ceiling fires only on pathological streams (≥240 patches without bottom-reach). Worst-case heap stays the same order of magnitude as the target (~2.5×, not 5–10×).
- **800+** — wasteful. Empirically the user almost always reaches bottom (proximity clears the buffer) or jumps to live tail (full reset) well before 400 buffered rows.

The one knob worth watching post-deploy: if telemetry shows the `chat-rebuild.window.live-append-deferred` log emitting with `overCeiling: true` more than ~once per long session, the proximity guard isn't catching cases it should and 400 may be too low. Conversely if the deferred-state buffer rarely exceeds ~200, we could tighten to 300 and save heap. Either change is a constant flip; no API needed.

## What the audit got right vs wrong

The audit was precise at file:line level:

- **`index.tsx:2046-2072`** — exact range of the `reachedLiveTail` exception. Confirmed.
- **`reachedLiveTail = responseCount < OLDER_PAGE`** — exact pre-fix line. Confirmed.
- **5 pages → 560 rows = 3.5× MAX_LOADED** — math correct (160 + 4×100 = 560 before the 5th page lands).
- **Revert `c6c01183` as origin** — confirmed via `git log` and the now-removed comment that exactly described the deferral.
- **Anchor restore infrastructure already in place at `captureFirstVisibleRowAnchor` / `pendingScrollAnchorRef`** — confirmed. No new scroll plumbing needed for FETCH evictions.
- **The "newer-jolt" risk on live-append eviction** — confirmed. The pre-fix path at `index.tsx:1166` would have evicted on the very first live patch after `hasOlder` flipped true, producing exactly the jolt the deferral was meant to avoid.

One audit suggestion **not adopted**: the audit floated `requestIdleCallback` for "quiescent eviction at idle" as an optional follow-up. Not needed for BUG-2 — the proximity guard already gates eviction to the moment the user IS at the tail, which is the right "quiescent" condition. `requestIdleCallback` would have added jitter for no benefit.

**No paper-fixable misclaims found.**

## Notes for parent / next wave

- **Coordination with Wave 1's `assertWindowInvariant` hook:** the post-commit `useEffect` already wraps every transition. Now that Rule 1's ceiling is `MAX_BUFFER`, the assertion will catch a real ceiling violation (eviction logic failed to fire) but no longer flags the legitimate deferred-eviction state. Good defence-in-depth retained.
- **MEMORY.md standing rule about `c6c01183`** — that rule was "newer paging is intentionally unbounded; do not reintroduce strict eviction without a guard." This wave introduces exactly the guard. The standing rule can be either:
  - **(a)** retired (BUG-2 is fixed, the original concern is addressed), or
  - **(b)** reworded to "the guard lives in `canEvictOnLiveAppend` + the `MAX_BUFFER` ceiling; do not remove either."
  I'd recommend (b) so the next agent doesn't re-revert thinking they're "simplifying."
- **Reaching-tail logic is gone from `fetchNewerPage`** — the `reachedLiveTail` variable was removed entirely. `response.hasNewer` (BUG-3's server flag, plumbed in Wave 1) is the canonical signal for "have we caught up?" now. If we ever need a fallback heuristic, restore it from git history (`b27ca140^`), not from intuition.
- **The `live-append-no-evict` log message renamed to `live-append-deferred`** — log consumers (if any) need to update. Search showed no external consumers; the only references are in this file.
- **Did not touch warm cache / dead code** per audit instructions.
- **Build:** still OOM-bound on this host. Not worth fighting.

## File-level diff summary

```
packages/ui/components/ChatView/__tests__/messageWindow.test.ts    | +183 -2
packages/ui/components/ChatView/__tests__/windowInvariants.test.ts | +28 -10
packages/ui/components/ChatView/index.tsx                          | +90 -39
packages/ui/components/ChatView/messageWindow.ts                   | +97 -0
packages/ui/components/ChatView/windowInvariants.ts                | +14 -7
```

Atomic single commit. No middleware files modified. No drive-by refactors.
