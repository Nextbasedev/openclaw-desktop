# Plan: image attachment blink

## Summary
Simplify chat attachment rendering to one stable path inside `MessageBubble`: use `MessageAttachments` for both user and assistant messages, and stop rendering `RichContentPreview` from message bubbles. This removes duplicate/competing image UIs without touching send/middleware logic.

## Files to change
- `packages/ui/components/ChatView/MessageBubble.tsx`
- Tests: existing UI/lib tests, plus targeted typecheck/build if feasible.

## Steps
1. Remove `RichContentPreview` import from `MessageBubble.tsx`.
2. Render `MessageAttachments` once for user messages before the text bubble.
3. Render `MessageAttachments` once for assistant messages inside the assistant body.
4. Remove the second `RichContentPreview` call from assistant rendering.
5. Keep the text bubble condition unchanged so text remains visible with images.

## Verification
- `pnpm --filter ui test -- chatAttachmentPreview chatMessageDedupe applyPatches`
- `pnpm --filter ui typecheck`
- `pnpm --filter ui build` if typecheck passes/time allows.

## Risks
- Slight UI behavior change: no lightbox-specific rich preview from message bubbles. This is intentional simplification per request.
- `RichContentPreview.tsx` may still be used elsewhere or can remain unused until a cleanup pass.

## Non-goals
- No middleware send/projection rewrite.
- No broad chat layout redesign.
