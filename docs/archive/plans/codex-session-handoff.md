# Codex Session Handoff

Last updated: 2026-04-24

## Current Goal

Continue the "Finish-The-Partials" plan for Jarvis/OpenClaw Desktop, focusing first on P0 reliability:

1. Chat lifecycle and session continuity
2. Sidebar/navigation/project-topic sync
3. Mission Control truthfulness
4. Cron/notification consistency

The user wants existing partial features finished to spec quality before starting brand-new missing features.

## Spec Completion Inventory

Canonical tracker: `docs/plans/openclaw-desktop-spec-tracker.md`.

Current tracker status:

- `done`: 2 items
- `partial`: 58 items
- `missing`: 67 items
- `removed`: 10 items

The only items currently marked fully done are:

- `#4` Markdown rendering
- `#5` Code syntax highlighting

The removed items are intentionally out of scope for this pass. Do not reintroduce removed or off-spec UI unless the spec changes.

## Partial Specs To Finish First

Finish these before broad new feature work. They already have visible UI, backend wiring, or scaffolding, so completing them gives the fastest path to a trustworthy app.

### P0 Partials

- `#1` Real-time chat via Gateway WebSocket
- `#2` Streaming responses with visible Thinking state
- `#3` Tool calls shown beside thinking/response flow
- `#19` Text input and composer lifecycle
- `#25` Interrupt while generating
- `#28` Live activity feed
- `#29` Tool call detail rows
- `#30` Sub-agent tree
- `#31` Click sub-agent to open detail
- `#40` Cancel running task / kill sub-agent
- `#52` Arc-style projects/topics sidebar
- `#53` Keyboard shortcuts and quick switcher
- `#54` Agent sidebar with status
- `#87` Mission Control Mode
- `#88` Frameless desktop shell
- `#93` Windows installer / portable groundwork
- `#94` Onboarding wizard
- `#95` Guided OpenClaw install / detection
- `#96` `openclaw://` URL scheme
- `#103` Agent connection manager
- `#111` Gateway WebSocket connection
- `#112` Session lifecycle management
- `#113` Authentication token flow
- `#125` Secure token storage
- `#126` No telemetry by default

### P1/P2 Partials Already Visible

- `#7` Inline file/image rendering
- `#9` Global search
- `#11` Message actions
- `#13` Regenerate branch flow
- `#14` Edit branch flow
- `#17` / `#24` Voice controls groundwork
- `#20` File attachments
- `#21` Per-message model selector
- `#33` Context inspector
- `#35` Running processes panel
- `#44` Sub-agent status indicators
- `#55` Project/topic management actions
- `#68` Git integration groundwork
- `#72` Embedded terminal
- `#73` Multiple terminal tabs
- `#74` Terminal split view
- `#76` Skills browse/detail/install UI
- `#80` Memory browse/edit
- `#81` Memory search
- `#83` Cron manage/run/delete
- `#84` Cron run history/status
- `#85` Create cron via chat only
- `#98` Connection setup
- `#105` Theme setting
- `#106` Keyboard shortcuts
- `#108` Basic/advanced settings split
- `#118` Unified inbox
- `#119` Unread indicators
- `#120` Deep links
- `#121` Desktop notifications
- `#130` Local usage dashboard
- `#134` Windows packaging extras

## Missing Specs To Add After Partials

Do not start these until the related partial systems above are stable and audited.

### Missing P0

- `#6` Reply/quote specific messages
- `#26` Rapid-message batching
- `#27` Interrupted/regenerate visible state
- `#39` Pause/resume agent execution
- `#61` File tree browser
- `#62` File viewer
- `#63` File editor
- `#86` Simple Mode
- `#133` macOS packaging
- `#135` Linux packaging

### Missing P1/P2 Groups

- Chat richness: pin/bookmark, selection follow-up, slash commands, `@skill` mentions, threads, reactions, export
- Observability/control: reasoning panel, token/cost display, live system stats, approvals, autonomy selector, sub-agent steering, waterfall timeline
- Review mode: browser/page annotate, screenshot comments, source mapping, fix-from-comment loop
- Workspace: split views, tabs, file CRUD/search/preview/diff, upload/download/watch mode
- Terminal: command palette actions for OpenClaw commands and advanced terminal layouts
- Skills/memory: try-now, reviews/ratings, update notifications, memory maintenance settings
- Settings/connect: config editor, default autonomy, reconnect/backoff, multi-connection panel, health checks, gateway logs, TLS verification, local-only mode
- Notifications/desktop: system tray, notification center, history
- Usage/release: per-agent usage, code signing/notarization, distribution channels

## Required Execution Order From Here

1. Finish P0 partials: chat/session/streaming, observability, sidebar/navigation, cron/notification consistency, Mission Control, onboarding/connect/security.
2. Add missing P0 items only after the related partials are green.
3. Finish P1/P2 partials already visible in the UI.
4. Add remaining missing P1/P2 features.
5. Run full spec audit and update the tracker after each completed subsystem.

## Important Context

- The visible off-spec "Long-Run Trust / Thread Brief / Project Memory" UI was removed.
- The combined spec is the product authority.
- The current theme and layout language must remain unchanged.
- Official Chrome DevTools MCP is the intended browser verification tool.
- `chrome-devtools-axi` should stay removed from active sandbox workflows.
- Keep Chrome/MCP testing to a small number of browser instances where possible.

## Work Completed In This Thread

- Fixed command palette recent-session navigation:
  - Server returns `key`, but UI used `sessionKey`.
  - Updated `packages/ui/components/CommandPalette.tsx`.
- Improved cron activity/name hydration in:
  - `packages/ui/components/notifications/tabs/ActivityTab.tsx`
  - `packages/ui/components/notifications/NotificationPopover.tsx`
- Fixed quick-send error handling:
  - `handleQuickSend` and `handleTopicQuickSend` now rethrow after logging so `ChatBox` can show "Message failed to send" instead of silently clearing the composer.
  - File: `packages/ui/app/page.tsx`
- Improved audit harness:
  - Added `sendComposerMessage()`.
  - Added `waitForControlEnabled("Send message")`.
  - Switched first-send audits toward the send-button path instead of relying only on Enter.
  - File: `scripts/sandbox/audit-ui.mjs`

## Validation Already Done

Passed after the latest patches:

- `pnpm --filter ui typecheck`
- `node --check scripts/sandbox/audit-ui.mjs`

Manual live Chrome DevTools checks proved:

- Home first-send works when clicking Send.
- Home first-send works when pressing Enter.
- URL changes from `/` to `/chat_...`.
- The user message appears and the chat enters "Thinking...".

So the prior "Chat send lifecycle" full-audit failure was likely a harness/timing issue, not the app's home send path itself.

## Known Environment Issue

The UI dev server has been unstable with Turbopack:

- Turbopack hit a Next panic: "Failed to write app endpoint /page".
- Webpack startup is slower but should be preferred for stable browser audit runs.
- Start server/UI carefully:
  - server: `pnpm --filter server dev`
  - UI stable path: run Next with `--webpack --port 3000` from `packages/ui`

Check health before audits:

- UI: `http://127.0.0.1:3000/` should return `200`
- Server: `POST http://127.0.0.1:3001/api/ipc/middleware_version_info` should return `200`

## Latest Reliable Audit State

The last completed full audit before the newest harness patch:

- Artifact root: `.sandbox/runs/2026-04-23T15-44-25-761Z-audit`
- Report: `docs/plans/jarvis-e2e-audit-baseline.md`
- Result: `10 passed / 9 failed`

Important: this report is stale relative to the latest harness and quick-send error-handling patches.

Remaining failures in that stale report:

- P0: Header route crumb sync
- P0: Topic first-send lifecycle
- P0: Chat send lifecycle
- P0: Sidebar and browser history sync
- P1: Cron and notifications
- P1: Top-bar notification popover cron links
- P1: Cron real job lifecycle
- P1: Cron activity stream and delete
- P1: Cron real user job surfaces

## Recommended Next Steps

Do not start with another huge full audit. Run smaller targeted checks first:

1. `pnpm --filter ui typecheck`
2. Targeted home first-send browser check
3. Targeted topic first-send browser check
4. Targeted settings back/forward check
5. Targeted cron notifications page load/activity check
6. Full `pnpm sandbox:audit -- --port=3000` only after the targeted checks are stable

## Likely Next Product Bug To Investigate

Settings/back-forward sync:

- Full audit repeatedly failed with:
  - `Expected path to leave "/settings". Last path: /settings`
- Need verify manually with live Chrome DevTools:
  - open a real chat route
  - click Settings
  - browser back
  - confirm route returns to chat and header/main/sidebar agree

If manual back works, fix audit harness. If manual back fails, fix `packages/ui/app/page.tsx` navigation/history handling.

## Files Recently Touched

- `packages/ui/app/page.tsx`
- `scripts/sandbox/audit-ui.mjs`
- `packages/ui/components/CommandPalette.tsx`
- `packages/ui/components/notifications/tabs/ActivityTab.tsx`
- `packages/ui/components/notifications/NotificationPopover.tsx`

## Caution

- Do not revert unrelated user changes.
- Do not reintroduce the off-spec Long-Run Trust panel.
- Avoid treating every audit failure as product truth until manually verified with Chrome DevTools MCP.
- Keep changes small and finish P0 partials before adding missing P1/P2 features.
