# Working Method — RPI + Compaction (Chat v5)

Operating procedure for the chat frontend rebuild. Goal: never let an agent enter the
"dumb zone" (context > ~40%), and never hallucinate code by mixing research, planning,
and implementation in one session.

## The three isolated steps (RPI)

1. **Research** — map the territory only. Locate files, trace data flows, read the
   middleware/contract. Produce a compressed *snapshot of truth*. Write NO new logic.
   - Output: contract types + notes (e.g. `sync/types.contract.ts`, plan §1).
2. **Plan** — draft an exact execution plan: file paths, signatures, pseudocode, test
   steps, acceptance. Still NO implementation.
   - Output: `CHAT_FRONTEND_PLAN_V5*.md` and the per-phase section.
3. **Implement** — hand the finished plan to a **fresh agent with an empty context** to
   write the actual code, run tests, and produce the commit doc.
   - Output: code + `frontend-docs/commits/NNNN-*.md`.

## Compaction (avoid the dumb zone)

- Each phase = its own session. Don't keep correcting in one long thread.
- Before context fills, the agent **compacts**: summarize current understanding into a
  markdown doc, then a fresh session continues from that summary only.
- **The docs ARE the compaction artifacts.** A fresh agent should be able to implement
  the next phase from: the relevant plan section + the previous `commits/NNNN-*.md` +
  the contract types — without re-reading the whole codebase.
- Keep source files ≤ 200 lines so any single file fits cheaply in context.

## Sub-agents = context protection, not roles

- Do NOT spawn sub-agents as personas ("frontend dev", "QA"). Spawn them to **protect
  the main context window**.
- Use them to read large things and return only what's needed, e.g.:
  - read a huge middleware file (`live.ts` 58k, `routes.ts` 80k) → return just the
    payload shape for one patch type.
  - scan a captured trajectory/patch log → return only the event ordering.
  - grep the codebase → return the 5 relevant lines, not the whole crawl.
- The main agent stays lean and keeps reasoning quality high.

## How each phase runs (the loop)

1. **Research** the specific surface (sub-agents fetch big-file details).
2. **Update the plan** section for that phase if reality differs.
3. **Fresh implement** session: code → `vitest` + `typecheck` green → write
   `commits/NNNN-*.md` (summary, why, workarounds, improved, what to test) → commit.
4. Update `index.md` (phase checklist + commit log).
5. Next phase = new context, fed by the docs above.

## Definition of done per phase
- All files ≤ 200 lines, isolated by concern.
- `pnpm --filter ui vitest run components/chat` green.
- `pnpm --filter ui typecheck` clean.
- A standalone commit doc exists and is linked from `index.md`.
