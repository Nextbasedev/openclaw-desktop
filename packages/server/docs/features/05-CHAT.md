# Feature Migration: Chat

## Overview

Chat commands manage Gateway chat sessions and message streaming. This is the core AI conversation feature. **Requires OpenClaw Gateway to be running.**

## Commands

| Command | Args |
|---------|------|
| `middleware_chat_create_session` | `{ label?, model?, agentId?, verboseLevel? }` |
| `middleware_chat_delete_session` | `{ sessionKey }` |
| `middleware_chat_send` | `{ sessionKey, text, timeoutMs?, attachments? }` |
| `middleware_chat_stop` | `{ sessionKey }` |
| `middleware_chat_history` | `{ sessionKey }` |
| `middleware_chat_edit_and_resend` | `{ sessionKey, messageId, text }` |
| `middleware_chat_regenerate` | `{ sessionKey, messageId }` |

## Streaming (Critical Change)

### Before (Tauri)

In Tauri, chat events came through Tauri window events:

```typescript
import { listen } from "@tauri-apps/api/event"

const unlisten = await listen("chat-stream-event", (event) => {
  const data = event.payload as ChatStreamEvent
  handleEvent(data)
})
```

### After (Browser)

In the browser, chat events come through Server-Sent Events (SSE):

```typescript
import { invoke, openEventStream } from "@/lib/ipc"

// 1. Create session
const { sessionKey } = await invoke("middleware_chat_create_session", {
  agentId: "my-agent",
  label: "New chat"
})

// 2. Open event stream BEFORE sending message
const close = openEventStream(
  `/api/stream/chat/${sessionKey}`,
  (event) => {
    const data = JSON.parse(event.data)
    handleChatEvent(data)
  }
)

// 3. Send message (this triggers streaming)
await invoke("middleware_chat_send", {
  sessionKey,
  text: "Hello, help me with this code"
})

// 4. Clean up when done
close()
```

### Chat Event Types

```typescript
type ChatStreamEvent =
  | { type: "chat.ready"; sessionKey: string }
  | { type: "chat.status"; sessionKey: string; state: "thinking" | "done" | "error"; label?: string }
  | { type: "chat.message"; sessionKey: string; content: string; role: string }
  | { type: "chat.tool"; sessionKey: string; toolName: string; input: unknown; output?: unknown }
  | { type: "chat.error"; sessionKey: string; message: string }
```

## Attachments

```typescript
await invoke("middleware_chat_send", {
  sessionKey: "ses_abc",
  text: "What does this file do?",
  attachments: [
    {
      name: "main.ts",
      mimeType: "text/typescript",
      content: "const x = 1; ...",
      encoding: "utf-8",
      size: 1234
    }
  ]
})
```

**Limits:**
- Max 10 attachments per message
- Max 50 MB per single attachment
- Max 100 MB total per message

## Error Cases

- `"Gateway not connected. Start the OpenClaw Gateway first."` — Gateway is not running
- Chat errors also stream via SSE as `chat.error` events

## Typical Flow

```
1. middleware_chat_create_session    → { sessionKey }
2. middleware_sessions_create        → store mapping locally
3. openEventStream("/api/stream/chat/{key}")  → subscribe to events
4. middleware_chat_send              → send user message, triggers streaming
5. ... receive SSE events (chat.status, chat.message, chat.tool, etc.)
6. middleware_chat_stop              → stop if needed
7. middleware_chat_history           → reload full history
8. middleware_chat_delete_session    → cleanup
```
