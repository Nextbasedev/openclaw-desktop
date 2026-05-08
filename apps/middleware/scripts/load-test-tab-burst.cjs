#!/usr/bin/env node
const http = require('http')
const https = require('https')
const { execSync } = require('child_process')

const BASE_URL = (process.env.BASE_URL || process.env.MIDDLEWARE_TEST_URL || 'http://127.0.0.1:8787').replace(/\/+$/, '')
const TOKEN = process.env.MIDDLEWARE_TOKEN || 'test-token'
const VUS = Number(process.env.VUS || 2)
const DURATION = process.env.DURATION || '10s'
const SPACE_COUNT = Number(process.env.SPACE_COUNT || 2)
const RUN_ID = process.env.RUN_ID || `tab-burst-${Date.now()}`
const GATEWAY_HISTORY_REQUIRED = process.env.GATEWAY_HISTORY_REQUIRED === 'true'
const GATEWAY_SOCKET_MAX = process.env.GATEWAY_SOCKET_MAX ? Number(process.env.GATEWAY_SOCKET_MAX) : null
const STREAM_HOLD_MS = Number(process.env.STREAM_HOLD_MS || 10_000)
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 120_000)
const STRICT_STREAMS = process.env.STRICT_STREAMS === 'true'

if (!Number.isFinite(VUS) || VUS < 1 || VUS > 100) fail(`VUS must be 1-100, got ${process.env.VUS}`)
if (!Number.isFinite(SPACE_COUNT) || SPACE_COUNT < 1 || SPACE_COUNT > 20) fail(`SPACE_COUNT must be 1-20, got ${process.env.SPACE_COUNT}`)

const deadline = Date.now() + parseDurationMs(DURATION)
const metrics = {
  requests: 0,
  failures: 0,
  historyFailures: 0,
  streamReady: 0,
  streamFailures: 0,
  baselineGatewaySockets: 0,
  maxGatewaySockets: 0,
  maxGatewaySocketDelta: 0,
}

function fail(message) {
  console.error(`TAB_BURST_LOAD_TEST_FAILED ${message}`)
  process.exit(1)
}

function parseDurationMs(value) {
  const match = String(value).trim().match(/^(\d+)(ms|s|m)?$/)
  if (!match) fail(`Invalid DURATION=${value}`)
  const amount = Number(match[1])
  const unit = match[2] || 'ms'
  return unit === 'm' ? amount * 60_000 : unit === 's' ? amount * 1000 : amount
}

function rawRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${BASE_URL}${path}`)
    const data = body === undefined ? null : JSON.stringify(body)
    const client = url.protocol === 'https:' ? https : http
    const req = client.request(url, {
      method,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, (res) => {
      let raw = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { raw += chunk })
      res.on('end', () => {
        metrics.requests += 1
        const ok = (res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300
        let json = null
        try { json = raw ? JSON.parse(raw) : null } catch {}
        if (!ok) {
          metrics.failures += 1
          reject(new Error(`${method} ${path} failed ${res.statusCode}: ${raw.slice(0, 300)}`))
        } else {
          resolve(json)
        }
      })
    })
    req.on('error', reject)
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error(`${method} ${path} timeout`)))
    if (data) req.write(data)
    req.end()
  })
}

async function request(method, path, body) {
  let lastError
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return await rawRequest(method, path, body)
    } catch (error) {
      lastError = error
      const message = error && error.message ? error.message : String(error)
      if (attempt >= 2 || !/ECONNRESET|socket hang up|ETIMEDOUT/i.test(message)) break
      await new Promise((resolve) => setTimeout(resolve, 100 * attempt))
    }
  }
  throw lastError
}

function command(name, input) {
  return request('POST', `/api/commands/${encodeURIComponent(name)}`, { input })
}

function openStream(sessionKey, holdMs = STREAM_HOLD_MS) {
  return new Promise((resolve) => {
    const url = new URL(`${BASE_URL}/api/stream/chat/${encodeURIComponent(sessionKey)}`)
    if (TOKEN) url.searchParams.set('token', TOKEN)
    const client = url.protocol === 'https:' ? https : http
    let ready = false
    let status = 0
    const req = client.get(url, { headers: { Accept: 'text/event-stream', Authorization: `Bearer ${TOKEN}` } }, (res) => {
      status = res.statusCode || 0
      res.setEncoding('utf8')
      res.on('data', (chunk) => {
        if (chunk.includes('event: chat.ready')) ready = true
      })
    })
    req.on('error', () => resolve(false))
    setTimeout(() => {
      req.destroy()
      const ok = status === 200 && ready
      if (ok) metrics.streamReady += 1
      else metrics.streamFailures += 1
      resolve(ok)
    }, holdMs)
  })
}

function gatewaySocketCount() {
  try {
    const out = execSync("ss -tan state established '( dport = :18789 )' | tail -n +2 | wc -l", { encoding: 'utf8' })
    return Number(out.trim() || 0)
  } catch {
    return 0
  }
}

async function safeHistory(sessionKey) {
  try {
    await command('middleware_chat_history', { sessionKey })
  } catch (error) {
    metrics.historyFailures += 1
    if (GATEWAY_HISTORY_REQUIRED) throw error
  }
}

async function createSession(label) {
  const result = await request('POST', '/api/sessions', { label, projectId: null, topicId: null })
  return result?.session?.sessionKey || result?.session?.key || `agent:main:${label}`
}

async function createSpace(index) {
  const created = await request('POST', '/api/spaces', { name: `burst ${RUN_ID}-${index}` })
  return created.space
}

async function runIteration(vu, iter, spaces) {
  const space = spaces[(vu + iter) % spaces.length]
  await request('POST', `/api/spaces/${space.id}/switch`, {})
  const a = await createSession(`${RUN_ID}-vu${vu}-a-${iter}`)
  const b = await createSession(`${RUN_ID}-vu${vu}-b-${iter}`)

  await Promise.all([safeHistory(a), command('middleware_voice_settings_get', {}).catch(() => null), openStream(a)])
  await Promise.all([safeHistory(b), command('middleware_voice_settings_get', {}).catch(() => null), openStream(b)])
  await safeHistory(a)
  await Promise.all([
    request('GET', '/api/sessions'),
    request('GET', `/api/chats?spaceId=${encodeURIComponent(space.id)}`),
    request('GET', `/api/projects?spaceId=${encodeURIComponent(space.id)}`),
    command('middleware_usage', { days: 7 }).catch(() => null),
    command('middleware_usage_daily', { days: 7 }).catch(() => null),
  ])

  const sockets = gatewaySocketCount()
  const delta = Math.max(0, sockets - metrics.baselineGatewaySockets)
  metrics.maxGatewaySockets = Math.max(metrics.maxGatewaySockets, sockets)
  metrics.maxGatewaySocketDelta = Math.max(metrics.maxGatewaySocketDelta, delta)
  if (GATEWAY_SOCKET_MAX !== null && delta > GATEWAY_SOCKET_MAX) {
    throw new Error(`gateway socket delta ${delta} exceeded max ${GATEWAY_SOCKET_MAX} (total=${sockets}, baseline=${metrics.baselineGatewaySockets})`)
  }
}

async function vuLoop(vu, spaces) {
  let iter = 0
  while (Date.now() < deadline) {
    await runIteration(vu, iter++, spaces)
  }
  return iter
}

async function main() {
  metrics.baselineGatewaySockets = gatewaySocketCount()
  metrics.maxGatewaySockets = metrics.baselineGatewaySockets
  console.log(`TAB_BURST_LOAD_TEST_START base=${BASE_URL} vus=${VUS} duration=${DURATION} spaces=${SPACE_COUNT} gatewaySocketBaseline=${metrics.baselineGatewaySockets}`)
  const version = await request('GET', '/api/version')
  if (!version || version.service !== 'openclaw-middleware') fail('middleware /api/version did not report openclaw-middleware')
  const spaces = []
  for (let i = 0; i < SPACE_COUNT; i += 1) spaces.push(await createSpace(i))

  let iterations = []
  try {
    iterations = await Promise.all(Array.from({ length: VUS }, (_, i) => vuLoop(i + 1, spaces)))
  } finally {
    await Promise.allSettled(spaces.map((space) => request('DELETE', `/api/spaces/${space.id}`)))
  }

  const summary = { ...metrics, iterations: iterations.reduce((a, b) => a + b, 0) }
  console.log(`TAB_BURST_LOAD_TEST_SUMMARY ${JSON.stringify(summary)}`)
  if (metrics.failures > 0) fail(`request failures=${metrics.failures}`)
  if (GATEWAY_HISTORY_REQUIRED && metrics.historyFailures > 0) fail(`history failures=${metrics.historyFailures}`)
  if (STRICT_STREAMS && metrics.streamFailures > 0) fail(`stream failures=${metrics.streamFailures}`)
  console.log('TAB_BURST_LOAD_TEST_OK')
}

main().catch((error) => fail(error.stack || error.message || String(error)))
