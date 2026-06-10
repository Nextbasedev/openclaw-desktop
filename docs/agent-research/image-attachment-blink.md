# Research: image attachment blink

## Goal
Stop uploaded image messages from blinking/alternating between image-only, file banner, duplicate preview, and hidden/visible text while active chat patches stream.

## Current behavior
- Branch: `v5-krish`, HEAD `3722f68a fix: polish model selector dialog`.
- User logs show many rapid `chat.tool.update` patches with stable `messageCount`, so this is likely row re-render/reconciliation noise, not new messages being appended.
- `MessageBubble.tsx` renders user image attachments through `RichContentPreview` before the text bubble.
- Non-user messages render both `MessageAttachments` and `RichContentPreview`, which is a duplicate attachment UI path.
- `RichContentPreview.tsx` has a separate Next/Image + lightbox implementation. `MessageAttachments` has a separate direct `<img>` + footer/card implementation.
- Attachment merging/preservation exists in `applyPatches.ts`, `timelineStore.ts`, `attachmentCache.ts`, and `chatMessageDedupe.ts`; those should remain.

## Relevant files
- `packages/ui/components/ChatView/MessageBubble.tsx` — message bubble layout and attachment renderer selection.
- `packages/ui/components/ChatView/RichContentPreview.tsx` — alternate rich image/lightbox renderer.
- `packages/ui/lib/chat-engine-v2/applyPatches.ts` — preserves optimistic user attachments when canonical patches omit them.
- `packages/ui/lib/chat-engine-v2/timelineStore.ts` — merges attachments by url/name/mime/size across patch sources.
- `packages/ui/lib/attachmentCache.ts` — caches optimistic attachment content for later hydration.

## Data/control flow
1. Composer creates optimistic user message with `attachments` and cached content.
2. Middleware/gateway later confirms user message and active tool/status patches stream.
3. Timeline patch layer preserves/merges attachments.
4. MessageBubble chooses renderer; currently there are two different renderers, and assistant path renders both.

## Invariants
- Do not remove attachment preservation/merge logic.
- Do not change send payload or middleware attachment handling.
- Keep uploaded images visible when only cached/base64 content exists.
- Keep text bubble visible when the user sent text plus an image.

## Risk / unknowns
- Exact live reproduction depends on local app/browser state. The code-level duplicate renderer is deterministic and matches the reported duplicate/alternating UI.
