# Sandbox — Agent Testing Environment

Tools that give agents the capability to verify their own work.

## Components

### 1. `verify-ui.sh`
Launches the dev server, opens it with chrome-devtools-axi, takes a snapshot + screenshot.
Agents use this to verify UI changes visually.

### 2. `worktree.sh`
Creates/manages git worktrees for parallel agent work.
Each agent gets its own worktree with an isolated dev server on a unique port.

### 3. `lint-architecture.ts`
Custom linter that enforces:
- Layer dependency direction (Types → Config → Store → Service → Runtime → UI)
- Domain isolation (no cross-domain imports except through Providers)
- File size limits (300 lines max)
- Naming conventions

### 4. `check-build.sh`
Runs TypeScript compilation, lint, and tests. Returns structured output agents can parse.

## Usage

```bash
# Verify UI change
./scripts/sandbox/verify-ui.sh [port]

# Create worktree for agent
./scripts/sandbox/worktree.sh create <branch-name> [port]

# Destroy worktree
./scripts/sandbox/worktree.sh destroy <branch-name>

# Run architectural lint
pnpm lint:architecture

# Full build check
./scripts/sandbox/check-build.sh
```
