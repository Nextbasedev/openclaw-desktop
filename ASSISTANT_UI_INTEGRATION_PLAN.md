# assistant-ui Integration Plan for OpenClaw Desktop

Branch: `krish-v3`
Workspace: `/root/.openclaw/workspace/tmp/openclaw-desktop-v3-temp`
Protected main checkout: `/root/.openclaw/workspace/openclaw-desktop` — do not touch/sync.

## Goal

Improve OpenClaw Desktop chat UI by adopting assistant-ui/shadcn message design patterns while preserving OpenClaw's existing chat engine, middleware protocol, session lifecycle, tools, attachments, approvals, subagents, slash commands, and persistence.

## Non-negotiable Rules

1. Work only inside the temp checkout on branch `krish-v3`.
2. Do not edit, fetch, reset, pull, or sync the protected main checkout.
3. Do not replace OpenClaw's backend protocol with Vercel AI SDK or Assistant Cloud.
4. Do not remove existing OpenClaw features: tool calls, approvals, subagents, attachments, pinned messages, branching/edit preview, model/space selectors, slash commands, voice, search, warm cache, patch stream v2.
5. Prefer adapter/wrapper migration over a hard rewrite.
6. Every phase must keep `pnpm --filter ui typecheck` passing before moving on.
7. Every risky UI change needs a fallback path or feature flag until visually verified.
8. Preserve existing tests and add regression tests for ordering, tool rendering, and composer send/stop behavior.

## assistant-ui Findings

assistant-ui is split into:

- UI primitives/components: Thread, Message, Composer, ActionBar, BranchPicker, attachments, markdown, reasoning, tool groups.
- Runtime layer: LocalRuntime, ExternalStoreRuntime, DataStream, AssistantTransport, framework adapters.
- Optional Assistant Cloud for persistence.

For OpenClaw Desktop, the best fit is **not** Assistant Cloud and not AI SDK. OpenClaw already owns backend/runtime state through:

- `packages/ui/lib/chat-engine-v2/store.ts`
- `packages/ui/lib/chat-engine-v2/applyPatches.ts`
- `packages/ui/hooks/useChatMessages.ts`
- `packages/ui/components/ChatView/index.tsx`
- `packages/ui/components/ChatBox/index.tsx`

Best integration path: copy/adapt assistant-ui visual component patterns first, then optionally evaluate `@assistant-ui/react` ExternalStoreRuntime only if it can map cleanly to OpenClaw's store without losing features.

## Recommended Architecture

### Phase A — Visual Adapter, No Runtime Swap

Create local OpenClaw-owned components inspired by assistant-ui:

- `packages/ui/components/assistant-style/ThreadShell.tsx`
- `packages/ui/components/assistant-style/AssistantMessage.tsx`
- `packages/ui/components/assistant-style/UserMessage.tsx`
- `packages/ui/components/assistant-style/ComposerShell.tsx`
- `packages/ui/components/assistant-style/MarkdownText.tsx` or adapt existing `MarkdownContent.tsx`
- `packages/ui/components/assistant-style/ToolGroup.tsx`
- `packages/ui/components/assistant-style/ReasoningBlock.tsx`

These consume existing `ChatMessage`, `InlineToolCall`, and `ChatComposerSubmit` types. They do not require backend changes.

### Phase B — Component Replacement Behind Flag

Add a local flag, for example:

```ts
const ASSISTANT_STYLE_CHAT = true
```

Use it in `ChatView/index.tsx` to render the new assistant-style message list/composer. Keep the current renderer available while testing.

### Phase C — Composer Alignment

Update current `ChatBox` visually to match assistant-ui:

- rounded composer radius ~24px
- sticky viewport footer
- attachment row above input
- send/stop button on right
- focus ring behavior
- drag/drop styling
- keep current model, voice, slash command, space, attachment actions

Do not replace current send path. `onSend(payload: ChatComposerSubmit)` remains the source of truth.

### Phase D — Message Rendering Alignment

Apply assistant-ui message design:

- Assistant messages: full-width text, no heavy bubble, `fade-in slide-in-from-bottom-1`, relaxed markdown spacing.
- User messages: right-aligned rounded muted bubble, attachments above/right, action bar on hover.
- Footer action bars should not shift layout.
- Markdown: use assistant-ui spacing rules for headings, lists, code blocks, tables.
- Streaming text: preserve existing `useStreamingText` behavior.

### Phase E — Tool/Reasoning Group Alignment

Map OpenClaw tool projections to assistant-ui-like groups:

- Running tools grouped into a collapsible “Using tools” block.
- Completed tools show success/error/running tones.
- Preserve existing approval card behavior and native approval buttons.
- Preserve subagent cards and full chat links.
- Do not hide tool outputs that are needed for audit/debugging.

### Phase F — Optional Package Initialization

Only after Phase A-E are stable, evaluate installing:

- `@assistant-ui/react`
- `@assistant-ui/react-markdown`
- `lucide-react`
- `zustand` if needed by copied attachment components

But avoid wiring runtime until proven safe. Current repo already has React 19, Next 16, Tailwind 4, shadcn, framer-motion, react-markdown, remark-gfm, and UI primitives, so a pure visual port may be safer and smaller.

## Step-by-step Implementation Plan

### Step 1 — Baseline

Commands:

```bash
git status --short --branch
pnpm --filter ui typecheck
pnpm --filter ui test -- --run
```

Record any existing failures before editing.

### Step 2 — Add Design System Tokens

Add assistant-style CSS utilities/classes without changing current chat:

- message max width: `44rem`
- composer radius: `24px`
- composer padding: `10px`
- fade/slide animation classes if missing
- markdown spacing/tables/code styles

Verification: typecheck/build unchanged.

### Step 3 — Add New Message Components

Create new assistant-style user/assistant message components using existing `ChatMessage` props.

Tests:

- renders user text and attachments
- renders assistant markdown/code
- preserves slash-command visual style
- renders approval card when approval prompt text is detected

### Step 4 — Add Tool Group Adapter

Create OpenClaw tool group renderer that accepts existing inline tools/tool groups.

Tests:

- running tool displays active blue/amber state
- success displays green result text
- error displays red result text
- pending/awaiting tools do not jump layout

### Step 5 — Integrate Behind Feature Flag

Switch ChatView message list to assistant-style renderer behind a flag.

Tests:

- existing chat dedupe/order tests still pass
- scroll-to-bottom behavior still works
- loading older messages still works
- streaming finalization still works

### Step 6 — Composer Visual Port

Port assistant-ui composer shell style into existing `ChatBox`, not its runtime.

Keep:

- `onSend(ChatComposerSubmit)`
- `onAbort`
- attachments
- slash commands
- model selector
- space selector
- voice recording
- web search/autonomy controls
- draft persistence

### Step 7 — Runtime E2E

Manual/dev E2E checklist:

1. Start UI/middleware dev server.
2. Open a fresh chat.
3. Send normal text message.
4. Confirm user bubble appears instantly.
5. Confirm assistant stream animates without duplicated text.
6. Run a tool-using prompt.
7. Confirm tool group renders running → result without jumping.
8. Trigger approval-required command.
9. Confirm approval buttons still work.
10. Attach image/file and send.
11. Use slash command.
12. Stop generation.
13. Reload chat and confirm order is stable.
14. Open older chat and confirm cached/history messages render correctly.
15. Spawn subagent and confirm card/full-chat behavior.

### Step 8 — Fix Loop

If E2E fails:

1. Capture exact failing behavior.
2. Add/adjust regression test first.
3. Fix only that issue.
4. Re-run focused test.
5. Re-run full UI typecheck/build.
6. Repeat E2E from the start.

### Step 9 — Final Gates

Required before claiming done:

```bash
pnpm --filter ui typecheck
pnpm --filter ui build
pnpm --filter ui test -- --run
pnpm test:middleware
```

If middleware tests are unrelated but available, run them because chat protocol/rendering depends on middleware projections.

## Files Likely to Change

Primary:

- `packages/ui/components/ChatView/index.tsx`
- `packages/ui/components/ChatView/MessageBubble.tsx`
- `packages/ui/components/ChatView/ToolCallDetails.tsx`
- `packages/ui/components/ChatView/ToolCallSteps.tsx`
- `packages/ui/components/ChatView/MarkdownContent.tsx`
- `packages/ui/components/ChatBox/index.tsx`

New:

- `packages/ui/components/assistant-style/*`
- tests under `packages/ui/components/assistant-style/*.test.tsx` or existing test structure

Possible:

- `packages/ui/package.json`
- `pnpm-lock.yaml`
- `packages/ui/app/globals.css` or equivalent CSS file

## Main Risks

1. Full assistant-ui runtime swap could break OpenClaw-specific patch stream, tools, approvals, and session persistence.
2. Assistant-ui components assume their own runtime context; direct copy without adaptation may not compile.
3. Composer replacement could accidentally break slash commands, attachments, voice, or model selection.
4. Scroll behavior is recently fixed; large ChatView rewrites can reintroduce jump bugs.
5. Tool cards were recently fixed; grouping must not re-add borders/jumps.

## Recommendation

Proceed with **visual adapter integration first**. It gives the assistant-ui message feel while keeping OpenClaw's stable runtime. After that is proven end-to-end, decide whether installing/wiring `@assistant-ui/react` brings enough value to justify the risk.
