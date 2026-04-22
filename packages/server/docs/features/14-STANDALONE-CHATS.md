# Feature Migration: Standalone Chats, Auto-Naming & Recent Feed

## Overview

Standalone Chats are quick conversations **not tied to any project**. They sit alongside the existing Project → Topic hierarchy. Both chats and topics support auto-naming from the first message using a hidden system prompt that the user never sees in history.

A new **Recent Feed** returns both chats and topics in a single list sorted by last activity — use it for the sidebar "Recent" section.

### Two Parallel Hierarchies

```
1. Standalone Chats (no project)        2. Project → Topics (unchanged)
   ├── "Fix my CSS grid"                   ├── My Project
   ├── "Explain async/await"               │   ├── "Auth refactor"
   └── "Debug memory leak"                 │   └── "CI pipeline"
                                           └── Another Project
                                               └── "API design"
```

---

## Standalone Chat Commands

| Command | Args | Returns |
|---------|------|---------|
| `middleware_chats_list` | `{ archived?: boolean }` | `{ chats: Chat[] }` |
| `middleware_chats_create` | `{ name?, agentId?, sessionKey? }` | `{ chat: Chat }` |
| `middleware_chats_get` | `{ chatId }` | `{ chat: Chat }` |
| `middleware_chats_update` | `{ chatId, name?, pinned?, archived? }` | `{ chat: Chat }` |
| `middleware_chats_rename` | `{ chatId, name }` | `{ chat: Chat }` |
| `middleware_chats_archive` | `{ chatId, archived? }` | `{ ok, chatId, archived }` |
| `middleware_chats_delete` | `{ chatId }` | `{ ok, chatId }` |
| `middleware_chats_attach_session` | `{ chatId, sessionKey }` | `{ ok, chatId, sessionKey }` |
| `middleware_chats_update_activity` | `{ chatId }` | _(void)_ |

### Chat Object

```typescript
interface Chat {
  id: string           // "chat_xxxxxxxx"
  name: string         // "New Chat" by default, auto-named after first message
  sessionKey?: string  // gateway session key, set via attach_session
  agentId: string      // "main" by default
  archived: boolean
  pinned: boolean
  lastActiveAt?: string
  createdAt: string
  updatedAt: string
}
```

### Key Differences from Topics

| | Standalone Chat | Topic |
|-|----------------|-------|
| Belongs to project | No | Yes (`projectId`) |
| Has `sessionKey` | Yes (direct 1:1) | No (sessions attached via `session_mappings`) |
| Has `agentId` | Yes | No |
| Has `sortOrder` | No | Yes |
| Pinnable | Yes | No |

---

## Auto-Naming

Both chats and topics auto-name themselves after the user sends their first message. The naming prompt is **hidden** — the user never sees it in chat history.

### Commands

| Command | Args | Returns |
|---------|------|---------|
| `middleware_autonaming_generate` | `{ sessionKey, firstMessage }` | `{ name, source }` |
| `middleware_autonaming_quick` | `{ text }` | `{ name }` |

### How It Works

```
User sends first message: "Help me fix the login page timeout issue"
                              ↓
Frontend calls middleware_autonaming_quick → "Help me fix the login page timeout issue"
  (immediate, sets name right away)
                              ↓
Frontend calls middleware_autonaming_generate (async, gateway-powered)
  → Gateway returns: "Fix Login Page Timeout"
  → source: "gateway"
                              ↓
Frontend calls middleware_chats_rename (or middleware_topics_rename)
  → User sees: named chat in sidebar
```

### Two-Step Flow (Recommended)

1. **Immediate** — Call `middleware_autonaming_quick` for an instant name (truncates first 50 chars). Set the name right away so the UI isn't blank.
2. **Async** — Call `middleware_autonaming_generate` in the background. When it returns, call `chats_rename` or `topics_rename` to upgrade the name to the AI-generated one.

The `source` field in the response tells you which method produced the name:
- `"gateway"` — AI-generated title (3-6 words)
- `"truncated"` — fell back to truncated first message (gateway unavailable or timed out)

### Topics Rename (New)

| Command | Args | Returns |
|---------|------|---------|
| `middleware_topics_rename` | `{ topicId, name }` | `{ topic: Topic }` |

This works identically to `middleware_chats_rename` — used by auto-naming for topics.

---

## Recent Feed

Returns both chats and topics interleaved by last activity. Use this for the sidebar "Recent" section.

### Command

| Command | Args | Returns |
|---------|------|---------|
| `middleware_recent_list` | `{ limit?, includeArchived? }` | `{ items: RecentItem[] }` |

- `limit` — max items to return (default 50)
- `includeArchived` — include archived chats/topics (default false)

### RecentItem Shape

```typescript
interface RecentItem {
  type: "chat" | "topic"
  id: string
  name: string
  projectId?: string      // only for topics
  projectName?: string    // only for topics
  sessionKey?: string     // only for chats
  archived: boolean
  pinned: boolean
  updatedAt: string
}
```

Items are sorted by `updatedAt DESC` across both tables.

---

## Full Integration Example

### Creating a New Standalone Chat

```typescript
import { invoke, openEventStream } from "@/lib/ipc"

// 1. Create the chat record
const { chat } = await invoke("middleware_chats_create", {
  name: "New Chat",
  agentId: "main",
})

// 2. Create a gateway session
const { sessionKey } = await invoke("middleware_chat_create_session", {
  agentId: "main",
  label: chat.name,
})

// 3. Attach the session to the chat
await invoke("middleware_chats_attach_session", {
  chatId: chat.id,
  sessionKey,
})

// 4. Open SSE stream BEFORE sending message
const close = openEventStream(
  `/api/stream/chat/${sessionKey}`,
  (event) => {
    const data = JSON.parse(event.data)
    handleChatEvent(data)
  }
)

// 5. Send the first message
const firstMessage = "Help me fix the login page timeout"
await invoke("middleware_chat_send", { sessionKey, text: firstMessage })

// 6. Auto-name: immediate
const { name: quickName } = await invoke("middleware_autonaming_quick", {
  text: firstMessage,
})
await invoke("middleware_chats_rename", { chatId: chat.id, name: quickName })

// 7. Auto-name: async upgrade (fire and forget)
invoke("middleware_autonaming_generate", { sessionKey, firstMessage })
  .then(({ name }) => {
    invoke("middleware_chats_rename", { chatId: chat.id, name })
  })
  .catch(() => {}) // keep the quick name if gateway fails

// 8. Clean up on unmount
close()
```

### Auto-Naming a Topic (Same Flow)

```typescript
// After user sends first message in a new topic...
const firstMessage = "Let's refactor the auth middleware"

// Immediate name
const { name: quickName } = await invoke("middleware_autonaming_quick", {
  text: firstMessage,
})
await invoke("middleware_topics_rename", { topicId: topic.id, name: quickName })

// Async upgrade
invoke("middleware_autonaming_generate", { sessionKey, firstMessage })
  .then(({ name }) => {
    invoke("middleware_topics_rename", { topicId: topic.id, name })
  })
  .catch(() => {})
```

### Rendering the Recent Sidebar

```typescript
const { items } = await invoke("middleware_recent_list", { limit: 20 })

items.map((item) => {
  if (item.type === "chat") {
    // Render standalone chat row
    // Click → navigate to chat view, use item.sessionKey
  } else {
    // Render topic row with project badge
    // item.projectName shown as subtitle
    // Click → navigate to project/topic view
  }
})
```

---

## Error Cases

| Error | When |
|-------|------|
| `"Chat not found: {id}"` | chatId doesn't exist |
| `"Name cannot be empty"` | rename with blank name |
| `"Topic not found: {id}"` | topicId doesn't exist for rename |
| `"Gateway not connected..."` | autonaming_generate when gateway is down (falls back to truncated) |

## Notes

- `chats_list` filters by `archived` (default false). Pinned chats sort first.
- `chats_create` defaults name to `"New Chat"` and agentId to `"main"`.
- `chats_delete` records a sync tombstone for cross-device sync.
- `chats_update_activity` is fire-and-forget — call it on every message send to keep `lastActiveAt` fresh for the recent feed.
- Auto-naming `generate` has a 10-second timeout — if the gateway is slow, it falls back to truncation.
- The naming system prompt is sent as a **separate request** to the gateway. It is never injected into the user's conversation history.
