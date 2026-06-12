# OCPlatform Desktop — Frontend System (v6-krish)

> Complete, micro-level reference for the **frontend** of the OCPlatform Desktop
> codebase on branch `v6-krish`. Covers the Next.js UI app, the Tauri shell,
> the chat engine v2 client, state stores, hooks, components, routing, build,
> and integration with the middleware backend.
>
> Repo: `Nextbasedev/openclaw-desktop` · Branch: `v6-krish` · Workspace path:
> `/root/.openclaw/workspace/openclaw-desktop`

---

## 1. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       OCPlatform Desktop (Tauri Shell)                    │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  Next.js UI (packages/ui)  — static export, hash routing in app   │  │
│  │                                                                   │  │
│  │  • App Router pages (`app/`)                                      │  │
│  │  • Components (`components/`)                                     │  │
│  │  • Hooks (`hooks/`)                                               │  │
│  │  • Chat Engine v2 (`lib/chat-engine-v2/`)                         │  │
│  │  • Local-first sync, warm cache, query cache                      │  │
│  │  • Tauri IPC + middleware HTTP/WebSocket clients                  │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  Tauri Rust backend (`packages/desktop/src-tauri`)                │  │
│  │  • Window management, native menus, traffic lights                │  │
│  │  • Notifications (Win toast, native dialog)                       │  │
│  │  • Updater, process, dialog plugins                               │  │
│  │  • PTY/terminal IPC (windows_toast.rs, backend.rs)                │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
              │                                       │
              │ HTTP / WebSocket (default :8787)       │ IPC (`@tauri-apps/api`)
              ▼                                       ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Middleware (apps/middleware)  ←→  Gateway (WS, Ed25519 signed v3)      │
└─────────────────────────────────────────────────────────────────────────┘
```

The frontend has three runtime targets:

1. **Tauri desktop** — primary. Uses hash routing, Tauri IPC, local
   middleware on `127.0.0.1:8787`, file system + notifications via plugins.
2. **Remote browser** — connects to a middleware on a LAN/tailnet host.
   `client.ts` rewrites `127.0.0.1` → current `window.location.hostname:8787`
   when running in a non-loopback browser context.
3. **Web dev** (`pnpm dev:ui` / `dev:web`) — standalone Next dev server.

---

## 2. Workspace Layout (`packages/ui`)

```
packages/ui
├── app/                     # Next.js App Router (RSC + client)
│   ├── layout.tsx           # Root layout, fonts, providers
│   ├── page.tsx             # → re-exports AppPage (shell)
│   ├── globals.css          # Tailwind v4 + tw-animate-css base
│   ├── not-found.tsx
│   ├── connect/page.tsx     # Middleware pairing/connect UI
│   ├── settings/page.tsx    # Settings dashboard
│   ├── skill/page.tsx       # Skill discovery & install
│   ├── notifications/page.tsx
│   ├── audit-long-chat/     # Diagnostic audit pages
│   ├── audit-plain/
│   ├── [slug]/              # Space/project routes
│   │   ├── page.tsx
│   │   └── [topicId]/       # Topic/chat detail
│   └── api/                 # Next.js route handlers (health, ipc bridge, stream, my)
├── components/              # All React UI
├── common/                  # Cross-feature shared (Header, etc.)
├── hooks/                   # Reusable hooks
├── lib/                     # Domain logic, clients, stores
├── utils/                   # Pure helpers
├── constants/
├── types/
├── public/
├── components.json          # shadcn config
├── next.config.mjs
├── postcss.config.mjs       # Tailwind v4 PostCSS
├── tsconfig.json
├── vitest.config.ts
└── package.json
```

### 2.1 Build modes

`packages/ui/package.json` scripts:

| Script        | Command                                         | Use                            |
| ------------- | ----------------------------------------------- | ------------------------------ |
| `dev`         | `next dev --turbopack --port 3000`              | Local dev                      |
| `build`       | `node ../../scripts/build-ui-static.cjs`        | Static export for Tauri        |
| `start`       | `next start`                                    | Prod server (rarely used)      |
| `lint`        | `eslint`                                        | ESLint v9 flat config          |
| `format`      | `prettier --write "**/*.{ts,tsx}"`              | Prettier + tailwind plugin     |
| `typecheck`   | `tsc --noEmit`                                  | Type check                     |

Static build is bundled into the Tauri app — `app-router.ts` switches to
**hash routing** (`/#/...`) when running inside Tauri (`window.__TAURI_INTERNALS__`)
or when the protocol isn't `http(s)`.

---

## 3. Routing & Shell (`AppPage`)

### 3.1 Hash router shim — `lib/app-router.ts`

- `shouldUseHashRoutes()` true if `NEXT_PUBLIC_OPENCLAW_ROUTER_MODE === "hash"`,
  or Tauri internals are present, or protocol is not http(s).
- `routeUrl(path)` returns `/#${path}` for desktop, normalized path for web.
- `installDesktopRouteShim()` monkey-patches `history.pushState/replaceState`
  to rewrite plain paths into hash URLs (only paths not starting with
  `/api`, `/_next`, and not file-like).
- `getRoutePath()` reads from `location.hash` (`#/...`) under hash mode,
  otherwise `location.pathname`.

### 3.2 Root layout — `app/layout.tsx`

- Fonts: `Geist`, `Geist_Mono`, `JetBrains_Mono` via `next/font/google`.
- Providers stacked:
  - `ThemeProvider` (next-themes)
  - `TooltipProvider` (radix-ui)
  - `ToastProvider` (custom + react-toastify)
  - `QueryProvider` (TanStack Query)
- Global classes from `globals.css` (Tailwind v4 + custom tokens).

### 3.3 Shell — `components/AppPage.tsx`

Single big client component that owns the desktop shell:

- Sidebar (spaces, projects, chats), Header, Footer.
- Editor groups (split panes) via `editorGroupsReducer` (`lib/editorGroups`).
- ChatBox composer + ChatView messages.
- Inspector panel (activity, git, workspace, subagent chat).
- Settings dialog, Logs dialog, Command Palette, Onboarding flow.
- Connect gating (`shouldForceConnectGate`, `appHasLiveConnection`).
- Layout persistence: `loadWorkspaceLayoutSnapshot/save…` (localStorage).
- Cross-window middleware connection sync via BroadcastChannel events
  (`MIDDLEWARE_CONNECTION_CHANGED_EVENT`, `MIDDLEWARE_DISCONNECTED_EVENT`).

### 3.4 Page surfaces

| Route                     | Purpose                                                   |
| ------------------------- | --------------------------------------------------------- |
| `/`                       | Shell (`AppPage`)                                         |
| `/[slug]`                 | Space view                                                |
| `/[slug]/[topicId]`       | Topic/chat detail                                         |
| `/connect`                | Middleware pairing / connect flow                         |
| `/settings`               | Settings dashboard                                        |
| `/skill`                  | Skill marketplace (discover/install)                      |
| `/notifications`          | Notification dashboard                                    |
| `/audit-long-chat`        | Long-chat diagnostics                                     |
| `/audit-plain`            | Plain audit view                                          |
| `/api/health`             | UI-side health probe                                      |
| `/api/ipc/*`              | IPC bridge (when running as web)                          |
| `/api/stream/*`           | Server-sent forwarders                                    |
| `/api/my/*`               | User-specific endpoints                                   |

---

## 4. Chat Engine v2 (`lib/chat-engine-v2`)

This is the core real-time chat state machine. It owns:

- bootstrap fetch + cache,
- WebSocket patch subscription,
- in-memory session state,
- merging with React Query (`@tanstack/react-query`),
- deduping, transient state, recovery, idempotency.

```
lib/chat-engine-v2/
├── types.ts            (134 lines)  Wire/contract types, CHAT_PROJECTION_VERSION=3
├── client.ts           (412)        HTTP/WS client + middleware URL resolution
├── store.ts           (2226)        Per-session state, listeners, lifecycle
├── timelineStore.ts    (394)        Page-windowed virtualization timeline store
├── messageSlice.ts     (265)        Telegram-style sliced window utilities
├── applyPatches.ts     (533)        Patch reducer + status derivation
├── bootstrapPreview.ts (36)         Pre-bootstrap preview hint
├── idempotency.ts      (3)          Send idempotency key generator
└── __tests__/                       Vitest tests
```

### 4.1 Wire types (`types.ts`)

- `CHAT_PROJECTION_VERSION = 3` — UI requires server projection v3.
- `RunStatusV2`: `"idle" | "queued" | "thinking" | "streaming" | "tool_running" | "done" | "error" | "aborted"`.
- `HistoryCoverageV2`: `"none" | "metadata" | "full" | "windowed"`.
- `ChatBootstrapV2` — initial snapshot from `GET /api/chat/bootstrap`:
  ```ts
  {
    ok, source, projectionVersion, sessionKey, sessionId,
    runStatus, statusLabel, activeRun?,
    historyCoverage, fullMessagesIncluded,
    messages: MessageProjectionV2[], messageCount,
    tools/toolCalls: ToolCallProjectionV2[],
    cursor, projection: { cursor, lastSeq, liveSubscribed, version }
  }
  ```
- `PatchPayloadV2` / `PatchFrame` — incoming WS deltas keyed by cursor.
- `ToolCallProjectionV2` — per-tool projection: id, runId, name, phase,
  status, args/result meta, awaitingResult flag, timestamps.
- `ActiveRunV2` — current run pointer with `idempotencyKey`/`clientMessageId`
  for dedupe of optimistic user messages.

### 4.2 Client (`client.ts`)

- Resolves middleware URL with priority:
  1. `localStorage["openclaw.middleware.url"]` (post-pairing canonical).
  2. `localStorage["openclaw.middleware.v2.url"]` (legacy/v2 override).
  3. `process.env.NEXT_PUBLIC_MIDDLEWARE_V2_URL`.
  4. Fallback `http://127.0.0.1:8787`.
- `rewriteLoopbackForRemoteBrowser` swaps `127.0.0.1` / `localhost` etc. for
  the current `window.location.hostname` with port `8787` whenever the UI
  runs in a non-loopback browser (LAN/tailnet preview).
- HTTP: `getChatBootstrap`, `sendChatV2`, `abortChat`, `getMessages`,
  `getToolResult`, `searchChat`, `getSessionContext`.
- WS: `openPatchStreamV2(afterCursor, handlers)` — connects
  `ws(s)://…/api/patches` (or compatible alias), resumes from
  `lastCursor`. Calls `logChatStreamRecoveryDecision` to record
  reconnect behavior into diagnostics.
- All requests are funneled through `registerScheduledRequest()` so the
  request scheduler can cancel them on session navigation or app blur.

### 4.3 Store (`store.ts`)

Per-`sessionKey` `SessionState`:

```
SessionState {
  cursor                  number    // last applied projection cursor
  messages                ChatMessage[]
  historyCoverage         HistoryCoverageV2
  messageCount            number | null
  status                  StreamStatus
  statusLabel             string | null
  pendingTools            InlineToolCall[]
  spawnedSubagents        SpawnedSubagent[]
  lastPatchAtMs           number
  activityStartedAtMs     number
  deferredDoneUntilAssistant     boolean
  finalizedAssistantAtMs  number
}
```

Key behaviors:

- **Active statuses**: `queued, running, collect, thinking, tool_running, streaming, stopping, restarting`.
- **Stale guards**:
  - `STALE_ACTIVE_RUN_MS = 5min` — kills active-run UI if no patches.
  - `STALE_RUNNING_TOOL_PATCH_MS = 30min` — auto-finishes hung tool patches.
  - `PREMATURE_DONE_GRACE_MS = 10s` — debounces premature "done" before
    assistant text arrives.
  - `POST_FINAL_ACTIVE_STATUS_GRACE_MS = 30s` — ignores active status flapping
    immediately after a finalized assistant.
  - `PREMATURE_DONE_AFTER_TEXT_GRACE_MS = 2s` — short grace if text already
    streamed.
- **Dedup** — `dedupeChatMessages` (`lib/chatMessageDedupe.ts`, 570 lines)
  handles optimistic/replay/idempotency collisions. Strips transient state
  via `stripTransientChatMessagesState` before commit.
- **React Query bridge** — writes warm cache to disk (debounced
  `WARM_CHAT_WRITE_DEBOUNCE_MS`) and updates query cache keys from
  `lib/query.ts → queryKeys`.
- **Subagent extraction** — `extractSubagentSessionKey` projects
  spawned-subagent rows for the inspector.
- **Listeners** — `subscribe(sessionKey, listener)` per-session; broadcast on
  every reducer pass.
- **Backend epoch reset** — when projection cursor goes backwards
  (`__resetEpoch` patch or cursor=0 with new projectionVersion), the store
  drops the persisted global cursor and rebootstraps to avoid stale
  flicker (regression fix from `v5-dixit` carry-over).

### 4.4 Patch reducer (`applyPatches.ts`)

- Pure function `applyChatPatch(state, patch) → nextState`.
- Patch kinds (`patch.type`): `message.upsert`, `message.delete`,
  `tool.upsert`, `tool.finish`, `run.start`, `run.finish`, `status`,
  `subagent.upsert`, `subagent.finish`, `historyCoverage`, `truncate`,
  `__resetEpoch`.
- Status derivation: `statusFromPatch(patch)` maps run/tool/status events to
  a `StreamStatus`; `patchImpliesActiveRun(patch)` decides whether to start
  the activity timer.

### 4.5 Telegram-style sliced window (`messageSlice.ts` + `timelineStore.ts`)

- After `feat(chat): telegram-style sliced message window` (`110283b0`) and
  `feat(chat): viewport-windowed message rendering` (`3c0d8287`), the UI
  renders only a bounded slice of the timeline.
- `timelineStore.ts` keeps a `pageWindow: { startIndex, endIndex, anchorId }`
  per session, decoupled from the canonical store messages.
- `messageSlice.ts` provides `selectVisibleSlice(messages, viewport)` and
  prefetch thresholds: when scroll within 60% of top edge, autoload older
  page via `GET /api/chat/messages?before=...`.
- Replaces the earlier TanStack virtualizer experiment that was reverted
  in `86c8670d`.

---

## 5. Components Map (`packages/ui/components`)

### 5.1 ChatBox (composer)

```
ChatBox/
├── index.tsx                # Main composer (text, attachments, send, voice)
├── ActionBar.tsx            # Toolbar (model picker, slash, voice, attach)
├── AttachmentPreviewList.tsx
├── SlashCommandMenu.tsx     # Slash command autocomplete
├── VoiceWaveIcon.tsx
└── Icons.tsx
```

- Uses `useSlashCommands`, `useVoiceInput`, `useVoiceRecorder` hooks.
- Attachments via `lib/chatAttachments.ts` + `chatAttachmentPreview.ts` —
  caches blobs in `attachmentCache.ts`.
- `controlSlashCommands.ts` — built-in `/clear`, `/abort`, `/model`, etc.

### 5.2 ChatView (timeline + assistants UI)

```
ChatView/
├── index.tsx                # Window mount, scroll lifecycle
├── ChatInput.tsx
├── ChatSearch.tsx
├── MessageBubble.tsx        # Single message row
├── MarkdownContent.tsx      # react-markdown + GFM + breaks
├── MermaidBlock.tsx         # mermaid diagram render
├── ThinkingBlock.tsx        # "thinking" / chain-of-thought block
├── ToolCallSteps.tsx        # Collapsed tool stack (multi-step)
├── ToolCallDetails.tsx      # Single tool expanded view
├── RichContentPreview.tsx
├── PinnedMessagesPopover.tsx
├── SubagentBar.tsx
├── SubagentCard.tsx
├── SubagentFullChat.tsx
├── MessageFeedbackDialog.tsx
├── viewportWindow.ts        # Page window math
├── chatHistoryAutoLoad.ts   # Threshold-based autoload
├── searchInlineHighlight.ts
├── chatStableIds.ts
├── chatScrollDebug.ts
├── useStreamingText.ts      # Token-by-token streaming text hook (+ test)
├── assistant-ui/            # Adapters for @assistant-ui/react
├── vercel-ui/               # Adapters for Vercel-style chat UI
├── types.ts
└── __tests__/
```

Notable:

- `chatHistoryAutoLoad.ts` — triggers older history prepend when scroll is
  within the upper threshold (60% in current build), debounced to avoid
  thrash. Cooperates with `messageSlice.ts` page window.
- `useStreamingText.ts` — drives token append animation for assistant text
  without re-rendering whole bubble.
- `searchInlineHighlight.ts` — wraps matched ranges, scrolls hit into view.

### 5.3 Sidebar

```
sidebar/
├── Sidebar.tsx              # Root sidebar component
├── SidebarItem.tsx
├── SidebarLabelTooltip.tsx
├── SettingsNav.tsx
├── SpacesSection.tsx
├── SpaceActionsMenu.tsx
├── SpaceContextMenuPortal.tsx
├── SpaceDialogs.tsx
├── SpaceIconImage.tsx
├── SpacesOverflowMenu.tsx
├── CollapsedSpacesPopover.tsx
├── CreateSpaceDialog.tsx
├── ProjectsSection.tsx
├── ProjectsSection/         # subitems
├── ChatsSection/            # chat list, search, group-by
├── ModelSelector.tsx
├── RepoPickerDialog.tsx
├── VersionUpdateButton.tsx
├── VersionUpdateModal.tsx
└── index.ts
```

- Drag-and-drop via `@dnd-kit/*` for reordering spaces/projects.
- Long press drag with `useLongPressDrag`.
- Repo picker uses `GET /api/repos/recent` and `POST /api/repos/scan`.

### 5.4 Inspector

```
inspector/
├── InspectorPanel.tsx       # Container, scope picker
├── InspectorView.tsx
├── InspectorScopePicker.tsx
├── inspectorScope.ts        # Persistence + effective scope logic
├── ActivityTab.tsx          # Live run activity
├── ActivityNodes.tsx
├── activity-types.ts
├── AgentStrip.tsx           # Agent/subagent strip
├── SubagentChatView.tsx
├── GitTab.tsx               # Branch / status / diff
├── BranchDropdown.tsx
├── git-helpers.ts
├── WorkspaceTab.tsx         # FS tree, file edits
└── workspace-api.ts
```

Inspector calls backend compat endpoints:
`/api/projects/:projectId/git/*`, `/api/projects/:projectId/workspace/*`.

### 5.5 Settings

```
settings/
├── SettingsDialog.tsx
├── SettingsDashboard.tsx
├── SettingsSidebar.tsx
├── settings.config.ts       # Section registry
├── ThemeSelector.tsx
└── tabs/                    # Per-section tab components
```

Sections drive `SettingSection` union; sidebar entries link to dashboard.

### 5.6 Notifications

```
notifications/
├── NotificationDashboard.tsx
├── NotificationPopover.tsx
├── CronJobChat.tsx
├── CronScheduleEditor.tsx
├── CronOptionSelect.tsx
├── cron-schedule-format.ts
├── cron-status.ts
└── tabs/
```

Cron events stream via `GET /api/stream/cron` (SSE).

### 5.7 Connect & Onboarding

- `ConnectPage.tsx` + `components/connect/*` — middleware pairing,
  connection error guide, status indicators. Talks to `/health`,
  `/pairing/local`, `/pairing/claim`.
- `components/onboarding/` — first-run flow (driven by `useOnboardingFlow`).

### 5.8 Other top-level

- `CommandPalette.tsx` — global ⌘K palette.
- `AppContextMenu.tsx` — radix ContextMenu wrappers.
- `WindowControls.tsx` + `TrafficLights.tsx` — macOS-style window chrome.
- `Footer.tsx` — bottom status (model, connection, queue depth).
- `PaneTabBar.tsx` + `EditorGroupsContainer.tsx` — split-pane editor groups.
- `terminal/XTerminal.tsx` + `usePty.ts` — xterm.js bound to backend PTY
  via `/api/terminal/:ptyId/ws`.
- `logs/LogsDialog.tsx` — pulls `/api/logs`.
- `SkillPage/` — skill marketplace UI (discover/install).
- `theme-provider.tsx` — next-themes wrapper with persisted dark/light.
- `Skeleton/` — `AppLoadingSkeleton`, `ChatLoadingSkeleton`.
- `ui/` — shadcn-style primitives (`button`, `dialog`, `tooltip`, etc.).

---

## 6. Hooks (`packages/ui/hooks`)

| Hook                            | Purpose                                                      |
| ------------------------------- | ------------------------------------------------------------ |
| `useAgentActivity`              | Subscribes to agent activity stream                          |
| `useAppFocus`                   | Window focus state (for pausing patches/streams)             |
| `useAppShortcuts`               | Global hotkeys (⌘K, ⌘,, ⌘N, etc.)                            |
| `useChatCompletionNotify`       | Native notification on assistant finish                      |
| `useChatComposerAttachments`    | Drag/drop, paste, file picker                                |
| `useChatMessages`               | Subscribes to chat engine v2 store                           |
| `useChatMessageSlice`           | Bound to `messageSlice/timelineStore` window                 |
| `useChatsData`                  | TanStack Query for chat list + cache merging                 |
| `useLongPressDrag`              | Hold-to-drag for sidebar                                     |
| `useModels`                     | Models list                                                  |
| `usePlatform`                   | OS/runtime detection (Tauri, Win, Mac, Linux)                |
| `useProjectsData`               | Projects list                                                |
| `useQuickChat`                  | Headless quick-chat shortcut                                 |
| `useSlashCommands`              | Slash command source + filter                                |
| `useSpaces` (+ test)            | Spaces list + active space                                   |
| `useSubagentMessages`           | Subagent timeline                                            |
| `useTerminalShortcut`           | Open terminal hotkey                                         |
| `useTopicSession` (+ test)      | Resolves topic → session key                                 |
| `useVoiceInput`                 | Mic permission + buffer                                      |
| `useVoiceRecorder` (+ test)     | MediaRecorder lifecycle                                      |

---

## 7. Lib (`packages/ui/lib`) — Selected Modules

### 7.1 API clients (`lib/api/`)

Thin typed wrappers around middleware HTTP routes:

| File              | Endpoints                                                      |
| ----------------- | -------------------------------------------------------------- |
| `chats.ts`        | `/api/chats` CRUD, archive, rename                             |
| `projects.ts`     | `/api/projects` CRUD                                           |
| `topics.ts`       | `/api/topics` CRUD                                             |
| `spaces.ts`       | `/api/spaces` CRUD, switch                                     |
| `search.ts`       | `/api/chat/search` + cross-space search                        |
| `searchData.ts`   | Search dataset normalization                                   |
| `searchMessages.ts` | Message search w/ pagination                                  |
| `searchTypes.ts`  | Wire types                                                     |

### 7.2 Stream / patches / status

- `chatStream.ts` — older streaming primitives (kept for compat with
  certain UI code paths).
- `chatStatus.ts` — derived UI status from store.
- `chatTimelineDiagnostics.ts` — telemetry of recovery decisions.
- `chatActivityStore.ts` — small global store for sidebar activity dots.

### 7.3 Caching & persistence

- `chatListCache.ts` — disk-backed chat list (per-space).
- `chatSessionStore.ts` — sessionKey ↔ topic mapping.
- `warmChatCache.ts` (via `store.ts`) — disk-warm cache of bootstrap +
  early patches with debounced writes (`WARM_CHAT_WRITE_DEBOUNCE_MS`).
- `attachmentCache.ts` — blob URL cache (memory + IndexedDB).
- `cacheRealtime.ts` — invalidates query cache on patch events.

### 7.4 Connection / pairing

- `middleware-client.ts` — connection state (URL, token, status),
  BroadcastChannel for cross-window updates.
- `connectGate.ts` + `connectionGate.ts` (+ tests) — gating rules for
  showing Connect page vs. main UI.
- `requestScheduler.ts` — queues, prioritizes, and cancels HTTP requests
  per session.

### 7.5 Misc

- `chatHistoryParser.ts` (1015 lines, with tests) — parses historic
  message formats from middleware/server snapshots into the canonical
  `ChatMessage` shape.
- `chatToolDisplay.ts` (+ test) — formats tool invocation summaries.
- `chatErrorText.ts` — extracts user-facing error text.
- `chatMessageDedupe.ts` (570 lines, with tests) — optimistic vs.
  authoritative dedupe.
- `chatStableIds.ts` (+ test) — stable IDs for React keys.
- `chatAttachments.ts` + `chatAttachmentPreview.ts` — file lifecycle.
- `chatTransientState.ts` — strips ephemeral fields before persistence.
- `composerState.ts` (+ test) — composer reducer (text, drafts).
- `controlSlashCommands.ts` (+ test) — built-in slash command set.
- `diagnostics.ts` (+ test) — diagnostics UI helpers.
- `editorGroups.ts` + `editorTabDisplay.ts` (+ test) — pane/tab math.
- `events.ts` — typed event bus (window-level).
- `id.ts` — `randomId()`.
- `ipc.ts` — Tauri `invoke` wrapper with web fallback.
- `clientLogs.ts` — frontend log buffer (sent to `/api/logs` on
  request).
- `app-router.ts` — see §3.1.

---

## 8. Tauri Shell (`packages/desktop`)

- Cargo crate `app` in `src-tauri`. Rust 1.77.2+. Tauri 2.10.3.
- Plugins enabled: `log`, `notification`, `dialog`, `updater`, `process`.
- Sources:
  - `main.rs` — entry point.
  - `lib.rs` — app builder, command registration.
  - `backend.rs` — native commands invoked from frontend (Tauri `invoke`).
  - `windows_toast.rs` — Windows Toast notifications via `quick-xml`.
- `Info.plist` + `Entitlements.plist` — macOS bundle metadata.
- `capabilities/` — Tauri ACL for plugin commands.
- `tauri.conf.json` — bundle ID, window config, allowed origins, distDir
  pointing at `packages/ui/out` (static export).
- `bundled/` — bundled middleware binaries shipped with the app.

JS side dependencies (`packages/desktop/package.json`):
`@tauri-apps/api`, `plugin-dialog`, `plugin-notification`, `plugin-shell`,
`plugin-sql`, `plugin-store`.

---

## 9. Connection Lifecycle

1. **App boot** (`AppPage`):
   - `installDesktopRouteShim()` patches history.
   - `initClientLogs()`, `initFrontendCacheRealtimeInvalidation()`.
   - `initMiddlewareConnectionCrossWindowSync()` sets up BroadcastChannel.
   - `shouldForceConnectGate()` and `appHasLiveConnection()` decide whether
     to show ConnectPage.
2. **Connect** (`/connect`):
   - Calls `GET /health` on candidate URL → reads
     `openclaw.connected` and `gateway` status.
   - On success → stores `openclaw.middleware.url`, reloads.
3. **Bootstrap session**:
   - `useTopicSession(slug, topicId)` → `sessionKey`.
   - `getChatBootstrap(sessionKey, {includeMessages})` from `client.ts`.
   - `store.hydrate(sessionKey, bootstrap)`.
4. **Live patches**:
   - `openPatchStreamV2(afterCursor)` opens WS to `/api/patches`.
   - Each frame → `applyChatPatch` → `setState` → listeners.
   - Reconnect with exponential backoff; on resume, resend `lastCursor`.
5. **Send**:
   - `sendChatV2({sessionKey, text, attachments, idempotencyKey, clientMessageId})`.
   - Optimistic message pushed immediately via store.
   - Backend ACK collapses optimistic with authoritative via
     `chatMessageDedupe`.

---

## 10. State Caches & Persistence

| Store / cache                  | Storage           | Notes                                  |
| ------------------------------ | ----------------- | -------------------------------------- |
| `localStorage`                 | Browser/Tauri WV  | URLs, theme, layout snapshot           |
| `IndexedDB` (attachmentCache)  | Browser/Tauri WV  | Blob URLs, sized                       |
| TanStack Query cache           | Memory            | API responses, invalidated by patches  |
| chat-engine-v2 `states` Map    | Memory            | Per-`sessionKey` `SessionState`        |
| Warm chat cache                | Disk (Tauri FS)   | Debounced snapshot of recent sessions  |
| Chat list cache                | Disk (Tauri FS)   | Per-space chat list                    |
| Frontend log buffer            | Memory (ring)     | Sent to `/api/logs` on demand          |

---

## 11. External Libraries (highlights)

- **UI:** `radix-ui`, `shadcn`, `tailwindcss@4`, `tw-animate-css`,
  `framer-motion`, `react-icons`, `@lobehub/icons`, `@hugeicons/react`,
  `recharts`, `mermaid`.
- **Chat / markdown:** `@assistant-ui/react` + `@assistant-ui/react-markdown`,
  `react-markdown`, `remark-gfm`, `remark-breaks`,
  `react-syntax-highlighter`.
- **State / data:** `jotai`, `@tanstack/react-query`.
- **DnD:** `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`.
- **Toasts:** `react-toastify` + custom `ToastProvider`.
- **Terminal:** `@xterm/xterm`, `@xterm/addon-fit`.
- **Tauri:** `@tauri-apps/api`, `plugin-dialog`, `plugin-notification`,
  `plugin-opener`, `plugin-process`, `plugin-updater`.

---

## 12. Testing

- Vitest config: `packages/ui/vitest.config.ts`.
- Co-located unit tests:
  - `chat-engine-v2/__tests__/store.test.ts`
  - `lib/chatMessageDedupe.test.ts`
  - `lib/chatHistoryParser.test.ts`
  - `lib/chatToolDisplay.test.ts`
  - `lib/chatStableIds.test.ts`
  - `lib/composerState.test.ts`
  - `lib/connectGate.test.ts`, `lib/connectionGate.test.ts`
  - `lib/controlSlashCommands.test.ts`
  - `lib/diagnostics.test.ts`
  - `lib/editorTabDisplay.test.ts`
  - `hooks/useSpaces.test.ts`, `useTopicSession.test.ts`,
    `useVoiceRecorder.test.ts`
  - `components/ChatView/useStreamingText.test.ts`
  - `components/inspector/*.test.ts`
- E2E: top-level `playwright.config.ts` + `tests/` (run from repo root).

Commands:

```bash
pnpm --filter ui typecheck
pnpm --filter ui test
pnpm --filter ui build
```

---

## 13. Recent History (branch `v6-krish`)

Selected commits driving current frontend behavior (most recent first):

| SHA        | Subject                                                       |
| ---------- | ------------------------------------------------------------- |
| `110283b0` | feat(chat): telegram-style sliced message window              |
| `3c0d8287` | feat(chat): viewport-windowed message rendering               |
| `86c8670d` | revert(chat): remove tanstack virtualization work             |
| `9dad508a` | fix(chat): bootstrap full history for virtual timeline        |
| `c067e772` | fix(chat): remove legacy virtualization path                  |
| `7a05f9b5` | fix(chat): let tanstack virtualizer own full timeline         |
| `2fe5409b` | Revert "fix(chat): make long history scroll feel continuous"  |
| `b7ad1559` | fix(chat): stabilize bounded virtual history windows          |
| `0340884d` | fix(chat): make long history scroll feel continuous           |
| `1f293c0a` | fix(chat): use bounded bidirectional page windows             |
| `719065c4` | fix(chat): scroll virtualized search targets into view        |
| `dac76a49` | feat(chat): add page-window virtualization foundation         |
| `7929ac75` | fix(chat): stabilize history autoload behavior                |
| `1cf96e06` | fix(chat): top up short visible bootstrap histories           |
| `3491e9c8` | fix(chat): stabilize paginated history parsing                |
| `82097823` | fix(chat): fill bootstrap page from windowed local history    |
| `97eee167` | fix(connect): limit success redirect to connect route         |
| `8d0959f9` | fix(connect): redirect saved connected sessions from connect  |
| `977db5ed` | fix(connect): reload tauri app after successful connect       |
| `e43bfc63` | fix(connect): notify shell on same-url reconnect              |

The current chat virtualization approach is **page-windowed (Telegram-style)**
— the prior TanStack virtualizer experiments were rolled back in `86c8670d`.

---

## 14. Frontend ↔ Backend Surface Contract

Endpoints used by the frontend (consumed via `lib/api/*` and
`chat-engine-v2/client.ts`):

| HTTP                                               | Used by                            |
| -------------------------------------------------- | ---------------------------------- |
| `GET /health`                                      | ConnectPage, Footer, AppPage gate  |
| `GET /api/system/info`                             | Settings → About                   |
| `GET /api/bootstrap`                               | Initial spaces/projects/chats      |
| `GET/POST /api/spaces`, `PATCH/DELETE` etc.        | Sidebar spaces                     |
| `GET/POST /api/projects`, …                        | Sidebar projects                   |
| `GET/POST /api/chats`, archive, rename, delete     | Sidebar chats                      |
| `GET/POST /api/topics`                             | Topic view                         |
| `GET/POST /api/sessions`                           | Session resolution                 |
| `GET /api/chat/bootstrap`                          | chat-engine-v2 bootstrap           |
| `POST /api/chat/send` / `POST /api/chat/message`   | Composer send                      |
| `POST /api/chat/abort`                             | Stop button                        |
| `GET /api/chat/messages`                           | History prepend                    |
| `GET /api/chat/tool-result`                        | Tool detail expand                 |
| `GET /api/chat/search`                             | ChatSearch                         |
| `GET /api/chat/session-context`                    | Inspector / token usage            |
| `WS  /api/patches`                                 | Real-time projection patches       |
| `GET /api/stream/cron`                             | Notifications                      |
| `GET /api/stream/chat/:sessionKey`                 | Compat streaming forwarder         |
| `GET /api/logs`                                    | LogsDialog                         |
| `GET /api/diagnostics`                             | Diagnostics page                   |
| `GET /api/skills/discover` / `installed` / install | SkillPage                          |
| `GET /api/repos/recent`, `POST /api/repos/scan`    | RepoPickerDialog                   |
| Workspace + git + terminal compat routes           | Inspector + Terminal               |
| `GET/POST /pairing/local`, `POST /pairing/claim`   | Connect flow                       |

See `BACKEND_SYSTEM.md` for the authoritative backend reference.
