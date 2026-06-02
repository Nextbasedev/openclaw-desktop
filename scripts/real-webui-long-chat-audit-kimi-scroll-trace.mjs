import { chromium } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const OUT = resolve('test-results/real-webui-long-chat-audit-kimi')
mkdirSync(OUT, { recursive: true })

const url = process.env.AUDIT_URL || 'http://127.0.0.1:3000/audit-long-chat'
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } })
const page = await context.newPage()
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 })
await page.waitForSelector('[data-vercel-chat-message-row="true"]', { timeout: 30000 })
await page.waitForTimeout(750)

// Add instrumentation to detect scrollTop changes and capture stack traces
await page.evaluate(() => {
  const container = Array.from(document.querySelectorAll('main[data-audit-real-webui="true"] *')).find((el) => {
    if (!(el instanceof HTMLElement)) return false
    const style = getComputedStyle(el)
    return style.overflowY === 'auto' && el.scrollHeight > el.clientHeight && el.clientHeight > 100
  })
  if (!(container instanceof HTMLElement)) throw new Error('scroll container not found')

  // Monkey-patch scrollTop setter to log changes
  const originalScrollTop = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTop')
  if (!originalScrollTop) return
  const scrollLog = (window).__scrollLog = []
  Object.defineProperty(container, 'scrollTop', {
    get() {
      return originalScrollTop.get.call(this)
    },
    set(value) {
      const old = originalScrollTop.get.call(this)
      const stack = new Error().stack
      scrollLog.push({ old, new: value, delta: value - old, time: Date.now(), stack: stack.split('\n').slice(1, 8).join('\n') })
      originalScrollTop.set.call(this, value)
    },
  })
})

const metrics = await page.evaluate(async () => {
  const container = Array.from(document.querySelectorAll('main[data-audit-real-webui="true"] *')).find((el) => {
    if (!(el instanceof HTMLElement)) return false
    const style = getComputedStyle(el)
    return style.overflowY === 'auto' && el.scrollHeight > el.clientHeight && el.clientHeight > 100
  })
  if (!(container instanceof HTMLElement)) throw new Error('scroll container not found')

  const state = {
    scrollPositions: [],
    jumpCount: 0,
    jumps: [],
  }
  let lastScrollTop = container.scrollTop
  let setupPhase = true

  function sample(label) {
    const scrollTop = container.scrollTop
    const delta = scrollTop - lastScrollTop
    if (!setupPhase && Math.abs(delta) > 900) {
      state.jumpCount++
      state.jumps.push({ from: lastScrollTop, to: scrollTop, delta, label })
    }
    state.scrollPositions.push({ scrollTop, scrollHeight: container.scrollHeight, clientHeight: container.clientHeight, label })
    lastScrollTop = scrollTop
  }

  sample('setup-initial')
  container.scrollTop = container.scrollHeight
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  lastScrollTop = container.scrollTop
  sample('setup-bottom')
  setupPhase = false

  for (let i = 0; i < 120; i++) {
    container.scrollTop = Math.max(0, container.scrollTop - 90)
    sample('scroll-up')
    await new Promise((resolve) => setTimeout(resolve, 16))
  }
  for (let i = 0; i < 120; i++) {
    container.scrollTop = Math.min(container.scrollHeight, container.scrollTop + 90)
    sample('scroll-down')
    await new Promise((resolve) => setTimeout(resolve, 16))
  }

  return { ...state, finalScrollTop: container.scrollTop, finalScrollHeight: container.scrollHeight }
})

const scrollLog = await page.evaluate(() => {
  return (window).__scrollLog || []
})

const report = {
  ...metrics,
  scrollLog: scrollLog.filter((entry) => Math.abs(entry.delta) > 900),
  verdict: metrics.jumpCount === 0 ? 'PASS' : 'ISSUE_FOUND',
}
writeFileSync(join(OUT, 'audit-report-scroll-trace.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))

await page.close()
await context.close()
await browser.close()
