import { test, expect } from "@playwright/test"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const ARTIFACTS = join(process.cwd(), "test-results", "long-chat-audit")
mkdirSync(ARTIFACTS, { recursive: true })

const MESSAGE_COUNT = 2000
const SCROLL_DURATION_MS = 8000
const SCROLL_STEP_PX = 60
const SCROLL_INTERVAL_MS = 16

function generateMessages(count: number) {
  const messages: Array<{
    messageId: string
    role: "user" | "assistant"
    text: string
    createdAt: string
    toolCalls?: Array<{
      id: string
      tool: string
      status: "success" | "running" | "error"
      input?: unknown
      resultText?: string
    }>
  }> = []

  const lorem = `Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.`

  const markdownBlocks = [
    "# Heading\n\nSome paragraph text here.",
    "```typescript\nconst x = 1;\n```",
    "- Item one\n- Item two\n- Item three",
    "> A blockquote for testing",
    "**Bold** and *italic* text",
  ]

  for (let i = 0; i < count; i++) {
    const role = i % 2 === 0 ? "user" : "assistant"
    const baseText = role === "user"
      ? `User prompt ${i + 1}: ${lorem.slice(0, 80 + (i % 120))}`
      : `Assistant response ${i + 1}: ${lorem} ${markdownBlocks[i % markdownBlocks.length]} ${lorem.slice(0, 200 + (i % 400))}`

    const msg: ReturnType<typeof generateMessages>[number] = {
      messageId: `msg-${i}`,
      role,
      text: baseText,
      createdAt: new Date(Date.now() - (count - i) * 60000).toISOString(),
    }

    if (role === "assistant" && i % 7 === 3) {
      msg.toolCalls = [
        {
          id: `tool-${i}`,
          tool: "exec",
          status: "success",
          input: { command: "echo hello" },
          resultText: "hello",
        },
      ]
    }

    messages.push(msg)
  }

  return messages
}

function buildTestPageHtml(messages: ReturnType<typeof generateMessages>) {
  let html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Long Chat Scroll Audit</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0a0a0a; color: #e0e0e0; font-family: system-ui, -apple-system, sans-serif; font-size: 14px; line-height: 1.5; }
  #scroll-container { height: 100vh; overflow-y: auto; overscroll-behavior: contain; }
  .msg-row { max-width: 44rem; margin: 0 auto; padding: 12px 16px; border-bottom: 1px solid; }
  .msg-user { background: #1a1a2e; border-color: #3a3a5e; }
  .msg-assistant { background: #16213e; border-color: #2a4a6e; }
  .msg-label { font-weight: 600; margin-bottom: 4px; }
  .msg-user .msg-label { color: #a0a0ff; }
  .msg-assistant .msg-label { color: #60d060; }
  .msg-text { white-space: pre-wrap; word-break: break-word; }
  .tool-card { margin-top: 8px; padding: 8px; background: #0a0a1a; border-radius: 4px; font-size: 12px; color: #888; }
</style>
</head>
<body>
<div id="scroll-container">
<div id="scroll-content">`

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    const cls = msg.role === "user" ? "msg-user" : "msg-assistant"
    const label = msg.role === "user" ? "You" : "Assistant"
    const textEsc = msg.text.replace(/</g, "&lt;").replace(/>/g, "&gt;")
    html += `<div id="message-${msg.messageId}" class="msg-row ${cls}" data-chat-message-row="true" data-ui-id="${msg.messageId}" data-message-id="${msg.messageId}">`
    html += `<div class="msg-label">${label}</div>`
    html += `<div class="msg-text">${textEsc}</div>`
    if (msg.toolCalls) {
      html += `<div class="tool-card">🔧 ${msg.toolCalls[0].tool}: ${JSON.stringify(msg.toolCalls[0].input).replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>`
    }
    html += `</div>`
  }

  html += `</div></div>
</body>
</html>`
  return html
}

test.describe("Long Chat Scroll Audit", () => {
  test("scroll stability with 2k synthetic messages", async ({ page }) => {
    const messages = generateMessages(MESSAGE_COUNT)

    // Build a standalone test page HTML that renders synthetic chat
    const testPageHtml = buildTestPageHtml(messages)
    const testPagePath = join(ARTIFACTS, "test-page.html")
    writeFileSync(testPagePath, testPageHtml)

    // Navigate to the test page directly
    await page.goto(`file://${testPagePath}`)
    await page.waitForLoadState("networkidle")

    // Wait for container to exist
    await page.waitForSelector("#scroll-container", { timeout: 5000 })

    // Small delay for layout to settle
    await page.waitForTimeout(500)

    // Inject instrumentation
    await page.evaluate(() => {
      const win = window as any
      const scrollContainer = document.getElementById("scroll-container")!
      win.__AUDIT_SCROLL_CONTAINER = scrollContainer
      win.__AUDIT_METRICS = {
        scrollJumps: [] as Array<{ time: number; from: number; to: number; delta: number }>,
        visibleRowIds: [] as Array<{ time: number; ids: string[]; count: number }>,
        domMutations: [] as Array<{ time: number; type: string; target: string }>,
        scrollPositions: [] as Array<{ time: number; scrollTop: number; scrollHeight: number; clientHeight: number }>,
      }

      const ch = scrollContainer.clientHeight
      let lastScrollTop = scrollContainer.scrollTop
      scrollContainer.addEventListener("scroll", () => {
        const now = performance.now()
        const st = scrollContainer.scrollTop
        const delta = st - lastScrollTop
        const sh = scrollContainer.scrollHeight
        const chNow = scrollContainer.clientHeight

        win.__AUDIT_METRICS.scrollPositions.push({ time: now, scrollTop: st, scrollHeight: sh, clientHeight: chNow })

        // Detect sudden jumps (not caused by our smooth scroll)
        if (Math.abs(delta) > 200 && Math.abs(delta) < 5000) {
          win.__AUDIT_METRICS.scrollJumps.push({ time: now, from: lastScrollTop, to: st, delta })
        }
        lastScrollTop = st
      }, { passive: true })

      // Mutation observer for DOM churn
      const observer = new MutationObserver((mutations) => {
        const now = performance.now()
        for (const m of mutations) {
          win.__AUDIT_METRICS.domMutations.push({
            time: now,
            type: m.type,
            target: (m.target as HTMLElement).id || (m.target as HTMLElement).tagName || "unknown",
          })
        }
      })
      observer.observe(document.getElementById("scroll-content")!, { childList: true, subtree: true, attributes: true })

      // Periodic visible row sampling
      const sampleInterval = setInterval(() => {
        const now = performance.now()
        const rows = Array.from(scrollContainer.querySelectorAll<HTMLElement>("[data-chat-message-row='true']"))
        const visible = rows.filter((row) => {
          const rect = row.getBoundingClientRect()
          return rect.top < ch && rect.bottom > 0
        })
        win.__AUDIT_METRICS.visibleRowIds.push({
          time: now,
          ids: visible.map((r) => r.id),
          count: visible.length,
        })
      }, 100)

      win.__AUDIT_STOP_SAMPLING = () => clearInterval(sampleInterval)
    })

    // Perform continuous scroll
    const scrollMetrics = await page.evaluate(({ duration, step, interval }) => {
      return new Promise<{
        finalScrollTop: number
        finalScrollHeight: number
        finalClientHeight: number
        totalScrollDistance: number
      }>((resolve) => {
        const win = window as any
        const container = win.__AUDIT_SCROLL_CONTAINER as HTMLElement
        const startTime = performance.now()
        let totalDistance = 0

        const tick = () => {
          const elapsed = performance.now() - startTime
          if (elapsed >= duration) {
            win.__AUDIT_STOP_SAMPLING()
            resolve({
              finalScrollTop: container.scrollTop,
              finalScrollHeight: container.scrollHeight,
              finalClientHeight: container.clientHeight,
              totalScrollDistance: totalDistance,
            })
            return
          }

          const prev = container.scrollTop
          container.scrollTop -= step
          totalDistance += Math.abs(container.scrollTop - prev)
          requestAnimationFrame(() => setTimeout(tick, interval))
        }

        // Start from bottom, scroll up (older history direction)
        container.scrollTop = container.scrollHeight
        tick()
      })
    }, { duration: SCROLL_DURATION_MS, step: SCROLL_STEP_PX, interval: SCROLL_INTERVAL_MS })

    // Extract metrics
    const metrics = await page.evaluate(() => {
      return (window as any).__AUDIT_METRICS
    })

    // Save metrics
    writeFileSync(join(ARTIFACTS, "scroll-metrics.json"), JSON.stringify({
      messageCount: MESSAGE_COUNT,
      scrollConfig: { duration: SCROLL_DURATION_MS, step: SCROLL_STEP_PX, interval: SCROLL_INTERVAL_MS },
      scrollResult: scrollMetrics,
      metrics: {
        scrollJumpCount: metrics.scrollJumps.length,
        scrollJumps: metrics.scrollJumps.slice(0, 20),
        domMutationCount: metrics.domMutations.length,
        domMutations: metrics.domMutations.slice(0, 50),
        visibleRowSampleCount: metrics.visibleRowIds.length,
        firstVisibleSample: metrics.visibleRowIds[0] || null,
        lastVisibleSample: metrics.visibleRowIds[metrics.visibleRowIds.length - 1] || null,
      },
    }, null, 2))

    // Analyze visible row stability
    const idDisappearances = await page.evaluate(() => {
      const samples = (window as any).__AUDIT_METRICS.visibleRowIds as Array<{ time: number; ids: string[]; count: number }>
      const lastSeen = new Map<string, number>()

      for (let i = 0; i < samples.length; i++) {
        const sample = samples[i]
        for (const id of sample.ids) {
          lastSeen.set(id, i)
        }
      }

      // Check for IDs that appeared then disappeared then reappeared (flicker)
      const flickers: Array<{ id: string; gapCount: number }> = []
      for (const [id, lastIdx] of lastSeen.entries()) {
        let firstIdx = -1
        for (let i = 0; i < samples.length; i++) {
          if (samples[i].ids.includes(id)) {
            firstIdx = i
            break
          }
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

    writeFileSync(join(ARTIFACTS, "id-stability.json"), JSON.stringify(idDisappearances, null, 2))

    // Assertions
    expect(scrollMetrics.finalScrollHeight).toBeGreaterThan(0)
    expect(scrollMetrics.totalScrollDistance).toBeGreaterThan(0)

    // No sudden scroll jumps
    expect(metrics.scrollJumps.length).toBe(0)

    // No DOM mutations during pure scroll (no content changes)
    expect(metrics.domMutations.length).toBe(0)

    // No flickering IDs
    expect(idDisappearances.flickerCount).toBe(0)

    // Save video path info
    const videoPath = await page.video()?.path()
    writeFileSync(join(ARTIFACTS, "video-path.txt"), videoPath || "no-video")
  })
})
