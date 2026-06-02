# Chat 404 Fix Summary

## Problem
The frontend was calling `/api/v1/chat/message` and `/api/chat/message` but the backend only had `/api/chat/send` route, causing 404 errors.

## Root Cause
The frontend source code (`packages/ui/lib/chat-engine-v2/client.ts`) correctly calls `/api/chat/send`, but the **built output files** had the old endpoint `/api/chat/message` hardcoded. This suggests a build caching issue or outdated build output.

## Fixes Applied

### 1. Frontend Built Files (Immediate Fix)
- `packages/ui/out/_next/static/chunks/6b8aba6cac74a35e.js` - Changed `/api/chat/message` → `/api/chat/send`
- `packages/ui/.next/static/chunks/6b8aba6cac74a35e.js` - Changed `/api/chat/message` → `/api/chat/send`

### 2. Middleware Backward-Compatible Aliases (Defensive Fix)
Added routes to handle old clients calling the wrong endpoint:
- `apps/middleware/src/features/chat/routes.ts` - Added `/api/chat/message` and `/api/v1/chat/message` aliases
- `packages/desktop/src-tauri/bundled/middleware/dist/features/chat/routes.js` - Added aliases
- `packages/desktop/src-tauri/bundled/middleware/node_modules/@openclaw/desktop-middleware/dist/features/chat/routes.js` - Added aliases

All aliases forward to `/api/chat/send` internally.

## Next Steps
1. Rebuild the frontend properly to ensure the built output matches the source code
2. Consider adding a build verification step to catch endpoint mismatches
3. Test the chat functionality to confirm messages are sent without 404 errors
