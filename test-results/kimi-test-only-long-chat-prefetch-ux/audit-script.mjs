import { chromium } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const OUT = resolve('test-results/kimi-test-only-long-chat-prefetch-ux')
mkdirSync(OUT, { recursive: true })

const url = process.env.AUDIT_URL || 'http://127.0.0.1:3000/audit-long-chat'
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } })
const page = await context.newPage()

// Capture console errors
const consoleErrors = []
page.on('console', msg => {
  if (msg.type() === 'error') consoleErrors.push({ type: msg.type(), text: msg.text(), loc: msg.location() })
})

await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 })
await page.waitForSelector('[data-vercel-chat-message-row="true"]', { timeout: 30000 })
await page.waitForTimeout(1000)

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
    textDisappearances: 0,
    rowCountHistory: [],
    scrollHeightHistory: [],
    blankFrames: 0,
    loaderAppeared: false,
    loaderAppearedAt: null,
    loaderVisibleSamples: 0,
  }

  let lastScrollTop = container.scrollTop
  let setupPhase = true

  // Mutation observer for DOM changes
  const observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'childList') {
        if (r.removedNodes.length) {
          // Count as remount only if rows are removed and re-added (not just prepend)
          const removedRows = Array.from(r.removedNodes).filter(n => n instanceof HTMLElement && n.dataset.vercelChatMessageRow === 'true')
          if (removedRows.length) {
            state.rowCountHistory.push({ t: 'remove', count: removedRows.length, time: Date.now() })
          }
        }
        if (r.addedNodes.length) {
          const addedRows = Array.from(r.addedNodes).filter(n => n instanceof HTMLElement && n.dataset.vercelChatMessageRow === 'true')
          if (addedRows.length) {
            state.rowCountHistory.push({ t: 'add', count: addedRows.length, time: Date.now() })
          }
        }
      }
    }
  })
  observer.observe(container, { childList: true, subtree: true })

  function sample(label) {
    const scrollTop = container.scrollTop
    const scrollHeight = container.scrollHeight
    const clientHeight = container.clientHeight
    const delta = scrollTop - lastScrollTop
    
    if (!setupPhase && Math.abs(delta) > 1200 && label !== 'intentional-jump') {
      state.jumpCount++
      state.jumps.push({ from: lastScrollTop, to: scrollTop, delta, label, time: Date.now() })
    }
    
    state.scrollPositions.push({ scrollTop, scrollHeight, clientHeight, label, time: Date.now() })
    state.scrollHeightHistory.push({ scrollHeight, label, time: Date.now() })
    lastScrollTop = scrollTop
  }

  function sampleVisible(label) {
    const rows = Array.from(container.querySelectorAll('[data-vercel-chat-message-row="true"]'))
    const visible = rows.filter((r) => {
      const rect = r.getBoundingClientRect()
      return rect.bottom > 0 && rect.top < window.innerHeight
    })
    const ids = visible.map((r) => r.getAttribute('data-message-id'))
    const texts = visible.map((r) => r.textContent?.slice(0, 120) || '')
    
    // Check for text disappearance (unexpected loss of content)
    if (state.visibleSamples.length > 0) {
      const prev = state.visibleSamples[state.visibleSamples.length - 1]
      const prevSet = new Set(prev.texts || [])
      const lost = texts.filter((t, i) => t.length > 20 && !prevSet.has(t) && prev.ids?.includes(ids[i]))
      // Actually, text disappearance means content that WAS visible is now gone
      const prevIdSet = new Set(prev.ids || [])
      const currIdSet = new Set(ids)
      const disappeared = prev.ids?.filter(id => id && !currIdSet.has(id)) || []
      if (disappeared.length > 2) {
        state.textDisappearances++
      }
    }
    
    // Check loader visibility
    const loader = container.querySelector('[role="status"]')
    if (loader && loader.offsetParent !== null) {
      state.loaderVisibleSamples++
      if (!state.loaderAppeared) {
        state.loaderAppeared = true
        state.loaderAppearedAt = { label, scrollTop: container.scrollTop, time: Date.now() }
      }
    }
    
    // Check blank frames (no visible rows)
    if (visible.length === 0 && rows.length > 0) {
      state.blankFrames++
    }
    
    state.visibleSamples.push({ ids, texts, count: visible.length, label, time: Date.now() })
    state.rowCountHistory.push({ t: 'sample', count: rows.length, time: Date.now(), label })
  }

  // Initial samples
  sample('initial')
  sampleVisible('initial')
  setupPhase = false

  // Scroll to bottom first
  container.scrollTo({ top: container.scrollHeight, behavior: 'instant' })
  await new Promise(r => requestAnimationFrame(r))
  sample('bottom')
  sampleVisible('bottom')

  // Fast scroll upward in increments (simulate user fast scroll to top)
  const maxScroll = container.scrollHeight - container.clientHeight
  const steps = 20
  for (let i = 1; i <= steps; i++) {
    const target = maxScroll - (maxScroll * i / steps)
    container.scrollTo({ top: Math.max(0, target), behavior: 'instant' })
    await new Promise(r => requestAnimationFrame(r))
    await new Promise(r => setTimeout(r, 30)) // simulate fast scroll timing
    sample(`upward-step-${i}`)
    sampleVisible(`upward-step-${i}`)
  }

  // Scroll to very top
  container.scrollTo({ top: 0, behavior: 'instant' })
  await new Promise(r => requestAnimationFrame(r))
  await new Promise(r => setTimeout(r, 50))
  sample('top')
  sampleVisible('top')

  // Wait a bit at top
  await new Promise(r => setTimeout(r, 500))
  sample('top-waited')
  sampleVisible('top-waited')

  // Scroll back down partially
  container.scrollTo({ top: maxScroll * 0.3, behavior: 'instant' })
  await new Promise(r => requestAnimationFrame(r))
  sample('downward')
  sampleVisible('downward')

  observer.disconnect()
  return state
})

await browser.close()

const report = {
  url,
  timestamp: new Date().toISOString(),
  metrics,
  consoleErrors: consoleErrors.slice(0, 50),
}

writeFileSync(join(OUT, 'audit-report.json'), JSON.stringify(report, null, 2))

// Analysis
const issues = []
if (metrics.jumpCount > 0) {
  // Filter jumps: only report if not explainable by intentional setup or coalesced events
  const suspiciousJumps = metrics.jumps.filter(j => {
    // A jump is suspicious if it goes opposite direction of the current scroll intent
    // or if it's a large unexpected discontinuity
    const lastFew = metrics.scrollPositions.slice(-5)
    const avgDirection = lastFew.reduce((s, p, i) => i > 0 ? s + (p.scrollTop - lastFew[i-1].scrollTop) : s, 0)
    const isOppositeDirection = Math.sign(j.delta) !== Math.sign(avgDirection) && Math.abs(avgDirection) > 50
    return isOppositeDirection || Math.abs(j.delta) > 3000
  })
  if (suspiciousJumps.length > 0) {
    issues.push({ type: 'suspicious-jump', count: suspiciousJumps.length, details: suspiciousJumps })
  }
}
if (metrics.textDisappearances > 0) {
  issues.push({ type: 'text-disappearances', count: metrics.textDisappearances })
}
if (metrics.blankFrames > 0) {
  issues.push({ type: 'blank-frames', count: metrics.blankFrames })
}

// Note: this audit page has hasOlderMessages=false so loader won't appear for real older loads
// but we can still verify the component structure

writeFileSync(join(OUT, 'audit-issues.json'), JSON.stringify(issues, null, 2))
writeFileSync(join(OUT, 'audit-summary.txt'), `Audit Summary
=============
URL: ${url}
Jumps detected: ${metrics.jumpCount}
Suspicious jumps: ${issues.filter(i => i.type === 'suspicious-jump').length > 0 ? issues.find(i => i.type === 'suspicious-jump').count : 0}
Text disappearances: ${metrics.textDisappearances}
Blank frames: ${metrics.blankFrames}
Console errors: ${consoleErrors.length}
Loader appeared: ${metrics.loaderAppeared}
Console errors: ${consoleErrors.length}
`)

console.log('Audit complete. Report:', join(OUT, 'audit-report.json'))
console.log('Issues:', issues.length > 0 ? JSON.stringify(issues, null, 2) : 'None')
