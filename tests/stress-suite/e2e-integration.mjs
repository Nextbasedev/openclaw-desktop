/**
 * Phase 14 — End-to-End Integration Validator
 */

import { chromium } from "playwright"
import http from "node:http"
import fs from "node:fs"
import path from "node:path"
import { generateSyntheticMessages } from "./generators.ts"
import { buildTestPageHtml } from "./page-builder.ts"
import { buildInstrumentationScript } from "./instrumentation.ts"
import { runAllValidators } from "./validators.ts"
import { validateFrames } from "./frame-validator.ts"

const PORT = 9876
const OUT = path.join(process.cwd(), "test-results", "stress-suite-e2e")
fs.mkdirSync(OUT, { recursive: true })

async function startServer(html) {
  const server = http.createServer((req, res) => {
    if (req.url === "/" || req.url === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html" })
      res.end(html)
    } else {
      res.writeHead(404)
      res.end("Not found")
    }
  })
  await new Promise((resolve) => server.listen(PORT, "0.0.0.0", resolve))
  return server
}

async function main() {
  console.log("Phase 14 — E2E Integration Validator")

  // 1. Generate messages
  const messages = generateSyntheticMessages({
    messageCount: 45,
    toolDensity: 0.15,
    toolVariety: 8,
    toolPattern: "interleaved",
    includeReasoning: true,
    includeContentBlocks: true,
    seed: 42,
  })
  console.log(`Generated ${messages.length} messages`)

  // 2. Build test page
  const html = buildTestPageHtml({ title: "e2e-integration", messages })
  const server = await startServer(html)
  console.log(`Server running on http://localhost:${PORT}/`)

  // 3. Launch browser
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
  })
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } })
  const page = await context.newPage()

  try {
    // 4. Navigate
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: "networkidle" })
    await page.waitForSelector("#scroll-container", { timeout: 10000 })
    await page.waitForTimeout(500)
    console.log("Page loaded and container found")

    // 5. Inject instrumentation
    const instrumentScript = buildInstrumentationScript({ sampleIntervalMs: 80 })
    await page.evaluate(instrumentScript)
    const hasState = await page.evaluate(() => typeof (window as any).__AUDIT_STATE !== "undefined")
    if (!hasState) throw new Error("Instrumentation failed to initialize")
    console.log("Instrumentation injected successfully")

    // 6. Perform scroll
    const scrollResult = await page.evaluate(({ duration, step, interval }) => {
      return new Promise((resolve) => {
        const container = document.querySelector("#scroll-container")
        const start = performance.now()
        let totalDist = 0
        const tick = () => {
          const elapsed = performance.now() - start
          if (elapsed >= duration) {
            (window as any).__AUDIT_STOP?.()
            resolve({
              finalScrollTop: container.scrollTop,
              finalScrollHeight: container.scrollHeight,
              totalDistance: totalDist,
            })
            return
          }
          const prev = container.scrollTop
          container.scrollTop = Math.max(0, container.scrollTop - step)
          totalDist += Math.abs(container.scrollTop - prev)
          requestAnimationFrame(() => setTimeout(tick, interval))
        }
        container.scrollTop = container.scrollHeight
        tick()
      })
    }, { duration: 4000, step: 60, interval: 16 })

    await page.waitForTimeout(500)
    console.log(`Scroll complete: distance=${scrollResult.totalDistance}px`)

    // 7. Extract metrics
    const metrics = (await page.evaluate(() => (window as any).__AUDIT_STATE))
    console.log(`Metrics: jumps=${metrics.scrollJumps.length}, mutations=${metrics.domMutations.length}, visibleSamples=${metrics.visibleSamples.length}`)

    // 8. Count rendered rows
    const renderedRowCount = await page.evaluate(
      () => document.querySelectorAll("[data-vercel-chat-message-row='true']").length
    )
    console.log(`Rendered rows: ${renderedRowCount}`)

    // 9. Run validators
    const validations = runAllValidators(messages, renderedRowCount)
    console.log(`Validations: ${validations.length} checks`)
    for (const v of validations) {
      const icon = v.pass ? "✅" : "❌"
      console.log(`  ${icon} ${v.name}: ${v.issues.length} issues`)
    }

    // 10. Screenshot and frame capture
    const ssPath = path.join(OUT, "screenshot-final.png")
    await page.screenshot({ path: ssPath })

    const framesDir = path.join(OUT, "frames")
    fs.mkdirSync(framesDir, { recursive: true })
    for (let i = 0; i < 10; i++) {
      await page.screenshot({ path: path.join(framesDir, `frame-${String(i).padStart(4, "0")}.png`) })
    }

    // 11. Frame validation
    const frameResult = validateFrames({ framesDir, tinyFrameSizeThreshold: 5000 })
    console.log(`Frame validation: ${frameResult.pass ? "PASS" : "FAIL"} (duplicates=${frameResult.duplicateFrames.length}, tiny=${frameResult.tinyFrames.length})`)

    // 12. Final verdict
    const allPass = validations.every((v) => v.pass) && frameResult.pass && metrics.scrollJumps.length === 0
    const report = {
      phase: 14,
      name: "e2e-integration",
      messageCount: messages.length,
      renderedRowCount,
      scrollResult,
      metrics: {
        jumpCount: metrics.scrollJumps.length,
        mutationCount: metrics.domMutations.length,
        visibleSampleCount: metrics.visibleSamples.length,
      },
      validations: validations.map((v) => ({ name: v.name, pass: v.pass, issues: v.issues })),
      frameValidation: frameResult,
      verdict: allPass ? "PASS" : "FAIL",
      timestamp: new Date().toISOString(),
    }

    fs.writeFileSync(path.join(OUT, "e2e-report.json"), JSON.stringify(report, null, 2))
    console.log(`\nFinal verdict: ${report.verdict}`)
    console.log(`Report written to ${path.join(OUT, "e2e-report.json")}`)

    process.exit(allPass ? 0 : 1)
  } catch (err) {
    console.error("E2E validation failed:", err instanceof Error ? err.message : String(err))
    process.exit(1)
  } finally {
    await page.close()
    await context.close()
    await browser.close()
    server.close()
  }
}

main().catch((err) => {
  console.error("Unhandled error:", err)
  process.exit(1)
})
