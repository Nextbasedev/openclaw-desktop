# Clean Bootstrap Message Metadata

## Problem
Production `/api/chat/bootstrap` can return user message content with OpenClaw-injected AI-facing metadata still attached, for example:

- `Conversation info (untrusted metadata): ...`
- `Sender (untrusted metadata): ...`
- `[Fri 2026-05-22 05:10 UTC] ...`
- `[Bootstrap truncation warning] ...`

The root path is:

- `apps/middleware/src/features/chat/routes.ts` calls Gateway `chat.history` in `/api/chat/bootstrap`.
- Gateway history is projected via `normalizeHistoryMessages()` in `apps/middleware/src/features/chat/message-normalizer.ts`.
- `normalizeHistoryMessages()` intentionally stores raw Gateway messages in `ProjectedMessage.data`.
- `serializeProjectedMessage()` in `routes.ts` returns that raw data in bootstrap/messages responses.

`normalizeMessageText()` already strips some wrappers for matching/compat text, but it does not strip all OpenClaw inbound metadata (`Conversation info`, reply/forward/thread context), and its cleaned value is not used by `serializeProjectedMessage()`.

## Current Flow

1. UI opens a chat and calls `/api/chat/bootstrap`.
2. Middleware requests `chat.history` from Gateway.
3. Middleware stores projected messages in SQLite with raw `data`.
4. Bootstrap reads projected messages and serializes raw `data` back to the UI.
5. The UI/parser can clean some metadata, but API consumers and some bootstrap paths can still see raw wrappers.

## Proposed Fix

Keep raw data in projection/storage for identity matching and debugging, but clean user-visible serialized text at the middleware API boundary.

Changes:

1. Add middleware text cleanup helpers in `apps/middleware/src/features/chat/message-normalizer.ts`:
   - Strip OpenClaw inbound metadata blocks matching installed OpenClaw behavior.
   - Strip leading timestamp prefixes.
   - Strip bootstrap truncation warning suffixes.
   - Preserve user text line breaks for display cleanup.
2. Reuse the cleanup from `normalizeMessageText()` so matching/compat logic also strips `Conversation info`.
3. Add `cleanMessageForDisplay()` or equivalent to sanitize serialized user messages in `serializeProjectedMessage()` without mutating stored raw DB rows.
4. Cover `/api/chat/bootstrap` and `/api/chat/messages` because both use `serializeProjectedMessage()`.

## Files to Change

- `apps/middleware/src/features/chat/message-normalizer.ts` — shared cleanup helpers.
- `apps/middleware/src/features/chat/routes.ts` — apply cleanup in `serializeProjectedMessage()`.
- `apps/middleware/tests/app.test.ts` — API-level regression test for bootstrap/messages metadata cleanup.
- `docs/clean-bootstrap-message-metadata-plan.md` — this plan.

## Risks

- Over-stripping legitimate user text: reduce risk by only stripping known sentinel blocks with fenced JSON at the start/trailing untrusted context and only applying serialized cleanup to user-role messages.
- Losing metadata needed for import identity: avoid by preserving raw `ProjectedMessage.data` in SQLite and only cleaning serialized API output.
- Breaking message ordering: no changes to `openclaw_seq`, segments, or projection event cursors.
- Breaking optimistic lifecycle: no changes to send/confirm paths except matching cleanup is slightly more complete.

## Testing

- Targeted middleware test for bootstrap/messages cleanup.
- Existing middleware app tests around archived bootstrap/import behavior.
- `pnpm --filter @openclaw/desktop-middleware typecheck`.
- `pnpm --filter @openclaw/desktop-middleware test -- app.test.ts`.
