import fs from 'node:fs/promises'
import fssync from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'

const outDir = path.resolve('/root/.openclaw/workspace/Jarvis/tmp/chat-streaming-reference/live-tool-output-test')
await fs.mkdir(outDir, { recursive: true })

const config = JSON.parse(await fs.readFile(path.join(os.homedir(), '.openclaw', 'openclaw.json'), 'utf8'))
const token = config?.gateway?.auth?.token
const port = config?.gateway?.port ?? 18789
const wsUrl = `ws://127.0.0.1:${port}`
if (!token) throw new Error('Missing gateway auth token')

const protocolVersion = 3
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')
const identity = JSON.parse(fssync.readFileSync(path.join(os.homedir(), '.openclaw', 'state', 'identity', 'device.json'), 'utf8'))

function base64UrlEncode(buf) {
  return buf.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '')
}

function derivePublicKeyRaw(publicKeyPem) {
  const key = crypto.createPublicKey(publicKeyPem)
  const spki = key.export({ type: 'spki', format: 'der' })
  if (spki.length === ED25519_SPKI_PREFIX.length + 32 && spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)) {
    return spki.subarray(ED25519_SPKI_PREFIX.length)
  }
  return spki
}

function normalizeDeviceMetadataForAuth(value) {
  return typeof value === 'string' && value.trim() ? value.trim().replace(/[A-Z]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 32)) : ''
}

function buildDeviceAuthPayloadV3({ deviceId, clientId, clientMode, role, scopes, signedAtMs, token, nonce, platform, deviceFamily }) {
  return [
    'v3',
    deviceId,
    clientId,
    clientMode,
    role,
    scopes.join(','),
    String(signedAtMs),
    token,
    nonce,
    normalizeDeviceMetadataForAuth(platform),
    normalizeDeviceMetadataForAuth(deviceFamily),
  ].join('|')
}

function signDevicePayload(privateKeyPem, payload) {
  const key = crypto.createPrivateKey(privateKeyPem)
  const sig = crypto.sign(null, Buffer.from(payload, 'utf8'), key)
  return base64UrlEncode(sig)
}

function parseEventData(raw) {
  const lines = raw.split(/\r?\n/)
  const name = lines.find((line) => line.startsWith('event: '))?.slice(7) ?? 'message'
  const data = lines.filter((line) => line.startsWith('data: ')).map((line) => line.slice(6)).join('\n')
  return { event: name, data: data ? JSON.parse(data) : null }
}

let ws
let nextId = 1
const seen = []

function req(method, params = {}) {
  return { type: 'req', id: `r${nextId++}`, method, params }
}

function waitForOpen() {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('ws open timeout')), 10000)
    ws.addEventListener('open', () => {
      clearTimeout(timer)
      resolve()
    }, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })
}

function waitForResponse(id, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for response ${id}`)), timeoutMs)
    const handler = (event) => {
      const msg = JSON.parse(event.data.toString())
      if (msg?.type !== 'res' || msg?.id !== id) return
      clearTimeout(timer)
      ws.removeEventListener('message', handler)
      resolve(msg)
    }
    ws.addEventListener('message', handler)
  })
}

function waitForChallenge(timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout waiting for challenge')), timeoutMs)
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

async function call(method, params = {}, timeoutMs = 30000) {
  const frame = req(method, params)
  const promise = waitForResponse(frame.id, timeoutMs)
  ws.send(JSON.stringify(frame))
  return await promise
}

function waitForRun(sessionKey, runId, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeEventListener('message', handler)
      reject(new Error(`timeout waiting for run ${runId}`))
    }, timeoutMs)
    const runEvents = []
    let assistantMessage = null
    let toolEvent = null

    const handler = (event) => {
      const msg = JSON.parse(event.data.toString())
      if (msg?.type !== 'event') return
      if (msg.event === 'session.tool' && msg.payload?.sessionKey === sessionKey && msg.payload?.runId === runId) {
        runEvents.push(msg)
        toolEvent ||= msg
      }
      if (msg.event === 'session.message' && msg.payload?.sessionKey === sessionKey) {
        runEvents.push(msg)
        const message = msg.payload?.message
        if (message?.role === 'assistant') {
          assistantMessage = msg
        }
      }
      if (toolEvent && assistantMessage) {
        clearTimeout(timer)
        ws.removeEventListener('message', handler)
        resolve({ toolEvent, assistantMessage, runEvents })
      }
    }

    ws.addEventListener('message', handler)
  })
}

async function main() {
  ws = new WebSocket(wsUrl, { headers: { origin: 'http://127.0.0.1:3000' } })
  await waitForOpen()
  const nonce = await waitForChallenge()
  const scopes = ['operator.read', 'operator.write', 'operator.approvals', 'operator.admin']
  const client = {
    id: 'openclaw-control-ui',
    displayName: 'Jarvis Tool Output Test',
    version: '0.0.1',
    platform: 'web',
    mode: 'webchat',
  }
  const signedAt = Date.now()
  const payload = buildDeviceAuthPayloadV3({
    deviceId: identity.deviceId,
    clientId: client.id,
    clientMode: client.mode,
    role: 'operator',
    scopes,
    signedAtMs: signedAt,
    token,
    nonce,
    platform: client.platform,
    deviceFamily: '',
  })
  const connectFrame = req('connect', {
    minProtocol: protocolVersion,
    maxProtocol: protocolVersion,
    client,
    auth: { token },
    caps: ['chat', 'sessions'],
    scopes,
    device: {
      id: identity.deviceId,
      publicKey: base64UrlEncode(derivePublicKeyRaw(identity.publicKeyPem)),
      signature: signDevicePayload(identity.privateKeyPem, payload),
      signedAt,
      nonce,
    },
  })
  const connectPromise = waitForResponse(connectFrame.id)
  ws.send(JSON.stringify(connectFrame))
  const connectRes = await connectPromise
  if (!connectRes.ok) throw new Error(`connect failed: ${JSON.stringify(connectRes)}`)

  await call('sessions.subscribe')
  const createRes = await call('sessions.create', {
    label: `Jarvis tool output test ${new Date().toISOString()}`,
    agentId: 'main',
    model: 'openai-codex/gpt-5.4',
  })
  const sessionKey = createRes?.payload?.key
  if (!sessionKey) throw new Error(`missing session key: ${JSON.stringify(createRes)}`)
  await call('sessions.messages.subscribe', { key: sessionKey })

  const prompt = 'Use the read tool to read /etc/hostname. Then reply with exactly HOSTNAME_CAPTURED and nothing else. You must use the tool before answering.'
  const cases = []

  for (const verboseLevel of ['on', 'full']) {
    const patchRes = await call('sessions.patch', { key: sessionKey, verboseLevel })
    if (!patchRes.ok) throw new Error(`sessions.patch failed for ${verboseLevel}: ${JSON.stringify(patchRes)}`)

    const sendFrame = req('chat.send', {
      sessionKey,
      message: prompt,
      idempotencyKey: crypto.randomUUID(),
      timeoutMs: 90000,
    })
    const sendPromise = waitForResponse(sendFrame.id, 90000)
    ws.send(JSON.stringify(sendFrame))
    const sendRes = await sendPromise
    if (!sendRes.ok) throw new Error(`chat.send failed for ${verboseLevel}: ${JSON.stringify(sendRes)}`)
    const runId = sendRes?.payload?.runId
    if (!runId) throw new Error(`chat.send missing runId for ${verboseLevel}: ${JSON.stringify(sendRes)}`)

    const run = await waitForRun(sessionKey, runId)
    const toolPayload = run.toolEvent.payload?.data ?? {}
    cases.push({
      verboseLevel,
      runId,
      toolPhase: toolPayload.phase ?? null,
      toolName: toolPayload.name ?? null,
      hasArgs: Object.prototype.hasOwnProperty.call(toolPayload, 'args'),
      hasPartialResult: Object.prototype.hasOwnProperty.call(toolPayload, 'partialResult'),
      hasResult: Object.prototype.hasOwnProperty.call(toolPayload, 'result'),
      result: toolPayload.result ?? null,
      partialResult: toolPayload.partialResult ?? null,
      assistantMessage: run.assistantMessage.payload?.message ?? null,
      runEvents: run.runEvents,
    })
  }

  await call('chat.history', { sessionKey, limit: 20 })
  await call('sessions.delete', { key: sessionKey, deleteTranscript: true })
  await fs.writeFile(path.join(outDir, 'result.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(), sessionKey, cases }, null, 2)}\n`)
  console.log(JSON.stringify({ ok: true, outDir, sessionKey, cases: cases.map((c) => ({ verboseLevel: c.verboseLevel, hasResult: c.hasResult, hasPartialResult: c.hasPartialResult })) }, null, 2))
  ws.close()
}

main().catch(async (error) => {
  await fs.writeFile(path.join(outDir, 'failure.txt'), `${String(error.stack || error)}\n`)
  console.error(error)
  process.exit(1)
})
