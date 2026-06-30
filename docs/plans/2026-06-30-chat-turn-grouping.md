# Spec — Chat response rendering: turn grouping + cleanup

Status: CONFIRMED (2026-06-30 10:13 UTC) — building.

FINAL DECISIONS (Krish):
- D1 one card per turn: YES
- D2 single action bar, bottom, only when turn terminal: YES
- D3 single loader, only while active: YES
- D4 layout: OPTION B — all tool stacks at TOP of the card, then all text below
- D5 system injections: OPTION A — recognize `System (untrusted): [date]` and do NOT
  treat as a turn boundary (apply existing predicate to the live path too); do NOT
  change how they display, only stop them splitting the answer.
- D6 spinner tied to the answer finishing, NOT background-agent activity: YES
- Perf: grouping first, measure, deeper memo only if still laggy: YES
- Scope: UI-only; no streaming-reveal or smooth-scroll changes.
Branch: `master-fixes`. Owner: Empire. Date: 2026-06-30.

---

## 1. Problem (observed)

From Krish's screenshots of a live `gpt-5.5` response on a long session:

- **P1 — Action buttons appear mid-generation.** The 👎 / copy / ⋮ action bar shows
  under an assistant chunk while the turn is still generating (loader + background
  agent still active below it).
- **P2 — Jumbled render order.** One turn renders as: text → blink → tool call →
  full text → more tool calls, as separate blocks instead of one coherent response.
- **P3 — Breaks & lag, worse on long history.** Rendering stutters/jumps; gets worse
  the longer the chat history is.

## 2. Root cause (one bug, three faces) — confirmed in code at HEAD `ced50809`

A single assistant *turn* is emitted by the gateway as **multiple assistant
messages** (preamble text, post-tool text, final text, plus tool-only messages),
and the UI renders **one row per message** with its **own** action bar + loader.

Evidence in `packages/ui/components/ChatView/index.tsx`:
- `renderedMessages.map((message, index) => ...)` renders each message as an
  independent row: subagent card + thinking + `ToolCallSteps` + `MessageBubble`.
- Action bar gate is per-message: `suppressActions = message.role==="assistant" &&
  animateAssistantText`. When a *fragment* stops animating, its bar shows even
  though the turn isn't done → **P1**.
- No grouping of consecutive text-bearing assistant messages (only tool-only
  duplicates are suppressed via `suppressedToolCallMessages` / `duplicateToolOnlyRows`)
  → **P2**.
- More fragments = more rows = more React work per streamed token, compounding the
  per-token re-render cost → **P3**.

Secondary defect: `isSystemInjectedUserMessage` (in `lib/chatHistoryParser.ts`)
strips `System (untrusted): [date] …` injections **only on reload**. In the **live**
path these can still appear as a fake `user` turn that splits the answer.

## 3. Goals

- G1. One assistant *turn* renders as **one** response card.
- G2. **One** action bar per turn, shown **only after the whole turn is terminal**.
- G3. **One** trailing loader per turn while generating.
- G4. Content within the turn renders in **emission order** (text/tool/text…), no
  reordering, no blink/jump between fragments.
- G5. System-injected `System (untrusted): …` messages are transparent (not a
  user bubble, not a turn boundary) in **both** live and reload paths.
- G6. Reduce render churn so long histories don't degrade (at least: fewer rows;
  ideally the streaming token updates only the active turn).

## 4. Non-goals (explicitly out of scope for this change)

- N1. No rewrite of the streaming/markdown reveal mechanism (the typewriter).
  We already reverted that twice; leave reveal behavior at current baseline.
- N2. No new smooth-scroll work — `aac50dab` stays as-is.
- N3. No change to gateway/middleware emission. Fix is UI-side only.
- N4. Deep per-token memoization (the `MessageBubble` memo work) is a SEPARATE,
  measured phase — see §8. Not bundled here, to avoid repeating the earlier breakage.

## 5. Design decisions — CONFIRMED (see header)

- D1. **One card per turn.** Group the run of assistant messages between two user
  turns into a single logical "response group". → confirm.
- D2. **Action bar placement/timing.** Single bar at the bottom of the group,
  rendered only when the turn has reached a terminal status (no active run /
  background agent). → confirm.
- D3. **Loader.** Single `GeneratingStatus` loader at the bottom of the active
  group; remove per-fragment loaders. → confirm.
- D4. **Ordering.** Preserve emission order; interleave text and tool stacks as they
  arrived (ChatGPT/Claude-style). → confirm (alt: all tools collapsed into one top
  stack then all text — say so if you prefer this).
- D5. **System injections.** Fully hidden (transparent), not shown collapsed. → confirm.
- D6. **Background agent.** A running background subagent does NOT keep the main
  turn's loader/active state alive once the answer is terminal (this was the
  "Writing… never clears" issue). The background-agent card shows its own state.
  → confirm.

## 6. Implementation plan (after sign-off)

Introduce a pure grouping function, unit-tested, used by the render loop.

- `components/ChatView/groupTurns.ts` (new): pure fn
  `groupRenderedMessagesIntoTurns(messages): TurnGroup[]` where a `TurnGroup` is
  `{ userMessage?, blocks: Array<{kind:"text"|"tools", ...}>, lastAssistantId,
  isComplete }`. Splits on real user turns only (system injections ignored via the
  shared predicate). Preserves order. Pure → fully unit-testable without the app.
- Move `isSystemInjectedUserMessage` predicate to a shared module (or re-export) so
  both the parser and the live grouping use the SAME rule.
- `components/ChatView/index.tsx`: replace the per-message `.map` body with a
  per-turn render: iterate `TurnGroup[]`; render the user bubble, then the group's
  blocks in order, then a SINGLE action bar (gated on `group.isComplete`) and a
  SINGLE loader (only for the active group while generating).
- Remove now-dead patchwork that grouping subsumes (`duplicateToolOnlyRows`,
  `suppressedToolCallMessages`, parts of `mergeToolOnlyAssistantMessages`) where
  the new grouping makes them redundant — simplification, not addition.
- Keep windowing/virtualization, scroll, subagent anchoring intact.

## 7. Edge cases to cover (tests)

- Single text turn (no tools) → one card, one bar.
- Text → tool → text within one turn → one card, interleaved, one bar.
- Tool-only turn (no text) → one card, no empty text bubble.
- System injection between assistant fragments → does NOT split the turn.
- Two real consecutive user sends (double-click) → two turns (not merged).
- Streaming active → no action bar, one loader; on terminal → bar appears, loader gone.
- Background agent still running after terminal answer → main bar shows, loader gone.
- Reload vs live produce identical grouping.

## 8. Perf (P3) — phased, measured

- Phase 1 (this change): fewer rows via grouping → fewer components per token.
- Phase 2 (separate, only if still laggy after Phase 1 is verified on real hardware):
  stabilize props so only the active turn re-renders per token. This is the memo
  work that previously regressed; do it ONLY with before/after profiling evidence,
  not blind.

## 9. Verification

- Unit: new `groupTurns.test.ts` covering §7; existing ChatView/applyPatches suites
  stay green. `tsc --noEmit` clean; eslint 0 new errors.
- Cannot drive live signed-in app on this host → Krish verifies on real build:
  P1 (no mid-gen buttons), P2 (one ordered card), P3 (subjectively smoother).
- Ship as ONE atomic commit on `master-fixes` after Krish confirms §5.

## 10. Open questions for Krish

- Q1. Confirm D1–D6.
- Q2. Do you want Phase-2 perf in the same PR, or grouping first then measure? (I
  recommend grouping first.)
- Q3. Anything about the background-agent card UX you want changed while we're here?
