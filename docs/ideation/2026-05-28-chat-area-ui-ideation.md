---
title: Chat Area UI Ideation
status: complete
date: 2026-05-28
workflow: ce-ideate
scope: OpenClaw Desktop current chat area UI/components
---

# Chat Area UI Ideation

## Inferred Mode

Treating this as a topic in this codebase — the current OpenClaw Desktop chat area UI and its components.

## Grounding Context

### Files inspected

Primary UI:
- `packages/ui/components/ChatView/index.tsx`
- `packages/ui/components/ChatView/MessageBubble.tsx`
- `packages/ui/components/ChatView/MarkdownContent.tsx`
- `packages/ui/components/ChatView/ThinkingBlock.tsx`
- `packages/ui/components/ChatView/ToolCallSteps.tsx`
- `packages/ui/components/ChatView/ToolCallDetails.tsx`
- `packages/ui/components/ChatView/SubagentBar.tsx`
- `packages/ui/components/ChatView/SubagentCard.tsx`
- `packages/ui/components/ChatView/SubagentFullChat.tsx`
- `packages/ui/components/ChatView/PinnedMessagesPopover.tsx`
- `packages/ui/components/ChatView/ChatSearch.tsx`
- `packages/ui/components/ChatBox/index.tsx`
- `packages/ui/components/ChatBox/ActionBar.tsx`
- `packages/ui/components/ChatBox/AttachmentPreviewList.tsx`
- `packages/ui/components/ChatBox/SlashCommandMenu.tsx`

Supporting behavior:
- `packages/ui/hooks/useChatMessages.ts`
- `packages/ui/hooks/useChatComposerAttachments.ts`
- `packages/ui/lib/chatToolDisplay.ts`
- `packages/ui/lib/messageActions.ts`
- `packages/ui/types/chat.ts`

Constraints:
- `docs/constraints/chat-engine.md`
- `docs/constraints/ui-scroll.md`
- `docs/constraints/async-ui-state.md`

### Current component map

- `ChatView/index.tsx` is the main orchestration layer: loading states, empty state, transcript, scroll ownership, live run status, pins, search, edit/regenerate previews, subagent handoff, approvals, and composer placement.
- `MessageBubble.tsx` owns most message-level UI: user/assistant layout, markdown rendering, copy/edit/reply/pin/fork actions, inline approval cards, attachment previews, slash command styling, selection ask UI, and error formatting.
- `ChatBox/index.tsx` and `ActionBar.tsx` provide the composer surface: text input, attachments, web toggle, model selector, send/stop, recording affordance, slash commands, draft persistence, and reply state.
- `ToolCallSteps.tsx` renders inline tool rows with expand/collapse, details, approval cards, and Activity selection affordances.
- `ThinkingBlock.tsx` renders collapsible reasoning previews.
- `SubagentBar.tsx` renders per-turn background agent summary near the composer; `SubagentFullChat.tsx` can temporarily replace the main transcript when a child agent is opened.

### Current UX shape

- Empty chats center `AnimatedGreeting` and the composer.
- Non-empty chats use a plain DOM scroll container, not virtualization, per `ui-scroll` constraints.
- Transcript content is generally constrained to `max-w-3xl` in the scroll container, while message bubbles themselves use `max-w-[85%]`.
- User messages are right-aligned rounded dark bubbles; assistant messages are full-width text/markdown without a strong card surface.
- Live status appears as a small thinking/running row near the bottom and is driven by current run/tool state.
- Tool calls render inline under assistant messages and can expand details or jump to Activity.
- Composer is fixed at bottom with translucent background and includes model selector, add/upload menu, web state, send/stop, and optional subagent bar.

### Constraints that matter

- Do not reintroduce timeline virtualization unless there is a specific regression test for live tool/status updates.
- ChatView owns scroll behavior. Live updates should follow-scroll only when the user is already near bottom.
- Short chats should top-align normally; avoid bottom-alignment wrappers that push status rows toward center.
- Status/footer row should reserve stable height so thinking/running/responding transitions do not shift the transcript.
- Tool cards must be scoped to their assistant message/run segment, never global `isGenerating` alone.
- Completed tool state must not be downgraded by replayed/backfilled running patches.
- Hidden/blank user messages still form turn boundaries and must prevent tool grouping across questions.

### Topic axes

- Transcript readability and hierarchy
- Composer clarity and action density
- Live work visibility: thinking, tools, approvals, subagents
- Navigation/recovery: search, pins, scroll, jump-to-latest
- Maintainability and state boundaries

## Subagent Ideation Results

The first attempt used too-short timeouts and produced no useful results. The rerun used 5-minute timeouts. Three ideation frames completed successfully; the broad grounding scan still timed out after extensive inspection without a written summary. The completed frames are incorporated below.

### Pain and friction frame

1. **Preserve scroll intent in subagent full chat**
   - `SubagentFullChat` auto-scrolls to bottom on every `displayMessages` change. It should use the same near-bottom behavior and jump-to-latest affordance as main `ChatView`.
   - Why it matters: reading older subagent output while the agent is still working should not get yanked away.

2. **Unify tool rendering between main chat and subagent chat**
   - Subagent tool history is a simple `Tools used` strip while main chat has richer `ToolCallSteps`.
   - Why it matters: users lose debugging context exactly where background agents are doing opaque work.

3. **Make collapsed tool stacks more informative**
   - Collapsed multi-tool groups should show compact status counts such as `2 running · 1 failed · 6 done`, plus current running tool label.
   - Why it matters: users should not need to expand just to know whether a tool sequence is healthy.

4. **Add sticky context for long assistant/tool outputs**
   - Long markdown, code blocks, embeds, and expanded tool details need subtle turn context while scrolling.
   - Why it matters: long technical chats become spatially disorienting.

5. **Improve ThinkingBlock summarization**
   - Collapsed reasoning should show a one-line preview, phase label, duration, or useful metadata instead of a generic label.
   - Why it matters: users cannot tell whether hidden reasoning is useful or noise.

6. **Expose web search state in composer payload or remove the dead toggle**
   - `ChatBox` tracks `webSearchEnabled`, but the send payload does not obviously include a web flag.
   - Why it matters: a visible toggle that may not affect the request is high-trust friction.

7. **Make send-while-generating clearer**
   - Distinguish `Send follow-up`, `Stop current response`, and disabled states with clear tooltip/copy.
   - Why it matters: ambiguity during active generation feels broken or risky.

8. **Give subagent cards richer progress without expansion**
   - Add latest tool, last message excerpt, elapsed time, or failure reason to collapsed/peek states.
   - Why it matters: hidden background work can feel like uncertainty instead of magic.

### Assumption-breaking frame

1. **Ambient work lane instead of trace/debug toggle**
   - Reframe tool calls, pending tools, thinking, and subagent activity as a collapsible work lane beneath/alongside the assistant bubble.
   - Why it matters: agent work should be legible without flooding the transcript.

2. **Replace “typing” with explicit run state**
   - Show stages like `thinking`, `running tools`, `waiting for approval`, `subagent working`, `streaming answer`.
   - Why it matters: long automation is not human typing; users need situational awareness.

3. **Conversation-first bubbles, artifact-first blocks**
   - Short conversational replies stay bubbles/text; long markdown, code, tables, outputs, images, and generated artifacts become full-width blocks/cards.
   - Why it matters: agent outputs are often documents, diffs, logs, or plans, not chat snippets.

4. **Scroll intent as visible mode**
   - Surface `Live`, `Paused reading`, `Jump to latest`, and maybe unread count instead of silently inferring everything from scroll position.
   - Why it matters: users should understand whether the transcript will follow live updates.

5. **Thinking as first-class collapsible block**
   - Treat thinking/reasoning as a dedicated component with status, duration, collapse, and privacy/density semantics.
   - Why it matters: reasoning has different UX expectations than final answer text.

6. **Tool results as semantic cards**
   - Render success/failure, target, changed files, command, duration, attachments, and expandable raw output.
   - Why it matters: users care what happened before they care about raw logs.

7. **Subagents as participants/workers**
   - Give subagents participant chips/cards: spawned, running, completed, result attached, steerable/focusable.
   - Why it matters: parallel work is a differentiator and should not feel like anonymous inserted text.

8. **Composer action bar as intent launcher**
   - Reframe composer from settings row to `what do you want OpenClaw to do?`: chat, run task, attach context, pick model/thinking, stop.
   - Why it matters: the current surface exposes system controls while the user is trying to express intent.

### Leverage and compounding frame

1. **Unified work timeline spine**
   - Merge `ThinkingBlock`, `ToolCallSteps`, and `SubagentCard/SubagentBar` into one chronological activity spine per turn: thinking → tools → subagents → final answer.
   - Why it matters: every future process artifact gets one place to live.

2. **Persistent turn-level execution summary**
   - Add a compact row per assistant turn: model, token count, tools used, subagents spawned, duration, approvals.
   - Why it matters: turns become inspectable units for debugging, cost awareness, and analytics.

3. **Reusable collapsible disclosure primitive**
   - Extract repeated open/close animation patterns from `ThinkingBlock`, `ToolCallSteps`, `SubagentBar`, and `SubagentFullChat` into shared `DisclosurePanel`.
   - Why it matters: one polished primitive improves every expandable chat artifact.

4. **Tool-call step cards as reusable objects**
   - Promote `ToolRow` / approval / details handling into reusable tool-event components for main chat, subagent full chat, Activity, and trace views.
   - Why it matters: tool rendering quality improves everywhere once.

5. **Scroll anchoring state machine**
   - Extract scroll behavior into `useChatScrollAnchor`: initial scroll, pinned-to-bottom, jump button, older-message load, user intent.
   - Why it matters: scroll behavior is foundational and currently high-risk.

6. **Markdown render capability registry**
   - Move code, mermaid, embeds, tables, attachments, approvals, and previews toward composable render capabilities.
   - Why it matters: future rich content should not keep bloating `MarkdownContent` and `MessageBubble`.

7. **Selection-to-composer reference system**
   - Generalize selected assistant text into first-class reference chips in `ChatBox`.
   - Why it matters: creates reusable quoting/reference workflow for deeper follow-ups.

8. **Subagent result digest before full chat**
   - Show live status plus final digest: task, last activity, result excerpt, tool count, open full chat.
   - Why it matters: full chat should be detail, not the only useful view.

## Raw Candidate Ideas Considered

### Transcript readability and hierarchy

1. **Assistant response frame only for complex turns**
   - Add a subtle container/frame for assistant turns that include tools, thinking, approvals, or subagents, while keeping simple text answers lightweight.
   - Basis: assistant messages currently render mostly as text; tools/thinking can feel like loose fragments.

2. **Turn header for assistant activity-heavy responses**
   - Add a small top line such as `Cozy · running tools · 2 steps` only when useful.
   - Basis: `ChatView` already computes live tools and status; `MessageBubble` has no concise turn-level summary.

3. **Better message action reveal zones**
   - Keep message actions but make hover/focus behavior more spatially predictable and less visually noisy.
   - Basis: `MessageBubble` contains many actions: copy/edit/reply/pin/fork/feedback/selection ask.

4. **Dense/comfortable transcript mode**
   - Add display density preference for users who use Desktop for long coding sessions.
   - Basis: `max-w-3xl`, 14px text, large vertical gaps are comfortable but may be inefficient for debugging-heavy chats.

5. **Improve code/tool output rhythm**
   - Normalize code blocks, tool details, and terminal-ish snippets into one consistent visual grammar.
   - Basis: terminal polish just improved a separate surface; chat tool/code surfaces can share some visual language.

### Composer clarity and action density

6. **Composer command rail / grouped action strip**
   - Separate high-frequency actions from secondary actions in `ActionBar`: model, send/stop, attach, web, voice/slash.
   - Basis: `ActionBar` currently carries many controls in a compact row.

7. **Model selector as contextual pill with cost/reasoning hints**
   - Expand current model pill with model logo, reasoning badge, and maybe active override status.
   - Basis: recent `ModelLogo` work exists; `ActionBar` already has model data.

8. **Reply/edit state banner above composer**
   - Make reply target and edit/regenerate branch state more explicit in a compact banner.
   - Basis: `ChatBox` receives `replyTo`, and `ChatView` has edit preview state.

9. **Attachment tray with clearer lifecycle**
   - Show queued/uploaded/failed attachment states in one tray above the composer, not only previews.
   - Basis: attachment logic exists in `useChatComposerAttachments` and `AttachmentPreviewList`.

10. **Send affordance state copy**
   - When generating, make the stop/send-while-generating state clearer: `Stop`, `Send anyway`, or disabled reason.
   - Basis: `ActionBar` supports `canSendWhileGenerating`, `isGenerating`, `onAbort`.

### Live work visibility

11. **Unified Work Timeline Spine**
   - Replace separate thinking row + inline tool list + bottom status with a coherent chronological activity spine inside the current assistant turn: thinking → tools → approvals → subagents → final answer.
   - Basis: `ThinkingBlock`, `ToolCallSteps`, `SubagentBar`, `SubagentCard`, and bottom `statusText` are separate surfaces.

12. **Tool step timeline with lifecycle grouping**
   - Make tool calls read like ordered steps with done/running/error/approval states, counts, durations, semantic summaries, and optional raw details.
   - Basis: `ToolCallSteps` already has statuses and details; Activity semantics are the reference.

13. **Approval cards become first-class decision cards**
   - Standardize approval UI across `MessageBubble` approval parsing and `ToolCallSteps` approval handling.
   - Basis: there are two approval card implementations with overlapping visuals/logic.

14. **Subagent progress mini-map**
   - Upgrade `SubagentBar` into a compact progress summary: active/completed/failed counts, latest child message preview, latest tool, elapsed time, failure reason, and open all.
   - Basis: `SubagentBar` already tracks active count and links to child chats; subagent full chat has deeper context.

15. **Live work status should attach to the originating turn**
   - Avoid bottom-only status for long transcripts; show the current run status near the current assistant message too.
   - Basis: scroll constraints reserve bottom row height, but status can be disconnected when user is scrolled up.

16. **Conversation-first bubbles, artifact-first blocks**
   - Keep short conversational replies lightweight; render long documents, logs, code, tables, tool outputs, plans, and generated artifacts as full-width blocks/cards.
   - Basis: assistant output often exceeds chat-bubble semantics.

17. **Turn-level execution summary**
   - Add compact model/token/tool/subagent/duration/approval metadata row per assistant turn.
   - Basis: `ResponseMetadata`, tool statuses, and subagent counts already exist across components.

18. **Visible scroll mode**
   - Surface `Live` vs `Paused reading` and unread/live update count around jump-to-bottom behavior.
   - Basis: main `ChatView` already tracks bottom proximity and jump button state.

### Navigation and recovery

19. **Pinned messages as timeline bookmarks**
   - Improve pins from a popover into lightweight bookmarks with snippets, role, and jump affordance.
   - Basis: `PinnedMessagesPopover` and `messageActions` already support pins and navigation.

20. **Search result context preview**
   - Make `ChatSearch` show surrounding turn context and tool/attachment markers, not just message hits.
   - Basis: search receives rendered messages and scroll callback.

21. **Jump-to-bottom with unread/live count**
   - Enhance current jump arrow with `3 new` / `running tool` context while user is scrolled away.
   - Basis: `showJumpToBottom`, live status, and rendered message counts exist.

22. **Turn minimization for long tool-heavy responses**
   - Allow collapsing older heavy assistant turns to summary rows while preserving scroll stability.
   - Basis: tool-heavy chats can become visually long; scroll constraints require careful plain DOM handling.

23. **Message recovery actions in error states**
   - For assistant error messages, surface `retry`, `copy debug`, and `open logs` when relevant.
   - Basis: `MessageBubble` detects assistant errors; `ChatView` already has retry/regenerate logic.

### Maintainability and state boundaries

24. **Split `MessageBubble` into focused subcomponents**
   - Extract approval card, action bar, attachment rendering, selection action, edit bubble, and assistant content.
   - Basis: `MessageBubble.tsx` is doing too much and mixes rendering, parsing, actions, and selection behavior.

25. **Create a shared `LiveRunStatus` component**
   - Centralize status text/icon behavior currently computed in `ChatView` and rendered near empty/non-empty layouts.
   - Basis: status display is duplicated across empty and non-empty states.

26. **Create a shared approval model/component**
   - Unify parsed text approvals and tool-call approvals behind one UI/data shape.
   - Basis: approval logic appears in both `MessageBubble` and `ToolCallSteps`.

27. **Shared `DisclosurePanel` primitive**
   - Centralize collapsible animation and header behavior for thinking/tools/subagents.
   - Basis: repeated open/close patterns across chat components.

28. **Reusable tool-event components**
   - Make tool rows/details/approval reusable across main chat, subagent full chat, Activity, and trace views.
   - Basis: main chat and subagent chat currently diverge.

29. **Extract `useChatScrollAnchor`**
   - Centralize initial scroll, pinned-to-bottom, jump button, older-message load, and user intent logic.
   - Basis: scroll code is large and high-risk in `ChatView/index.tsx`.

30. **Document chat UI visual grammar**
   - Add `docs/constraints/chat-ui.md` for transcript width, message surfaces, tool status, composer density, and scroll-safe changes.
   - Basis: current constraints cover engine/scroll but not visual hierarchy.

31. **Add visual regression smoke for core chat states**
   - Capture empty chat, normal exchange, tool-heavy turn, approval, attachments, subagent bar, scrolled-away status.
   - Basis: many regressions here are visual/stateful; typecheck does not catch them.

## Rejected / Deferred Ideas

- **Replace transcript with virtualized list** — rejected because `docs/constraints/ui-scroll.md` explicitly removed virtualization due to anchoring jumps during live tool/status updates.
- **Full chat redesign before component extraction** — risky because `ChatView` and `MessageBubble` carry many lifecycle constraints; visual changes should be incremental.
- **Always-card assistant messages** — may make normal conversation heavier and less elegant; better to card only complex turns or use very subtle surfaces.
- **Move all live status to bottom composer only** — loses context when long tool-heavy responses are above the fold.
- **Introduce backend changes for UI polish** — unnecessary for most ideas; current UI already has status/tool/subagent data.
- **Blindly apply mobile/native assumptions to Desktop** — the assumption-breaking pass looked beyond Desktop; useful reframes should be filtered through current React UI constraints before planning.

## Ranked Survivor Ideas

### 1. Unified Work Timeline Spine

Merge thinking, tools, approvals, subagent progress, and live run status into one chronological activity spine per assistant turn.

Why this is strongest:
- It is the clearest synthesis across all completed ideation frames.
- Highest UX leverage for OpenClaw’s agent-heavy workflows.
- Gives every future process artifact one home instead of adding ad-hoc chat blocks.
- Builds on existing `ThinkingBlock`, `ToolCallSteps`, `SubagentBar`, `SubagentCard`, approval UI, and `statusText` without backend changes.

Suggested next workflow:
- Run `ce-brainstorm` on: “Unified Work Timeline Spine for ChatView assistant turns.”

### 2. Tool Step Timeline / Reusable Tool Events

Make tool calls read like ordered progress steps with clear lifecycle, semantic summary, status counts, duration, approval, success/error, and optional raw details. Reuse the same tool-event rendering in main chat, subagent chat, Activity, and future trace views.

Why it survives:
- Tool execution is central to OpenClaw Desktop.
- `ToolCallSteps.tsx` already has most data and expansion behavior.
- Subagent tool display is currently weaker and can benefit immediately.
- This aligns chat with Activity tab semantics without touching engine contracts.

### 3. Subagent Progress and Result Digest

Upgrade `SubagentBar` / `SubagentCard` from count/list surfaces into concise worker summaries: active/completed/failed counts, latest tool, last message excerpt, elapsed time, failure reason, final digest, and open full chat.

Why it survives:
- OpenClaw’s subagent workflow is distinctive.
- Existing UI is functional but undersells background work.
- Inline digests make fanout workflows scannable without forcing users into full child chats.

### 4. Composer Clarity / Intent Launcher Pass

Refine `ChatBox` / `ActionBar` so model, attach, web, voice/slash, send/stop, reply state, and send-while-generating behavior are easier to parse. Confirm whether web-search state is actually wired into send payload; if not, wire it or remove/rename the toggle.

Why it survives:
- The composer is the highest-frequency interaction surface.
- The web toggle and generating states can create trust friction if unclear.
- Recent model logo work gives a good entry point.
- Can be scoped to UI only unless the web toggle truly needs payload support.

### 5. Scroll Intent System / `useChatScrollAnchor`

Extract scroll ownership into a small hook/state machine and make scroll mode visible: `Live`, `Paused reading`, `Jump to latest`, unread/live count. Apply the same behavior to `SubagentFullChat`.

Why it survives:
- Scroll behavior is one of the most fragile parts of streaming chat.
- Main ChatView has hard-won logic; subagent full chat does not yet match it.
- Visible scroll mode gives users control during long live runs.

### 6. MessageBubble Decomposition + Shared DisclosurePanel

Split the large `MessageBubble.tsx` into focused subcomponents and extract a shared `DisclosurePanel` for thinking/tools/subagents.

Why it survives:
- Reduces risk for future chat UI work.
- Makes approval/actions/attachments/editing easier to improve independently.
- Reuses one polished expandable pattern across multiple surfaces.

### 7. Chat UI Visual Grammar Constraint Doc

Create `docs/constraints/chat-ui.md` to lock down safe patterns for transcript width, assistant surfaces, artifact blocks, tool/work lane behavior, composer density, and scroll-safe changes.

Why it survives:
- This repo already benefits from constraints docs.
- Chat has many subtle scroll/tool/replay rules; visual rules are currently implicit.
- Low cost, high future leverage.

## Recommended Path

Do not start with a full visual redesign. Start with the agent-specific surfaces that make OpenClaw feel powerful:

1. Run `ce-brainstorm` for the **Unified Work Timeline Spine**.
2. Plan and implement a first PR around the spine and **Tool Step Timeline**.
3. Include `docs/constraints/chat-ui.md` in that first PR.
4. Reuse/extract `DisclosurePanel` and tool-event primitives only as much as needed for the first slice.
5. Follow with **Subagent Progress Digest** and **Composer Clarity** as separate PRs.
6. Extract `useChatScrollAnchor` before making deeper scroll-affecting changes, and apply it to `SubagentFullChat`.

## Validation Ideas for Future Implementation

Automated:
- Targeted eslint on changed chat files.
- Existing chat parser/dedupe/status tests.
- Existing scroll/chat tests where applicable.
- Add component tests only for deterministic data transforms; avoid brittle animation tests.

Manual smoke:
- Empty chat.
- Normal user/assistant exchange.
- Streaming assistant text.
- Thinking block open/closed.
- Running tool, completed tool, failed tool.
- Multi-tool collapsed stack status counts.
- Approval card resolution.
- Attachment message.
- Reply/edit/regenerate.
- Subagent spawn, progress digest, and open child chat.
- Subagent full chat while scrolled away during live updates.
- Scroll away during live run and use jump-to-bottom.
- Search/pin navigation.
