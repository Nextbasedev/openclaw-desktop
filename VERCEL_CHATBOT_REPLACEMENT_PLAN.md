# Vercel Chatbot-Style Chat Screen Replacement Plan

Branch: `krish-3`  
Workspace: `/root/.openclaw/workspace/tmp/openclaw-desktop-v3-temp`  
Source references:
- Vercel Chatbot clone: `/root/.openclaw/workspace/vendor/vercel-chatbot` at `2becdb4`
- assistant-ui clone: `/root/.openclaw/workspace/vendor/assistant-ui` at `e7c2396`

## Problem statement

The current assistant-ui integration still does not feel stable:

- sending a message can blink/remount
- confirmed user messages can replace optimistic messages visually instead of smoothly updating
- assistant response can disappear and then render all at once
- response text does not reveal with a typing/smooth stream feel
- the screen structure is still too hybrid: part assistant-ui, part legacy ChatView behavior

The goal is not another small patch. The goal is a complete, reliable chat timeline flow inspired by Vercel Chatbot’s production implementation, while preserving OpenClaw-specific backend/session/tool functionality.

## Reference findings

### Vercel Chatbot structure

Key files:
- `components/chat/messages.tsx`
- `components/chat/message.tsx`
- `components/chat/multimodal-input.tsx`
- `hooks/use-messages.tsx`
- `hooks/use-scroll-to-bottom.tsx`
- `components/ai-elements/message.tsx`
- `components/ai-elements/tool.tsx`
- `components/ai-elements/shimmer.tsx`

Important patterns to copy/adapt:

1. **One stable scroll viewport**
   - Vercel has one absolute/inset scroll container inside a `relative flex-1` wrapper.
   - It does not swap whole viewport trees during send/response.
   - It keeps a stable end ref at the bottom.

2. **Stable message list keys**
   - Each message row is keyed by a stable UI message id.
   - Streaming updates mutate message content under the same key.
   - The row does not unmount when text changes.

3. **Separate thinking placeholder**
   - If submitted and no assistant message exists yet, render a separate `ThinkingMessage`.
   - Do not fake/remove the user row.
   - Do not replace the whole list while waiting for response.

4. **Autoscroll with intent detection**
   - Track `isAtBottom` and user scrolling.
   - If user is already at bottom, auto-scroll instantly/smoothly as content grows.
   - If user scrolls upward, stop forcing scroll.
   - Use MutationObserver/ResizeObserver to handle streaming text height changes.

5. **Message row visual design**
   - User message: right aligned, rounded bubble, max width, subtle border/shadow.
   - Assistant message: left aligned row with an assistant icon/glyph, content column, action bar below.
   - Assistant thinking: shimmer “Thinking...” line.
   - Message rows use small enter animation only on new messages.

6. **Streaming text**
   - Text must reveal progressively under the same row key.
   - Never blank and restart if the incoming text extends the previous text.
   - Only reset reveal if text is not a continuation of current display.

### Current OpenClaw issue analysis

Likely causes of blinking/remounting:

1. **Backend id churn**
   - Optimistic user id can be replaced by canonical id.
   - Assistant live/delta/final ids can change (`live:*`, final message id, cursor id).
   - assistant-ui/React treats changed ids as new rows → old row unmounts → blink.

2. **Whole mode/layout swap risk**
   - Current feature flag wraps a separate assistant-ui path in `ChatView`.
   - If enabled state or message load state changes at the wrong time, the list subtree can remount.

3. **Streaming reveal mode mismatch**
   - `MarkdownContent` defaulted to immediate reveal; assistant path must use buffered reveal for response text.

4. **Assistant ordinal instability**
   - Assistant message display id by ordinal can still change if a tool-only placeholder appears/disappears before final text.

5. **No dedicated optimistic/canonical UI identity layer**
   - Current adapter maps backend messages directly to UI messages.
   - We need a UI timeline adapter that preserves display identity across backend reconciliation.

## New architecture

### A. `StableChatTimeline` adapter

Create/extend `packages/ui/components/ChatView/assistant-ui/adapter.ts` into a real UI timeline adapter.

Responsibilities:

1. Convert `ChatMessage[]` into `OpenClawAssistantMessage[]`.
2. Generate **stable UI ids** that survive backend id changes:
   - user rows: stable by turn fingerprint (`text + attachment names + approximate order`) and preserved map
   - assistant rows: stable by the preceding user turn id and assistant slot type (`thinking/tool/final`) with map preservation
   - explicit backend ids still stored in `metadata.custom.openclaw.messageId`
3. Preserve the same UI id when:
   - optimistic user becomes canonical user
   - assistant delta becomes assistant final
   - assistant status changes from streaming to done
   - text grows incrementally
4. Avoid ordinal shifting when tool-only rows appear/disappear:
   - one assistant response row per user turn should be preferred
   - tool calls and text should merge into the same assistant row for the active turn where possible
5. Retain all OpenClaw metadata:
   - original message id
   - model/usage/stopReason
   - attachments/voice/embeds
   - toolCalls and approval data
   - branch/reply/fork state when available

### B. Vercel-style message screen component

Create a new component path, likely:

`packages/ui/components/ChatView/vercel-ui/OpenClawVercelChat.tsx`

or evolve `assistant-ui/OpenClawAssistantThread.tsx` into Vercel-like structure.

Required behavior:

1. **Stable root**
   - `relative flex-1 bg-background`
   - one `overflow-y-auto` scroll container
   - one inner `mx-auto flex min-h-full max-w-4xl flex-col gap-5 px-2 py-6`

2. **Rows**
   - user row: right aligned bubble
   - assistant row: assistant glyph + content column
   - rows animate only on first mount, not on text updates
   - use `[content-visibility:auto]` and `[contain-intrinsic-size]` for long chat performance

3. **Thinking placeholder**
   - show shimmer only when `isGenerating && latest message is user && no assistant response yet`
   - never hide the sent user message

4. **Response reveal**
   - use `MarkdownContent` with `revealMode="buffered"` for actively streaming assistant text
   - ensure text extension continues from current display
   - no full text flash unless reduced motion is enabled

5. **Tool cards**
   - render OpenClaw `ToolCallSteps` inside assistant row
   - stable placement: before text while running; after/around text as current design requires
   - approval buttons remain wired to `resolveExecApproval`

6. **Action bars**
   - copy, retry, edit, fork, pin, feedback, reply remain available
   - copy should use visible message text
   - actions should not appear during active streaming unless existing product behavior expects them

7. **Highlighted words / selection colors**
   - preserve existing `MarkdownContent` highlight system and colors
   - keep sky/yellow selection/highlight overlays from old message bubble where applicable
   - do not regress previous highlighted-word styling

8. **Composer**
   - Vercel-style sticky composer shell
   - no blink on submit
   - input clears immediately after optimistic append
   - stop button appears while generating

### C. Scroll system

Implement/adapt Vercel’s `use-scroll-to-bottom` pattern locally:

`packages/ui/components/ChatView/vercel-ui/useStableChatScroll.ts`

Requirements:

1. Track `isAtBottom` with 100-160px threshold.
2. Track user scroll intent with a short timeout.
3. Use `MutationObserver` for message/content changes.
4. Use `ResizeObserver` for streaming text/tool card expansion.
5. If user is at bottom and not actively scrolling up, keep pinned to bottom.
6. If user scrolls up, show floating scroll-down button and do not force-scroll.
7. Reset scroll state on session change.
8. Support load-older threshold at top without fighting bottom pinning.

### D. Data flow

Keep existing backend/data layer:

- `useChatMessages`
- chat-engine-v2 store/applyPatches
- `wrappedSend`
- `handleAbort`
- `resolveExecApproval`
- subagent bar / full chat handling
- search/pinned overlays initially preserved outside new timeline

Do **not** rewrite the middleware or Gateway protocol for this UI pass.

### E. Migration strategy

Phase 1 — Adapter stability
- Add stable UI id mapping tests.
- Handle optimistic → canonical user replacement.
- Handle assistant delta → final replacement.
- Handle tool-only + final assistant merge.
- Verify no duplicate/shifted assistant ids.

Phase 2 — Vercel-style timeline component
- Build new Vercel-inspired timeline component.
- Use it under `NEXT_PUBLIC_OPENCLAW_ASSISTANT_UI_CHATVIEW=1` / localStorage flag.
- Keep old path untouched until verified.

Phase 3 — Animations and smoothness
- Add row enter animations.
- Add shimmer thinking placeholder.
- Use buffered reveal for assistant text.
- Keep action bars and tool cards from OpenClaw.

Phase 4 — Long-chat reliability
- Add content visibility and intrinsic size.
- Add stable scroll hook with MutationObserver + ResizeObserver.
- Verify older-message loading still works.

Phase 5 — Verification
- Unit tests:
  - adapter stable IDs
  - optimistic/canonical reconciliation
  - assistant delta/final same id
  - duplicate user text does not collapse messages
  - tool-call metadata preserved
- Targeted tests:
  - `assistantUiAdapter.test.ts`
  - `chatToolDisplay.test.ts`
  - `liveToolCalls.test.ts`
  - `useStreamingText.test.ts`
- Gates:
  - `pnpm --filter ui typecheck`
  - `pnpm --filter ui build`
  - targeted eslint on touched files
- Browser smoke if Chrome available; otherwise cURL and dev-server chunk smoke.

## Implementation checklist

### Step 1: Stable adapter
- [ ] Replace direct backend id usage with a stable display-id strategy.
- [ ] Add adapter tests for optimistic/canonical and delta/final.
- [ ] Preserve original ids in metadata.

### Step 2: Vercel scroll hook
- [ ] Copy/adapt `use-scroll-to-bottom.tsx`.
- [ ] Add top-load callback compatibility.
- [ ] Add reset on session key changes.

### Step 3: New chat timeline
- [ ] Create Vercel-style message screen.
- [ ] Render messages with stable keys.
- [ ] Add thinking placeholder.
- [ ] Add jump-to-bottom button.
- [ ] Preserve tool card and approval UI.

### Step 4: Composer polish
- [ ] Keep current OpenClaw composer data features.
- [ ] Apply Vercel-style visual shell/animation.
- [ ] Ensure no composer remount on submit.

### Step 5: OpenClaw-specific parity
- [ ] Attachments
- [ ] Rich content preview
- [ ] Thinking/reasoning block
- [ ] Copy/edit/retry/fork/pin/reply/feedback
- [ ] Highlighted selected words / colors
- [ ] Subagent cards/bar
- [ ] Search/pinned popovers

### Step 6: Verification and push
- [ ] Run all targeted tests.
- [ ] Run typecheck.
- [ ] Run build.
- [ ] Commit and push to `origin krish-3`.

## Acceptance criteria

The implementation is not accepted until:

1. Sent user message remains visible continuously after submit.
2. Assistant response starts as thinking/shimmer, then streams into the same row.
3. No hide-then-render-at-once behavior during normal response.
4. No remount blink when backend confirms optimistic user message.
5. No remount blink when assistant final replaces live/delta message.
6. Tool calls remain visible and stable.
7. Existing highlighted word colors remain unchanged.
8. Long chats scroll smoothly and do not jump unless pinned to bottom.
9. Tests/typecheck/build pass.
