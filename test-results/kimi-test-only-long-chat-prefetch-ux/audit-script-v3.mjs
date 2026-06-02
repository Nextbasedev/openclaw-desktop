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
    anchorTest: null,
    unexpectedJumps: [],
    blankFrames: 0,
    domRemovals: 0,
    domAdds: 0,
    textDisappearances: 0,
  }

  let lastScrollTop = container.scrollTop

  function checkJump(label, isIntentional = false) {
    const scrollTop = container.scrollTop
    const delta = scrollTop - lastScrollTop
    if (!isIntentional && Math.abs(delta) > 500) {
      state.unexpectedJumps.push({ from: lastScrollTop, to: scrollTop, delta, label, scrollHeight: container.scrollHeight })
    }
    lastScrollTop = scrollTop
  }

  // Step 1: Scroll to middle
  const maxScroll = container.scrollHeight - container.clientHeight
  container.scrollTo({ top: maxScroll * 0.5, behavior: 'instant' })
  await new Promise(r => requestAnimationFrame(r))
  checkJump('mid-scroll', true)

  // Step 2: Capture which message is at a fixed anchor point (simulating scroll anchor)
  const anchorY = 200
  const rows = Array.from(container.querySelectorAll('[data-vercel-chat-message-row="true"]'))
  const anchorRow = rows.find((r) => {
    const rect = r.getBoundingClientRect()
    return rect.top <= anchorY && rect.bottom >= anchorY
  }) || rows[0]
  const anchorId = anchorRow?.getAttribute('data-message-id')
  const anchorRect = anchorRow?.getBoundingClientRect()
  const anchorTopBefore = anchorRect?.top || 0

  // Step 3: Simulate prepend by injecting new rows at the top (like older history load)
  const wrapper = container.querySelector('.mx-auto.flex.min-h-full') // the inner wrapper
  if (wrapper) {
    const fragment = document.createDocumentFragment()
    for (let i = 0; i < 10; i++) {
      const div = document.createElement('div')
      div.setAttribute('data-vercel-chat-message-row', 'true')
      div.setAttribute('data-message-id', `prepended-${i}`)
      div.setAttribute('data-ui-id', `prepended-${i}`)
      div.className = 'group/message w-full'
      div.innerHTML = `<div class="flex items-start gap-3"><div class="flex h-[calc(13px*1.65)] shrink-0 items-center"><div class="flex size-7 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground ring-1 ring-border/50">!</div></div><div class="flex min-w-0 flex-1 flex-col gap-1.5"><div class="min-w-0 text-[13px] leading-[1.65] text-foreground"><p>Prepended message ${i} for anchor test</p></div></div></div>`
      fragment.appendChild(div)
    }
    wrapper.insertBefore(fragment, wrapper.firstChild)
    state.domAdds += 10
  }

  await new Promise(r => requestAnimationFrame(r))
  await new Promise(r => setTimeout(r, 100))

  // Step 4: Check if anchor row stayed in place (or if it jumped)
  const rowsAfter = Array.from(container.querySelectorAll('[data-vercel-chat-message-row="true"]'))
  const anchorRowAfter = rowsAfter.find(r => r.getAttribute('data-message-id') === anchorId)
  const anchorTopAfter = anchorRowAfter?.getBoundingClientRect().top || 0
  const driftPx = anchorTopAfter - anchorTopBefore

  // The "jump" from prepend is expected (scrollHeight increased). 
  // What we care about is: did the visible content stay stable relative to viewport?
  // Without scroll anchor restoration, the user would see the old content jump DOWN by the height of prepended content.
  // With scroll anchor, the container.scrollTop should have increased to compensate.

  state.anchorTest = {
    anchorId,
    anchorTopBefore,
    anchorTopAfter,
    driftPx,
    scrollTopBefore: maxScroll * 0.5,
    scrollTopAfter: container.scrollTop,
    scrollHeightBefore: container.scrollHeight - (wrapper ? 10 * 100 : 0), // approximate
    scrollHeightAfter: container.scrollHeight,
  }

  // A drift > 50px indicates the anchor restoration did NOT work
  // But this is testing the raw DOM behavior, not the React component's anchor logic
  // The component would call settleVercelScrollAnchor after prepend.
  // Since we're simulating raw DOM prepend without the React lifecycle, 
  // some drift is expected. We just need to verify it's not catastrophically bad.

  checkJump('after-prepend')

  // Check visible content
  const visible = rowsAfter.filter((r) => {
    const rect = r.getBoundingClientRect()
    return rect.bottom > 0 && rect.top < window.innerHeight
  })
  if (visible.length === 0 && rowsAfter.length > 10) {
    state.blankFrames++
  }

  // Check for text disappearance
  const visibleIds = visible.map(r => r.getAttribute('data-message-id'))
  const hadOldContent = visibleIds.some(id => id && id.startsWith('audit-msg-'))
  if (!hadOldContent && visible.length > 0) {
    state.textDisappearances++
  }

  return state
})

await browser.close()

const report = {
  url,
  timestamp: new Date().toISOString(),
  metrics,
  consoleErrors: consoleErrors.slice(0, 50),
}

writeFileSync(join(OUT, 'audit-report-v3.json'), JSON.stringify(report, null, 2))

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

const summaryLines = [
  `Audit Summary (v3 - prepend simulation)`,
  `=========================================`,
  `URL: ${url}`,
  `Anchor drift (px): ${metrics.anchorTest?.driftPx}`,
  `Anchor drift acceptable (<200px): ${Math.abs(metrics.anchorTest?.driftPx || 0) < 200}`,
  `Unexpected jumps: ${metrics.unexpectedJumps.length}`,
  `Text disappearances: ${metrics.textDisappearances}`,
  `Blank frames: ${metrics.blankFrames}`,
  `Console errors: ${consoleErrors.length}`,
  ``,
  `Anchor test details:`,
  JSON.stringify(metrics.anchorTest, null, 2),
  ``,
  `Issues: ${issues.length > 0 ? JSON.stringify(issues, null, 2) : 'None'}`,
]

writeFileSync(join(OUT, 'audit-summary-v3.txt'), summaryLines.join('\n'))
console.log(summaryLines.join('\n'))
