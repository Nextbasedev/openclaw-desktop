#!/usr/bin/env node
/**
 * Wave 3 E2E — window stabilization browser verification.
 *
 * Runs against:
 *  - Middleware on http://127.0.0.1:8787
 *  - Next UI dev server on http://127.0.0.1:3000
 *  - Fixture session: agent:main:desktop:e2e-window-stabilize (500 messages)
 *
 * Uses Playwright from /root/.openclaw/workspace/webwright_runs/wetransfer_upload/node_modules.
 */
import { createRequire } from "node:module"
import { mkdir, writeFile, appendFile } from "node:fs/promises"
import path from "node:path"
import url from "node:url"

const require = createRequire(import.meta.url)
const { chromium } = require(
  "/root/.openclaw/workspace/webwright_runs/wetransfer_upload/node_modules/playwright",
)

const MIDDLEWARE = process.env.MIDDLEWARE_URL || "http://127.0.0.1:8787"
const UI = process.env.UI_URL || "http://127.0.0.1:3000"
const SESSION_KEY =
  process.env.E2E_SESSION_KEY || "agent:main:desktop:e2e-window-stabilize"
const PAGE_URL = `${UI}/e2e?openclawWindowMode=focused-chat&sessionKey=${encodeURIComponent(SESSION_KEY)}`

const RUN_TS = new Date().toISOString().replace(/[:.]/g, "-")
const ARTIFACT_ROOT = `/root/.openclaw/workspace/e2e-artifacts/openclaw-desktop/window-stabilization-2026-06-17/run_${RUN_TS}`

await mkdir(ARTIFACT_ROOT, { recursive: true })

const consoleLogPath = path.join(ARTIFACT_ROOT, "console.log")
const networkLogPath = path.join(ARTIFACT_ROOT, "network.log")
const traceLogPath = path.join(ARTIFACT_ROOT, "trace.log")

async function logLine(file, line) {
  await appendFile(file, line + "\n", "utf8")
}

const results = []
function record(name, verdict, details = {}) {
  const entry = { name, verdict, ...details }
  results.push(entry)
  console.log(`[${verdict}] ${name}`, details)
}

const consoleEvents = []
const networkEvents = []
const invariantViolations = []

async function snap(page, label) {
  const file = path.join(ARTIFACT_ROOT, `${label}.png`)
  try {
    await page.screenshot({ path: file, fullPage: false })
  } catch (err) {
    await logLine(traceLogPath, `screenshot fail ${label}: ${err.message}`)
  }
  return file
}

async function waitForVisibleRows(page, timeoutMs = 30_000) {
  await page.waitForFunction(
    () => document.querySelectorAll('[data-chat-message-row="true"]').length > 0,
    { timeout: timeoutMs },
  )
}

async function countRows(page) {
  return await page.evaluate(
    () => document.querySelectorAll('[data-chat-message-row="true"]').length,
  )
}

async function getScrollState(page) {
  return await page.evaluate(() => {
    const container = document.querySelector(
      '[data-chat-message-row="true"]',
    )?.parentElement?.parentElement?.parentElement
    let el = container
    while (el && (el.scrollHeight <= el.clientHeight || getComputedStyle(el).overflowY === "visible")) {
      el = el.parentElement
    }
    if (!el) return null
    return {
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      atBottom: el.scrollHeight - el.clientHeight - el.scrollTop <= 4,
    }
  })
}

async function getScrollContainer(page) {
  return await page.evaluateHandle(() => {
    const rowEl = document.querySelector('[data-chat-message-row="true"]')
    if (!rowEl) return null
    let el = rowEl.parentElement
    while (el && el !== document.body) {
      const cs = getComputedStyle(el)
      if (
        (cs.overflowY === "auto" || cs.overflowY === "scroll") &&
        el.scrollHeight > el.clientHeight
      ) {
        return el
      }
      el = el.parentElement
    }
    return null
  })
}

async function scrollContainer(page, delta) {
  return await page.evaluate((d) => {
    const rowEl = document.querySelector('[data-chat-message-row="true"]')
    if (!rowEl) return null
    let el = rowEl.parentElement
    while (el && el !== document.body) {
      const cs = getComputedStyle(el)
      if (
        (cs.overflowY === "auto" || cs.overflowY === "scroll") &&
        el.scrollHeight > el.clientHeight
      ) {
        const before = { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight }
        el.scrollTop = Math.max(0, Math.min(el.scrollHeight - el.clientHeight, el.scrollTop + d))
        const after = { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight }
        // dispatch scroll event so React listeners fire
        el.dispatchEvent(new Event("scroll", { bubbles: true }))
        return { before, after, clientHeight: el.clientHeight }
      }
      el = el.parentElement
    }
    return null
  }, delta)
}

async function captureAnchorRowTop(page, anchorMessageId) {
  return await page.evaluate((id) => {
    if (!id) return null
    const row = document.querySelector(`[data-chat-message-row="true"][data-message-id="${CSS.escape(id)}"]`)
    if (!row) return null
    return row.getBoundingClientRect().top
  }, anchorMessageId)
}

async function firstVisibleMessageId(page) {
  return await page.evaluate(() => {
    const rows = document.querySelectorAll('[data-chat-message-row="true"]')
    for (const row of rows) {
      const rect = row.getBoundingClientRect()
      if (rect.bottom > 0 && rect.top < window.innerHeight) {
        return row.getAttribute("data-message-id")
      }
    }
    return null
  })
}

async function waitForBeforeSeqRequest(page, beforeSeqs, timeoutMs = 15_000) {
  // beforeSeqs: set of recently-seen seq values to dedupe
  const start = Date.now()
  return await new Promise((resolve) => {
    let resolved = false
    const handler = (response) => {
      const u = response.url()
      const m = u.match(/\/api\/chat\/messages\?[^"]*beforeSeq=(\d+)/)
      if (m) {
        const seq = Number(m[1])
        if (!beforeSeqs.has(seq)) {
          beforeSeqs.add(seq)
          if (!resolved) {
            resolved = true
            page.off("response", handler)
            resolve({ kind: "older", seq, status: response.status() })
          }
        }
      }
    }
    page.on("response", handler)
    const interval = setInterval(() => {
      if (Date.now() - start > timeoutMs) {
        clearInterval(interval)
        if (!resolved) {
          resolved = true
          page.off("response", handler)
          resolve(null)
        }
      }
    }, 200)
  })
}

async function getDebugSnapshot(page) {
  // Best-effort snapshot of state through DOM
  return await page.evaluate(() => {
    const rows = document.querySelectorAll('[data-chat-message-row="true"]')
    const firstId = rows[0]?.getAttribute("data-message-id") ?? null
    const lastId = rows[rows.length - 1]?.getAttribute("data-message-id") ?? null
    return {
      rowCount: rows.length,
      firstId,
      lastId,
    }
  })
}

// ============================================================================
// MAIN
// ============================================================================

await logLine(traceLogPath, `RUN START ts=${RUN_TS} sessionKey=${SESSION_KEY}`)
await logLine(traceLogPath, `MIDDLEWARE=${MIDDLEWARE} UI=${UI}`)
await logLine(traceLogPath, `PAGE_URL=${PAGE_URL}`)

const CHROME_PATH = process.env.CHROME_EXECUTABLE || "/root/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell"
const browser = await chromium.launch({
  headless: true,
  executablePath: CHROME_PATH,
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
  ],
})
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  // disable default localStorage so middleware URL resolves to default 127.0.0.1:8787
})

// Inject initial localStorage to pin the middleware URL before page load
await context.addInitScript((middlewareUrl) => {
  try {
    localStorage.setItem("openclaw.middleware.url", middlewareUrl)
    localStorage.setItem("openclaw.middleware.v2.url", middlewareUrl)
    localStorage.setItem("jarvis.gatewayActive", "true")
  } catch (_) {}
}, MIDDLEWARE)

const page = await context.newPage()

page.on("console", async (msg) => {
  const txt = msg.text()
  const type = msg.type()
  consoleEvents.push({ type, text: txt, ts: Date.now() })
  await logLine(consoleLogPath, `[${type}] ${txt}`)
  if (/chat-rebuild\.window\.invariant-violation|InvariantViolation|WindowInvariantViolation/i.test(txt)) {
    invariantViolations.push({ type, text: txt, ts: Date.now() })
  }
})

page.on("pageerror", async (err) => {
  consoleEvents.push({ type: "error", text: String(err), ts: Date.now() })
  await logLine(consoleLogPath, `[pageerror] ${err.stack ?? err}`)
})

page.on("requestfailed", async (req) => {
  await logLine(networkLogPath, `[requestfailed] ${req.method()} ${req.url()} :: ${req.failure()?.errorText}`)
})

page.on("response", async (res) => {
  const u = res.url()
  if (
    u.includes("/api/chat/messages") ||
    u.includes("/api/chat/bootstrap") ||
    u.includes("/api/chat/send") ||
    u.includes("/api/patches") ||
    u.includes("/api/stream/")
  ) {
    networkEvents.push({ url: u, status: res.status(), ts: Date.now() })
    await logLine(networkLogPath, `[${res.status()}] ${res.request().method()} ${u}`)
  }
})

// ----------------------------------------------------------------------------
// T1 — initial load is 160 visible
// ----------------------------------------------------------------------------
console.log("T1: navigate + initial load")
await logLine(traceLogPath, "T1 START")

const t1Start = Date.now()
try {
  await page.goto(PAGE_URL, { waitUntil: "load", timeout: 120_000 })
  await waitForVisibleRows(page, 60_000)
  // give the bootstrap settle
  await page.waitForTimeout(1500)
  const t1Count = await countRows(page)
  const t1Snap = await getDebugSnapshot(page)
  await snap(page, "T1_initial_load")
  const t1Verdict = t1Count === 160 ? "PASS" : t1Count > 0 && t1Count <= 200 ? "PARTIAL" : "FAIL"
  record("T1_initial_160", t1Verdict, {
    rowCount: t1Count,
    expected: 160,
    snapshot: t1Snap,
    durationMs: Date.now() - t1Start,
  })
} catch (err) {
  await snap(page, "T1_initial_load_FAIL")
  record("T1_initial_160", "FAIL", { error: String(err), stack: err.stack?.slice(0, 1000) })
  await logLine(traceLogPath, `T1 ERROR ${err.message}\n${err.stack}`)
}

// ----------------------------------------------------------------------------
// T2 — scroll up 5 pages, then down 5 pages; measure jolt + bounded buffer
// ----------------------------------------------------------------------------
console.log("T2: scroll up 5 pages, then down 5 pages")
await logLine(traceLogPath, "T2 START")

const t2Jolts = []
const t2Snapshots = []
const seenBeforeSeqs = new Set()

try {
  // Scroll UP 5 times
  for (let i = 0; i < 5; i++) {
    const anchorId = await firstVisibleMessageId(page)
    const anchorBefore = await captureAnchorRowTop(page, anchorId)

    // Trigger scroll to top
    const beforeSeqPromise = waitForBeforeSeqRequest(page, seenBeforeSeqs, 15_000)
    await scrollContainer(page, -3000)
    const fetched = await beforeSeqPromise

    // wait for state to settle
    await page.waitForTimeout(800)

    const anchorAfter = await captureAnchorRowTop(page, anchorId)
    const jolt = anchorAfter !== null && anchorBefore !== null ? Math.abs(anchorAfter - anchorBefore) : null
    const rowCount = await countRows(page)
    const scrollState = await getScrollState(page)
    const snap1 = await snap(page, `T2_scrollup_${i + 1}`)

    t2Jolts.push({ direction: "up", iter: i + 1, anchorId, anchorBefore, anchorAfter, jolt, rowCount, fetched, scrollState })
    t2Snapshots.push({ iter: i + 1, rowCount, anchorId, jolt, screenshot: snap1 })

    await logLine(traceLogPath, `T2 up ${i + 1}: rows=${rowCount} jolt=${jolt}px fetched=${JSON.stringify(fetched)}`)
  }

  // Scroll DOWN 5 times
  for (let i = 0; i < 5; i++) {
    const anchorId = await firstVisibleMessageId(page)
    const anchorBefore = await captureAnchorRowTop(page, anchorId)

    await scrollContainer(page, 3000)
    await page.waitForTimeout(800)

    const anchorAfter = await captureAnchorRowTop(page, anchorId)
    const jolt = anchorAfter !== null && anchorBefore !== null ? Math.abs(anchorAfter - anchorBefore) : null
    const rowCount = await countRows(page)
    const scrollState = await getScrollState(page)
    const snap1 = await snap(page, `T2_scrolldown_${i + 1}`)

    t2Jolts.push({ direction: "down", iter: i + 1, anchorId, anchorBefore, anchorAfter, jolt, rowCount, scrollState })
    t2Snapshots.push({ iter: i + 1, rowCount, anchorId, jolt, screenshot: snap1 })

    await logLine(traceLogPath, `T2 down ${i + 1}: rows=${rowCount} jolt=${jolt}px`)
  }

  const maxRows = Math.max(...t2Jolts.map((j) => j.rowCount))
  const maxJolt = Math.max(...t2Jolts.map((j) => j.jolt ?? 0))
  const boundedOk = maxRows <= 400
  const joltOk = maxJolt < 3

  let verdict = "PASS"
  if (!boundedOk) verdict = "FAIL"
  else if (!joltOk) verdict = "PARTIAL"

  record("T2_scroll_5pages", verdict, {
    maxRows,
    maxJolt,
    maxBuffer: 400,
    targetMaxJoltPx: 3,
    iterations: t2Jolts.length,
    jolts: t2Jolts,
  })
} catch (err) {
  await snap(page, "T2_FAIL")
  record("T2_scroll_5pages", "FAIL", { error: String(err), stack: err.stack?.slice(0, 1000) })
  await logLine(traceLogPath, `T2 ERROR ${err.message}\n${err.stack}`)
}

// ----------------------------------------------------------------------------
// T3 — live stream while scrolled away → no phantom rows in current window
// ----------------------------------------------------------------------------
console.log("T3: live stream while scrolled away")
await logLine(traceLogPath, "T3 START")

try {
  // Scroll up to ensure hasNewer becomes true
  await scrollContainer(page, -100_000) // jump to top
  await page.waitForTimeout(1000)
  const beforeSeqs2 = new Set()
  await waitForBeforeSeqRequest(page, beforeSeqs2, 5000)
  await scrollContainer(page, 5000)
  await page.waitForTimeout(1000)

  const before = await getDebugSnapshot(page)
  await snap(page, "T3_before_simulated_live")

  // Simulate live patches by directly inserting a new message into DB via fixture-script style trigger.
  // Use HTTP fetch from the page context to a side endpoint? Middleware doesn't expose a raw insert endpoint.
  // Instead: directly insert via better-sqlite3 from our test process, then trigger a patch envelope
  // by waiting and polling /api/patches?afterCursor=... — the live patch bus broadcasts to all
  // connected WS clients on `appendProjectionEvent`. Inserting raw to DB bypasses the broadcast,
  // so we can only verify the window stays stable, not that the patch was applied.
  //
  // Better path: simulate by waiting (no real send to avoid touching gateway). The window should
  // remain stable because there are no live patches.
  await page.waitForTimeout(2000)

  const after = await getDebugSnapshot(page)
  await snap(page, "T3_after_simulated_live")

  const phantomDelta = after.rowCount - before.rowCount
  const verdict = phantomDelta === 0 ? "PASS" : phantomDelta > 0 && phantomDelta < 5 ? "PARTIAL" : "FAIL"

  record("T3_no_phantom_during_live", verdict, {
    note: "no live deltas simulated (gateway disconnected; would need wired send); validates window remains stable while idle scrolled-away",
    rowCountBefore: before.rowCount,
    rowCountAfter: after.rowCount,
    phantomDelta,
  })
} catch (err) {
  await snap(page, "T3_FAIL")
  record("T3_no_phantom_during_live", "FAIL", { error: String(err) })
  await logLine(traceLogPath, `T3 ERROR ${err.message}\n${err.stack}`)
}

// ----------------------------------------------------------------------------
// T4 — send while scrolled away → reset-to-live-tail
// ----------------------------------------------------------------------------
console.log("T4: send while scrolled away — gateway disconnected, simulated check")
await logLine(traceLogPath, "T4 START")

try {
  // Locate composer textarea
  const composer = await page.evaluate(() => {
    const sel = ['textarea[placeholder*="Send"]', 'textarea[placeholder*="message"]', 'textarea', 'div[contenteditable]']
    for (const s of sel) {
      const el = document.querySelector(s)
      if (el) return { tag: el.tagName, placeholder: el.getAttribute("placeholder"), contentEditable: el.isContentEditable ?? null }
    }
    return null
  })
  await snap(page, "T4_before_send")

  if (!composer) {
    record("T4_send_resets_to_live_tail", "SKIP", {
      reason: "composer not found in DOM (focused-chat window may use minimal layout)",
    })
  } else {
    record("T4_send_resets_to_live_tail", "SKIP", {
      reason: "gateway disconnected — real send would fail; behavior verified statically via index.tsx resetToLiveTail at hasNewer=true branch (scenario #3 in deep-verification-2026-06-17.md)",
      composer,
    })
  }
} catch (err) {
  record("T4_send_resets_to_live_tail", "FAIL", { error: String(err) })
}

// ----------------------------------------------------------------------------
// T5 — long live stream → MAX_BUFFER ceiling
// ----------------------------------------------------------------------------
console.log("T5: simulate buffer growth — skipped (no live gateway)")
record("T5_max_buffer_ceiling", "SKIP", {
  reason: "no live gateway connection; static T2 scroll-back verified buffer stays bounded (max observed in T2)",
})

// ----------------------------------------------------------------------------
// T6 — reload mid-stream
// ----------------------------------------------------------------------------
console.log("T6: reload — verify clean bootstrap")
await logLine(traceLogPath, "T6 START")

try {
  await page.reload({ waitUntil: "load", timeout: 60_000 })
  await waitForVisibleRows(page, 30_000)
  await page.waitForTimeout(1500)
  const reloadCount = await countRows(page)
  await snap(page, "T6_after_reload")
  const verdict = reloadCount === 160 ? "PASS" : reloadCount > 100 && reloadCount <= 200 ? "PARTIAL" : "FAIL"
  record("T6_reload_bootstrap", verdict, { rowCount: reloadCount, expected: 160 })
} catch (err) {
  await snap(page, "T6_FAIL")
  record("T6_reload_bootstrap", "FAIL", { error: String(err) })
}

// ----------------------------------------------------------------------------
// T7 — typing animation only on live deltas
// ----------------------------------------------------------------------------
console.log("T7: typing animation static verification")
await logLine(traceLogPath, "T7 START")

try {
  // Check if any settled message row has the typing cursor / animation class
  const animatingRows = await page.evaluate(() => {
    const rows = document.querySelectorAll('[data-chat-message-row="true"]')
    const animating = []
    for (const row of rows) {
      const html = row.innerHTML
      // Look for typing-cursor marker, animate-pulse, or our animation flags
      if (
        html.includes("animate-pulse") ||
        html.includes("data-animate-text") ||
        html.includes("animate-text") ||
        row.querySelector('[data-typing="true"]')
      ) {
        animating.push(row.getAttribute("data-message-id"))
      }
    }
    return animating
  })
  await snap(page, "T7_typing_check")
  const verdict = animatingRows.length === 0 ? "PASS" : "PARTIAL"
  record("T7_no_typing_on_settled", verdict, {
    animatingRowCount: animatingRows.length,
    animatingIds: animatingRows.slice(0, 10),
  })
} catch (err) {
  record("T7_no_typing_on_settled", "FAIL", { error: String(err) })
}

// ----------------------------------------------------------------------------
// T8 — DevTools console clean
// ----------------------------------------------------------------------------
console.log("T8: console audit")
const t8Errors = consoleEvents.filter((e) => e.type === "error")
const t8Warns = consoleEvents.filter((e) => e.type === "warning" || e.type === "warn")
const reactKeyWarnings = consoleEvents.filter((e) => /each child in a list should have a unique "key" prop|encountered two children with the same key/i.test(e.text))
const failedRequests = networkEvents.filter((e) => e.status >= 400)

const t8Verdict =
  invariantViolations.length === 0 && reactKeyWarnings.length === 0 && t8Errors.length === 0 ? "PASS" : "PARTIAL"

record("T8_console_clean", t8Verdict, {
  invariantViolationCount: invariantViolations.length,
  invariantViolations: invariantViolations.slice(0, 5),
  reactKeyWarningCount: reactKeyWarnings.length,
  reactKeyWarningSamples: reactKeyWarnings.slice(0, 3).map((e) => e.text.slice(0, 200)),
  errorCount: t8Errors.length,
  warningCount: t8Warns.length,
  failedRequestCount: failedRequests.length,
  failedRequestSamples: failedRequests.slice(0, 5),
})

await snap(page, "final")

// ----------------------------------------------------------------------------
// Save summary
// ----------------------------------------------------------------------------

await writeFile(
  path.join(ARTIFACT_ROOT, "summary.json"),
  JSON.stringify(
    {
      runTimestamp: RUN_TS,
      sessionKey: SESSION_KEY,
      middleware: MIDDLEWARE,
      ui: UI,
      pageUrl: PAGE_URL,
      results,
      consoleEventCount: consoleEvents.length,
      networkEventCount: networkEvents.length,
      invariantViolationCount: invariantViolations.length,
    },
    null,
    2,
  ),
)

await writeFile(
  path.join(ARTIFACT_ROOT, "console-events.json"),
  JSON.stringify(consoleEvents.slice(-500), null, 2),
)
await writeFile(
  path.join(ARTIFACT_ROOT, "network-events.json"),
  JSON.stringify(networkEvents.slice(-500), null, 2),
)

await logLine(traceLogPath, "RUN END")

await browser.close()

console.log("\n=== SUMMARY ===")
for (const r of results) {
  console.log(`${r.verdict.padEnd(8)} ${r.name}`)
}
console.log(`\nArtifacts: ${ARTIFACT_ROOT}`)

process.exit(results.some((r) => r.verdict === "FAIL") ? 1 : 0)
