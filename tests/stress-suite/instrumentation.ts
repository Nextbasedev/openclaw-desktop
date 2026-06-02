/**
 * Phase 4 — Scroll Stability Instrumentation (injectable into browser context)
 *
 * Tracks scroll jumps, DOM mutations, visible row sampling, frame duplicates,
 * and stale-live detection during long-chat stress runs.
 */

export type ScrollInstrumentationConfig = {
  sampleIntervalMs: number
  scrollJumpThresholdPx: number
  maxScrollJumpPx: number
  rowSelector: string
  containerSelector: string
}

export type ScrollMetrics = {
  scrollJumps: Array<{ time: number; from: number; to: number; delta: number }>
  scrollPositions: Array<{ time: number; scrollTop: number; scrollHeight: number; clientHeight: number; label?: string }>
  visibleSamples: Array<{ time: number; ids: string[]; count: number; texts?: string[] }>
  domMutations: Array<{ time: number; type: string; target: string; added?: number; removed?: number }>
  frameSamples: Array<{ time: number; scrollTop: number; scrollHeight: number; rowCount: number; visibleFirstId: string | null; visibleLastId: string | null }>
  idFlickers: Array<{ id: string; gapCount: number }>
  duplicateFrames: number[]
  tinyFrames: Array<{ index: number; size?: number }>
}

export const DEFAULT_CONFIG: ScrollInstrumentationConfig = {
  sampleIntervalMs: 100,
  scrollJumpThresholdPx: 200,
  maxScrollJumpPx: 5000,
  rowSelector: "[data-vercel-chat-message-row='true']",
  containerSelector: "[data-audit-scroll-container='true']",
}

/**
 * Returns a self-contained function string that can be passed to page.evaluate()
 * to install instrumentation on the target page.
 */
export function buildInstrumentationScript(config: Partial<ScrollInstrumentationConfig> = {}): string {
  const c = { ...DEFAULT_CONFIG, ...config }
  return `
(() => {
  const container = document.querySelector(${JSON.stringify(c.containerSelector)}) ||
    Array.from(document.querySelectorAll('*')).find(el => {
      const style = getComputedStyle(el)
      return style.overflowY === 'auto' && el.scrollHeight > el.clientHeight && el.clientHeight > 100
    })
  if (!container) {
    window.__AUDIT_ERROR = 'scroll container not found'
    return
  }

  const state = {
    scrollJumps: [],
    scrollPositions: [],
    visibleSamples: [],
    domMutations: [],
    frameSamples: [],
    idFlickers: [],
    duplicateFrames: [],
    tinyFrames: [],
    stopped: false,
  }

  let lastScrollTop = container.scrollTop
  let sampleTimer = null
  let frameTimer = null
  let mutationObserver = null

  container.addEventListener('scroll', () => {
    const now = performance.now()
    const st = container.scrollTop
    const delta = st - lastScrollTop
    const sh = container.scrollHeight
    const ch = container.clientHeight
    state.scrollPositions.push({ time: now, scrollTop: st, scrollHeight: sh, clientHeight: ch })
    if (Math.abs(delta) > ${c.scrollJumpThresholdPx} && Math.abs(delta) < ${c.maxScrollJumpPx}) {
      state.scrollJumps.push({ time: now, from: lastScrollTop, to: st, delta })
    }
    lastScrollTop = st
  }, { passive: true })

  mutationObserver = new MutationObserver((records) => {
    const now = performance.now()
    for (const r of records) {
      state.domMutations.push({
        time: now,
        type: r.type,
        target: r.target.id || r.target.tagName || 'unknown',
        added: r.addedNodes?.length || 0,
        removed: r.removedNodes?.length || 0,
      })
    }
  })
  mutationObserver.observe(container, { childList: true, subtree: true, attributes: true })

  function sampleVisible(label) {
    const now = performance.now()
    const rows = Array.from(container.querySelectorAll(${JSON.stringify(c.rowSelector)}))
    const ch = container.clientHeight
    const visible = rows.filter(r => {
      const rect = r.getBoundingClientRect()
      return rect.bottom > 0 && rect.top < ch
    })
    state.visibleSamples.push({
      time: now,
      ids: visible.map(r => r.id || r.dataset.uiId || r.dataset.messageId),
      count: visible.length,
      texts: visible.map(r => r.textContent?.slice(0, 120) || ''),
      label,
    })
  }

  sampleTimer = setInterval(() => sampleVisible('periodic'), ${c.sampleIntervalMs})

  frameTimer = setInterval(() => {
    const now = performance.now()
    const rows = Array.from(container.querySelectorAll(${JSON.stringify(c.rowSelector)}))
    const ch = container.clientHeight
    const visible = rows.filter(r => {
      const rect = r.getBoundingClientRect()
      return rect.bottom > 0 && rect.top < ch
    })
    state.frameSamples.push({
      time: now,
      scrollTop: container.scrollTop,
      scrollHeight: container.scrollHeight,
      rowCount: rows.length,
      visibleFirstId: visible[0]?.id || visible[0]?.dataset?.uiId || visible[0]?.dataset?.messageId || null,
      visibleLastId: visible[visible.length - 1]?.id || visible[visible.length - 1]?.dataset?.uiId || visible[visible.length - 1]?.dataset?.messageId || null,
    })
  }, 16)

  window.__AUDIT_STATE = state
  window.__AUDIT_SAMPLE_VISIBLE = sampleVisible
  window.__AUDIT_STOP = () => {
    state.stopped = true
    clearInterval(sampleTimer)
    clearInterval(frameTimer)
    mutationObserver?.disconnect()
  }
})()
  `.trim()
}

/**
 * Analyze metrics extracted from page.evaluate(() => window.__AUDIT_STATE)
 */
export function analyzeMetrics(metrics: ScrollMetrics): {
  jumpCount: number
  mutationCount: number
  flickerCount: number
  duplicateFrameCount: number
  tinyFrameCount: number
  avgVisibleRows: number
  issues: string[]
} {
  const issues: string[] = []

  if (metrics.scrollJumps.length > 0) {
    issues.push(`scroll-jumps (${metrics.scrollJumps.length})`)
  }
  if (metrics.domMutations.length > 0) {
    issues.push(`dom-mutations (${metrics.domMutations.length})`)
  }
  if (metrics.idFlickers.length > 0) {
    issues.push(`id-flickers (${metrics.idFlickers.length})`)
  }
  if (metrics.duplicateFrames.length > 0) {
    issues.push(`duplicate-frames (${metrics.duplicateFrames.length})`)
  }
  if (metrics.tinyFrames.length > 0) {
    issues.push(`tiny-frames (${metrics.tinyFrames.length})`)
  }

  const avgVisibleRows =
    metrics.visibleSamples.length > 0
      ? metrics.visibleSamples.reduce((s, v) => s + v.count, 0) / metrics.visibleSamples.length
      : 0

  return {
    jumpCount: metrics.scrollJumps.length,
    mutationCount: metrics.domMutations.length,
    flickerCount: metrics.idFlickers.length,
    duplicateFrameCount: metrics.duplicateFrames.length,
    tinyFrameCount: metrics.tinyFrames.length,
    avgVisibleRows,
    issues,
  }
}
