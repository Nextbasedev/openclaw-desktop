# OpenClaw Middleware

Standalone Node.js/TypeScript service for OpenClaw Desktop new architecture.

## Dev

```bash
pnpm install
MIDDLEWARE_TOKEN=dev-token pnpm dev
curl http://127.0.0.1:8787/health
curl -H 'Authorization: Bearer dev-token' http://127.0.0.1:8787/api/version
```
