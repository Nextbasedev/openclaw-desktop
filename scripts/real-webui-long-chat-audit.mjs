import { chromium } from '@playwright/test'
import { mkdirSync, writeFileSync, readdirSync, statSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import crypto from 'node:crypto'

const OUT = resolve('test-results/real-webui-long-chat-audit')
const FRAMES = join(OUT, 'frames')
mkdirSync(FRAMES, { recursive: true })

const url = process.env.AUDIT_URL || 'http://127.0.0.1:3461/audit-long-chat'
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
  const content = container.firstElementChild
  const state = {
    scrollPositions: [],
    visibleSamples: [],
    mutations: [],
    textDisappearances: 0,
    rowCountStart: document.querySelectorAll('[data-vercel-chat-message-row="true"]').length,
    rowCountEnd: 0,
    jumpCount: 0,
    jumps: [],
  }
  const seenVisible = new Map()
  let lastScrollTop = container.scrollTop
  const observer = new MutationObserver((items) => {
    for (const item of items) {
      state.mutations.push({ type: item.type, added: item.addedNodes.length, removed: item.removedNodes.length, target: item.target?.nodeName || 'unknown' })
    }
  })
  if (content) observer.observe(content, { childList: true, subtree: true, characterData: true })

  function sample() {
    const rows = Array.from(container.querySelectorAll('[data-vercel-chat-message-row="true"]'))
    const visible = rows.filter((row) => {
      const r = row.getBoundingClientRect()
      const c = container.getBoundingClientRect()
      return r.bottom >= c.top && r.top <= c.bottom
    }).map((row) => ({ id: row.getAttribute('data-ui-id') || '', textLength: row.textContent?.trim().length || 0 }))
    for (const item of visible) {
      const prev = seenVisible.get(item.id)
      if (prev && prev > 0 && item.textLength === 0) state.textDisappearances++
      seenVisible.set(item.id, item.textLength)
    }
    const scrollTop = container.scrollTop
    const delta = scrollTop - lastScrollTop
    if (Math.abs(delta) > 900) {
      state.jumpCount++
      state.jumps.push({ from: lastScrollTop, to: scrollTop, delta })
    }
    state.scrollPositions.push({ scrollTop, scrollHeight: container.scrollHeight, clientHeight: container.clientHeight })
    state.visibleSamples.push({ first: visible[0]?.id || null, last: visible.at(-1)?.id || null, count: visible.length })
    lastScrollTop = scrollTop
  }

  sample()
  container.scrollTop = container.scrollHeight
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  sample()
  const start = container.scrollTop
  for (let i = 0; i < 120; i++) {
    container.scrollTop = Math.max(0, container.scrollTop - 90)
    sample()
    await new Promise((resolve) => setTimeout(resolve, 16))
  }
  for (let i = 0; i < 120; i++) {
    container.scrollTop = Math.min(container.scrollHeight, container.scrollTop + 90)
    sample()
    await new Promise((resolve) => setTimeout(resolve, 16))
  }
  state.rowCountEnd = document.querySelectorAll('[data-vercel-chat-message-row="true"]').length
  observer.disconnect()
  return { ...state, startScrollTop: start, finalScrollTop: container.scrollTop, finalScrollHeight: container.scrollHeight }
})

for (let i = 0; i < 120; i++) {
  await page.screenshot({ path: join(FRAMES, `frame-${String(i + 1).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 82 })
  await page.evaluate((i) => {
    const container = Array.from(document.querySelectorAll('main[data-audit-real-webui="true"] *')).find((el) => {
      if (!(el instanceof HTMLElement)) return false
      const style = getComputedStyle(el)
      return style.overflowY === 'auto' && el.scrollHeight > el.clientHeight && el.clientHeight > 100
    })
    if (container instanceof HTMLElement) container.scrollTop = Math.max(0, container.scrollTop - (i < 60 ? 150 : -150))
  }, i)
  await page.waitForTimeout(50)
}

await page.close()
await context.close()
await browser.close()

const frameFiles = readdirSync(FRAMES).filter((f) => f.endsWith('.jpg')).sort()
const hashes = frameFiles.map((file) => crypto.createHash('md5').update(readFileSync(join(FRAMES, file))).digest('hex'))
const duplicateFrames = []
for (let i = 1; i < hashes.length; i++) if (hashes[i] === hashes[i - 1]) duplicateFrames.push(frameFiles[i])
const tinyFrames = frameFiles.filter((file) => statSync(join(FRAMES, file)).size < 25000)
const report = {
  repo: process.cwd(),
  route: '/audit-long-chat',
  component: 'packages/ui/components/ChatView/vercel-ui/OpenClawVercelChat.tsx',
  messageCount: 2000,
  frameCount: frameFiles.length,
  uniqueConsecutiveFrameCount: frameFiles.length - duplicateFrames.length,
  duplicateFrames,
  tinyFrames,
  metrics,
  verdict: metrics.jumpCount === 0 && metrics.mutations.length === 0 && metrics.textDisappearances === 0 && duplicateFrames.length === 0 && tinyFrames.length === 0 ? 'PASS' : 'ISSUE_FOUND',
}
writeFileSync(join(OUT, 'audit-report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
