# 0002 — Tool-Call UI reference ported from openclaw-power-dashboard

**Branch:** `v5`
**Scope:** `CHAT_FRONTEND_PLAN_V5_APPROACH_A.md` (new §6.1), `frontend-docs/index.md`
**Status:** docs/plan only — no source code changed
**Depends on:** 0001

---

## 1. Summary

Reviewed `openclaw-power-dashboard/session.html` (the existing static transcript
viewer) for its tool-call / reasoning / subagent UI, and folded the **proven
interaction patterns** into the Approach A plan as a new section **§6.1**. This turns
the `ToolCard` / `AssistantTurn` / `SubagentBar` specs from greenfield guesses into
already-validated UX.

## 2. Why

The power dashboard has shipped and been used for a while; its transcript renderer
solved the same problems we're about to (collapsible tool cards, pending/orphan
results, status colors, copy semantics, reasoning blocks, subagent cards). Reusing a
working interaction model is cheaper and safer than re-deriving it — and aligns with
the "don't reinvent the wheel" rule. We adopt the *behavior*, not the markup (visuals
still come from AI Elements + our theme tokens).

## 3. What was captured (source: `session.html` `renderTranscript`)

- **ToolCard** (`.tool-call`): collapsible header (tool name + chevron) over a body of
  **args** (mono, pretty JSON, dim) + **result** (labeled `RESULT` + copy button).
  Default collapsed when a result exists; expanded while pending or for orphan results.
- **Pending state**: italic "waiting for result…" placeholder → maps to our
  `phase/status === running` + `awaitingResult`.
- **Result correlation**: dashboard pairs `type:'tool'`(id) ↔ `type:'result'`(id) via a
  `resultMap`, and renders standalone results whose call is missing. Our store already
  correlates by `toolCallId`; we keep the **orphan-result fallback**.
- **Status colors**: running = green, completed = blue/green, error = red (card border +
  status pill).
- **Reasoning** (`.thinking-block`): italic, dim, accent left-border, collapsible →
  from `MessageRow.reasoning`.
- **Subagent cards** (`.subagent-card`): name + meta + status pill
  (running/completed/error), clickable to drill in → informs `SubagentBar`/`SubagentCard`
  wired to `subagent-correlation.ts`.
- **Per-message meta**: inline `model` + optional `cost`.
- **Content types**: text(markdown), image, attachment (image/audio/video/file inline),
  tool, result, thinking — all must be supported by the renderer.

## 4. Workarounds / notes

- Copy buttons must `stopPropagation()` so copying doesn't toggle the card (dashboard
  does this; carry it over).
- We deliberately do NOT port the dashboard's `resultMap` correlation logic — our
  middleware-backed store already keys tools by `toolCallId`. We only port the
  *orphan-result* edge case as a rendering fallback.
- Markup/styling is NOT copied; only the interaction model. Visual layer = AI Elements
  `Tool`/`Reasoning` + our theme tokens.

## 5. What improved

- `ToolCard.tsx`, `rows/AssistantTurn.tsx` (reasoning + meta), and `overlays/SubagentBar`
  now have concrete, validated UX specs in the plan (Approach A §6.1).
- Reduces Phase 5 (tools & approvals) risk and ambiguity before any code is written.

## 6. What to test (when Phase 5 implements this)

- Tool card collapses by default once a result is present; expands on click.
- Pending tool shows "waiting for result…" until `chat.tool.result`.
- Orphan result (no matching started call) still renders as a result-only card.
- Status colors map correctly: running/success/error.
- Copy on result/text does not toggle the card.
- Reasoning block renders from `chat.reasoning.delta` and is collapsible.
- Subagent card shows correct status pill and drills into the child session.
- `model`/`cost` meta appears under finalized assistant turns.

## 7. Follow-ups
- Implement these in Phase 5; verify against a real session with tool calls (e.g. via
  the bootstrap snapshot + live stream) and against the dashboard for visual parity of
  *information*, not pixels.
