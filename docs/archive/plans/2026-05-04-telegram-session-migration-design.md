# Telegram Session Migration Design

**Goal:** Add a Desktop Settings → Migration tab with a Telegram-only migration option that creates new Desktop chats/sessions copied from existing Telegram OpenClaw sessions.

**Status:** Design/plan only. No implementation yet.

## Context checked

- Gateway session index: `/root/.openclaw/agents/main/sessions/sessions.json`
  - Current sample count: 345 total session mappings
  - Telegram mappings: 17
  - Desktop mappings: 29
- Telegram session keys look like:
  - `agent:main:telegram:direct:1245183865`
  - `agent:main:telegram:group:-1003743034323:topic:11896`
- Desktop session keys look like:
  - `agent:main:desktop:<uuid>`
- Telegram entries point to JSONL transcript files via `sessionFile`.
- Transcript files contain JSONL events; chat messages are `type: "message"` with `message.role` and `message.content[]`.
- Existing middleware already has helper precedent for copying history into a new transcript:
  - `apps/middleware/src/services/commands.ts` uses `copyHistoryMessagesToTranscript(...)` for fork/regenerate flows.
- Desktop settings UI lives in:
  - `packages/ui/components/settings/SettingsDashboard.tsx`
  - settings tabs live in `packages/ui/components/settings/tabs/`
- Desktop local chat/session records are created through:
  - `middleware_chats_create`
  - `middleware_sessions_create`
  - remote routes in `packages/ui/lib/ipc.ts`
  - local server services: `packages/server/src/services/chats.service.ts`, `packages/server/src/services/sessions.service.ts`

## Feasibility

Yes, this is feasible.

Recommended implementation: add a middleware command that reads Telegram sessions from Gateway's session index, creates brand-new Desktop sessions through Gateway, copies transcript contents, then creates Desktop chat records pointing at those new session keys.

This avoids mutating the original Telegram sessions and avoids binding Desktop chats directly to Telegram delivery context.

## Product behavior

Add Settings → Migration tab.

Migration tab initially supports one option only:

- Telegram

UI flow:

1. User opens Settings → Migration.
2. Card: “Import Telegram sessions”.
3. Button: “Scan Telegram sessions”.
4. UI shows count and preview list:
   - detected sessions
   - proposed Desktop chat name
   - message count
   - last updated time
5. Button: “Import all Telegram sessions”.
6. Middleware creates Desktop copies.
7. UI shows success/failure summary.
8. New chats appear in Desktop chat list.

## Naming rule

For each Telegram session copy, use the last user message as the chat name:

1. Read transcript JSONL from `entry.sessionFile`.
2. Walk messages from end to start.
3. Find latest `type: "message"` where `message.role === "user"`.
4. Extract first text content from `message.content`.
5. Normalize whitespace.
6. Remove leading system/untrusted bootstrap chunks when possible.
7. Take first 15 visible chars.
8. Fallbacks:
   - Telegram direct: `Telegram direct`
   - Telegram group topic: `Telegram topic <topicId>`
   - Unknown: `Telegram import`
9. If duplicate name, suffix: `name (2)`, `name (3)`.

Example:

- Last user message: `here find way if we can migrate telegram session...`
- Chat name: `here find way i`

## Data model

Do not reuse Telegram session keys.

For each import:

- Source key: `agent:main:telegram:...`
- New key: `agent:main:desktop:migrated-telegram-<uuid>`
- New Gateway session label: generated chat name
- New Desktop chat name: same generated chat name
- New transcript file: created by Gateway `sessions.create`
- Transcript contents: copy message history from source into new transcript
- Optional migration metadata in local store/state:
  - sourceSessionKey
  - sourceSessionId
  - importedAt
  - importKind: `telegram`

## Middleware API design

Add commands:

### `middleware_migration_telegram_scan`

Input:

```ts
{
  limit?: number
}
```

Output:

```ts
{
  sessions: Array<{
    sourceSessionKey: string
    sourceSessionId: string
    sourceSessionFile: string
    proposedName: string
    messageCount: number
    lastUserMessagePreview: string | null
    updatedAt: number | null
    chatType: "direct" | "group" | "unknown"
    subject?: string
    topicId?: number
    alreadyImported: boolean
  }>
}
```

### `middleware_migration_telegram_import`

Input:

```ts
{
  sourceSessionKeys?: string[]
  dryRun?: boolean
  skipAlreadyImported?: boolean
}
```

Output:

```ts
{
  imported: Array<{
    sourceSessionKey: string
    desktopSessionKey: string
    chatId: string
    name: string
    copiedMessages: number
  }>
  skipped: Array<{ sourceSessionKey: string; reason: string }>
  failed: Array<{ sourceSessionKey: string; error: string }>
}
```

## Implementation architecture

### Middleware responsibilities

Implement in `apps/middleware/src/services/commands.ts` first because this is where Gateway connection and transcript-copy helpers already exist.

Core helper functions:

- `readGatewaySessionsIndex()`
  - Load `/root/.openclaw/agents/main/sessions/sessions.json` initially.
  - Later improvement: use a Gateway sessions API if one exposes all sessions including Telegram.
- `isTelegramSessionKey(key)`
  - `key.includes(":telegram:")`
- `readTranscriptMessages(sessionFile)`
  - Parse JSONL safely.
  - Keep only valid events.
- `extractTextFromMessage(message)`
  - Join `content[].text` values.
- `lastUserMessageTitle(messages)`
  - Apply naming rule.
- `copyTranscriptEvents(sourceFile, destFile)`
  - Reuse or adapt `copyHistoryMessagesToTranscript` depending on whether it expects Gateway history message shape or JSONL event shape.
- `createDesktopImportedSession(source, name)`
  - `sessions.create` via Gateway with key `agent:main:desktop:migrated-telegram-<uuid>`.
- `createDesktopChatRecord(name, desktopSessionKey)`
  - Use existing store/records path or service route equivalent so it appears in Desktop chat list.

### UI responsibilities

Files:

- Add `packages/ui/components/settings/tabs/MigrationTab.tsx`
- Update `packages/ui/components/settings/SettingsDashboard.tsx`
  - Add `"migration"` to `SettingSection`
  - Add item under System or Personal: `Migration`
  - Render `<MigrationTab />`
- Update `packages/ui/lib/ipc.ts`
  - Add remote mappings for both migration commands

Migration tab states:

- idle
- scanning
- scanned
- importing
- complete
- error

## Duplicate/import safety

Need idempotency.

Preferred: local import registry in middleware state/store:

```ts
commandState.telegramMigrationImports = {
  [sourceSessionKey]: {
    desktopSessionKey,
    chatId,
    name,
    importedAt
  }
}
```

Scan marks `alreadyImported: true` when source exists in registry.

Import default: `skipAlreadyImported: true`.

## Tests

### Unit tests

Add middleware tests for:

1. Telegram session filtering from sample `sessions.json`.
2. JSONL transcript parsing.
3. Last-user-message title generation, including:
   - normal text
   - long text → first 15 chars
   - system/untrusted prefix stripped
   - no user messages fallback
   - duplicate titles suffix correctly
4. Dry-run import does not write.
5. Import skips already imported sessions.
6. Import creates Desktop session key, chat record, and copied transcript.

### UI tests

If existing test infra supports it:

1. Settings shows Migration tab.
2. Scan button calls `middleware_migration_telegram_scan`.
3. Import button calls `middleware_migration_telegram_import`.
4. Success summary renders imported/skipped/failed counts.

## Verification checklist

After implementation:

1. `pnpm --filter desktop-middleware test` or relevant middleware tests.
2. `pnpm --filter server test` if touched.
3. `pnpm --filter ui typecheck`.
4. `pnpm --filter ui build`.
5. Manual dry run:
   - scan returns current Telegram sessions.
   - import with `dryRun: true` changes nothing.
6. Manual real import in dev/local only:
   - creates Desktop chats.
   - opening imported chat shows copied Telegram history.
   - sending new message stays on Desktop/webchat context, not Telegram.

## Risks / decisions needed

1. Source of truth for Telegram sessions:
   - Fast path: read `~/.openclaw/agents/main/sessions/sessions.json` directly.
   - Cleaner path: add/use Gateway API if available.
   - Recommendation: fast path now, abstract behind helper so we can swap later.

2. Copy format:
   - Copy full JSONL events preserves metadata but may include Telegram delivery context in old events.
   - Copy normalized chat messages avoids old transport metadata but may lose tool/system event details.
   - Recommendation: copy normalized non-system chat messages into new transcript, matching existing fork behavior, so Desktop session is clean.

3. Privacy/scope:
   - Telegram group sessions may contain other people’s messages.
   - Recommendation: Telegram-only import requires explicit click and preview count before copying.

## Implementation plan after approval

1. Add middleware scan/import command helpers and unit tests.
2. Wire commands into middleware command registry/API path.
3. Add UI IPC mappings.
4. Add Settings → Migration tab UI.
5. Run tests/build.
6. Commit and push.
