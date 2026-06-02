/**
 * Phase 9 — Real WebUI Stress Audit (similar to existing real-webui-* scripts)
 *
 * Connects to a running OpenClaw Desktop instance and performs
 * parameterized stress validation on the actual chat UI.
 */

import { chromium } from "playwright"
import { mkdirSync, writeFileSync, readdirSync, statSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import crypto from "node:crypto"

const OUT = resolve("test-results/real-webui-stress-suite")
const FRAMES = join(OUT, "frames")
mkdirSync(FRAMES, { recursive: true })

const url = process.env.AUDIT_URL || "http://127.0.0.1:3000/"
const sessionKey = process.env.AUDIT_SESSION_KEY || "agent:main:desktop:default"

async function main() {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: OUT, size: { width: 1280, height: 720 } },
  })
  const page = await context.newPage()

  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 })

  // Wait for real chat rows
  await page.waitForSelector('[data-vercel-chat-message-row="true"]', { timeout: 30000 })
  await page.waitForTimeout(750)

  // Inject stress instrumentation
  await page.evaluate(() => {
    const container = Array.from(document.querySelectorAll("*")).find((el) => {
      if (!(el instanceof HTMLElement)) return false
      const style = getComputedStyle(el)
      return style.overflowY === "auto" && el.scrollHeight > el.clientHeight && el.clientHeight > 100
    }) as HTMLElement | undefined

    if (!container) throw new Error("scroll container not found")

    const state = {
      scrollPositions: [],
      visibleSamples: [],
      jumpCount: 0,
      jumps: [],
      domRemovals: 0,
      domRemounts: 0,
      domMutations: 0,
      frameSamples: [],
      rowCountStart: 0,
      rowCountEnd: 0,
      firstVisibleId: null as string | null,
      lastVisibleId: null as string | null,
    }

    const observer = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === "childList") {
          if (r.addedNodes.length) state.domRemounts += r.addedNodes.length
          if (r.removedNodes.length) state.domRemovals += r.removedNodes.length
        }
        if (r.type === "attributes") state.domMutations++
      }
    })
    observer.observe(container, { childList: true, subtree: true, attributes: true })

    let lastScrollTop = container.scrollTop
    let setupPhase = true

    function sample(label: string) {
      const st = container.scrollTop
      const delta = st - lastScrollTop
      if (!setupPhase && Math.abs(delta) > 900) {
        state.jumpCount++
        state.jumps.push({ from: lastScrollTop, to: st, delta, label })
      }
      state.scrollPositions.push({ scrollTop: st, scrollHeight: container.scrollHeight, clientHeight: container.clientHeight, label })
      lastScrollTop = st
    }

    function sampleVisible() {
      const rows = Array.from(container.querySelectorAll<HTMLElement>('[data-vercel-chat-message-row="true"]'))
      const visible = rows.filter((r) => {
        const rect = r.getBoundingClientRect()
        return rect.bottom > 0 && rect.top < window.innerHeight
      })
      const ids = visible.map((r) => r.getAttribute("data-message-id") || r.getAttribute("data-ui-id") || "")
      state.visibleSamples.push({
        first: ids[0] || null,
        last: ids[ids.length - 1] || null,
        count: ids.length,
      })
      state.firstVisibleId = ids[0] || null
      state.lastVisibleId = ids[ids.length - 1] || null
    }

    // Setup
    sample("setup-initial")
    container.scrollTop = container.scrollHeight
    lastScrollTop = container.scrollTop
    sample("setup-bottom")
    setupPhase = false

    // Scroll up then down
    for (let i = 0; i < 120; i++) {
      container.scrollTop = Math.max(0, container.scrollTop - 90)
      sample("scroll-up")
    }
    for (let i = 0; i < 120; i++) {
      container.scrollTop = Math.min(container.scrollHeight, container.scrollTop + 90)
      sample("scroll-down")
    }

    observer.disconnect()

    const rows = Array.from(container.querySelectorAll('[data-vercel-chat-message-row="true"]'))
    state.rowCountEnd = rows.length
    state.rowCountStart = rows.length

    // High-frequency frame sampling for 3s
    let frameIdx = 0
    const frameTimer = setInterval(() => {
      const rows = Array.from(container.querySelectorAll<HTMLElement>('[data-vercel-chat-message-row="true"]'))
      const visible = rows.filter((r) => {
        const rect = r.getBoundingClientRect()
        return rect.bottom > 0 && rect.top < window.innerHeight
      })
      state.frameSamples.push({
        index: frameIdx,
        scrollTop: container.scrollTop,
        scrollHeight: container.scrollHeight,
        rowCount: rows.length,
        visibleFirstId: visible[0]?.getAttribute("data-message-id") || null,
        visibleLastId: visible[visible.length - 1]?.getAttribute("data-message-id") || null,
      })
      frameIdx++
    }, 16)

    window.__AUDIT_STOP_FRAMES = () => clearInterval(frameTimer)
    window.__AUDIT_STATE = state
    window.__AUDIT_CONTAINER = container
  })

  // Wait for frame sampling
  await page.waitForTimeout(3000)
  await page.evaluate(() => (window as any).__AUDIT_STOP_FRAMES?.())

  const metrics = (await page.evaluate(() => (window as any).__AUDIT_STATE)) as any

  // Capture screenshots for duplicate detection
  const frameFiles: string[] = []
  for (let i = 0; i < Math.min(metrics.frameSamples.length, 100); i++) {
    const path = join(FRAMES, `frame-${String(i).padStart(4, "0")}.png`)
    await page.screenshot({ path })
    frameFiles.push(path)
  }

  // Hash frames
  const hashes: string[] = []
  for (const f of frameFiles) {
    const buf = readFileSync(f)
    hashes.push(crypto.createHash("sha256").update(buf).digest("hex"))
  }

  const duplicates: number[] = []
  for (let i = 1; i < hashes.length; i++) {
    if (hashes[i] === hashes[i - 1]) duplicates.push(i)
  }

  const tinyFrames: Array<{ index: number; size: number }> = []
  for (let i = 0; i < frameFiles.length; i++) {
    const s = statSync(frameFiles[i])
    if (s.size < 5000) tinyFrames.push({ index: i, size: s.size })
  }

  const videoFiles = readdirSync(OUT).filter((f) => f.endsWith(".webm"))
  const videoPath = videoFiles.length > 0 ? join(OUT, videoFiles[0]) : null

  // Row count check
  const rowCount = metrics.rowCountEnd
  const userRows = await page.evaluate(
    () => document.querySelectorAll('[data-vercel-chat-message-row="true"][data-role="user"]').length
  )
  const assistantRows = await page.evaluate(
    () => document.querySelectorAll('[data-vercel-chat-message-row="true"][data-role="assistant"]').length
  )

  const report = {
    repo: "/root/.openclaw/workspace/openclaw-desktop",
    url,
    sessionKey,
    component: "packages/ui/components/ChatView/vercel-ui/OpenClawVercelChat.tsx",
    rowCount,
    userRows,
    assistantRows,
    frameCount: frameFiles.length,
    duplicateFrames: duplicates,
    tinyFrames,
    videoPath,
    metrics: {
      scrollPositions: metrics.scrollPositions,
      visibleSamples: metrics.visibleSamples,
      jumpCount: metrics.jumpCount,
      jumps: metrics.jumps,
      domRemovals: metrics.domRemovals,
      domRemounts: metrics.domRemounts,
      domMutations: metrics.domMutations,
      rowCountStart: metrics.rowCountStart,
      rowCountEnd: metrics.rowCountEnd,
      frameSamples: metrics.frameSamples,
    },
    verdict: metrics.jumpCount === 0 && duplicates.length === 0 && tinyFrames.length === 0 ? "PASS" : "ISSUE_FOUND",
  }

  writeFileSync(join(OUT, "stress-audit-report.json"), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))

  await page.close()
  await context.close()
  await browser.close()
}

main().catch((err) => {
  console.error("AUDIT FAILED:", err.message)
  process.exit(1)
})
