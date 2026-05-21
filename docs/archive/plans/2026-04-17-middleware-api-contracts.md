# Jarvis Middleware API Contracts Implementation Plan
**Goal:** Add a real, typed middleware API contract layer for Jarvis so backend/middleware and frontend can share one source of truth for endpoint inputs and outputs.
**Architecture:** Keep the first implementation contract-first in `packages/shared`, with Zod schemas for request/response payloads plus typed endpoint metadata. Expose minimal desktop middleware scaffolding only where helpful, but prioritize a stable shared contract that the frontend can consume immediately.
**Tech Stack:** TypeScript, Zod, pnpm workspace, Vitest

---

## Task 1. Create shared middleware contract modules
- Add structured modules under `packages/shared/src/api/`
- Define reusable common types: ids, status enums, pagination-ish helpers, timestamps, session refs, profile refs
- Define endpoint contracts for:
  - profiles/environment
  - projects
  - topics
  - sessions
  - chat
  - files
  - git
  - terminal
  - activity
  - inbox/notifications
  - memory
  - settings/preferences/config
  - approvals
  - bootstrap
- Export both Zod schemas and inferred TS types
- Add one typed registry that lists method/path/request/response for every endpoint

## Task 2. Add tests for contract integrity
- Add Vitest to `packages/shared`
- Write tests that validate representative request/response payloads for every endpoint group
- Add tests that ensure registry entries have request/response schemas and unique operation ids

## Task 3. Add small desktop middleware scaffolding
- Add a lightweight Rust command surface or placeholder module only if needed to show where middleware integration will enter later
- Do not overbuild runtime logic yet
- Keep it minimal and aligned with the shared contract direction

## Task 4. Verify
- Run `pnpm --filter shared typecheck`
- Run `pnpm --filter shared test`
- If desktop changes are added, run desktop compile checks if practical

## Deliverable
- Shared endpoint types and schemas ready for frontend consumption
- Tested contract registry
- Clear summary of built API groups and what was verified
