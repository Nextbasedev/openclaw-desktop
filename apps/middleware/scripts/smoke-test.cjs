#!/usr/bin/env node
const BASE = (process.env.MIDDLEWARE_TEST_URL || 'http://127.0.0.1:8787').replace(/\/+$/, '')

function assert(value, message) {
  if (!value) throw new Error(message)
}

async function getJson(path) {
  const res = await fetch(`${BASE}${path}`, { headers: { 'Cache-Control': 'no-cache' } })
  const text = await res.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch {}
  if (!res.ok) throw new Error(`GET ${path} failed ${res.status}: ${text}`)
  return body
}

async function main() {
  const health = await getJson('/health')
  assert(health.ok === true, 'health.ok must be true')
  assert(health.service === 'openclaw-middleware', `unexpected health service: ${health.service}`)
  assert(health.port === 8787 || typeof health.port === 'number', 'health.port must be present')
  assert(health.openclaw && typeof health.openclaw.connected === 'boolean', 'health.openclaw.connected must be boolean')

  const version = await getJson('/api/version')
  assert(version.ok === true, 'version.ok must be true')
  assert(version.service === 'openclaw-middleware', `unexpected version service: ${version.service}`)

  const pairing = await getJson('/pairing/local')
  assert(pairing.ok === true, 'pairing.ok must be true')
  assert(pairing.url, 'pairing.url must be present')
  assert(pairing.mode === 'local', `unexpected pairing mode: ${pairing.mode}`)

  console.log(`MIDDLEWARE_SMOKE_OK ${BASE} openclaw.connected=${health.openclaw.connected}`)
}

main().catch((error) => {
  console.error(`MIDDLEWARE_SMOKE_FAILED ${error?.message || error}`)
  process.exit(1)
})
