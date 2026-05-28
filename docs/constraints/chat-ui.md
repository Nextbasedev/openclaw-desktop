# Chat UI Constraints

## Work Timeline Spine

- Agent work belongs to the turn that produced it. Thinking, tools, approvals, subagents, and live status should not be scattered across unrelated transcript/footer surfaces when they can be attached to the originating turn.
- Simple assistant text stays simple. Do not wrap short text-only answers in heavy cards just because the Work Timeline Spine exists.
- The spine is progressive disclosure: summarize first, raw tool details second.
- Approval-needed state must stay visible and actionable. Never hide approvals behind a collapsed raw-log view without an obvious approval affordance.
- Tool summaries should communicate health at a glance: running, done, failed, and approval-needed counts where available.
- Subagents should read as delegated workers. At minimum, show count/status and preserve the ability to open the full child chat.

## Large Transcript Safety

- The main chat transcript remains a plain DOM scroll container unless a dedicated windowing plan includes regression coverage for live tool/status anchoring.
- Do not reintroduce `react-virtuoso` or generic virtualization casually. See `docs/constraints/ui-scroll.md`.
- Avoid per-row full-list scans in `renderMessageRow`. Derive row metadata in memoized passes and consume it by message ID.
- Avoid adding new layout read/write loops (`scrollHeight`, `scrollTop`, `scrollIntoView`) for visual polish. Scroll changes need their own justification and smoke coverage.
- Live status/tool updates must not steal scroll when the user is reading older content.
- Multi-tool groups should remain collapsed by default unless the user expands them; expanding live multi-tool groups can create large height churn.

## Tool Lifecycle Safety

- Tool cards are scoped to their assistant message/run segment, not global `isGenerating` alone.
- Completed tool state must not be downgraded by replayed/backfilled running patches.
- Hidden/blank user boundaries still separate turns and must prevent tool grouping across questions.
- Do not change Activity tab semantics to hide ChatView bugs; ChatView should follow Activity semantics for stale running/awaiting-result rows.

## Visual Change Boundaries

- Keep first-slice Work Timeline changes narrow: summary chrome, existing components, and safer row metadata.
- Defer composer redesign, full-width artifacts, markdown renderer rewrites, and rich subagent digests unless explicitly planned.
- Prefer small stable surfaces over animated height changes during active streaming.

## Related Constraints

- `docs/constraints/chat-engine.md`
- `docs/constraints/ui-scroll.md`
- `docs/plans/2026-05-28-unified-work-timeline-spine.md`
