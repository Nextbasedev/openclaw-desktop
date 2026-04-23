# Sandbox — Agent Testing Environment

Tools that give agents the capability to verify their own work.

## Components

### 1. `verify-ui.mjs`
Connects to the official Chrome DevTools MCP server, opens a Jarvis route, waits for expected text, captures a screenshot, captures an accessibility snapshot, records console/network output, and writes a JSON summary.

Artifacts are saved under `.sandbox/runs/<timestamp>-<route>/`.

### 2. `verify-routes.mjs`
Runs the verifier across the core Jarvis routes: `/`, `/connect`, `/settings`, `/skill`, and `/notifications`.

### 3. `audit-ui.mjs`
Runs an evidence-only end-to-end audit across routes, chat restore, chat send, sidebar navigation, Mission Control surfaces, cron/notifications, settings, connect, and skills. It writes artifacts under `.sandbox/runs/` and a ranked report under `docs/plans/`.

### 4. `worktree.sh`
Creates/manages git worktrees for parallel agent work.
Each agent gets its own worktree with an isolated dev server on a unique port.

### 5. `lint-architecture.ts`
Custom linter that enforces:
- Layer dependency direction (Types → Config → Store → Service → Runtime → UI)
- Domain isolation (no cross-domain imports except through Providers)
- File size limits (300 lines max)
- Naming conventions

### 6. `check-build.sh`
Runs TypeScript compilation, lint, and tests. Returns structured output agents can parse.

## Usage

```bash
# Start the web UI in another terminal
pnpm --filter ui dev -- --port 3000

# Verify one route
pnpm sandbox:verify -- --port=3000 --path=/ --wait-for="Jarvis" --expect-main="Select model"

# Verify all core routes
pnpm sandbox:routes -- --port=3000

# Run evidence-only end-to-end audit
pnpm sandbox:audit -- --port=3000

# Create worktree for agent
./scripts/sandbox/worktree.sh create <branch-name> [port]

# Destroy worktree
./scripts/sandbox/worktree.sh destroy <branch-name>

# Run architectural lint
pnpm lint:architecture

# Full build check
./scripts/sandbox/check-build.sh
```

## Chrome DevTools MCP

The verifier uses the official `chrome-devtools-mcp` package from the Chrome DevTools team:

```bash
cmd /c npx -y chrome-devtools-mcp@latest --no-usage-statistics --no-performance-crux --isolated
```

Do not use `chrome-devtools-axi` for Jarvis UI verification.
