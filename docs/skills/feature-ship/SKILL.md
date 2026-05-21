---
name: feature-ship
description: Create a PR for a completed and reviewed OCPlatform Desktop feature. Use when asked to "create PR", "ship it", or "open PR" AFTER testing and review are complete. Hard rule — never merge without explicit permission.
---

# Feature Ship

Create a pull request for a completed, tested, and reviewed feature branch.

## Prerequisites

- Feature implemented (`feature-build`) ✅
- Testing completed ✅
- Branch review completed (`feature-review`) ✅
- Review fixes applied per instructions ✅

## Workflow

### 1. Pre-Flight Checks

```bash
BRANCH=$(git branch --show-current)
BASE=dev-2-temp  # or target branch

# Verify on feature branch
echo "Branch: $BRANCH"

# Check diff
git diff ${BASE}..${BRANCH} --stat

# Compile checks
pnpm --filter @openclaw/desktop-middleware typecheck
pnpm --filter ui typecheck

# Tests
pnpm --filter @openclaw/desktop-middleware test -- --runInBand

# Build
pnpm --filter ui build
```

### 2. Create PR

```bash
gh pr create \
  --base ${BASE} \
  --head ${BRANCH} \
  --title "<type>: <concise description>" \
  --body-file /tmp/pr-body.md \
  --repo Nextbasedev/openclaw-desktop
```

#### PR Title Format

Use conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`

#### PR Description

Use `.github/PULL_REQUEST_TEMPLATE.md` as the base. Fill in:
- Summary of changes
- Key changes (bullet list)
- Which `docs/constraints/` files were checked
- Verification steps run (typecheck, test, build)
- Lessons added (if bug fix)

### 3. Report

Provide:
- PR URL
- Number of commits
- Files changed summary
- Ready for review

### 4. Wait for Merge Permission

**HARD RULE: Never merge without explicit permission.**

When told to merge:
```bash
gh pr merge <PR_NUMBER> --repo Nextbasedev/openclaw-desktop --squash --delete-branch
```

Verify:
```bash
gh pr view <PR_NUMBER> --repo Nextbasedev/openclaw-desktop --json state -q .state
```

### 5. Post-Merge

After merge:
- **If this PR fixed a bug:** add a lesson to `docs/lessons/README.md`
- **If this PR introduced a new constraint:** verify it was added to `docs/constraints/`
- Clean up temp review files (`.review-pr*`, `/tmp/pr-*`)

## Hard Rules

- **Never merge without explicit "merge it" / "go ahead" or similar**
- Never create a PR without prior testing and review
- Always include verification results in PR description
- Always include which constraints from `docs/constraints/` were checked
- PR description should be self-contained — reviewer shouldn't need external context
