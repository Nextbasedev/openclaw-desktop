/**
 * Phase 8 — Standalone Node.js Stress Suite Runner
 *
 * Runs the full 10×45 varied stress suite without Playwright test framework.
 * Useful for CI, cron jobs, or quick validation via `npx tsx`.
 */

import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { generateSyntheticMessages, generate10x45Varied, type GeneratorOptions } from "./generators"
import { buildTestPageHtml } from "./page-builder"
import { runStressTest, runStressSuite } from "./harness"

const ARTIFACTS = join(process.cwd(), "test-results", "stress-suite-standalone")
mkdirSync(ARTIFACTS, { recursive: true })

const VARIATIONS: GeneratorOptions[] = [
  { messageCount: 45, toolDensity: 0.05, toolVariety: 3, toolPattern: "sequential", seed: 1 },
  { messageCount: 45, toolDensity: 0.1, toolVariety: 5, toolPattern: "interleaved", seed: 2 },
  { messageCount: 45, toolDensity: 0.2, toolVariety: 8, toolPattern: "burst", seed: 3 },
  { messageCount: 45, toolDensity: 0.15, toolVariety: 10, toolPattern: "random", seed: 4 },
  { messageCount: 45, toolDensity: 0.25, toolVariety: 6, toolPattern: "interleaved", includeReasoning: true, seed: 5 },
  { messageCount: 45, toolDensity: 0.1, toolVariety: 12, toolPattern: "sequential", includeContentBlocks: true, seed: 6 },
  { messageCount: 45, toolDensity: 0.18, toolVariety: 7, toolPattern: "burst", includeOptimisticUser: true, seed: 7 },
  { messageCount: 45, toolDensity: 0.12, toolVariety: 9, toolPattern: "random", includeReasoning: false, seed: 8 },
  { messageCount: 45, toolDensity: 0.3, toolVariety: 4, toolPattern: "interleaved", includeContentBlocks: false, seed: 9 },
  { messageCount: 45, toolDensity: 0.08, toolVariety: 15, toolPattern: "sequential", includeOptimisticUser: true, seed: 10 },
]

function buildVariationName(index: number, cfg: GeneratorOptions): string {
  return `v${index + 1}-n${cfg.messageCount}-d${cfg.toolDensity}-tv${cfg.toolVariety}-${cfg.toolPattern}`
}

async function main() {
  console.log("=== OpenClaw Desktop Stress Suite (Standalone) ===")
  console.log(`Variations: ${VARIATIONS.length}`)
  console.log(`Artifacts: ${ARTIFACTS}`)
  console.log("")

  const configs = VARIATIONS.map((cfg, i) => {
    const messages = generateSyntheticMessages(cfg)
    const name = buildVariationName(i, cfg)
    return {
      name,
      messages,
      outDir: join(ARTIFACTS, name),
      scrollDurationMs: 6000,
      scrollStepPx: 60,
      scrollIntervalMs: 16,
      headless: true,
      viewport: { width: 1280, height: 720 },
      timeoutMs: 45000,
      recordVideo: false,
      recordFrames: false,
      recordScreenshots: true,
    }
  })

  const results = await runStressSuite(configs, ARTIFACTS)

  console.log("\n=== Results ===")
  let passed = 0
  let failed = 0
  let timeouts = 0
  let errors = 0
  for (const r of results) {
    const icon = r.verdict === "PASS" ? "✅" : r.verdict === "FAIL" ? "❌" : r.verdict === "TIMEOUT" ? "⏱" : "💥"
    console.log(`${icon} ${r.name}: ${r.verdict} (${r.durationMs}ms)`)
    if (r.verdict === "PASS") passed++
    else if (r.verdict === "FAIL") failed++
    else if (r.verdict === "TIMEOUT") timeouts++
    else errors++
    if (r.error) console.log(`   Error: ${r.error}`)
    for (const v of r.validationResults || []) {
      if (!v.pass) console.log(`   Validator ${v.name}: ${v.issues.join("; ")}`)
    }
  }

  console.log("\n=== Summary ===")
  console.log(`Total: ${results.length}`)
  console.log(`Passed: ${passed}`)
  console.log(`Failed: ${failed}`)
  console.log(`Timeouts: ${timeouts}`)
  console.log(`Errors: ${errors}`)

  const exitCode = failed + timeouts + errors > 0 ? 1 : 0
  process.exit(exitCode)
}

main().catch((err) => {
  console.error("Unhandled error:", err)
  process.exit(1)
})
