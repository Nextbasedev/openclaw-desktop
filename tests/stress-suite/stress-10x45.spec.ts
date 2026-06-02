/**
 * Phase 7 — Parameterized Playwright Spec: 10×45 Varied Stress Test
 *
 * Reusable Playwright test that iterates over 10 configuration variations
 * of 45 messages each, covering diverse tool densities, patterns, and attributes.
 */

import { test, expect } from "playwright/test"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { generateSyntheticMessages, generate10x45Varied, type GeneratorOptions } from "./generators"
import { buildTestPageHtml } from "./page-builder"
import { buildInstrumentationScript, analyzeMetrics, type ScrollMetrics } from "./instrumentation"
import { runAllValidators } from "./validators"

const ARTIFACTS = join(process.cwd(), "test-results", "stress-suite-10x45")
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

test.describe("Stress Suite — 10×45 Varied", () => {
  for (let i = 0; i < VARIATIONS.length; i++) {
    const cfg = VARIATIONS[i]
    const name = buildVariationName(i, cfg)

    test(name, async ({ page }) => {
      const messages = generateSyntheticMessages(cfg)
      const html = buildTestPageHtml({ title: name, messages })
      const pagePath = join(ARTIFACTS, `${name}.html`)
      writeFileSync(pagePath, html)

      await page.goto(`file://${pagePath}`)
      await page.waitForSelector("#scroll-container", { timeout: 10000 })
      await page.waitForTimeout(500)

      // Inject instrumentation
      await page.evaluate(buildInstrumentationScript({ sampleIntervalMs: 80 }))

      // Wait for init
      await page.waitForFunction(() => typeof (window as any).__AUDIT_STATE !== "undefined", { timeout: 5000 })

      // Scroll from bottom to top
      const scrollResult = await page.evaluate(({ duration, step, interval }) => {
        return new Promise<{ finalScrollTop: number; finalScrollHeight: number; totalDistance: number }>((resolve) => {
          const container = document.querySelector("#scroll-container") as HTMLElement
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
      }, { duration: 6000, step: 60, interval: 16 })

      await page.waitForTimeout(500)

      // Extract metrics
      const metrics = (await page.evaluate(() => (window as any).__AUDIT_STATE)) as ScrollMetrics

      // Analyze flickers
      const flickers = await page.evaluate(() => {
        const samples = (window as any).__AUDIT_STATE.visibleSamples as Array<{ ids: string[] }>
        if (!samples || samples.length === 0) return { flickerCount: 0, flickers: [] }
        const lastSeen = new Map<string, number>()
        for (let i = 0; i < samples.length; i++) {
          for (const id of samples[i].ids) lastSeen.set(id, i)
        }
        const flickers: Array<{ id: string; gapCount: number }> = []
        for (const [id, lastIdx] of lastSeen.entries()) {
          let firstIdx = -1
          for (let i = 0; i < samples.length; i++) {
            if (samples[i].ids.includes(id)) { firstIdx = i; break }
          }
          if (firstIdx >= 0 && lastIdx > firstIdx) {
            let gapCount = 0
            for (let i = firstIdx; i <= lastIdx; i++) {
              if (!samples[i].ids.includes(id)) gapCount++
            }
            if (gapCount > 0) flickers.push({ id, gapCount })
          }
        }
        return { flickerCount: flickers.length, flickers: flickers.slice(0, 10) }
      })

      metrics.idFlickers = flickers.flickers

      const renderedRowCount = await page.evaluate(
        () => document.querySelectorAll("[data-vercel-chat-message-row='true']").length
      )

      const analysis = analyzeMetrics(metrics)
      const validations = runAllValidators(messages, renderedRowCount)

      // Save per-variation report
      const report = {
        name,
        config: cfg,
        messageCount: messages.length,
        toolCount: messages.filter((m) => m.toolCalls?.length).length,
        scrollResult,
        metricsAnalysis: analysis,
        validations,
        renderedRowCount,
        timestamp: new Date().toISOString(),
      }
      writeFileSync(join(ARTIFACTS, `${name}-report.json`), JSON.stringify(report, null, 2))

      // Assertions
      expect(scrollResult.totalDistance).toBeGreaterThan(0)
      expect(renderedRowCount).toBeGreaterThan(0)
      expect(analysis.jumpCount).toBe(0)
      expect(analysis.mutationCount).toBe(0)
      expect(flickers.flickerCount).toBe(0)

      for (const v of validations) {
        expect(v.pass, `${v.name}: ${v.issues.join(", ")}`).toBe(true)
      }
    })
  }

  test("suite summary generation", async () => {
    // After all variations, generate a summary if reports exist
    const fs = await import("node:fs")
    const files = fs.readdirSync(ARTIFACTS).filter((f) => f.endsWith("-report.json"))
    const reports = files.map((f) => JSON.parse(fs.readFileSync(join(ARTIFACTS, f), "utf-8")))
    const summary = {
      totalVariations: VARIATIONS.length,
      executed: reports.length,
      allPassed: reports.every((r) => r.validations.every((v: any) => v.pass)),
      variations: reports.map((r) => ({
        name: r.name,
        messages: r.messageCount,
        tools: r.toolCount,
        jumps: r.metricsAnalysis.jumpCount,
        mutations: r.metricsAnalysis.mutationCount,
        flickers: r.metricsAnalysis.flickerCount,
        renderedRows: r.renderedRowCount,
      })),
    }
    writeFileSync(join(ARTIFACTS, "suite-summary.json"), JSON.stringify(summary, null, 2))
    expect(summary.allPassed).toBe(true)
  })
})
