---
date: 2026-05-28
topic: unified-work-timeline-spine
---

# Unified Work Timeline Spine Requirements

## Summary

Build a combined thin slice for ChatView: remove the most obvious large-data render hot spots, then introduce a minimal per-turn Work Timeline Spine that groups thinking, tools, approvals, subagents, and live status without worsening scroll stability.

The v1 goal is not a full redesign. It is a safe foundation: the transcript should stay stable under large histories while making active agent work easier to understand.

---

## Problem Frame

OpenClaw Desktop chat is currently doing two hard things at once: rendering long technical transcripts and showing live agent work while the transcript changes. The existing UI has separate surfaces for thinking, tool steps, bottom status, approvals, and subagents, so users can struggle to answer “what is Cozy doing right now?” without expanding/debugging multiple areas.

At the same time, large transcripts already have scroll/blink risk. `ChatView` renders the full visible history, performs repeated list scans during row rendering, reads/writes layout during frequent active-run updates, and reparses large streaming markdown. Any visible timeline improvement must avoid adding more full-list work or unstable layout behavior.

---

## Key Decisions

- **Combined thin slice v1.** Do small, targeted large-data performance fixes and a minimal Work Timeline Spine together. Stability-only would delay visible product improvement; timeline-only risks making the existing scroll/blink issues worse.
- **No naive virtualization in v1.** Existing constraints explicitly warn that timeline virtualization previously caused live tool/status anchoring regressions. V1 should preserve the plain DOM scroll container.
- **Attach work to the originating turn.** Thinking, tools, approvals, subagents, and status should be visually associated with the assistant/user turn that caused them, not scattered between the transcript bottom, separate cards, and child chat surfaces.
- **Progressive disclosure by default.** The spine should summarize work first and reveal raw details only when needed.
- **Reuse existing data.** V1 should use data already available in `ChatView`, `ToolCallSteps`, `ThinkingBlock`, `SubagentBar`, `SubagentCard`, and pending tool state. Backend/protocol changes are out of scope unless planning proves a required field is missing.

---

## Actors

- A1. **Automation user** — supervises long-running OpenClaw work and needs to know what happened, what is running, what failed, and what needs approval.
- A2. **Debugging builder** — uses Desktop to inspect tool/subagent lifecycle and diagnose regressions in long sessions.
- A3. **Chat UI planner/implementer** — needs clear scope boundaries so the first PR improves UX without destabilizing scroll.

---

## Requirements

**Large-data stability foundation**

- R1. Precompute per-message row metadata in one or a small number of list passes instead of doing forward scans inside every rendered row.
- R2. Precompute displayed/completed tool ID sets once per render so pending-tool filtering does not call `renderedMessages.some(...)` inside every row.
- R3. Keep active-turn computations scoped to the current turn where possible; do not repeatedly scan the full transcript for information that only affects the current live run.
- R4. Preserve the current plain DOM scroll container for v1; do not reintroduce `react-virtuoso` or generic virtualization.
- R5. The v1 timeline must not add new scrollHeight/scrollIntoView reads/writes beyond what already exists unless they are part of a deliberate scroll anchoring fix.

**Work Timeline Spine behavior**

- R6. For an assistant turn with thinking, tool calls, approvals, subagents, or live status, render a single coherent Work Timeline Spine associated with that turn.
- R7. The spine should summarize work in chronological order where possible: thinking, tools, approvals, subagents, final/streaming response state.
- R8. The collapsed spine summary should answer the basic state question without expansion: what is running, what is done, what failed, and whether approval is needed.
- R9. Multi-tool groups should show compact status counts such as `2 running · 5 done · 1 failed` and the current running/failed tool label when available.
- R10. Existing detailed tool rendering should remain reachable through expansion; raw command/output details should stay behind progressive disclosure.
- R11. Existing approval actions must remain functional and must not be hidden behind an expansion state that prevents users from acting.
- R12. Existing assistant text rendering should remain readable and should not be forced into a heavy card for simple conversational replies.
- R13. Long artifact-like outputs can be prepared for future full-width treatment, but v1 should only make minimal layout changes needed for the spine.

**Subagent visibility**

- R14. Subagent activity should appear as part of the work timeline or immediately adjacent to it, not only as a separate bar near the composer.
- R15. The subagent summary should include active/completed/failed counts and should preserve the ability to open the full subagent chat.
- R16. V1 may keep rich subagent result digests for a later PR, but it should not make current subagent visibility worse.

**Scroll and large-history behavior**

- R17. If the user is scrolled away from the bottom, live work updates must not force-scroll them back to the latest message.
- R18. Loading older messages must preserve viewport position at least as well as current behavior.
- R19. The new spine should use stable reserved space where possible so status changes do not visibly push the transcript around.
- R20. Any new animations should be subtle and avoid changing layout height repeatedly during active streaming.

**Compatibility and constraints**

- R21. Existing chat engine constraints still apply: tool cards are scoped to their assistant message/run segment, completed tool states must not be downgraded by replayed running patches, and hidden user boundaries must still prevent cross-question tool grouping.
- R22. The existing `ThinkingBlock`, `ToolCallSteps`, approval resolution, message actions, and Activity selection behavior must keep working during the v1 refactor.
- R23. V1 should not require backend protocol changes.
- R24. Add or update `docs/constraints/chat-ui.md` to document Work Timeline Spine, scroll-safe UI changes, and what not to regress.

---

## Key Flows

- F1. **Active tool-heavy assistant turn**
  - **Trigger:** The assistant starts thinking and running tools after a user message.
  - **Actors:** A1, A2.
  - **Steps:** ChatView receives thinking/tool/status updates; the current turn shows a Work Timeline Spine; the collapsed summary updates with running/done/failed/approval state; final assistant text streams below or alongside the work summary.
  - **Outcome:** The user understands what is happening without opening raw details.
  - **Covers:** R6, R7, R8, R9, R10, R11, R19.

- F2. **User reading older content during live work**
  - **Trigger:** The user scrolls away from the bottom while the agent continues streaming or running tools.
  - **Actors:** A1.
  - **Steps:** Live updates continue to update the relevant turn; ChatView preserves the user’s reading position; jump-to-latest remains the explicit way back.
  - **Outcome:** The new timeline does not reintroduce scroll stealing.
  - **Covers:** R5, R17, R19, R20.

- F3. **Large transcript with many historical messages**
  - **Trigger:** A chat with hundreds of messages and many tool calls is rendered or receives a status/tool patch.
  - **Actors:** A1, A2.
  - **Steps:** ChatView computes row metadata and tool ID sets once; row rendering consumes precomputed data; unchanged historical rows avoid unnecessary work where possible.
  - **Outcome:** Interaction remains responsive enough to scroll and inspect without obvious blink/jank.
  - **Covers:** R1, R2, R3, R4.

- F4. **Subagent spawned during a turn**
  - **Trigger:** A tool call spawns one or more subagents.
  - **Actors:** A1, A2.
  - **Steps:** The turn’s work timeline or adjacent summary reflects subagent count/status; active/completed/failed state is visible; user can open full child chat when needed.
  - **Outcome:** Background work feels like delegated workers, not hidden uncertainty.
  - **Covers:** R14, R15, R16.

---

## Acceptance Examples

- AE1. **Large chat render avoids per-row full-list scans**
  - **Covers:** R1, R2, R3.
  - **Given:** A transcript with 500 messages and many tool calls.
  - **When:** A new tool/status patch arrives for the active turn.
  - **Then:** ChatView does not perform `slice(index + 1)` or `renderedMessages.some(...)` from inside every row render to derive row metadata.

- AE2. **Collapsed spine communicates state**
  - **Covers:** R8, R9.
  - **Given:** An assistant turn has seven tool calls: five succeeded, one running, one failed.
  - **When:** The work timeline is collapsed.
  - **Then:** The visible summary communicates counts and the running/failed tool labels without requiring expansion.

- AE3. **Approval remains actionable**
  - **Covers:** R11, R21, R22.
  - **Given:** A command approval is awaiting user action.
  - **When:** The work timeline is rendered in collapsed/default state.
  - **Then:** The user can still see that approval is needed and can approve/deny without hunting through raw logs.

- AE4. **Scrolled-away user is not pulled to bottom**
  - **Covers:** R17, R20.
  - **Given:** The user is reading older messages and is not near the bottom.
  - **When:** A tool status changes or assistant text streams.
  - **Then:** The scroll position remains stable and the user can choose to jump to latest.

- AE5. **Simple replies stay simple**
  - **Covers:** R12, R13.
  - **Given:** An assistant turn has only a short text answer and no thinking/tools/subagents/approval.
  - **When:** The message renders.
  - **Then:** It remains lightweight and is not wrapped in a heavy work timeline container.

---

## Success Criteria

- Large-history chat interactions feel no worse than current `v3`, and obvious O(n²) render scans are removed.
- Tool-heavy active turns are easier to understand in collapsed/default state.
- Approval and tool detail interactions remain functional.
- User scroll intent is preserved during live updates.
- The first PR is small enough to review: it should not bundle composer redesign, full subagent digest, markdown renderer overhaul, or virtualization.
- `docs/constraints/chat-ui.md` exists and documents the new invariants.

---

## Scope Boundaries

### In scope for v1

- Precomputed row metadata / displayed tool ID sets in `ChatView`.
- Minimal Work Timeline Spine for assistant turns with thinking/tools/approvals/subagents/status.
- Collapsed tool status counts and current running/failed tool label.
- Basic subagent count/status visibility attached to the relevant turn.
- Constraint documentation for chat UI changes.

### Deferred for later

- Full composer intent-launcher redesign.
- Rich subagent result digest with last message excerpt/tool count/failure reason.
- Full-width artifact/card treatment for long documents and generated outputs.
- Markdown renderer capability registry.
- Deep `useChatScrollAnchor` extraction unless planning decides it is needed for the v1 slice.
- Anchored/windowed rendering after perf fixes are measured.

### Out of scope

- Naive virtualization as the first fix.
- Backend protocol changes unless a required field is proven missing.
- Reworking Activity tab semantics to hide ChatView bugs.
- Changing chat engine tool lifecycle semantics.

---

## Dependencies and Assumptions

- Existing `ToolCallSteps` and `ThinkingBlock` can be adapted or wrapped without replacing their underlying behavior.
- Existing chat engine/tool lifecycle data is sufficient for v1 status counts and summaries.
- Current scroll constraints in `docs/constraints/ui-scroll.md` remain authoritative.
- Existing unrelated UI typecheck failure around `workspaceControls` / `HeaderProps` may still block full `pnpm --filter ui typecheck`; targeted checks should still run.

---

## Sources

- `STRATEGY.md`
- `docs/ideation/2026-05-28-chat-area-ui-ideation.md`
- `docs/ideation/2026-05-28-chat-scroll-blink-debug-audit.md`
- `docs/constraints/chat-engine.md`
- `docs/constraints/ui-scroll.md`
- `packages/ui/components/ChatView/index.tsx`
- `packages/ui/components/ChatView/MessageBubble.tsx`
- `packages/ui/components/ChatView/ToolCallSteps.tsx`
- `packages/ui/components/ChatView/ThinkingBlock.tsx`
- `packages/ui/components/ChatView/SubagentBar.tsx`
- `packages/ui/components/ChatView/SubagentCard.tsx`
