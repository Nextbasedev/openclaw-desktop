# packages/server — Documentation

## Migration Docs

If you're a frontend developer migrating from Tauri IPC to the Node.js HTTP backend, start here:

1. **[MIGRATION-GUIDE.md](./MIGRATION-GUIDE.md)** — Full migration guide with step-by-step instructions, search-and-replace patterns, and a checklist

## Per-Feature Docs

Each feature doc has: command table, request/response shapes, before/after code examples, error cases, and notes.

| # | Feature | Commands | Gateway? |
|---|---------|----------|----------|
| [01](./features/01-PROFILES.md) | Profiles & Environment | 10 | No |
| [02](./features/02-PROJECTS.md) | Projects | 8 | No |
| [03](./features/03-TOPICS.md) | Topics | 7 | No |
| [04](./features/04-SESSIONS.md) | Sessions | 4 | No |
| [05](./features/05-CHAT.md) | Chat & Streaming | 7 + SSE | Yes |
| [06](./features/06-BRANCHES.md) | Branches | 7 | No |
| [07](./features/07-FILES.md) | Files & Filesystem | 17 | No |
| [08](./features/08-GIT.md) | Git | 6 | No |
| [09](./features/09-TERMINAL.md) | Terminal & PTY | 9 + SSE | No |
| [10](./features/10-ONBOARDING.md) | Onboarding | 22 | Partial |
| [11](./features/11-CRON.md) | Cron Jobs | 12 | Yes |
| [12](./features/12-MEMORY-SKILLS-SYNC-USAGE.md) | Memory, Skills, Sync, Usage | 17 | Partial |
| [13](./features/13-CONNECT-RUNTIME.md) | Connect & Runtime | 8 | No |

**Total: 134 commands + 3 SSE streams**

## Quick Reference

### Server URL

```
http://localhost:3001
```

### IPC Endpoint

```
POST /api/ipc/:command
Content-Type: application/json
Body: { ...args }
Response: { ...result } or { error: "message" }
```

### SSE Endpoints

```
GET /api/stream/chat/:sessionKey
GET /api/stream/terminal/:sessionId
GET /api/stream/pty/:ptyId
```

### Health Check

```
GET /health
Response: { ok: true, timestamp: "2024-01-15T10:30:00.000Z" }
```

### Start the server

```bash
pnpm dev:web          # starts both server (:3001) and UI (:3000)
pnpm --filter server dev   # server only
```
