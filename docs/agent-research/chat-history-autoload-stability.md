# Research: chat history autoload stability

## Goal
Stabilize older-history loading so session behavior does not vary wildly with total loaded history size, and avoid startup jump/blink/blank behavior in long sessions.

## Confirmed issues

### 1) Long sessions: synchronous bootstrap visible top-up causes startup page chaining
- `topUpBootstrapVisibleHistory()` in `packages/ui/hooks/useChatMessages.ts` can fetch multiple older pages during bootstrap before the first settled render.
- This was added to normalize visible rows for tool-heavy sessions, but it changes bootstrap from a single-page load into a multi-page startup path.
- Causal chain:
  1. bootstrap raw page returns `160`
  2. visible rows are low for tool-heavy session
  3. bootstrap helper fetches older pages immediately, in series
  4. first paint waits on that extra work / transcript shape changes before settling
  5. user perceives startup blank/jump/back-to-back loading

### 2) Small vs large sessions: older autoload trigger depends on total scrollHeight
- `packages/ui/components/ChatView/chatHistoryAutoLoad.ts`
- `shouldAutoLoadOlderHistory()` uses ratio thresholds based on `(scrollHeight - clientHeight)`.
- That means the exact same absolute position near the top can be inside the load zone for a long session and outside the load zone for a shorter one.
- Causal chain:
  1. user scrolls near top
  2. trigger threshold is derived from total loaded height, not fixed top distance
  3. after prepends / depending on total session length, threshold moves significantly
  4. long sessions can chain-trigger more aggressively; smaller sessions can require extra up/down movement before another load triggers

## Evidence
- Real user report matches both patterns:
  - long session: direct back-to-back load jump / blink / blank screen
  - smaller total history: sometimes next page does not trigger until extra movement
- Code evidence:
  - bootstrap helper performs serial older-page fetches during initial bootstrap
  - autoload threshold is ratio-driven and therefore total-height-sensitive by design

## Relevant files
- `packages/ui/hooks/useChatMessages.ts`
- `packages/ui/components/ChatView/chatHistoryAutoLoad.ts`
- `packages/ui/lib/__tests__/chatHistoryAutoLoad.test.ts`
- `packages/ui/lib/__tests__/useChatMessages.reconcile.test.ts`

## Fix direction
- Remove synchronous bootstrap visible top-up from the initial blocking bootstrap path.
- Make older-history autoload use stable absolute top-distance thresholds (with bounded fast-scroll behavior) instead of total-height ratios.
- Preserve anchor restore and anti-repeat guards, but base them on user movement near the top rather than total document height.

## Risks
- Removing bootstrap top-up may reintroduce short initial visible history for tool-heavy sessions unless handled differently later.
- Need to avoid over-triggering near top when replacing the ratio threshold.
