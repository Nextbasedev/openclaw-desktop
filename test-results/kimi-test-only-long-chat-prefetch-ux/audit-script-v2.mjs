import { chromium } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const OUT = resolve('test-results/kimi-test-only-long-chat-prefetch-ux')
mkdirSync(OUT, { recursive: true })

const url = process.env.AUDIT_URL || 'http://127.0.0.1:3000/audit-long-chat'
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } })
const page = await context.newPage()

const consoleErrors = []
page.on('console', msg => {
  if (msg.type() === 'error') consoleErrors.push({ type: msg.type(), text: msg.text() })
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
    unexpectedJumps: [],
    textDisappearances: 0,
    blankFrames: 0,
    domRemovals: 0,
    domAdds: 0,
    rowCountHistory: [],
    loaderVisible: false,
    loaderVisibleAt: null,
    loaderElementExists: false,
  }

  let lastScrollTop = container.scrollTop
  let lastScrollTime = Date.now()

  // Mutation observer
  const observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'childList') {
        const removedRows = Array.from(r.removedNodes).filter(n => n instanceof HTMLElement && n.dataset.vercelChatMessageRow === 'true')
        const addedRows = Array.from(r.addedNodes).filter(n => n instanceof HTMLElement && n.dataset.vercelChatMessageRow === 'true')
        if (removedRows.length) state.domRemovals += removedRows.length
        if (addedRows.length) state.domAdds += addedRows.length
      }
    }
  })
  observer.observe(container, { childList: true, subtree: true })

  function sample(label, isIntentional = false) {
    const scrollTop = container.scrollTop
    const scrollHeight = container.scrollHeight
    const clientHeight = container.clientHeight
    const now = Date.now()
    const delta = scrollTop - lastScrollTop
    const elapsed = now - lastScrollTime

    // Only classify as unexpected jump if:
    // - Not an intentional scripted scroll
    // - Large delta (>1200px)
    // - AND (opposite direction from recent movement OR sudden scrollHeight discontinuity)
    if (!isIntentional && Math.abs(delta) > 1200 && elapsed < 100) {
      // Check if opposite direction from recent trend
      const recent = state.scrollPositions.slice(-3)
      const recentDelta = recent.length > 1 ? recent[recent.length-1].scrollTop - recent[0].scrollTop : delta
      const isOpposite = Math.sign(delta) !== Math.sign(recentDelta) && Math.abs(recentDelta) > 100
      
      // Check scrollHeight discontinuity (DOM prepend caused jump)
      const prevScrollHeight = recent.length > 0 ? recent[recent.length-1].scrollHeight : scrollHeight
      const heightChanged = scrollHeight !== prevScrollHeight && Math.abs(scrollHeight - prevScrollHeight) > 100
      
      if (isOpposite || (heightChanged && Math.abs(delta) > 2000)) {
        state.unexpectedJumps.push({ from: lastScrollTop, to: scrollTop, delta, label, time: now, reason: isOpposite ? 'opposite-direction' : 'scrollHeight-change' })
      }
    }
    
    state.scrollPositions.push({ scrollTop, scrollHeight, clientHeight, label, delta, time: now, isIntentional })
    lastScrollTop = scrollTop
    lastScrollTime = now
  }

  function sampleVisible(label) {
    const rows = Array.from(container.querySelectorAll('[data-vercel-chat-message-row="true"]'))
    const visible = rows.filter((r) => {
      const rect = r.getBoundingClientRect()
      return rect.bottom > 0 && rect.top < window.innerHeight
    })
    const ids = visible.map((r) => r.getAttribute('data-message-id'))
    
    if (state.visibleSamples.length > 0) {
      const prev = state.visibleSamples[state.visibleSamples.length - 1]
      const prevIds = prev.ids || []
      const currSet = new Set(ids)
      // Text disappearance = previously visible IDs that disappeared unexpectedly (not just scrolled out)
      // But during normal scrolling, IDs will scroll out. Only flag if a large batch disappears at once.
      if (prevIds.length > 5 && ids.length > 5) {
        const disappeared = prevIds.filter(id => id && !currSet.has(id))
        // If more than 80% of previously visible items disappeared at once, that's suspicious
        if (disappeared.length > prevIds.length * 0.8) {
          state.textDisappearances++
        }
      }
    }
    
    // Check for blank frames
    if (visible.length === 0 && rows.length > 10) {
      state.blankFrames++
    }
    
    // Check loader element exists in DOM (even if hidden due to hasOlderMessages=false)
    const loader = container.querySelector('[role="status"]')
    if (loader) {
      state.loaderElementExists = true
      if (loader.offsetParent !== null) {
        state.loaderVisible = true
        if (!state.loaderVisibleAt) state.loaderVisibleAt = { label, scrollTop: container.scrollTop, time: Date.now() }
      }
    }
    
    state.visibleSamples.push({ ids, count: visible.length, label, time: Date.now(), totalRows: rows.length })
    state.rowCountHistory.push({ t: 'sample', count: rows.length, time: Date.now(), label })
  }

  // Phase 1: Initial state
  sample('initial')
  sampleVisible('initial')

  // Phase 2: Use actual wheel events for realistic fast scroll to top
  // This simulates real user behavior better than scrollTo()
  const scrollToBottom = () => {
    container.scrollTo({ top: container.scrollHeight, behavior: 'instant' })
  }
  scrollToBottom()
  await new Promise(r => requestAnimationFrame(r))
  sample('after-bottom', true)
  sampleVisible('after-bottom')

  // Fast wheel scroll upward (simulate user flicking upward)
  const wheelEvents = 60
  const wheelDeltaY = -300 // negative = upward
  for (let i = 0; i < wheelEvents; i++) {
    container.dispatchEvent(new WheelEvent('wheel', { deltaY: wheelDeltaY, bubbles: true, cancelable: true }))
    if (i % 5 === 0) {
      await new Promise(r => requestAnimationFrame(r))
      sample(`wheel-${i}`)
      sampleVisible(`wheel-${i}`)
    }
  }
  
  // Let settle
  await new Promise(r => setTimeout(r, 300))
  sample('after-wheel-settle')
  sampleVisible('after-wheel-settle')

  // Phase 3: Programmatic fast scroll to top (intentional, not a bug)
  container.scrollTo({ top: 0, behavior: 'instant' })
  await new Promise(r => setTimeout(r, 100))
  sample('top-intentional', true)
  sampleVisible('top-intentional')

  // Phase 4: Programmatic scroll down (intentional)
  const maxScroll = container.scrollHeight - container.clientHeight
  container.scrollTo({ top: maxScroll * 0.3, behavior: 'instant' })
  await new Promise(r => requestAnimationFrame(r))
  sample('downward-intentional', true)
  sampleVisible('downward-intentional')

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

writeFileSync(join(OUT, 'audit-report-v2.json'), JSON.stringify(report, null, 2))

// Analysis
const issues = []
if (metrics.unexpectedJumps.length > 0) {
  issues.push({ type: 'unexpected-jump', count: metrics.unexpectedJumps.length, details: metrics.unexpectedJumps })
}
if (metrics.textDisappearances > 0) {
  issues.push({ type: 'text-disappearances', count: metrics.textDisappearances })
}
if (metrics.blankFrames > 0) {
  issues.push({ type: 'blank-frames', count: metrics.blankFrames })
}
if (metrics.domRemovals > 0 && metrics.domAdds > 0) {
  // DOM remounts are expected during older history prepend. 
  // In the static 2000-message case, there should be ZERO removals/adds of rows.
  issues.push({ type: 'dom-mutations', removals: metrics.domRemovals, adds: metrics.domAdds, note: 'In static audit page, zero row mutations expected' })
}

const summaryLines = [
  `Audit Summary (v2 - realistic wheel scroll)`,
  `============================================`,
  `URL: ${url}`,
  `Unexpected jumps: ${metrics.unexpectedJumps.length}`,
  `Text disappearances: ${metrics.textDisappearances}`,
  `Blank frames: ${metrics.blankFrames}`,
  `DOM row removals: ${metrics.domRemovals}`,
  `DOM row adds: ${metrics.domAdds}`,
  `Console errors: ${consoleErrors.length}`,
  `Loader element exists in DOM: ${metrics.loaderElementExists}`,
  `Loader visible: ${metrics.loaderVisible}`,
  ``,
  `Issues: ${issues.length > 0 ? JSON.stringify(issues, null, 2) : 'None'}`,
]

writeFileSync(join(OUT, 'audit-summary-v2.txt'), summaryLines.join('\n'))
console.log(summaryLines.join('\n'))
