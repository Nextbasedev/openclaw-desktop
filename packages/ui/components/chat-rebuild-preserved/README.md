# Chat Rebuild Preserved Design

This folder is a temporary design snapshot for the chat screen rebuild.

These files are not linked into the app right now. They are here so we can remove and rebuild the active chat flow while keeping the current visual design and interaction ideas available.

## Preserved Chat Message Design

- `ChatViewDesign/MessageBubble.tsx`
  - User message bubble design.
  - Assistant response text design.
  - User message action buttons.
  - Assistant response action buttons.
  - Copy, edit, reply, pin, fork, retry, feedback, and selected-text actions.
- `ChatViewDesign/MarkdownContent.tsx`
  - Markdown response rendering.
  - Code block rendering.
  - Rich response formatting.
- `ChatViewDesign/ToolCallSteps.tsx`
  - Tool call step list design.
  - Running, success, error, and approval states.
- `ChatViewDesign/ToolCallDetails.tsx`
  - Tool input and output detail design.
  - Full output fetch button design.
- `ChatViewDesign/ThinkingBlock.tsx`
  - Assistant reasoning/thinking block design.
- `ChatViewDesign/RichContentPreview.tsx`
  - Rich preview design for embedded content.

## Preserved Composer Design

- `ChatBoxDesign/index.tsx`
  - Main chat box design.
  - Text input behavior.
  - Send button design.
  - Model selector connection points.
  - Reply preview connection points.
- `ChatBoxDesign/ActionBar.tsx`
  - Composer action bar design.
- `ChatBoxDesign/AttachmentPreviewList.tsx`
  - Attachment preview design.
- `ChatBoxDesign/SlashCommandMenu.tsx`
  - Slash command menu design.
- `ChatBoxDesign/Icons.tsx`
  - Composer icon design helpers.
- `ChatBoxDesign/VoiceWaveIcon.tsx`
  - Voice input icon design.

## Rebuild Rule

Use these files only as reference or as source material for new smaller components. Do not connect this folder directly to the app.
