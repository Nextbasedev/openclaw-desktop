# Frontend Overview

This guide is for agents working in `packages/ui`. It explains how the Next.js desktop UI is wired end to end, where important code lives, and which invariants must be protected.

## Mental Model

The frontend is a Next.js 16 and React 19 app that renders inside the Tauri desktop shell. It does not talk directly to the remote OCPlatform Gateway. Instead, it talks to the local middleware on port `8787`.

Main path:

```text
User action
  -> React component or hook
  -> packages/ui/lib/* API helper
  -> local middleware HTTP or WebSocket route
  -> patch stream updates local chat state
  -> React re-renders from projected state
```

For chat, the patch stream is the source of truth. A send response only means the middleware accepted the request. Final message state comes from patches.

## Entry Points

| File | Role |
| --- | --- |
| `packages/ui/app/page.tsx` | Next route entry. Exports `AppPage`. |
| `packages/ui/app/layout.tsx` | Root document layout and providers. |
| `packages/ui/app/globals.css` | Tailwind v4 globals, CSS variables, base styling. |
| `packages/ui/components/AppPage.tsx` | Main desktop shell, routing, sidebar, tabs, inspector, terminal, active chat selection. |
| `packages/ui/components/ChatView/index.tsx` | Main conversation surface. |
| `packages/ui/components/ChatBox/index.tsx` | Composer, send controls, attachments, slash commands, voice input. |
| `packages/ui/lib/chat-engine-v2/client.ts` | Middleware client for chat send, bootstrap, messages, and patch stream. |
| `packages/ui/hooks/useChatMessages.ts` | Core chat hook: bootstrap, send, stream subscription, retry, status. |

## Key Directories

```text
packages/ui/
  app/                    Next.js app routes
  components/
    AppPage.tsx           Main application shell
    ChatView/             Message list, scroll logic, markdown, tools, subagents
    ChatBox/              Composer, attachments, slash commands, voice controls
    sidebar/              Space/chat navigation
    inspector/            Activity, git, workspace, subagent inspection
    settings/             Settings UI
    terminal/             xterm terminal UI
    SkillPage/            Skill browser and installer UI
  hooks/                  React hooks for chat, spaces, topics, voice, shortcuts
  lib/
    chat-engine-v2/       Patch client, reducer, store, active run watcher
    chatAttachments.ts    File encoding and limits
    chatSessionStore.ts   Warm/bootstrap session cache
    middleware-client.ts  Middleware connection management
    ipc.ts                Tauri IPC bridge helpers
  types/                  Shared frontend-only domain types
```

## Chat End-to-End Flow

1. User types in `ChatBox`.
2. `ChatView` or `useChatMessages` calls `sendChatV2()` from `lib/chat-engine-v2/client.ts`.
3. `sendChatV2()` sends `POST /api/chat/send` to the middleware.
4. Middleware creates an optimistic user message and broadcasts patches.
5. UI receives patches from `WS /api/stream/ws`.
6. `applyPatches.ts` merges patches into the chat store.
7. `useChatMessages.ts` exposes updated messages, run status, tool calls, and errors.
8. `ChatView` renders message bubbles, markdown, tool steps, subagents, and attachments.

Important: do not mark a run complete from the send HTTP response. Wait for projected patches from the middleware.

## Bootstrap and Reopen Flow

When a chat opens:

1. App shell resolves the active session key.
2. `useChatMessages` requests `GET /api/chat/bootstrap`.
3. Warm cache may paint recent messages quickly.
4. Middleware bootstrap projection is authoritative.
5. Patch stream continues from the latest cursor.
6. Older history is loaded via `GET /api/chat/messages`.

Warm cache is only a fast preview. It must never override authoritative projection data.

## Patch Stream

Primary files:

| File | Purpose |
| --- | --- |
| `lib/chat-engine-v2/client.ts` | Opens the WebSocket stream and fetches bootstrap/history. |
| `lib/chat-engine-v2/applyPatches.ts` | Converts patch frames into chat state changes. |
| `lib/chat-engine-v2/store.ts` | Central chat state store. |
| `lib/chat-engine-v2/types.ts` | Patch, run, tool, and bootstrap types. |
| `lib/chat-engine-v2/runWatcher.ts` | Watches active runs and reconciles stale status. |

Common patch categories:

- `chat.message.upsert`: insert or update a projected message.
- `chat.message.confirmed`: confirm an optimistic user message.
- `chat.run.updated`: update active run status.
- `chat.tool.updated`: update tool lifecycle state.
- `sessions.changed`: refresh session/sidebar state.

## Message Ordering

Always preserve `openclaw_seq` ordering within chat segments. Do not sort the conversation by timestamp alone. Gateway timestamps can be inconsistent.

Relevant files:

- `components/ChatView/orderChatMessages.ts`
- `components/ChatView/messageRowKey.ts`
- `lib/chatMessageDedupe.ts`
- `lib/chatHistoryParser.ts`
- `lib/chat-engine-v2/applyPatches.ts`

## Scroll Behavior

The chat surface must not force-scroll on every assistant token. Follow-scroll only when:

- the chat is first opened, or
- the user is already near the bottom.

If the user scrolls up, preserve their position. Before touching scroll behavior, read `docs/constraints/ui-scroll.md`.

## Attachments

Primary files:

- `lib/chatAttachments.ts`
- `hooks/useChatComposerAttachments.ts`
- `components/ChatBox/AttachmentPreviewList.tsx`
- `components/ChatView/RichContentPreview.tsx`

Frontend limits:

- max single attachment: `CHAT_ATTACHMENT_LIMITS.maxSingleBytes` = 10 MB
- max total attachments: `CHAT_ATTACHMENT_LIMITS.maxTotalBytes` = 10 MB
- max count: `CHAT_ATTACHMENT_LIMITS.maxCount` = 10

Do not duplicate these numbers in error strings. Import the constants.

## App Shell and Navigation

`components/AppPage.tsx` owns most desktop-level state:

- active space
- active topic
- active chat/session
- sidebar visibility and width
- editor groups and tabs
- inspector state
- terminal state
- settings and notifications routes
- focused chat windows
- middleware connection state

Route parsing and activation happen in this file. If a bug crosses sidebar, route, and active chat behavior, start here, then follow helpers into `lib/api/*`, `hooks/useSpaces.ts`, and `hooks/useTopicSession.ts`.

## Tauri Boundary

The frontend runs in both browser dev and Tauri desktop contexts. Tauri-specific behavior should stay behind helpers.

Relevant files:

- `lib/ipc.ts`
- `lib/openRouteWindow.ts`
- `components/TrafficLights.tsx`
- `components/WindowControls.tsx`
- `packages/desktop/src-tauri/tauri.conf.json`

Per-window layout state must be scoped by `openclawWindowId`. Main window uses the stable `"main"` scope with legacy fallback.

## Common Change Paths

### Add or change chat rendering

Start in:

- `components/ChatView/MessageBubble.tsx`
- `components/ChatView/MarkdownContent.tsx`
- `components/ChatView/ToolCallSteps.tsx`
- `components/ChatView/RichContentPreview.tsx`

Check:

- message ordering still uses `openclaw_seq`
- markdown and code blocks remain readable
- streaming text does not cause layout jank
- tool details handle loading, success, error, and missing data

### Add composer behavior

Start in:

- `components/ChatBox/index.tsx`
- `components/ChatBox/ActionBar.tsx`
- `hooks/useChatComposerAttachments.ts`
- `hooks/useSlashCommands.ts`

Check:

- disabled/sending state is correct
- errors surface through composer UI
- attachment limits are imported, not hardcoded
- send cannot double-submit

### Change chat state handling

Start in:

- `hooks/useChatMessages.ts`
- `lib/chat-engine-v2/applyPatches.ts`
- `lib/chat-engine-v2/store.ts`
- `lib/chatMessageDedupe.ts`

Check:

- optimistic messages are confirmed or failed
- patch application is idempotent
- stale runs do not appear active
- warm cache does not override bootstrap

### Add a middleware call from UI

Use existing helpers in:

- `lib/middleware-client.ts`
- `lib/chat-engine-v2/client.ts`
- `lib/api/*.ts`

Prefer one narrow helper per route. Keep response parsing close to the helper and keep components focused on UI state.

## Frontend Invariants

- Chat state comes from middleware projection and patches.
- Optimistic messages must become confirmed or failed.
- Use `openclaw_seq` for message ordering.
- Respect scroll intent. Do not force bottom when the user scrolled up.
- Scope layout persistence per window.
- Warm cache is a preview, not authority.
- UI attachment limits come from `CHAT_ATTACHMENT_LIMITS`.
- Do not mutate chat state directly outside the chat engine/store flow.

## Useful Commands

Run from repository root:

```bash
pnpm --filter ui dev
pnpm --filter ui typecheck
pnpm --filter ui build
pnpm --filter ui lint
```

For targeted tests:

```bash
pnpm --filter ui exec vitest run lib/__tests__/chatMessageDedupe.test.ts
pnpm --filter ui exec vitest run components/ChatView/__tests__/messageRowKey.test.ts
```

## Agent Checklist

Before editing:

- Read `AGENTS.md`.
- Read `packages/ui/AGENTS.md`.
- Inspect nearby components and existing styles.
- For chat work, read the relevant file in `docs/constraints/`.

Before finishing:

- Run `pnpm --filter ui typecheck` for UI changes.
- Run focused tests when changing chat engine, attachment, routing, or store behavior.
- For visual UI changes, verify in browser or Tauri when possible.
- Mention any verification that could not be run.
