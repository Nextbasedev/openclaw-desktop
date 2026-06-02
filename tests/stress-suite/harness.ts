/**
 * Phase 6 — Composite Stress Test Runner Harness
 *
 * Executes stress tests with configurable timeout, abort signal support,
 * artifact collection, and report generation.
 */

import { chromium, type Browser, type BrowserContext, type Page } from "playwright"
import { mkdirSync, writeFileSync, readdirSync, statSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import crypto from "node:crypto"
import type { SyntheticMessage } from "./generators"
import { buildTestPageHtml } from "./page-builder"
import { buildInstrumentationScript, analyzeMetrics, type ScrollMetrics } from "./instrumentation"
import { runAllValidators, type ValidationResult } from "./validators"

export type StressRunConfig = {
  name: string
  messages: SyntheticMessage[]
  outDir: string
  url?: string
  scrollDurationMs?: number
  scrollStepPx?: number
  scrollIntervalMs?: number
  headless?: boolean
  viewport?: { width: number; height: number }
  timeoutMs?: number
  recordVideo?: boolean
  recordFrames?: boolean
  recordScreenshots?: boolean
}

export type StressRunReport = {
  name: string
  timestamp: string
  config: Omit<StressRunConfig, "messages">
  messageCount: number
  toolCount: number
  validationResults: ValidationResult[]
  metrics?: ScrollMetrics & { analysis: ReturnType<typeof analyzeMetrics> }
  frameCount?: number
  duplicateFrames?: number[]
  tinyFrames?: Array<{ index: number; size: number }>
  videoPath?: string | null
  screenshotPaths?: string[]
  verdict: "PASS" | "FAIL" | "TIMEOUT" | "ERROR"
  error?: string
  durationMs: number
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    const result = await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener("abort", () => reject(new Error(`Timeout: ${label} after ${ms}ms`)))
      }),
    ])
    return result
  } finally {
    clearTimeout(timer)
  }
}

export async function runStressTest(config: StressRunConfig): Promise<StressRunReport> {
  const startTime = Date.now()
  const outDir = resolve(config.outDir)
  const framesDir = join(outDir, "frames")
  const screenshotsDir = join(outDir, "screenshots")
  mkdirSync(outDir, { recursive: true })
  if (config.recordFrames) mkdirSync(framesDir, { recursive: true })
  if (config.recordScreenshots) mkdirSync(screenshotsDir, { recursive: true })

  let browser: Browser | null = null
  let context: BrowserContext | null = null
  let page: Page | null = null

  try {
    browser = await chromium.launch({
      headless: config.headless ?? true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
    })

    context = await browser.newContext({
      viewport: config.viewport ?? { width: 1280, height: 720 },
      recordVideo: config.recordVideo ? { dir: outDir, size: { width: 1280, height: 720 } } : undefined,
    })

    page = await context.newPage()

    // Build test page
    const testPageHtml = buildTestPageHtml({
      title: config.name,
      messages: config.messages,
    })
    const testPagePath = join(outDir, "test-page.html")
    writeFileSync(testPagePath, testPageHtml)

    // Navigate
    const navTimeout = config.timeoutMs ?? 60000
    await withTimeout(
      page.goto(`file://${testPagePath}`, { waitUntil: "networkidle" }),
      navTimeout,
      "navigation"
    )
    await withTimeout(
      page.waitForSelector("#scroll-container", { timeout: 10000 }),
      navTimeout,
      "container-wait"
    )
    await page.waitForTimeout(500)

    // Inject instrumentation
    const instrumentScript = buildInstrumentationScript({
      sampleIntervalMs: config.scrollIntervalMs ?? 100,
    })
    await page.evaluate(instrumentScript)

    // Wait for instrumentation to initialize
    const hasState = await page.evaluate(() => typeof (window as any).__AUDIT_STATE !== "undefined")
    if (!hasState) {
      const err = (await page.evaluate(() => (window as any).__AUDIT_ERROR)) || " instrumentation failed"
      throw new Error(err)
    }

    // Perform scroll
    const scrollDuration = config.scrollDurationMs ?? 8000
    const scrollStep = config.scrollStepPx ?? 60
    const scrollInterval = config.scrollIntervalMs ?? 16

    await withTimeout(
      page.evaluate(
        ({ duration, step, interval }) => {
          return new Promise<void>((resolve) => {
            const container = (window as any).__AUDIT_CONTAINER ||
              document.querySelector("#scroll-container")
            if (!container) {
              resolve()
              return
            }
            const start = performance.now()
            let totalDist = 0
            const tick = () => {
              const elapsed = performance.now() - start
              if (elapsed >= duration) {
                ;(window as any).__AUDIT_STOP?.()
                resolve()
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
        },
        { duration: scrollDuration, step: scrollStep, interval: scrollInterval }
      ),
      config.timeoutMs ?? scrollDuration + 10000,
      "scroll"
    )

    // Wait a beat for metrics to settle
    await page.waitForTimeout(500)

    // Extract metrics
    const metrics = (await page.evaluate(() => (window as any).__AUDIT_STATE)) as ScrollMetrics

    // Analyze id flickers
    if (metrics.visibleSamples.length > 0) {
      const lastSeen = new Map<string, number>()
      for (let i = 0; i < metrics.visibleSamples.length; i++) {
        for (const id of metrics.visibleSamples[i].ids) lastSeen.set(id, i)
      }
      const flickers: Array<{ id: string; gapCount: number }> = []
      for (const [id, lastIdx] of lastSeen.entries()) {
        let firstIdx = -1
        for (let i = 0; i < metrics.visibleSamples.length; i++) {
          if (metrics.visibleSamples[i].ids.includes(id)) {
            firstIdx = i
            break
          }
        }
        if (firstIdx >= 0 && lastIdx > firstIdx) {
          let gapCount = 0
          for (let i = firstIdx; i <= lastIdx; i++) {
            if (!metrics.visibleSamples[i].ids.includes(id)) gapCount++
          }
          if (gapCount > 0) flickers.push({ id, gapCount })
        }
      }
      metrics.idFlickers = flickers
    }

    // Capture frames/screenshots
    let frameCount = 0
    let screenshotPaths: string[] = []
    if (config.recordFrames) {
      const frameMetrics = await page.evaluate(() => (window as any).__AUDIT_STATE?.frameSamples || [])
      for (let i = 0; i < Math.min(frameMetrics.length, 200); i++) {
        const path = join(framesDir, `frame-${String(i).padStart(4, "0")}.png`)
        await page.screenshot({ path })
        frameCount++
      }
    }

    if (config.recordScreenshots) {
      const ssPath = join(screenshotsDir, `screenshot-final.png`)
      await page.screenshot({ path: ssPath })
      screenshotPaths.push(ssPath)
    }

    // Hash frames for duplicate detection
    let duplicateFrames: number[] = []
    let tinyFrames: Array<{ index: number; size: number }> = []
    if (config.recordFrames && frameCount > 0) {
      const frameFiles = readdirSync(framesDir)
        .filter((f) => f.endsWith(".png"))
        .sort()
      const hashes: string[] = []
      for (const f of frameFiles) {
        const buf = readFileSync(join(framesDir, f))
        hashes.push(crypto.createHash("sha256").update(buf).digest("hex"))
      }
      for (let i = 1; i < hashes.length; i++) {
        if (hashes[i] === hashes[i - 1]) duplicateFrames.push(i)
      }
      for (let i = 0; i < frameFiles.length; i++) {
        const s = statSync(join(framesDir, frameFiles[i]))
        if (s.size < 5000) tinyFrames.push({ index: i, size: s.size })
      }
    }

    // Count rendered rows
    const renderedRowCount = await page.evaluate(
      (sel) => document.querySelectorAll(sel).length,
      "[data-vercel-chat-message-row='true']"
    )

    // Run validators
    const validationResults = runAllValidators(config.messages, renderedRowCount)

    // Video path
    let videoPath: string | null = null
    if (config.recordVideo && page.video) {
      const vp = await page.video()?.path()
      videoPath = vp || null
    }

    const analysis = analyzeMetrics(metrics)
    const allIssues = [...analysis.issues, ...validationResults.flatMap((v) => v.issues)]

    const durationMs = Date.now() - startTime
    const report: StressRunReport = {
      name: config.name,
      timestamp: new Date().toISOString(),
      config: { ...config, messages: undefined as any },
      messageCount: config.messages.length,
      toolCount: config.messages.filter((m) => m.toolCalls && m.toolCalls.length > 0).length,
      validationResults,
      metrics: { ...metrics, analysis },
      frameCount,
      duplicateFrames,
      tinyFrames,
      videoPath,
      screenshotPaths,
      verdict: allIssues.length === 0 ? "PASS" : "FAIL",
      durationMs,
    }

    writeFileSync(join(outDir, "stress-report.json"), JSON.stringify(report, null, 2))
    return report
  } catch (error) {
    const durationMs = Date.now() - startTime
    const report: StressRunReport = {
      name: config.name,
      timestamp: new Date().toISOString(),
      config: { ...config, messages: undefined as any },
      messageCount: config.messages.length,
      toolCount: config.messages.filter((m) => m.toolCalls && m.toolCalls.length > 0).length,
      validationResults: [],
      verdict: error instanceof Error && error.message.startsWith("Timeout") ? "TIMEOUT" : "ERROR",
      error: error instanceof Error ? error.message : String(error),
      durationMs,
    }
    writeFileSync(join(outDir, "stress-report.json"), JSON.stringify(report, null, 2))
    return report
  } finally {
    await page?.close()
    await context?.close()
    await browser?.close()
  }
}

export async function runStressSuite(
  runs: StressRunConfig[],
  suiteOutDir: string
): Promise<StressRunReport[]> {
  mkdirSync(suiteOutDir, { recursive: true })
  const results: StressRunReport[] = []
  for (const run of runs) {
    const result = await runStressTest({ ...run, outDir: join(suiteOutDir, run.name) })
    results.push(result)
  }
  const summary = {
    total: results.length,
    passed: results.filter((r) => r.verdict === "PASS").length,
    failed: results.filter((r) => r.verdict === "FAIL").length,
    timeouts: results.filter((r) => r.verdict === "TIMEOUT").length,
    errors: results.filter((r) => r.verdict === "ERROR").length,
    runs: results.map((r) => ({ name: r.name, verdict: r.verdict, durationMs: r.durationMs })),
  }
  writeFileSync(join(suiteOutDir, "suite-summary.json"), JSON.stringify(summary, null, 2))
  return results
}
