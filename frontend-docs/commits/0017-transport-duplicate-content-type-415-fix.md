# 0017 — Fix duplicate Content-Type header (415 on all POSTs)

**Commit:** `0ae1f509` (branch `v5`)
**File:** `packages/ui/components/chat/runtime/transport.ts` (1-line behavior change)

## Symptom
Live send fully broken in real-usage browser verification: `POST /api/chat/send`
returned **HTTP 415 Unsupported Media Type**, the optimistic user message never
persisted, and an uncaught `unhandledrejection` fired. All GET read paths
(bootstrap / messages / chats / pagination) worked fine — only writes failed.

## Root cause
Two layers each set the JSON content type with different key casing:
- `lib/middleware-client.ts` `middlewareFetch` always sets `"Content-Type": "application/json"`.
- `components/chat/runtime/transport.ts` *also* set `"content-type": "application/json"`
  (lowercase) for POST bodies, spread via `init.headers`.

`fetch` normalizes header names case-insensitively and **merges the two
case-different keys into a single comma-joined value**: `content-type:
application/json, application/json`. Fastify's content-type parser rejects that
malformed value with 415. Reproduced with curl: doubled value → 415, single → 200.
Affected every POST route: `send`, `abort`, `createChat`, `resolveApproval`.

## Fix
Drop the redundant header in `transport.ts`; `middlewareFetch` already sets it.
The POST branch now only adds the serialized body:

```ts
...(hasBody ? { body: JSON.stringify(init?.body) } : {}),
```

## Verification
- `pnpm --filter ui exec vitest run components/chat` → 26/26 pass.
- `pnpm --filter ui typecheck` → clean.
- `pnpm --filter ui build` → green (all routes prerendered).
- Live send/stream re-verification: see follow-up browser pass.

## Lesson
Never set request headers in two layers with different casing — `fetch` merges
same-name (case-insensitive) headers into a comma-joined value. Set
`Content-Type` in exactly one place (the shared fetch wrapper).
