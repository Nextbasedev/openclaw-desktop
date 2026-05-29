# assistant-ui ChatView Integration Plan

Scope: temp checkout only (`/root/.openclaw/workspace/tmp/openclaw-desktop-v3-temp`). Do not touch the protected main checkout.

## Target outcome

Completely replace OpenClaw Desktop's current custom chat message screen rendering with an `assistant-ui`-based thread while preserving OpenClaw-specific behavior:

- Existing chat transport/session logic stays: `useChatMessages`, chat-engine-v2 store/patches, `sendMessage`, abort, retry, load older, completion notifications.
- Visual message/thread/composer structure comes from assistant-ui patterns (`ThreadPrimitive`, `MessagePrimitive`, `ComposerPrimitive`, `ExternalThread`/Aui store).
- Existing OpenClaw custom rendering is reused where product-specific behavior matters: tool-call cards, approval buttons, copy/edit/retry/fork/reply/pin/download/feedback actions, attachments, markdown/code blocks, rich previews, thinking/reasoning, subagent cards.
- Long chat behavior remains smooth: stable keys, no Virtuoso reintroduction, bottom anchoring, lazy older loads, reduced rerenders, scroll-to-bottom affordance.
- Verification includes unit tests, UI/render tests where feasible, build/typecheck, cURL/API smoke checks, virtual/e2e browser checks, and saved logs.

## Repository findings

### assistant-ui clone

- Cloned at `/root/.openclaw/workspace/vendor/assistant-ui`, HEAD `c4d3eea`.
- Useful source patterns:
  - `examples/with-browser-extension/MyThread.tsx`: minimal browser-extension thread wrapper.
  - `examples/with-opencode/components/assistant-ui/thread.tsx`: full web thread with composer, action bar, grouped tool rendering, scroll-to-bottom, animations.
  - `examples/with-tap-runtime/app/MyRuntimeProvider.tsx`: `ExternalThread` + message converter pattern for external chat state.
  - `packages/core/src/runtimes/external-store/external-store-adapter.ts`: external store runtime contract.
- NPM packages installed in `packages/ui`:
  - `@assistant-ui/react`
  - `@assistant-ui/react-markdown`
- `@assistant-ui/ui` is not published to npm; examples import it as monorepo workspace code. We must copy/adapt required components locally instead of depending on that package.

### current OpenClaw chat UI

- Primary screen: `packages/ui/components/ChatView/index.tsx`.
- Message renderer: `packages/ui/components/ChatView/MessageBubble.tsx`.
- Composer: `packages/ui/components/ChatBox/index.tsx` plus `ChatView/ChatInput.tsx` legacy/alternate.
- Tool rendering: `ToolCallSteps.tsx`, `ToolCallDetails.tsx`, `ThinkingBlock.tsx`, `chatToolDisplay.ts`, `liveToolCalls.ts`.
- Message types: `packages/ui/components/ChatView/types.ts` (`ChatMessage`, `InlineToolCall`, attachments, usage, branches, reply, voice).
- Existing test coverage for parsing/session/reconcile/tool display is already present under `packages/ui/lib/**/__tests__` and `packages/ui/lib/*.test.ts`.

## Integration architecture

### 1. Runtime bridge

Create `packages/ui/components/ChatView/assistant-ui/adapter.ts`.

Responsibilities:

1. Convert `ChatMessage[]` to `ExternalThreadMessage[]` / assistant-ui thread messages.
2. Preserve stable IDs (`messageId`) and timestamps.
3. Convert text/reasoning/tool calls/attachments into assistant-ui message parts:
   - text -> `{ type: "text", text }`
   - reasoningText -> `{ type: "reasoning", text }`
   - toolCalls -> `{ type: "tool-call", toolCallId, toolName, args/argsText, result, isError }`
   - image/file attachments -> assistant-ui attachments/parts when possible, otherwise custom metadata for OpenClaw renderers.
4. Attach `metadata.custom.openclaw` with original message data needed by existing actions: usage, model, stopReason, branches, replyTo, embeds, voice, optimistic/send status.
5. Map running state from existing stream status to assistant-ui `isRunning`.
6. Map composer `onNew` back to existing `handleSend`/`ChatComposerSubmit` without changing backend API.
7. Map `onCancel` to existing abort flow.
8. Keep edit/reload hooks disabled initially unless we can wire them to existing flows safely; re-enable once parity is verified.

### 2. assistant-ui thread shell

Create local copied/adapted components under `packages/ui/components/ChatView/assistant-ui/`:

- `Thread.tsx`: based on `examples/with-opencode/components/assistant-ui/thread.tsx`, stripped to OpenClaw needs.
- `Message.tsx`: assistant-ui `ThreadPrimitive.Messages` + role switch.
- `Composer.tsx`: assistant-ui `ComposerPrimitive`, styled to match current OpenClaw smooth composer and attachment controls.
- `MessageActions.tsx`: wrap existing action state handlers (copy, edit, retry, pin, reply, fork, feedback, download).
- `ToolPart.tsx`: renders OpenClaw `InlineToolCall` using current `ToolCallSteps`/`ToolCallDetails` styling instead of generic assistant-ui fallback.
- `MarkdownPart.tsx`: use existing `MarkdownContent` for markdown/code/mermaid parity.

### 3. ChatView replacement path

Refactor `ChatView/index.tsx` in small slices:

1. Keep data hooks/effects/state at top level.
2. Replace only the message-list + bottom composer JSX with `<OpenClawAssistantThread />`.
3. Pass existing callbacks into the assistant-ui bridge:
   - send, abort, retry, edit preview, approval resolution, tool selection, subagent open, fork navigation.
4. Keep outer shell/search/pinned/subagent overlay/loading skeleton unchanged until parity is confirmed.
5. Delete old custom message-list code only after tests/build/e2e pass.

### 4. Long chat and smooth rendering

- Use assistant-ui `ThreadPrimitive.Viewport` with `scroll-smooth`, stable message IDs, and bottom sticky footer.
- Preserve existing older-message loader threshold (`AUTO_LOAD_OLDER_SCROLL_THRESHOLD_PX`) by attaching scroll callback to assistant-ui viewport.
- Avoid virtualization unless real performance regression is measured; Krish specifically wants long chat smoothness and prior work removed Virtuoso.
- Memoize converted assistant-ui messages by message signature, not raw array identity, to reduce re-render churn during streaming.
- Keep streaming text behavior controlled: assistant-ui handles part updates; OpenClaw `useStreamingText` only remains if needed for message-level animation parity.

### 5. Test matrix

Unit tests first:

- `assistantUiAdapter.test.ts`
  - user/assistant text conversion
  - reasoning conversion
  - tool-call conversion with running/success/error statuses
  - approval metadata retained
  - attachments retained
  - usage/model/stopReason metadata retained
  - stable IDs and dates
- Rendering tests if current setup supports React/jsdom:
  - thread renders 100+ messages without key warnings
  - user and assistant messages appear
  - tool-call card appears
  - action buttons appear for sent and response messages
  - composer send/stop states render

Verification commands:

- `pnpm --filter ui test -- assistantUiAdapter.test.ts`
- `pnpm --filter ui typecheck`
- `pnpm --filter ui build`
- Existing relevant tests:
  - `pnpm --filter ui test -- chatToolDisplay.test.ts liveToolCalls.test.ts chatMessageDedupe.test.ts useChatMessages.reconcile.test.ts`
- Middleware/API smoke where applicable:
  - start middleware/dev server if needed
  - cURL chat bootstrap/send endpoints with test session
  - confirm projected message stream shape still feeds UI adapter
- Virtual/e2e:
  - run existing `scripts/e2e/v2-chat-human-flow.ts` or sandbox UI verifier if environment allows
  - browser smoke with a long fake chat fixture if app can run locally

## Micro-task sequence

### Phase A — Dependencies and adapter foundation

1. Add assistant-ui dependencies to `packages/ui/package.json`.
2. Create `components/ChatView/assistant-ui/adapter.ts`.
3. Create adapter unit tests.
4. Run adapter tests and typecheck.

### Phase B — Local assistant-ui components

5. Copy/adapt assistant-ui opencode thread skeleton into local `Thread.tsx`.
6. Replace assistant-ui example imports (`@/components/assistant-ui/*`) with local OpenClaw UI primitives.
7. Implement text/markdown part using existing `MarkdownContent`.
8. Implement tool part using existing OpenClaw tool-call display.
9. Implement message action bar using existing callbacks.
10. Implement assistant-ui composer wired to existing send/abort callbacks.
11. Add render tests.

### Phase C — ChatView swap

12. Add `<OpenClawAssistantThread />` behind an internal component boundary.
13. Replace current message viewport JSX with assistant-ui thread shell.
14. Preserve search, pinned messages, edit preview, subagent bars/cards, jump-to-bottom, load older.
15. Remove dead imports/state after parity.
16. Run UI tests, typecheck, build.

### Phase D — End-to-end and cURL verification

17. Run existing chat projection/stream tests.
18. cURL bootstrap endpoint for a real/test session and save logs.
19. cURL send endpoint with a harmless test message if local middleware is available.
20. Run virtual browser/e2e smoke: initial load, send, streaming response, tool card, long chat scroll, copy button.
21. Save verification logs under `reports/assistant-ui-integration/`.

### Phase E — final review

22. Review diff for scope creep and protected checkout safety.
23. Confirm no `console.log`, no debug-only code, no TODO placeholders in new path.
24. Commit with a focused message after all gates pass.
25. Push only if Krish wants this branch pushed or if repository workflow expects it.

## Known risks / mitigations

- assistant-ui examples use workspace-only `@assistant-ui/ui`; mitigation: copy/adapt the needed component patterns locally.
- Full replacement is large; mitigation: adapter-first, then component shell, then swap.
- Current `ChatView/index.tsx` is large and stateful; mitigation: preserve data layer and replace only render surface initially.
- Tool call design is product-specific; mitigation: do not use generic assistant-ui tool fallback, render current OpenClaw tool cards inside assistant-ui parts.
- Long chat regressions are likely if scroll anchoring changes; mitigation: explicit long-chat render test and browser scroll smoke.
