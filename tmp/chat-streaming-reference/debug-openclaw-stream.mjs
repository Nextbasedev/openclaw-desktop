import fs from 'node:fs/promises'
import fssync from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'

const outDir = path.resolve('/root/.openclaw/workspace/Jarvis/tmp/chat-streaming-reference/live-stream-debug')
await fs.mkdir(outDir, { recursive: true })
const config = JSON.parse(await fs.readFile(path.join(os.homedir(), '.openclaw', 'openclaw.json'), 'utf8'))
const token = config?.gateway?.auth?.token
const port = config?.gateway?.port ?? 18789
const wsUrl = `ws://127.0.0.1:${port}`
const identity = JSON.parse(fssync.readFileSync(path.join(os.homedir(), '.openclaw', 'state', 'identity', 'device.json'), 'utf8'))
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')
if (!token) throw new Error('Missing gateway auth token')

function base64UrlEncode(buf) { return buf.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '') }
function derivePublicKeyRaw(publicKeyPem) {
  const key = crypto.createPublicKey(publicKeyPem)
  const spki = key.export({ type: 'spki', format: 'der' })
  if (spki.length === ED25519_SPKI_PREFIX.length + 32 && spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)) return spki.subarray(ED25519_SPKI_PREFIX.length)
  return spki
}
function normalizeDeviceMetadataForAuth(value) { return typeof value === 'string' && value.trim() ? value.trim().replace(/[A-Z]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 32)) : '' }
function buildDeviceAuthPayloadV3({ deviceId, clientId, clientMode, role, scopes, signedAtMs, token, nonce, platform, deviceFamily }) {
  return ['v3', deviceId, clientId, clientMode, role, scopes.join(','), String(signedAtMs), token, nonce, normalizeDeviceMetadataForAuth(platform), normalizeDeviceMetadataForAuth(deviceFamily)].join('|')
}
function signDevicePayload(privateKeyPem, payload) {
  const key = crypto.createPrivateKey(privateKeyPem)
  const sig = crypto.sign(null, Buffer.from(payload, 'utf8'), key)
  return base64UrlEncode(sig)
}
let ws
let nextId = 1
function req(method, params = {}) { return { type: 'req', id: `r${nextId++}`, method, params } }
function waitForResponse(id, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${id}`)), timeoutMs)
    const handler = (event) => {
      const msg = JSON.parse(event.data.toString())
      if (msg?.type === 'res' && msg?.id === id) {
        clearTimeout(timer)
        ws.removeEventListener('message', handler)
        resolve(msg)
      }
    }
    ws.addEventListener('message', handler)
  })
}
async function call(method, params = {}, timeoutMs = 30000) {
  const frame = req(method, params)
  const p = waitForResponse(frame.id, timeoutMs)
  ws.send(JSON.stringify(frame))
  return await p
}
function waitForChallenge() {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('challenge timeout')), 10000)
    const handler = (event) => {
      const msg = JSON.parse(event.data.toString())
      if (msg?.type === 'event' && msg?.event === 'connect.challenge') {
        clearTimeout(timer)
        ws.removeEventListener('message', handler)
        resolve(msg.payload.nonce)
      }
    }
    ws.addEventListener('message', handler)
  })
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

async function main() {
  ws = new WebSocket(wsUrl, { headers: { origin: 'http://127.0.0.1:3000' } })
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('open timeout')), 10000)
    ws.addEventListener('open', () => { clearTimeout(t); resolve() }, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })
  const nonce = await waitForChallenge()
  const scopes = ['operator.read', 'operator.write', 'operator.approvals', 'operator.admin']
  const client = { id: 'openclaw-control-ui', displayName: 'Jarvis Stream Debug', version: '0.0.1', platform: 'web', mode: 'webchat' }
  const signedAt = Date.now()
  const payload = buildDeviceAuthPayloadV3({ deviceId: identity.deviceId, clientId: client.id, clientMode: client.mode, role: 'operator', scopes, signedAtMs: signedAt, token, nonce, platform: client.platform, deviceFamily: '' })
  const connectFrame = req('connect', {
    minProtocol: 3,
    maxProtocol: 3,
    client,
    auth: { token },
    caps: ['chat', 'sessions'],
    scopes,
    device: { id: identity.deviceId, publicKey: base64UrlEncode(derivePublicKeyRaw(identity.publicKeyPem)), signature: signDevicePayload(identity.privateKeyPem, payload), signedAt, nonce },
  })
  const cp = waitForResponse(connectFrame.id)
  ws.send(JSON.stringify(connectFrame))
  const connected = await cp
  if (!connected.ok) throw new Error(JSON.stringify(connected))

  const created = await call('sessions.create', { label: `Jarvis stream debug ${new Date().toISOString()}`, agentId: 'main', model: 'openai-codex/gpt-5.4' })
  const sessionKey = created.payload.key
  await call('sessions.subscribe')
  await call('sessions.messages.subscribe', { key: sessionKey })

  const all = []
  const handler = (event) => {
    const msg = JSON.parse(event.data.toString())
    if (msg?.type === 'event' && msg?.payload?.sessionKey === sessionKey) {
      all.push(msg)
    }
  }
  ws.addEventListener('message', handler)

  const prompt = 'Use the read tool to read /etc/hostname. Then reply with exactly HOSTNAME_CAPTURED and nothing else.'
  for (const verboseLevel of ['on', 'full']) {
    await call('sessions.patch', { key: sessionKey, verboseLevel })
    const send = await call('chat.send', { sessionKey, message: prompt, idempotencyKey: crypto.randomUUID(), timeoutMs: 90000 }, 90000)
    all.push({ marker: 'send', verboseLevel, response: send })
    await sleep(15000)
    all.push({ marker: 'after-wait', verboseLevel, history: await call('chat.history', { sessionKey, limit: 20 }) })
  }

  ws.removeEventListener('message', handler)
  await call('sessions.delete', { key: sessionKey, deleteTranscript: true })
  await fs.writeFile(path.join(outDir, 'events.json'), `${JSON.stringify({ sessionKey, all }, null, 2)}\n`)
  console.log(JSON.stringify({ ok: true, sessionKey, count: all.length }, null, 2))
  ws.close()
}

main().catch(async (error) => {
  await fs.writeFile(path.join(outDir, 'failure.txt'), `${String(error.stack || error)}\n`)
  console.error(error)
  process.exit(1)
})
