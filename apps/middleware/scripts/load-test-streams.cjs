#!/usr/bin/env node
const http = require('http')
const https = require('https')

const BASE_URL = (process.env.BASE_URL || process.env.MIDDLEWARE_TEST_URL || 'http://127.0.0.1:8787').replace(/\/+$/, '')
const TOKEN = process.env.MIDDLEWARE_TOKEN || 'test-token'
const STREAMS = Number(process.env.STREAMS || 2)
const DURATION_MS = Number(process.env.DURATION_MS || 70_000)
const SESSION_PREFIX = process.env.SESSION_PREFIX || `stream-load-${Date.now()}`
const MIN_READY_EVENTS = Number(process.env.MIN_READY_EVENTS || STREAMS)

if (!Number.isFinite(STREAMS) || STREAMS < 1 || STREAMS > 20) {
  console.error('STREAMS must be between 1 and 20 for this RAM-friendly test')
  process.exit(1)
}
if (!Number.isFinite(DURATION_MS) || DURATION_MS < 60_000) {
  console.error('DURATION_MS must be at least 60000 for long-running stream test')
  process.exit(1)
}

function openStream(index) {
  return new Promise((resolve) => {
    const sessionKey = `${SESSION_PREFIX}-${index}`
    const url = new URL(`${BASE_URL}/api/stream/chat/${encodeURIComponent(sessionKey)}`)
    if (TOKEN) url.searchParams.set('token', TOKEN)
    const client = url.protocol === 'https:' ? https : http
    const startedAt = Date.now()
    let bytes = 0
    let ready = false
    let status = 0
    let endedEarly = false
    let settled = false

    const req = client.get(url, {
      headers: {
        Accept: 'text/event-stream',
        ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
      },
    }, (res) => {
      status = res.statusCode || 0
      res.setEncoding('utf8')
      res.on('data', (chunk) => {
        bytes += Buffer.byteLength(chunk)
        if (chunk.includes('event: chat.ready')) ready = true
      })
      res.on('end', () => {
        if (!settled) endedEarly = true
      })
    })

    req.on('error', (error) => {
      if (!settled) {
        settled = true
        resolve({ index, sessionKey, ok: false, status, ready, bytes, durationMs: Date.now() - startedAt, error: error.message, endedEarly: true })
      }
    })

    const stopTimer = setTimeout(() => {
      settled = true
      req.destroy()
      resolve({ index, sessionKey, ok: status === 200 && ready && !endedEarly, status, ready, bytes, durationMs: Date.now() - startedAt, endedEarly })
    }, DURATION_MS)

    req.setTimeout(DURATION_MS + 5_000, () => {
      clearTimeout(stopTimer)
      if (!settled) {
        settled = true
        req.destroy()
        resolve({ index, sessionKey, ok: false, status, ready, bytes, durationMs: Date.now() - startedAt, error: 'request timeout', endedEarly: true })
      }
    })
  })
}

async function main() {
  console.log(`Opening ${STREAMS} SSE stream(s) for ${DURATION_MS}ms against ${BASE_URL}`)
  const results = await Promise.all(Array.from({ length: STREAMS }, (_, i) => openStream(i + 1)))
  const readyCount = results.filter((r) => r.ready).length
  const failed = results.filter((r) => !r.ok)
  for (const result of results) {
    console.log(JSON.stringify(result))
  }
  if (readyCount < MIN_READY_EVENTS || failed.length > 0) {
    console.error(`STREAM_LOAD_TEST_FAILED ready=${readyCount}/${STREAMS} failed=${failed.length}`)
    process.exit(1)
  }
  console.log(`STREAM_LOAD_TEST_OK ready=${readyCount}/${STREAMS} durationMs=${DURATION_MS}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
