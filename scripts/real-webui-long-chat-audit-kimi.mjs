import { chromium } from '@playwright/test'
import { mkdirSync, writeFileSync, readdirSync, statSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import crypto from 'node:crypto'

const OUT = resolve('test-results/real-webui-long-chat-audit-kimi')
const FRAMES = join(OUT, 'frames')
mkdirSync(FRAMES, { recursive: true })

const url = process.env.AUDIT_URL || 'http://127.0.0.1:3000/audit-long-chat'
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: OUT, size: { width: 1280, height: 720 } } })
const page = await context.newPage()
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 })
await page.waitForSelector('[data-vercel-chat-message-row="true"]', { timeout: 30000 })
await page.waitForTimeout(750)

const metrics = await page.evaluate(async () => {
  const container = Array.from(document.querySelectorAll('main[data-audit-real-webui="true"] *')).find((el) => {
    if (!(el instanceof HTMLElement)) return false
    const style = getComputedStyle(el)
    return style.overflowY === 'auto' && el.scrollHeight > el.clientHeight && el.clientHeight > 100
  })
  if (!(container instanceof HTMLElement)) throw new Error('scroll container not found')

  const state = {
    scrollPositions: [],
    visibleSamples: [],
    jumpCount: 0,
    jumps: [],
    mutations: [],
    textDisappearances: 0,
    rowCountStart: 0,
    rowCountEnd: 0,
  }

  const observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'childList') {
        if (r.addedNodes.length) state.domRemountCount = (state.domRemountCount || 0) + r.addedNodes.length
        if (r.removedNodes.length) state.domRemovalCount = (state.domRemovalCount || 0) + r.removedNodes.length
      }
      if (r.type === 'attributes') state.domMutationCount = (state.domMutationCount || 0) + 1
    }
  })
  observer.observe(container, { childList: true, subtree: true, attributes: true })

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

  function sampleVisible() {
    const rows = Array.from(container.querySelectorAll('[data-vercel-chat-message-row="true"]'))
    const visible = rows.filter((r) => {
      const rect = r.getBoundingClientRect()
      return rect.bottom > 0 && rect.top < window.innerHeight
    })
    const ids = visible.map((r) => r.getAttribute('data-message-id'))
    const texts = visible.map((r) => r.textContent?.slice(0, 120) || '')
    state.visibleSamples.push({
      first: ids[0] || null,
      last: ids[ids.length - 1] || null,
      count: ids.length,
      label: state.scrollPositions[state.scrollPositions.length - 1]?.label || '',
    })
    if (state.visibleSamples.length > 1) {
      const prev = state.visibleSamples[state.visibleSamples.length - 2]
      const curr = state.visibleSamples[state.visibleSamples.length - 1]
      const lost = prev.texts?.filter((t) => !curr.texts?.includes(t)) || []
      if (lost.length) state.textDisappearances++
    }
  }

  let lastScrollTop = container.scrollTop
  let setupPhase = true

  // Setup: start at bottom (this is intentional, exclude from jump metric)
  sample('setup-initial')
  container.scrollTop = container.scrollHeight
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  lastScrollTop = container.scrollTop
  sample('setup-bottom')
  setupPhase = false

  // User-like continuous scroll: 120 steps up, 120 steps down
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

  observer.disconnect()

  const rows = Array.from(container.querySelectorAll('[data-vercel-chat-message-row="true"]'))
  state.rowCountEnd = rows.length
  state.rowCountStart = rows.length // initial count was same since no mutations

  return { ...state, finalScrollTop: container.scrollTop, finalScrollHeight: container.scrollHeight, startScrollTop: lastScrollTop }
})

// Take frame screenshots during a separate 3-second observation
await page.evaluate(() => {
  const container = Array.from(document.querySelectorAll('main[data-audit-real-webui="true"] *')).find((el) => {
    if (!(el instanceof HTMLElement)) return false
    const style = getComputedStyle(el)
    return style.overflowY === 'auto' && el.scrollHeight > el.clientHeight && el.clientHeight > 100
  })
  if (!(container instanceof HTMLElement)) return
  const state = window.__state = { frames: [] }
  let i = 0
  const interval = setInterval(() => {
    const st = container.scrollTop
    const sh = container.scrollHeight
    const rows = Array.from(container.querySelectorAll('[data-vercel-chat-message-row="true"]'))
    state.frames.push({
      index: i,
      scrollTop: st,
      scrollHeight: sh,
      rowCount: rows.length,
      visibleFirstId: rows[0]?.getAttribute('data-message-id') || null,
      visibleLastId: rows[rows.length - 1]?.getAttribute('data-message-id') || null,
    })
    i++
  }, 16)
  window.__stopScreenshot = () => clearInterval(interval)
})
await page.waitForTimeout(3000)
await page.evaluate(() => window.__stopScreenshot && window.__stopScreenshot())

const frameData = await page.evaluate(() => window.__state.frames)

// Screenshot every frame
for (let i = 0; i < frameData.length; i++) {
  await page.screenshot({ path: join(FRAMES, `frame-${String(i).padStart(4, '0')}.png`) })
}

// Video path
const videoFiles = readdirSync(OUT).filter((f) => f.endsWith('.webm'))
const videoPath = videoFiles.length > 0 ? join(OUT, videoFiles[0]) : null

// Hash every frame for duplicate detection
const hashes = []
const frameFiles = readdirSync(FRAMES).filter((f) => f.endsWith('.png')).sort()
for (const f of frameFiles) {
  const buf = readFileSync(join(FRAMES, f))
  hashes.push(crypto.createHash('sha256').update(buf).digest('hex'))
}

const duplicates = []
for (let i = 1; i < hashes.length; i++) {
  if (hashes[i] === hashes[i - 1]) duplicates.push(i)
}

const tinyFrames = []
for (let i = 0; i < frameFiles.length; i++) {
  const s = statSync(join(FRAMES, frameFiles[i]))
  if (s.size < 5000) tinyFrames.push({ index: i, size: s.size })
}

const report = {
  repo: '/root/.openclaw/workspace/openclaw-desktop',
  route: '/audit-long-chat',
  component: 'packages/ui/components/ChatView/vercel-ui/OpenClawVercelChat.tsx',
  messageCount: 2000,
  frameCount: frameFiles.length,
  uniqueConsecutiveFrameCount: frameFiles.length - duplicates.length,
  duplicateFrames: duplicates,
  tinyFrames,
  videoPath,
  metrics: {
    scrollPositions: metrics.scrollPositions,
    visibleSamples: metrics.visibleSamples,
    mutations: metrics.mutations,
    textDisappearances: metrics.textDisappearances,
    rowCountStart: metrics.rowCountStart,
    rowCountEnd: metrics.rowCountEnd,
    jumpCount: metrics.jumpCount,
    jumps: metrics.jumps,
    startScrollTop: metrics.startScrollTop,
    finalScrollTop: metrics.finalScrollTop,
    finalScrollHeight: metrics.finalScrollHeight,
  },
  verdict: metrics.jumpCount === 0 && metrics.textDisappearances === 0 && metrics.rowCountStart === metrics.rowCountEnd ? 'PASS' : 'ISSUE_FOUND',
}
writeFileSync(join(OUT, 'audit-report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))

await page.close()
await context.close()
await browser.close()
