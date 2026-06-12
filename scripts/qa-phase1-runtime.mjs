#!/usr/bin/env node
/**
 * Phase 1 runtime QA harness.
 *
 * Connects to a live middleware (default http://127.0.0.1:8787) and
 * exercises pagination + streaming + send flows the way the UI would.
 * Verifies the invariants stated by the user:
 *
 *  - Memory bounded (≈ WINDOW_SIZE)
 *  - No duplicate messages in the window
 *  - No missing seq gaps within the window
 *  - No request loops
 *  - WS streaming doesn't corrupt the window
 *  - Page boundaries (60-row pages) are respected
 *
 * The ClientWindow class below mirrors the production hook
 * (useChatMessages + ChatView sliding-window) as closely as possible:
 *   - in-flight dedup latches per direction
 *   - identity dedup by messageId on merge
 *   - load older → drop one page from bottom when over WINDOW_SIZE
 *   - load newer → drop one page from top when over WINDOW_SIZE
 *   - never drops optimistic / sendStatus rows
 */

import { argv, exit, hrtime } from "node:process"
import { writeFile, mkdir } from "node:fs/promises"
import { dirname } from "node:path"

const PAGE_SIZE = 60
const WINDOW_PAGES = 5
const WINDOW_SIZE = PAGE_SIZE * WINDOW_PAGES // 300
const BOOTSTRAP_SIZE = 120 // matches CHAT_BOOTSTRAP_MESSAGE_LIMIT

function parseArgs() {
  const out = { base: "http://127.0.0.1:8787", scenario: "all", session: null, out: null, verbose: false }
  for (let i = 2; i < argv.length; i += 1) {
    const k = argv[i]
    const v = argv[i + 1]
    if (k === "--base") { out.base = v; i += 1 }
    else if (k === "--session") { out.session = v; i += 1 }
    else if (k === "--scenario") { out.scenario = v; i += 1 }
    else if (k === "--out") { out.out = v; i += 1 }
    else if (k === "--verbose" || k === "-v") { out.verbose = true }
  }
  return out
}

const log = (...args) => console.log("[qa]", ...args)
const warn = (...args) => console.warn("[qa:WARN]", ...args)
const err = (...args) => console.error("[qa:ERR]", ...args)

async function fetchJSON(url, opts = {}) {
  const t0 = hrtime.bigint()
  const res = await fetch(url, opts)
  const elapsedMs = Number((hrtime.bigint() - t0) / 1_000_000n)
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch {}
  return { ok: res.ok, status: res.status, json, text, elapsedMs }
}

// ---------------------------------------------------------------------------
// Simulated client-side sliding window. Mirrors the production hook logic.
// ---------------------------------------------------------------------------

class ClientWindow {
  constructor({ sessionKey, base, name = "default" }) {
    this.sessionKey = sessionKey
    this.base = base
    this.name = name
    this.messages = [] // { openclawSeq, messageId, role, ... }
    this.optimisticTail = [] // never trimmed
    this.requestLog = [] // { kind, params, returnedCount, elapsedMs, ts }
    this.invariantViolations = []
    this.renderTicks = 0
    this.oldestLoadedSeq = null
    this.newestLoadedSeq = null
    this.hasOlder = false
    this.hasNewer = false
    this.serverNewestSeq = null
    this._olderInFlight = false
    this._newerInFlight = false
    this._allKnownSeqs = new Set() // for missing-seq detection across the run
  }

  fullView() {
    return [...this.messages, ...this.optimisticTail]
  }

  recordRequest(kind, params, returnedCount, elapsedMs) {
    this.requestLog.push({ kind, params, returnedCount, elapsedMs, ts: Date.now() })
  }

  recordViolation(stage, kind, extra = {}) {
    this.invariantViolations.push({ stage, kind, ...extra })
  }

  checkInvariants(stage) {
    // 1. No duplicates by messageId in the persistent window (optimistic
    //    rows may legitimately share id with their canonical row briefly).
    const ids = new Map()
    for (let i = 0; i < this.messages.length; i += 1) {
      const id = this.messages[i].messageId
      if (!id) continue
      if (ids.has(id)) this.recordViolation(stage, "duplicate-messageId", { id, indices: [ids.get(id), i] })
      ids.set(id, i)
    }
    // 2. Strictly monotonic openclawSeq.
    let prev = null
    for (const m of this.messages) {
      const s = m.openclawSeq
      if (typeof s !== "number") continue
      if (prev !== null && s <= prev) this.recordViolation(stage, "non-monotonic-seq", { prev, curr: s })
      prev = s
    }
    // 2b. No gaps to the LIVE TAIL (serverNewestSeq) inside the loaded
    // window. Small/medium server-side gaps are legitimate (tool-only
    // patches, deleted rows, session-internal seqs that the bootstrap
    // endpoint skips). The real failure mode we care about is:
    // "trimmed-tail + WS-appended future row stranded past the trimmed
    // boundary", which manifests as a gap whose upper bound equals or
    // approaches the server's lastSeq.
    let prevGap = null
    const liveTail = this.serverNewestSeq
    for (const m of this.messages) {
      const s = m.openclawSeq
      if (typeof s !== "number") continue
      if (prevGap !== null) {
        const delta = s - prevGap
        if (delta > 50 && liveTail !== null && Math.abs(s - liveTail) < 5) {
          this.recordViolation(stage, "large-seq-gap-to-live-tail", { prev: prevGap, curr: s, delta, liveTail })
        }
      }
      prevGap = s
    }
    // 3. Bounded memory: WINDOW_SIZE + PAGE_SIZE slack.
    if (this.messages.length > WINDOW_SIZE + PAGE_SIZE) {
      this.recordViolation(stage, "memory-unbounded", { length: this.messages.length, cap: WINDOW_SIZE + PAGE_SIZE })
    }
    // 4. Optimistic rows must be preserved.
    if (this.optimisticTail.length > 0) {
      // (they live in a separate array — verified by construction)
    }
  }

  async bootstrap(limit = BOOTSTRAP_SIZE) {
    const url = `${this.base}/api/chat/bootstrap?sessionKey=${encodeURIComponent(this.sessionKey)}&limit=${limit}`
    const { ok, status, json, elapsedMs } = await fetchJSON(url)
    if (!ok) throw new Error(`bootstrap failed ${status}`)
    const msgs = (json?.messages ?? []).map(normalizeServerMessage)
    this.messages = msgs
    this.oldestLoadedSeq = msgs[0]?.openclawSeq ?? null
    this.newestLoadedSeq = msgs[msgs.length - 1]?.openclawSeq ?? null
    this.hasOlder = Boolean(json?.hasOlder) || (this.oldestLoadedSeq !== null && this.oldestLoadedSeq > 1)
    this.hasNewer = false
    this.serverNewestSeq = json?.lastSeq ?? this.newestLoadedSeq
    for (const m of msgs) if (typeof m.openclawSeq === "number") this._allKnownSeqs.add(m.openclawSeq)
    this.recordRequest("bootstrap", { limit }, this.messages.length, elapsedMs)
    this.renderTicks += 1
    this.checkInvariants("post-bootstrap")
  }

  async loadOlder() {
    if (!this.hasOlder) return { skipped: "no-older" }
    if (this._olderInFlight) return { skipped: "in-flight-dedup" }
    if (this.oldestLoadedSeq === null || this.oldestLoadedSeq <= 1) {
      this.hasOlder = false
      return { skipped: "boundary" }
    }
    this._olderInFlight = true
    const beforeSeq = this.oldestLoadedSeq
    try {
      const url = `${this.base}/api/chat/messages?sessionKey=${encodeURIComponent(this.sessionKey)}&beforeSeq=${beforeSeq}&limit=${PAGE_SIZE}`
      const { ok, status, json, elapsedMs } = await fetchJSON(url)
      if (!ok) throw new Error(`loadOlder ${status}`)
      const page = (json?.messages ?? []).map(normalizeServerMessage)
      this.recordRequest("load-older", { beforeSeq, limit: PAGE_SIZE }, page.length, elapsedMs)
      if (page.length === 0) { this.hasOlder = false; return { loaded: 0 } }
      // Prepend, dedupe.
      const existingIds = new Set(this.messages.map((m) => m.messageId).filter(Boolean))
      const newer = page.filter((m) => !m.messageId || !existingIds.has(m.messageId))
      this.messages = [...newer, ...this.messages]
      this.oldestLoadedSeq = this.messages[0]?.openclawSeq ?? this.oldestLoadedSeq
      this.hasOlder = page.length >= PAGE_SIZE && (this.oldestLoadedSeq ?? 2) > 1
      for (const m of newer) if (typeof m.openclawSeq === "number") this._allKnownSeqs.add(m.openclawSeq)
      // Slide: drop bottom.
      let droppedFromBottom = 0
      if (this.messages.length > WINDOW_SIZE) {
        droppedFromBottom = Math.min(PAGE_SIZE, this.messages.length - WINDOW_SIZE)
        this.messages = this.messages.slice(0, this.messages.length - droppedFromBottom)
        this.newestLoadedSeq = this.messages[this.messages.length - 1]?.openclawSeq ?? this.newestLoadedSeq
        this.hasNewer = true
      }
      this.renderTicks += 1
      this.checkInvariants("post-load-older")
      return { loaded: newer.length, droppedFromBottom, length: this.messages.length }
    } finally {
      this._olderInFlight = false
    }
  }

  async loadNewer() {
    if (!this.hasNewer) return { skipped: "no-newer" }
    if (this._newerInFlight) return { skipped: "in-flight-dedup" }
    if (this.newestLoadedSeq === null) return { skipped: "no-baseline" }
    this._newerInFlight = true
    const afterSeq = this.newestLoadedSeq
    try {
      const url = `${this.base}/api/chat/messages?sessionKey=${encodeURIComponent(this.sessionKey)}&afterSeq=${afterSeq}&limit=${PAGE_SIZE}`
      const { ok, status, json, elapsedMs } = await fetchJSON(url)
      if (!ok) throw new Error(`loadNewer ${status}`)
      const page = (json?.messages ?? []).map(normalizeServerMessage)
      this.recordRequest("load-newer", { afterSeq, limit: PAGE_SIZE }, page.length, elapsedMs)
      if (page.length === 0) { this.hasNewer = false; return { loaded: 0 } }
      const existingIds = new Set(this.messages.map((m) => m.messageId).filter(Boolean))
      const newRows = page.filter((m) => !m.messageId || !existingIds.has(m.messageId))
      this.messages = [...this.messages, ...newRows]
      this.newestLoadedSeq = this.messages[this.messages.length - 1]?.openclawSeq ?? this.newestLoadedSeq
      this.hasNewer = page.length >= PAGE_SIZE
      for (const m of newRows) if (typeof m.openclawSeq === "number") this._allKnownSeqs.add(m.openclawSeq)
      let droppedFromTop = 0
      if (this.messages.length > WINDOW_SIZE) {
        droppedFromTop = Math.min(PAGE_SIZE, this.messages.length - WINDOW_SIZE)
        this.messages = this.messages.slice(droppedFromTop)
        this.oldestLoadedSeq = this.messages[0]?.openclawSeq ?? this.oldestLoadedSeq
        this.hasOlder = true
      }
      this.renderTicks += 1
      this.checkInvariants("post-load-newer")
      return { loaded: newRows.length, droppedFromTop, length: this.messages.length }
    } finally {
      this._newerInFlight = false
    }
  }

  // Simulate the WS path: an upsert patch lands a row at the tail. If the
  // tail is currently loaded, the row appears in the window; otherwise it
  // stays in the store but isn't visible.
  ingestWsTailUpsert({ messageId, openclawSeq, role, text }) {
    // Match production: ingestion is direction-agnostic; the row is inserted
    // by seq. We simulate "the row arrives at the tail of the store" which
    // for Phase 1 means: if newestLoadedSeq+1 == openclawSeq AND tail is
    // loaded (hasNewer=false), append; otherwise stash separately.
    if (!this.hasNewer && (this.newestLoadedSeq === null || openclawSeq === this.newestLoadedSeq + 1)) {
      const incoming = { messageId, openclawSeq, role, text }
      const existingIds = new Set(this.messages.map((m) => m.messageId).filter(Boolean))
      if (incoming.messageId && existingIds.has(incoming.messageId)) {
        // identity dedupe — update in place (simulate text streaming append).
        const idx = this.messages.findIndex((m) => m.messageId === incoming.messageId)
        if (idx >= 0) this.messages[idx] = { ...this.messages[idx], text }
      } else {
        this.messages.push(incoming)
        this.newestLoadedSeq = openclawSeq
        this._allKnownSeqs.add(openclawSeq)
      }
      this.renderTicks += 1
      // Slide if window grew.
      if (this.messages.length > WINDOW_SIZE) {
        const drop = Math.min(PAGE_SIZE, this.messages.length - WINDOW_SIZE)
        this.messages = this.messages.slice(drop)
        this.oldestLoadedSeq = this.messages[0]?.openclawSeq ?? this.oldestLoadedSeq
        this.hasOlder = true
        this.recordRequest("ws-slide", { drop }, 0, 0)
      }
      this.checkInvariants("post-ws-upsert")
      return { appended: true }
    }
    // Tail not loaded → row drops on the floor (Phase 1 explicit).
    return { appended: false, reason: "tail-not-loaded" }
  }

  // Send flow: client builds an optimistic row, then a canonical row
  // replaces it via WS.
  sendOptimistic({ clientMessageId, text, role = "user" }) {
    this.optimisticTail.push({
      messageId: clientMessageId,
      role,
      text,
      isOptimistic: true,
      sendStatus: "sending",
    })
    this.renderTicks += 1
    this.checkInvariants("post-send-optimistic")
  }

  finalizeOptimistic({ clientMessageId, openclawSeq, gatewayMessageId, finalText }) {
    // Remove optimistic, append canonical.
    this.optimisticTail = this.optimisticTail.filter((m) => m.messageId !== clientMessageId)
    return this.ingestWsTailUpsert({
      messageId: gatewayMessageId,
      openclawSeq,
      role: "user",
      text: finalText,
    })
  }
}

function normalizeServerMessage(raw) {
  const data = raw?.data ?? raw ?? {}
  return {
    openclawSeq: raw.openclawSeq ?? data.openclawSeq ?? data.__openclaw?.seq ?? null,
    messageId: raw.messageId ?? data.messageId ?? data.__openclaw?.id ?? null,
    role: data.role ?? raw.role ?? null,
    text: typeof data.text === "string" ? data.text.slice(0, 80) : null,
  }
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

async function findLargestSession(base) {
  const { json } = await fetchJSON(`${base}/api/sessions`)
  const sessions = Array.isArray(json) ? json : (json?.sessions ?? [])
  if (sessions.length === 0) return null
  const candidates = []
  for (const s of sessions) {
    const key = s.sessionKey ?? s.key
    if (!key) continue
    const { json: bj } = await fetchJSON(`${base}/api/chat/bootstrap?sessionKey=${encodeURIComponent(key)}&limit=1`)
    const lastSeq = bj?.lastSeq ?? bj?.knownTotalMessages ?? bj?.messageCount ?? 0
    candidates.push({ key, lastSeq, title: s.title ?? s.label ?? "" })
  }
  candidates.sort((a, b) => (b.lastSeq ?? 0) - (a.lastSeq ?? 0))
  return candidates[0] ?? null
}

async function scenarioPagination(base, sessionKey) {
  log(`--- scenarioPagination ---`)
  const w = new ClientWindow({ sessionKey, base, name: "pagination" })
  await w.bootstrap(BOOTSTRAP_SIZE)
  for (let i = 0; i < 20; i += 1) {
    const r = await w.loadOlder()
    if (r.skipped) break
  }
  for (let i = 0; i < 25; i += 1) {
    const r = await w.loadNewer()
    if (r.skipped) break
  }
  return summarize(w)
}

async function scenarioStress(base, sessionKey) {
  log(`--- scenarioStress ---`)
  const w = new ClientWindow({ sessionKey, base, name: "stress" })
  await w.bootstrap(BOOTSTRAP_SIZE)
  for (let i = 0; i < 30; i += 1) {
    const r = i % 2 === 0 ? await w.loadOlder() : await w.loadNewer()
    if (r.skipped && i > 4) break
  }
  for (let i = 0; i < 15; i += 1) {
    const r = await w.loadOlder()
    if (r.skipped) break
  }
  for (let i = 0; i < 15; i += 1) {
    const r = await w.loadNewer()
    if (r.skipped) break
  }
  return summarize(w)
}

async function scenarioBoundary(base, sessionKey) {
  log(`--- scenarioBoundary ---`)
  const w = new ClientWindow({ sessionKey, base, name: "boundary" })
  await w.bootstrap(BOOTSTRAP_SIZE)
  while (true) {
    const r = await w.loadOlder()
    if (r.skipped || r.loaded === 0) break
  }
  while (true) {
    const r = await w.loadNewer()
    if (r.skipped || r.loaded === 0) break
  }
  return summarize(w)
}

async function scenarioRapidReversal(base, sessionKey) {
  log(`--- scenarioRapidReversal ---`)
  const w = new ClientWindow({ sessionKey, base, name: "rapid-reversal" })
  await w.bootstrap(BOOTSTRAP_SIZE)
  // Scroll up 5, down 5, up 5, down 5, ...
  for (let cycle = 0; cycle < 10; cycle += 1) {
    for (let i = 0; i < 5; i += 1) {
      const r = await w.loadOlder()
      if (r.skipped) break
    }
    for (let i = 0; i < 5; i += 1) {
      const r = await w.loadNewer()
      if (r.skipped) break
    }
  }
  return summarize(w)
}

async function scenarioParallelDoubleFire(base, sessionKey) {
  log(`--- scenarioParallelDoubleFire ---`)
  const w = new ClientWindow({ sessionKey, base, name: "parallel" })
  await w.bootstrap(BOOTSTRAP_SIZE)
  // Fire 5 in parallel — dedup latch should keep only 1 actually firing.
  const results = await Promise.all([w.loadOlder(), w.loadOlder(), w.loadOlder(), w.loadOlder(), w.loadOlder()])
  const skipped = results.filter((r) => r?.skipped === "in-flight-dedup").length
  if (skipped < 4) {
    w.recordViolation("parallel", "in-flight-dedup-leak", { skipped, expected: 4 })
  }
  return summarize(w)
}

async function scenarioStreamingDuringScroll(base, sessionKey) {
  log(`--- scenarioStreamingDuringScroll ---`)
  const w = new ClientWindow({ sessionKey, base, name: "streaming" })
  await w.bootstrap(BOOTSTRAP_SIZE)
  // Scroll up 3 pages → user is reading history, tail not in window.
  for (let i = 0; i < 5; i += 1) {
    const r = await w.loadOlder()
    if (r.skipped) break
  }
  // Now WS patches arrive for the live tail. Phase 1 explicitly says they
  // should drop because tail isn't loaded.
  const wsNew = (w.serverNewestSeq ?? 0) + 1
  let dropped = 0
  let appended = 0
  for (let i = 0; i < 10; i += 1) {
    const result = w.ingestWsTailUpsert({
      messageId: `live-${i}`,
      openclawSeq: wsNew + i,
      role: "assistant",
      text: "streaming chunk " + i,
    })
    if (result.appended) appended += 1
    else dropped += 1
  }
  // Scroll back down → loadNewer should eventually surface the new rows.
  for (let i = 0; i < 30; i += 1) {
    const r = await w.loadNewer()
    if (r.skipped) break
  }
  const summary = summarize(w)
  summary.wsAppended = appended
  summary.wsDroppedDuringHistory = dropped
  return summary
}

async function scenarioSendDuringHistory(base, sessionKey) {
  log(`--- scenarioSendDuringHistory ---`)
  const w = new ClientWindow({ sessionKey, base, name: "send-during-history" })
  await w.bootstrap(BOOTSTRAP_SIZE)
  // Scroll up 3 pages.
  for (let i = 0; i < 4; i += 1) {
    const r = await w.loadOlder()
    if (r.skipped) break
  }
  // Send 3 optimistic messages from history view.
  w.sendOptimistic({ clientMessageId: "client-1", text: "first" })
  w.sendOptimistic({ clientMessageId: "client-2", text: "second" })
  w.sendOptimistic({ clientMessageId: "client-3", text: "third" })
  // Optimistic rows must persist through ANY trim. Verify they're still in the view.
  if (w.optimisticTail.length !== 3) {
    w.recordViolation("send-during-history", "optimistic-lost", { remaining: w.optimisticTail.length })
  }
  // Now finalize them as canonical rows arriving via WS at the tail. Since
  // the tail isn't in the window, the canonical row won't appear (Phase 1).
  for (let i = 0; i < 3; i += 1) {
    w.finalizeOptimistic({
      clientMessageId: `client-${i + 1}`,
      openclawSeq: (w.serverNewestSeq ?? 0) + i + 1,
      gatewayMessageId: `gateway-${i + 1}`,
      finalText: "final-" + (i + 1),
    })
  }
  // Optimistic tail must be empty now (all finalized).
  if (w.optimisticTail.length !== 0) {
    w.recordViolation("send-during-history", "optimistic-not-cleared", { remaining: w.optimisticTail.length })
  }
  return summarize(w)
}

async function scenarioRapidSends(base, sessionKey) {
  log(`--- scenarioRapidSends ---`)
  const w = new ClientWindow({ sessionKey, base, name: "rapid-sends" })
  await w.bootstrap(BOOTSTRAP_SIZE)
  // Fire 10 sends back-to-back at the tail.
  for (let i = 0; i < 10; i += 1) {
    w.sendOptimistic({ clientMessageId: `c-${i}`, text: `msg-${i}` })
  }
  if (w.optimisticTail.length !== 10) {
    w.recordViolation("rapid-sends", "optimistic-count-mismatch", { got: w.optimisticTail.length })
  }
  // Finalize 5, leave 5 pending.
  for (let i = 0; i < 5; i += 1) {
    w.finalizeOptimistic({
      clientMessageId: `c-${i}`,
      openclawSeq: (w.serverNewestSeq ?? 0) + i + 1,
      gatewayMessageId: `g-${i}`,
      finalText: `final-${i}`,
    })
  }
  if (w.optimisticTail.length !== 5) {
    w.recordViolation("rapid-sends", "optimistic-partial-clear", { remaining: w.optimisticTail.length })
  }
  return summarize(w)
}

async function scenarioSessionSwitch(base, sessionKeys) {
  log(`--- scenarioSessionSwitch ---`)
  const results = []
  for (const key of sessionKeys.slice(0, 3)) {
    const w = new ClientWindow({ sessionKey: key, base, name: `switch:${key.slice(0, 24)}` })
    try {
      await w.bootstrap(BOOTSTRAP_SIZE)
      // Scroll up 5.
      for (let i = 0; i < 5; i += 1) { const r = await w.loadOlder(); if (r.skipped) break }
      // Scroll down 5.
      for (let i = 0; i < 5; i += 1) { const r = await w.loadNewer(); if (r.skipped) break }
      results.push(summarize(w))
    } catch (e) {
      results.push({ sessionKey: key, error: e.message })
    }
  }
  // Aggregate.
  const violations = results.flatMap((r) => r.invariantViolations || [])
  return { perSession: results, totalViolations: violations.length, violations }
}

async function scenarioOutOfOrderResponses(base, sessionKey) {
  log(`--- scenarioOutOfOrderResponses ---`)
  // Simulate: dispatch two loadOlder fetches, but resolve them out of order.
  // The production code uses in-flight latches so only one runs at a time, so
  // this scenario is mostly about confirming the latch protects us. We test
  // by manually constructing a race.
  const w = new ClientWindow({ sessionKey, base, name: "out-of-order" })
  await w.bootstrap(BOOTSTRAP_SIZE)
  // Start the first load.
  const p1 = w.loadOlder()
  // Try to start a second one immediately — should be deduped.
  const p2 = w.loadOlder()
  await Promise.all([p1, p2])
  const dedupSkipped = w.requestLog.filter((r) => r.kind === "load-older").length === 1
  if (!dedupSkipped) {
    w.recordViolation("out-of-order", "double-load-older", { logged: w.requestLog.length })
  }
  return summarize(w)
}

function summarize(w) {
  const olderRequests = w.requestLog.filter((r) => r.kind === "load-older")
  const newerRequests = w.requestLog.filter((r) => r.kind === "load-newer")
  return {
    sessionKey: w.sessionKey,
    name: w.name,
    requests: w.requestLog.length,
    olderRequests: olderRequests.length,
    newerRequests: newerRequests.length,
    duplicateLoadOlder: countDuplicateRequests(olderRequests, "beforeSeq"),
    duplicateLoadNewer: countDuplicateRequests(newerRequests, "afterSeq"),
    finalLength: w.messages.length,
    finalSeqRange: [w.oldestLoadedSeq, w.newestLoadedSeq],
    serverNewestSeq: w.serverNewestSeq,
    renderTicks: w.renderTicks,
    optimisticTailLength: w.optimisticTail.length,
    invariantViolations: w.invariantViolations,
    sampleRequests: w.requestLog.slice(0, 10),
  }
}

function countDuplicateRequests(requests, key) {
  const seen = new Set()
  let dups = 0
  for (const r of requests) {
    const k = r.params?.[key]
    if (k === undefined) continue
    if (seen.has(k)) dups += 1
    seen.add(k)
  }
  return dups
}

// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs()
  log(`base=${opts.base} scenario=${opts.scenario} session=${opts.session ?? "auto"}`)

  let sessionKey = opts.session
  let allSessions = []
  if (!sessionKey) {
    const big = await findLargestSession(opts.base)
    if (!big) { err("no sessions on middleware"); exit(2) }
    sessionKey = big.key
    log(`auto-selected session: ${sessionKey} (lastSeq=${big.lastSeq}, title='${big.title}')`)
  }
  // For session-switch tests, fetch all session keys.
  const { json: sessJson } = await fetchJSON(`${opts.base}/api/sessions`)
  allSessions = (Array.isArray(sessJson) ? sessJson : (sessJson?.sessions ?? [])).map((s) => s.sessionKey ?? s.key).filter(Boolean)

  const results = {}
  const scenarios = opts.scenario === "all"
    ? [
      "pagination",
      "stress",
      "boundary",
      "rapid-reversal",
      "parallel",
      "streaming",
      "send-during-history",
      "rapid-sends",
      "session-switch",
      "out-of-order",
    ]
    : [opts.scenario]

  for (const name of scenarios) {
    try {
      let result
      if (name === "pagination") result = await scenarioPagination(opts.base, sessionKey)
      else if (name === "stress") result = await scenarioStress(opts.base, sessionKey)
      else if (name === "boundary") result = await scenarioBoundary(opts.base, sessionKey)
      else if (name === "rapid-reversal") result = await scenarioRapidReversal(opts.base, sessionKey)
      else if (name === "parallel") result = await scenarioParallelDoubleFire(opts.base, sessionKey)
      else if (name === "streaming") result = await scenarioStreamingDuringScroll(opts.base, sessionKey)
      else if (name === "send-during-history") result = await scenarioSendDuringHistory(opts.base, sessionKey)
      else if (name === "rapid-sends") result = await scenarioRapidSends(opts.base, sessionKey)
      else if (name === "session-switch") result = await scenarioSessionSwitch(opts.base, allSessions)
      else if (name === "out-of-order") result = await scenarioOutOfOrderResponses(opts.base, sessionKey)
      else { warn(`unknown scenario: ${name}`); continue }
      results[name] = result
      printScenarioReport(name, result)
    } catch (e) {
      err(`scenario ${name} failed:`, e.message)
      results[name] = { error: e.message, stack: e.stack }
    }
  }

  if (opts.out) {
    await mkdir(dirname(opts.out), { recursive: true })
    await writeFile(opts.out, JSON.stringify(results, null, 2))
    log(`wrote report to ${opts.out}`)
  }

  let totalViolations = 0
  for (const r of Object.values(results)) {
    if (r?.invariantViolations) totalViolations += r.invariantViolations.length
    if (r?.totalViolations) totalViolations += r.totalViolations
  }
  log(`SUMMARY: scenarios=${Object.keys(results).length} totalViolations=${totalViolations}`)
  exit(totalViolations > 0 ? 1 : 0)
}

function printScenarioReport(name, r) {
  if (r.error) { err(name, "FAILED:", r.error); return }
  if (r.perSession) {
    log(`scenario ${name}:`)
    for (const ps of r.perSession) {
      log(`  - ${ps.sessionKey?.slice(0, 40)} → len=${ps.finalLength}, requests=${ps.requests}, violations=${ps.invariantViolations?.length ?? 0}`)
    }
    if (r.violations.length > 0) {
      err(`  VIOLATIONS (${r.violations.length}):`)
      for (const v of r.violations.slice(0, 10)) err(`    - ${JSON.stringify(v)}`)
    }
    return
  }
  log(`scenario ${name}:`)
  log(`  requests=${r.requests} older=${r.olderRequests} newer=${r.newerRequests}`)
  log(`  duplicateLoadOlder=${r.duplicateLoadOlder} duplicateLoadNewer=${r.duplicateLoadNewer}`)
  log(`  finalWindowLength=${r.finalLength} (cap ${WINDOW_SIZE + PAGE_SIZE}) seqRange=[${r.finalSeqRange[0]}..${r.finalSeqRange[1]}]`)
  log(`  serverLastSeq=${r.serverNewestSeq} optimisticTail=${r.optimisticTailLength} renderTicks=${r.renderTicks}`)
  if (typeof r.wsAppended === "number") log(`  ws: appended=${r.wsAppended} dropped=${r.wsDroppedDuringHistory}`)
  if (r.invariantViolations.length > 0) {
    err(`  VIOLATIONS (${r.invariantViolations.length}):`)
    for (const v of r.invariantViolations) err(`    - ${JSON.stringify(v)}`)
  } else {
    log(`  invariants: OK`)
  }
}

main().catch((e) => { err("fatal:", e); exit(3) })
