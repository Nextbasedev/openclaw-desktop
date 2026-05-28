---
name: OpenClaw Desktop Chat UX
last_updated: 2026-05-28
---

# OpenClaw Desktop Chat UX Strategy

## Target problem

OpenClaw Desktop users are not just chatting; they are supervising long-running agent work with tools, approvals, subagents, streaming markdown, and large histories. The hard part is keeping that work understandable and scroll-stable when the transcript is large and the assistant is actively changing the page.

## Our approach

Make agent work legible as a per-turn work timeline, not scattered debug trace: thinking, tools, approvals, subagents, and final answers should live in a coherent structure attached to the turn that produced them. Preserve the current plain-DOM scroll architecture, but remove large-data render hot spots and make scroll intent explicit before attempting any windowing or virtualization.

## Who it's for

**Primary:** Power users running OpenClaw Desktop for real automation - They're hiring the chat UI to supervise what Cozy is doing, understand when work is stuck or waiting, and recover context quickly across long technical sessions.

**Secondary:** Builders debugging OpenClaw itself - They're hiring the chat UI to inspect tool/subagent behavior, trace regressions, and trust that the transcript reflects the actual run lifecycle.

## Key metrics

- **Large-chat interaction latency** - Time from scroll/input/tool patch to visible UI response in a 500+ message transcript; measured with local performance marks or browser traces.
- **Scroll stability during live work** - Count of unintended scroll jumps while streaming, running tools, or loading older messages; measured by manual smoke plus targeted scroll instrumentation.
- **Work-state comprehension** - Whether a user can answer “what is the agent doing, what has finished, what failed, and what needs me?” from the visible turn without opening raw logs; measured by QA checklist initially.
- **Tool/subagent inspection clicks** - Number of expansions or full child-chat opens needed to understand a run; measured later via UI telemetry if available.
- **Regression safety** - Chat parser/dedupe/status tests plus targeted visual/manual smoke pass for empty, normal, tool-heavy, approval, subagent, and large-history states.

## Tracks

### Work Timeline Spine

A coherent per-turn lane for thinking, tools, approvals, subagents, live status, and final answer context.

_Why it serves the approach:_ It makes OpenClaw feel like an automation cockpit instead of a normal chatbot with scattered debug widgets.

### Large-Data Scroll Stability

Performance and anchoring work for large transcripts: remove O(n²) render scans, reduce whole-list recomputation, centralize scroll ownership, and improve older-message prepend anchoring.

_Why it serves the approach:_ A beautiful work timeline fails if the transcript blinks, jumps, or stalls under real agent output volume.

### Tool and Subagent Legibility

Reusable semantic tool-event cards and subagent progress/result digests that work across main chat, subagent chat, Activity, and future trace views.

_Why it serves the approach:_ Tools and subagents are the product differentiator; users need summaries, status counts, failures, and digests before raw logs.

### Composer Intent Clarity

A cleaner composer/action bar that distinguishes chat, task/follow-up, attachments, model/thinking state, web/search behavior, send-while-generating, and stop.

_Why it serves the approach:_ The input surface should help users direct automation, not force them to decode a settings row while work is running.

## Not working on

- Naive timeline virtualization as the first fix; prior constraints say it caused live tool/status anchoring regressions.
- A full visual redesign before stabilizing large-data scroll and live work structure.
- Backend protocol changes unless the UI proves existing metadata is insufficient.

## Marketing

**One-liner:** Chat should show not only what Cozy said, but what Cozy did.

**Key message:** OpenClaw Desktop’s chat area should feel like a live automation cockpit: readable conversation, inspectable work, trustworthy progress, and stable scrolling even when the agent is doing a lot.
