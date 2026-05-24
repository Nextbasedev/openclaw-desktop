# Edge Case Fix Workflow Constraints

This constraint applies to the desktop edge-case work split under `edge-cases/groups/`.

## Why this exists

The edge cases are connected across chat state, focused windows, Activity, inspector tabs, cron activity, and terminal lifecycle. If each group is fixed from scratch without durable docs, every PR wastes context and risks reintroducing the same bugs.

## Required four-stage workflow per group

For every group, use the repo-local skill workflow in this order:

1. `docs/skills/feature-plan/SKILL.md`
   - Read the relevant `docs/constraints/*.md` files first.
   - Trace code before changing behavior.
   - Write or update a short implementation note/doc for the group.

2. `docs/skills/feature-build/SKILL.md`
   - Implement only the current group.
   - Do not silently fix later groups unless the current group requires it.
   - Keep the PR scoped to the group.

3. `docs/skills/pr-review/SKILL.md`
   - Create one PR for the group.
   - Run the required 3-pass review:
     - Code Quality
     - Regression Risk
     - Better Alternatives
   - Verify review findings against code before repeating or patching.

4. `docs/skills/feature-ship/SKILL.md`
   - Run the smallest meaningful checks.
   - Update the PR body/comment with checks and remaining blockers.
   - Do not merge unless explicitly asked.

## Required docs before code changes

Before touching runtime code in a group, update or create a doc with:

- Problem / current behavior
- Current code flow with file/function references
- Proposed fix order
- Files to change
- Risks / connected groups
- Tests/checks to run
- Manual verification notes

Preferred locations:

- Group-level planning: `docs/plans/group-XX-<name>.md`
- Durable constraints: `docs/constraints/*.md`
- Lessons after fixing bugs: `docs/lessons/YYYY-MM-DD-<topic>.md`
- Edge-case inventory: `edge-cases/groups/*.md`

## Scope rule

Each group gets its own branch and PR:

- Group 01: instrumentation only
- Group 02: canonical chat state + focused window bootstrap
- Group 03: subagent turn model
- Group 04: message ordering + optimistic/canonical dedupe
- Group 05: Activity progressive hydration
- Group 06: inspector Workspace/Git scope
- Group 07: cron/notification activity
- Group 08: terminal lifecycle

Do not combine groups unless the user explicitly approves it.

## Required checks

Use the smallest meaningful checks for the touched files. Common checks:

- `pnpm --filter ui typecheck`
- `pnpm --filter ui build`
- Targeted tests when relevant
- `pnpm --filter ui lint` only as a known-health signal; if unrelated existing lint failures remain, state that clearly.

## Review output rule

For every group, report back in this compact format:

1. Group
2. PR
3. What changed
4. Checks
5. PR review
6. Verdict

## Safety rule

Instrumentation can be merged before behavioral fixes, but behavioral fixes must not rely on unstated assumptions. If a fix depends on bootstrap, patch cursor, subagent anchoring, or inspector session scope, document that dependency before changing code.
