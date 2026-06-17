#!/usr/bin/env node
/**
 * Refined T2 — measures anchor-jolt CORRECTLY across older-fetch + prepend + scroll-restore.
 *
 * Protocol per cycle:
 *   1. Scroll the container by -delta (jump toward top).
 *   2. Immediately capture the first-visible row's data-message-id + its rect.top.
 *      (This is the row the system's anchor-restore should track, because fetchOlderPage
 *       calls captureFirstVisibleRowAnchor right at the start.)
 *   3. Wait for /api/chat/messages?beforeSeq=... network response.
 *   4. Wait for React commit + layout settle.
 *   5. Re-measure that row's rect.top.
 *   6. jolt = |afterTop - beforeTop|. Should be ≤ 3px.
 */
import { createRequire } from "node:module"
import { mkdir, writeFile, appendFile } from "node:fs/promises"
import path from "node:path"

const require = createRequire(import.meta.url)
const { chromium } = require(
  "/root/.openclaw/workspace/webwright_runs/wetransfer_upload/node_modules/playwright",
)

const MIDDLEWARE = "http://127.0.0.1:8787"
const UI = "http://127.0.0.1:3000"
const SESSION_KEY = "agent:main:desktop:e2e-window-stabilize"
const PAGE_URL = `${UI}/e2e?openclawWindowMode=focused-chat&sessionKey=${encodeURIComponent(SESSION_KEY)}`

const RUN_TS = new Date().toISOString().replace(/[:.]/g, "-")
const ARTIFACT_ROOT = `/root/.openclaw/workspace/e2e-artifacts/openclaw-desktop/window-stabilization-2026-06-17/jolt_${RUN_TS}`
await mkdir(ARTIFACT_ROOT, { recursive: true })

const CHROME = "/root/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell"
const browser = await chromium.launch({
  headless: true,
  executablePath: CHROME,
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
})
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
await context.addInitScript((mw) => {
  try {
    localStorage.setItem("openclaw.middleware.url", mw)
    localStorage.setItem("openclaw.middleware.v2.url", mw)
  } catch (_) {}
}, MIDDLEWARE)

const page = await context.newPage()
const networkLog = []
page.on("response", (res) => {
  const u = res.url()
  if (u.includes("/api/chat/messages")) networkLog.push({ url: u, status: res.status(), ts: Date.now() })
})

await page.goto(PAGE_URL, { waitUntil: "load", timeout: 120_000 })
await page.waitForFunction(
  () => document.querySelectorAll('[data-chat-message-row="true"]').length > 0,
  { timeout: 60_000 },
)
await page.waitForTimeout(2000)

// Find the scroll container once
const scrollContainerHandle = await page.evaluateHandle(() => {
  const rowEl = document.querySelector('[data-chat-message-row="true"]')
  let el = rowEl?.parentElement
  while (el && el !== document.body) {
    const cs = getComputedStyle(el)
    if ((cs.overflowY === "auto" || cs.overflowY === "scroll") && el.scrollHeight > el.clientHeight) return el
    el = el.parentElement
  }
  return null
})

const measurements = []

async function captureFirstVisible() {
  return await page.evaluate(() => {
    const rows = document.querySelectorAll('[data-chat-message-row="true"]')
    for (const row of rows) {
      const rect = row.getBoundingClientRect()
      if (rect.bottom > 0 && rect.top < window.innerHeight) {
        return {
          id: row.getAttribute("data-message-id"),
          top: rect.top,
          height: rect.height,
        }
      }
    }
    return null
  })
}

async function rectTop(id) {
  return await page.evaluate((mid) => {
    if (!mid) return null
    const row = document.querySelector(`[data-chat-message-row="true"][data-message-id="${CSS.escape(mid)}"]`)
    return row ? row.getBoundingClientRect().top : null
  }, id)
}

async function getContainerInfo() {
  return await page.evaluate(() => {
    const rowEl = document.querySelector('[data-chat-message-row="true"]')
    let el = rowEl?.parentElement
    while (el && el !== document.body) {
      const cs = getComputedStyle(el)
      if ((cs.overflowY === "auto" || cs.overflowY === "scroll") && el.scrollHeight > el.clientHeight) {
        return {
          scrollTop: el.scrollTop,
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
          rowCount: document.querySelectorAll('[data-chat-message-row="true"]').length,
        }
      }
      el = el.parentElement
    }
    return null
  })
}

// Wait for a /api/chat/messages?beforeSeq response to fire
async function waitForOlderFetch(seen, timeoutMs = 8000) {
  return await new Promise((resolve) => {
    const start = Date.now()
    const handler = (res) => {
      const u = res.url()
      const m = u.match(/beforeSeq=(\d+)/)
      if (m) {
        const seq = Number(m[1])
        if (!seen.has(seq)) {
          seen.add(seq)
          page.off("response", handler)
          clearInterval(t)
          resolve({ seq, status: res.status() })
        }
      }
    }
    const t = setInterval(() => {
      if (Date.now() - start > timeoutMs) {
        page.off("response", handler)
        clearInterval(t)
        resolve(null)
      }
    }, 100)
    page.on("response", handler)
  })
}

const seenBeforeSeqs = new Set()

// Cycle: scroll-up to top in 5 rounds; on each round, perform anchor-jolt measurement
for (let cycle = 0; cycle < 5; cycle++) {
  // 1. Capture starting state
  const startInfo = await getContainerInfo()

  // 2. Scroll big jump toward top
  await page.evaluate(() => {
    const rowEl = document.querySelector('[data-chat-message-row="true"]')
    let el = rowEl?.parentElement
    while (el && el !== document.body) {
      const cs = getComputedStyle(el)
      if ((cs.overflowY === "auto" || cs.overflowY === "scroll") && el.scrollHeight > el.clientHeight) {
        // jump so that scrollTop=0 (forces rowsAboveViewport=0 → trigger fires)
        el.scrollTop = 0
        el.dispatchEvent(new Event("scroll", { bubbles: true }))
        return
      }
      el = el.parentElement
    }
  })

  // 3. Within a single microtask after scroll, capture the first-visible row.
  //    React's onScroll handler also fires synchronously here and calls
  //    fetchOlderPage → captureFirstVisibleRowAnchor with the same DOM state.
  const anchor = await captureFirstVisible()
  const midScrollInfo = await getContainerInfo()

  // 4. Wait for the older-fetch network response
  const fetched = await waitForOlderFetch(seenBeforeSeqs, 8000)

  // 5. Wait for layout-effect anchor-restore to run + React commit + paint
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  await page.waitForTimeout(400)

  // 6. Measure jolt
  const afterTop = anchor ? await rectTop(anchor.id) : null
  const afterInfo = await getContainerInfo()

  const jolt = anchor && afterTop !== null ? Math.abs(afterTop - anchor.top) : null

  await page.screenshot({ path: path.join(ARTIFACT_ROOT, `jolt_cycle_${cycle + 1}.png`) })

  measurements.push({
    cycle: cycle + 1,
    startInfo,
    midScrollInfo,
    afterInfo,
    anchorId: anchor?.id,
    anchorTopBefore: anchor?.top,
    anchorTopAfter: afterTop,
    jolt,
    fetched,
    networkResponses: networkLog.length,
  })

  console.log(`cycle ${cycle + 1}: anchor=${anchor?.id} top ${anchor?.top}→${afterTop} jolt=${jolt}px fetched=${JSON.stringify(fetched)} rows ${startInfo?.rowCount}→${afterInfo?.rowCount}`)

  // Small pause for refractory
  await page.waitForTimeout(1200)
}

// Now reverse: scroll back to bottom in 5 cycles
for (let cycle = 0; cycle < 5; cycle++) {
  const startInfo = await getContainerInfo()
  await page.evaluate(() => {
    const rowEl = document.querySelector('[data-chat-message-row="true"]')
    let el = rowEl?.parentElement
    while (el && el !== document.body) {
      const cs = getComputedStyle(el)
      if ((cs.overflowY === "auto" || cs.overflowY === "scroll") && el.scrollHeight > el.clientHeight) {
        el.scrollTop = el.scrollHeight - el.clientHeight
        el.dispatchEvent(new Event("scroll", { bubbles: true }))
        return
      }
      el = el.parentElement
    }
  })
  const anchor = await captureFirstVisible()
  const midInfo = await getContainerInfo()
  // newer-fetch may fire
  await page.waitForTimeout(800)
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  const afterTop = anchor ? await rectTop(anchor.id) : null
  const afterInfo = await getContainerInfo()
  const jolt = anchor && afterTop !== null ? Math.abs(afterTop - anchor.top) : null
  await page.screenshot({ path: path.join(ARTIFACT_ROOT, `jolt_down_cycle_${cycle + 1}.png`) })
  measurements.push({
    cycle: `down_${cycle + 1}`,
    startInfo,
    midInfo,
    afterInfo,
    anchorId: anchor?.id,
    anchorTopBefore: anchor?.top,
    anchorTopAfter: afterTop,
    jolt,
  })
  console.log(`down cycle ${cycle + 1}: anchor=${anchor?.id} top ${anchor?.top}→${afterTop} jolt=${jolt}px rows ${startInfo?.rowCount}→${afterInfo?.rowCount}`)
  await page.waitForTimeout(1200)
}

await writeFile(
  path.join(ARTIFACT_ROOT, "jolt-measurements.json"),
  JSON.stringify({ runTs: RUN_TS, sessionKey: SESSION_KEY, measurements, networkLog }, null, 2),
)

const olderJolts = measurements.filter((m) => typeof m.cycle === "number").map((m) => m.jolt).filter((j) => j !== null)
const maxJolt = olderJolts.length > 0 ? Math.max(...olderJolts) : null
const meanJolt = olderJolts.length > 0 ? olderJolts.reduce((a, b) => a + b, 0) / olderJolts.length : null

console.log(`\n=== JOLT SUMMARY ===`)
console.log(`up cycles: max=${maxJolt}px mean=${meanJolt?.toFixed(2)}px`)
console.log(`artifacts: ${ARTIFACT_ROOT}`)

await browser.close()
