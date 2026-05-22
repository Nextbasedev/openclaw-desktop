---
name: feature-ship
description: Create a PR and ship a completed openclaw-desktop feature or fix.
---

# Feature Ship

## When to Use
Code is done, tests pass, review is clean. Time to create the PR.

## Step 1: Pre-Flight

```bash
# Make sure tests and types pass
pnpm --filter @openclaw/desktop-middleware typecheck
pnpm --filter @openclaw/desktop-middleware test -- --runInBand
pnpm --filter ui typecheck
pnpm --filter ui build
```

Only run what you changed. Middleware-only fix? Skip UI checks.

## Step 2: Create PR

```bash
gh pr create \
  --repo Nextbasedev/openclaw-desktop \
  --base dev-2-temp \
  --head fix/<branch-name> \
  --title "<what changed>" \
  --body "## Summary
<1-2 sentences>

## Changes
- <bullet per logical change>

## Verification
- pnpm --filter @openclaw/desktop-middleware typecheck ✅
- pnpm --filter @openclaw/desktop-middleware test ✅
- pnpm --filter ui typecheck ✅
- pnpm --filter ui build ✅"
```

Base branch: usually `dev-2-temp` or `fix/pr33-segment-followups` if stacking on another fix.

Title style (from actual PRs):
- `Fix per-window chat layout restore`
- `Fix chat initial scroll behavior`
- `Raise chat attachment payload limit`
- `Fix stale synced session cleanup`

## Step 3: If Review Requested

Run `feature-review` skill on the PR. Fix issues, push, comment the fix on the PR.

```bash
# Comment issue
gh pr comment <PR> --repo Nextbasedev/openclaw-desktop --body "Review found: <issue>"

# After fixing
git add <files> && git commit -m "<fix description>" && git push

# Comment fix
gh pr comment <PR> --repo Nextbasedev/openclaw-desktop --body "Fixed: <what was done>"
```

## Step 4: Wait

**Never merge without explicit permission.**

When told to merge:
```bash
gh pr merge <PR> --repo Nextbasedev/openclaw-desktop --squash --delete-branch
```

## Step 5: Post-Merge

If this PR fixed a bug, add a lesson to `docs/lessons/README.md`:
- What broke
- Root cause (file:line)
- Fix (PR number)
- Which constraint it validates
