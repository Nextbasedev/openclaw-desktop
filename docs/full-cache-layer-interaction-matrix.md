# Full Cache Layer Interaction Matrix

## Cache Layers (Frontend → Middleware → Gateway)

### Frontend (7 layers):
| Layer | Storage | TTL | Scope |
|-------|---------|-----|-------|
| warmChatCache | In-memory | Session lifetime | Per chat |
| persistentCache | IndexedDB + localStorage | 60s | Per key |
| chatListCache | In-memory + persistentCache | 1.5s dedupe, 60s persist | Per space |
| startupBootstrap | localFirstSync + persistentCache | 2s dedupe, 60s persist | App-level |
| requestDedupe | In-memory | Per-key TTL (2-30s) | Per request |
| requestScheduler | In-memory | None (abort-based) | Per session |
| globalChatEngineStore | In-memory | Session lifetime | Per session |

### Middleware (4 layers):
| Layer | Storage | TTL | Scope |
|-------|---------|-----|-------|
| syncGatewaySessionsCache | In-memory promise | 5s dedupe | Global |
| lastFullSyncAtMs | In-memory timestamp | 30s fresh, 5min stale-serve | Global |
| localFirstBootstrapTimestamps | In-memory Map | 30s | Per session |
| compatState | In-memory + SQLite | Always valid | Global |

### Data Sources:
| Source | Latency | Data |
|--------|---------|------|
| Gateway sessions.list | 800ms | Chat/session list |
| Gateway chat.history | 40-100ms | Chat messages |
| Gateway chat.send | 54ms | Send confirmation |
| SQLite projection | 1-6ms | Chat messages (local) |

## User Action → Cache Layer Trace

### App Refresh (F5)
```
localStorage.middleware.url → skip health check (0ms)
  → startupBootstrap: localFirstSync/IndexedDB (0-5ms)
    → render sidebar from cache
  → /api/bootstrap (background)
    → lastFullSyncAtMs: if <5min → serve compatState (1ms)
      → syncGatewaySessions (background, 800ms+)
    → if >5min → block on sync (3-5s)
  → update localStorage/IndexedDB cache
```

### Click Sidebar Chat
```
setActiveChat (0ms)
  → requestScheduler: abort old session
  → warmChatCache: if fresh → render (0ms)
  → /api/chat/bootstrap
    → localFirstBootstrapTimestamps: if <30s → SQLite (4-6ms)
    → if >30s → Gateway chat.history (40-100ms)
  → requestDedupe: coalesce within 2s
  → update warmChatCache + globalStore
```

### Send (Existing Chat)
```
checkGatewayOrRedirect: skip if URL in localStorage (0ms)
  → optimistic message + status=thinking
  → requestScheduler: 'critical' (never aborted)
  → /api/chat/send
    → skip sessions.create if session exists locally (0ms)
    → Gateway chat.send (54ms)
  → patch stream: thinking/tool/assistant updates
```

### Rapid Tab Switch
```
For each switch:
  → scheduler: abort old session requests
  → warmChatCache: render if <30s (0ms)
  → requestDedupe: prevent double bootstrap (2s)
  → middleware: localFirst if <30s (4-6ms) 
  → windowed rendering: only 20 msgs initially
```

## Cross-Layer Edge Cases

| # | Scenario | Severity | Status |
|---|----------|----------|--------|
| 1 | Warm cache 'done' vs middleware 'thinking' | Low | ✅ Patch stream corrects |
| 2 | Old sidebar cache vs new middleware data | Cosmetic | ✅ Background fetch updates |
| 3 | requestDedupe blocks fresh bootstrap | Low | ✅ Dedupe key includes sessionKey |
| 4 | syncGateway 5s vs lastFullSync 5min | None | ✅ Independent layers |
| 5 | localFirst expired but warm cache fresh | None | ✅ Correct: warm=paint, middleware=authority |
| 6 | invalidateCache + active sync promise | Low | ✅ 5s dedupe, compatState has mutation |
| 7 | Chat switch during background sync | None | ✅ Independent Gateway calls |
| 8 | Windowed render + pagination | Low | ✅ Separate mechanisms |
| 9 | Scheduler abort + warm cache + timeout | Medium | ✅ Fixed: timeout skips if msgs > 0 |
| 10 | Multiple cache layers → msg count jumps | Low | ✅ dedupeChatMessages merges |

## Verdict
All interactions safe. No data corruption. No blocking after first sync.
