# Developer Guide — OCPlatform Desktop

## How this codebase works with AI

This codebase is built for AI-assisted development. Instead of documentation that goes stale, we have a system that keeps your AI agent informed and accurate.

## What to read first

**You:** Read `AGENTS.md` at the repo root. It's the architecture overview — takes 10 minutes. After that, you know how the system works.

**Your AI agent:** Will read `AGENTS.md` automatically (most AI tools detect it at the repo root). This gives it the architecture, coding patterns, and rules it needs to write correct code.

## The system

```
AGENTS.md                        ← Architecture, invariants, patterns, anti-patterns
├── docs/constraints/            ← Domain-specific rules (6 files)
│   ├── middleware.md             ← Body limits, send pipeline, patch bus, timeouts
│   ├── chat-engine.md           ← Message ordering, dedup, history, streaming
│   ├── ui-scroll.md             ← Scroll behavior, layout effects
│   ├── sessions.md              ← Session sync, imports, window isolation
│   ├── gateway.md               ← Protocol, events, timeouts
│   └── api-routes.md            ← Complete route inventory
├── docs/skills/                 ← Development workflows (5 skills)
│   ├── feature-plan/            ← How to research and plan a feature
│   ├── feature-build/           ← How to implement (constraint checks, self-review)
│   ├── feature-review/          ← How to review code (parallel agents)
│   ├── feature-ship/            ← How to create a PR
│   └── pr-review/               ← How to review an existing PR
├── docs/lessons/                ← Post-incident learnings (bug → root cause → fix → constraint)
└── .github/PULL_REQUEST_TEMPLATE.md  ← PR template (auto-fills on every PR)
```

## How to work on a task

1. **Get a task** — bug fix, feature, investigation.
2. **Tell your AI to read the relevant skill FIRST.** This is the critical step. Don't let the AI jump into coding. Say: "Read `docs/skills/feature-plan/SKILL.md`" (for new features) or "Read `docs/skills/feature-build/SKILL.md`" (for implementation). The skill tells the AI exactly what to do — read constraints, extract a checklist, self-review before pushing.
3. **The AI follows the skill** — reads `AGENTS.md` + relevant constraint files, extracts a constraint checklist for the task, implements following the patterns, self-reviews against the checklist.
4. **Create a PR** — the template at `.github/PULL_REQUEST_TEMPLATE.md` auto-fills with: Summary, Changes, Constraints checked, Verification.
5. **You review** — check blast radius, verify the AI's understanding is correct, don't rubber-stamp (see "The human's role" below).
6. **Merge.**

**Common mistake:** The AI will try to start coding the moment you describe the task. Don't let it. The skills exist to prevent the class of bugs where the AI writes correct-looking code that violates an undocumented constraint. Make it read the skill first — every time.

## What the constraint files prevent

Every constraint exists because we shipped a bug without it. Examples:

- "Messages ordered by `openclaw_seq`, not timestamp" — because timestamp sorting corrupted chat history across segments
- "Per-window layout isolation via `openclawWindowId`" — because a shared layout cache caused two windows to show each other's chats
- "Seed `historyLoadVersion` when warm messages exist" — because chats opened at the top instead of the latest message
- "Middleware body limit is 25 MB" — because Fastify's default 1 MB silently rejected image attachments
- "Session sync must preserve imported/manual/local sessions" — because a sync deleted user-created sessions

Your AI reads these before writing code. The rules prevent it from re-introducing bugs we already fixed.

## Key rules (the short version)

1. **Tell your AI to read the skill before every task** — not just `AGENTS.md`, the specific skill for what you're doing
2. Read `AGENTS.md` before your first task
3. Use the PR template — fill in Constraints checked
4. If you discover a new rule that should be documented, add it to `docs/constraints/` in the same PR
5. If you fix a bug, add a lesson to `docs/lessons/README.md`

## The human's role — what to check when AI ships code

AI handles the HOW (correct code, patterns, constraints). You handle the WHAT and the SO WHAT (right problem, right solution, real-world risk).

### 1. Verify the problem is real
AI builds exactly what you ask. It won't question whether the task makes sense.
- Is this actually a problem? Or a symptom of something else?
- Is this the right solution? Or are we patching when we should be redesigning?
- Does this need to be done now?

### 2. Check blast radius honestly
AI fills in PR descriptions confidently. But AI underestimates risk — it sees the code path, not the user impact.
- "Only affects attachment sending" — how many users send attachments daily?
- "Low risk" — based on what? Did the AI test this or just reason about it?
- What's the worst case if this breaks after release?

### 3. Spot what the AI is confident about but wrong
AI never says "I'm not sure." It writes code that looks correct and compiles. Ask:
- Does this change behavior for existing users? Even subtly?
- Is the AI's understanding actually correct, or is it following an outdated constraint?
- Did the AI test this, or just write code that looks like it would work?

### 4. Verify the AI read the right context
AI reads what the skill tells it to. But sometimes the relevant context isn't in the constraint files yet.
- Does this touch a flow with undocumented gotchas?
- Is there a reason we do things a certain way that isn't written down?
- Did the AI miss a related system that will be affected?
- The compat layer is 4500 lines — did the AI actually read the relevant section?

### 5. Check the rollback plan
- Is this actually revertable? Or does it change the SQLite schema in a way that can't be undone?
- If this breaks after a Tauri release, can you hotfix without a new binary?
- Does this affect the bundled middleware inside the Tauri app?

### 6. Don't rubber-stamp
The biggest risk in AI-assisted development: the human stops reviewing because "the AI follows the rules." The rules don't cover everything. The constraints don't cover everything. The tests don't cover everything.

Read the diff. Understand what changed, why, and what could go wrong. If you can't explain what the PR does after reading it, don't merge it.

## Common AI mistakes to watch for

These are behaviors AI agents default to unless the skills correct them:

- **Jumps into coding without reading the skill** — always make it read the relevant `docs/skills/` file first
- **Grepping instead of reading** — searches for keywords instead of reading full functions. Misses context every time.
- **Writes docs from session memory instead of code** — describes what it thinks the code does instead of what the code actually does. Always verify claims against source.
- **Doesn't check the compat layer** — changes a v2 route without checking if the compat layer (`features/compat/routes.ts`) needs matching updates
- **Misses the bundled middleware** — `packages/desktop/src-tauri/bundled/middleware/` is a copy of `apps/middleware`. Changes to one may need to be reflected in the other.
- **Treats warm cache as source of truth** — warm cache is a bounded preview for fast paint. The middleware projection is authoritative.
- **Assumes gateway "done" means UI done** — gateway `chat.send` returns "done" before the assistant message appears in history. Middleware must wait.
- **Shares layout/cache keys across windows** — every persistent cache must be scoped by `openclawWindowId`
- **Silently deviates from the plan** — implementation changes approach but the AI doesn't flag it

All of these are addressed by reading the skill first. When the AI skips the skill, these mistakes appear.

## What you should NEVER do

- Never push directly to `dev-2-temp` or `main` — always create a PR
- Never merge without explicit approval
- Never skip typecheck/test before pushing
- Never delete sessions during sync without checking if they're imported/manual/local

## When you're stuck

Ask early. Don't spend a full day stuck without reaching out. A quick question saves hours of guessing.

If the AI agent gets stuck or produces something that doesn't look right — don't trust it blindly. Check the constraints, read the relevant code, and ask if something doesn't make sense.

If a situation isn't covered by the constraint files, that's a gap — flag it so we can add it.

## Quick start

```bash
git clone https://github.com/Nextbasedev/openclaw-desktop.git
cd openclaw-desktop
cat AGENTS.md                    # understand the system (10 min read)
ls docs/constraints/             # see the rules
ls docs/skills/                  # see the workflows
pnpm install                     # install all deps

# Verify everything works
pnpm --filter @openclaw/desktop-middleware typecheck
pnpm --filter @openclaw/desktop-middleware test -- --runInBand
pnpm --filter ui typecheck
pnpm --filter ui build
```

## Package quick reference

| What | Command |
|------|---------|
| Install | `pnpm install` |
| Dev server | `pnpm dev` (Next.js on :3000) |
| Full Tauri app | `pnpm dev:tauri` |
| Middleware typecheck | `pnpm --filter @openclaw/desktop-middleware typecheck` |
| Middleware tests | `pnpm --filter @openclaw/desktop-middleware test -- --runInBand` |
| UI typecheck | `pnpm --filter ui typecheck` |
| UI build | `pnpm --filter ui build` |
| All tests | `pnpm test` |
| All types | `pnpm typecheck` |
| Lint | `pnpm lint` |
