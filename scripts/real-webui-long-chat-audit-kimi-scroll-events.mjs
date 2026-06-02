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

// Add scroll event listener to log all scroll events
await page.evaluate(() => {
  const container = Array.from(document.querySelectorAll('main[data-audit-real-webui="true"] *')).find((el) => {
    if (!(el instanceof HTMLElement)) return false
    const style = getComputedStyle(el)
    return style.overflowY === 'auto' && el.scrollHeight > el.clientHeight && el.clientHeight > 100
  })
  if (!(container instanceof HTMLElement)) throw new Error('scroll container not found')
  
  window.__scrollEvents = []
  container.addEventListener('scroll', (e) => {
    window.__scrollEvents.push({
      scrollTop: container.scrollTop,
      scrollHeight: container.scrollHeight,
      time: Date.now(),
      type: e.type
    })
  }, { passive: true })
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

const scrollEvents = await page.evaluate(() => {
  return window.__scrollEvents || []
})

// Find scroll events that coincide with jumps
const jumpEvents = []
for (const jump of metrics.jumps) {
  const nearbyEvents = scrollEvents.filter(e => Math.abs(e.scrollTop - jump.to) < 100 || Math.abs(e.scrollTop - jump.from) < 100)
  jumpEvents.push({ jump, events: nearbyEvents })
}

const report = {
  ...metrics,
  scrollEvents: scrollEvents.filter(e => e.scrollTop > 320000 || e.scrollTop < 10000),
  jumpEvents,
  verdict: metrics.jumpCount === 0 ? 'PASS' : 'ISSUE_FOUND',
}
writeFileSync(join(OUT, 'audit-report-scroll-events.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))

await page.close()
await context.close()
await browser.close()
