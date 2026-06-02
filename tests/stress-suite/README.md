# OpenClaw Desktop Chat Stress Test Suite

A reusable, parameterized production stress test suite for validating OpenClaw Desktop chat heavy tool sessions.

## Focus Areas

1. **Parameterized N messages × M varied tool calls** — configurable message count, tool density, tool variety, and injection patterns
2. **Assistant final marker gating** — validates that assistant messages are correctly classified as final vs. non-final based on content blocks
3. **Transcript duplicate detection** — detects duplicate message IDs, optimistic user echoes, and runId+text collisions
4. **Stale live detection** — ensures live:run-* rows are replaced by canonical finals and no orphans remain
5. **Timeout handling** — configurable timeouts per phase (navigation, scroll, extraction)
6. **Row count expectations** — validates rendered DOM row count matches expected coalesced timeline count
7. **10×45 varied test** — 10 pre-defined variations of 45 messages each, covering diverse tool patterns

## Files

| File | Purpose |
|------|---------|
| `generators.ts` | Synthetic message + tool call generators |
| `validators.ts` | Invariant validators (duplicates, finals, stale live, row counts, timeouts) |
| `instrumentation.ts` | Browser-injectable scroll/mutation/frame instrumentation |
| `page-builder.ts` | Synthetic HTML test page builder |
| `harness.ts` | Playwright-based test harness with timeout/abort support |
| `stress-10x45.spec.ts` | Parameterized Playwright spec for the 10×45 varied suite |
| `run-standalone.ts` | Standalone Node.js runner (no test framework required) |
| `real-webui-stress-audit.mjs` | Real WebUI audit against a running Desktop instance |
| `ARCHITECTURE.md` | Design documentation |

## Usage

### Playwright (recommended for CI)

```bash
cd /root/.openclaw/workspace/openclaw-desktop
npx playwright test tests/stress-suite/stress-10x45.spec.ts --reporter=list
```

### Standalone Node.js

```bash
cd /root/.openclaw/workspace/openclaw-desktop
npx tsx tests/stress-suite/run-standalone.ts
```

### Real WebUI Audit

Requires a running Desktop instance on `http://127.0.0.1:3000/`:

```bash
cd /root/.openclaw/workspace/openclaw-desktop
node tests/stress-suite/real-webui-stress-audit.mjs
```

### Custom Parameterized Run

```typescript
import { generateSyntheticMessages } from "./tests/stress-suite/generators"
import { runStressTest } from "./tests/stress-suite/harness"

const messages = generateSyntheticMessages({
  messageCount: 200,
  toolDensity: 0.15,
  toolVariety: 8,
  toolPattern: "interleaved",
  seed: 42,
})

const report = await runStressTest({
  name: "custom-heavy",
  messages,
  outDir: "test-results/custom-heavy",
  scrollDurationMs: 10000,
  timeoutMs: 60000,
  recordFrames: true,
})

console.log(report.verdict)
```

## Artifacts

Each run produces:
- `stress-report.json` — full report with metrics, validations, and verdict
- `test-page.html` — the synthetic page under test
- `screenshots/screenshot-final.png` — final state screenshot (if enabled)
- `frames/frame-*.png` — frame sequence for duplicate detection (if enabled)
- `suite-summary.json` — aggregate summary when running a suite

## Validation Verdicts

- **PASS** — all invariants satisfied, no scroll jumps, no DOM mutations during scroll, no flickers, no duplicate frames
- **FAIL** — one or more validators failed or runtime issues detected
- **TIMEOUT** — operation exceeded configured timeout
- **ERROR** — unhandled exception during test execution

## Extending

Add new validators in `validators.ts`. Add new generator configs in `generators.ts`. Add new Playwright specs by importing `runStressTest` from `harness.ts`.
