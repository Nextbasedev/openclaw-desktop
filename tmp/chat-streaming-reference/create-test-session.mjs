import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

const config = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.openclaw', 'openclaw.json'), 'utf8'))
const token = config.gateway?.auth?.token
const port = config.gateway?.port ?? 18789
const wsUrl = `ws://127.0.0.1:${port}`
const identity = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.openclaw', 'state', 'identity', 'device.json'), 'utf8'))
const ED = Buffer.from('302a300506032b6570032100', 'hex')

function b64(buf) { return buf.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '') }
function raw(pub) {
  const key = crypto.createPublicKey(pub)
  const spki = key.export({ type: 'spki', format: 'der' })
  return spki.length === ED.length + 32 && spki.subarray(0, ED.length).equals(ED) ? spki.subarray(ED.length) : spki
}
function norm(v) { return typeof v === 'string' && v.trim() ? v.trim().replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32)) : '' }
function authPayload({ deviceId, clientId, clientMode, role, scopes, signedAtMs, token, nonce, platform, deviceFamily }) {
  return ['v3', deviceId, clientId, clientMode, role, scopes.join(','), String(signedAtMs), token, nonce, norm(platform), norm(deviceFamily)].join('|')
}
function sign(priv, payload) { return b64(crypto.sign(null, Buffer.from(payload, 'utf8'), crypto.createPrivateKey(priv))) }
let nextId = 1
const req = (method, params = {}) => ({ type: 'req', id: `r${nextId++}`, method, params })

async function main() {
  const ws = new WebSocket(wsUrl, { headers: { origin: 'http://127.0.0.1:3000' } })
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('open timeout')), 10000)
    ws.addEventListener('open', () => { clearTimeout(t); resolve() }, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })

  const wait = (id, timeoutMs = 15000) => new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout ${id}`)), timeoutMs)
    const h = (event) => {
      const message = JSON.parse(event.data.toString())
      if (message?.type === 'res' && message?.id === id) {
        clearTimeout(t)
        ws.removeEventListener('message', h)
        resolve(message)
      }
    }
    ws.addEventListener('message', h)
  })

  const nonce = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('challenge timeout')), 10000)
    const h = (event) => {
      const message = JSON.parse(event.data.toString())
      if (message?.type === 'event' && message?.event === 'connect.challenge') {
        clearTimeout(t)
        ws.removeEventListener('message', h)
        resolve(message.payload.nonce)
      }
    }
    ws.addEventListener('message', h)
  })

  const scopes = ['operator.read', 'operator.write', 'operator.approvals', 'operator.admin']
  const client = { id: 'openclaw-control-ui', displayName: 'Jarvis Middleware Test', version: '0.0.1', platform: 'web', mode: 'webchat' }
  const signedAt = Date.now()
  const connectFrame = req('connect', {
    minProtocol: 3,
    maxProtocol: 3,
    client,
    auth: { token },
    caps: ['chat', 'sessions'],
    scopes,
    device: {
      id: identity.deviceId,
      publicKey: b64(raw(identity.publicKeyPem)),
      signature: sign(identity.privateKeyPem, authPayload({ deviceId: identity.deviceId, clientId: client.id, clientMode: client.mode, role: 'operator', scopes, signedAtMs: signedAt, token, nonce, platform: client.platform, deviceFamily: '' })),
      signedAt,
      nonce,
    },
  })
  let pending = wait(connectFrame.id)
  ws.send(JSON.stringify(connectFrame))
  const connected = await pending
  if (!connected.ok) throw new Error(JSON.stringify(connected))

  const createFrame = req('sessions.create', {
    label: `Jarvis middleware route test ${new Date().toISOString()}`,
    agentId: 'main',
    model: 'openai-codex/gpt-5.4',
  })
  pending = wait(createFrame.id)
  ws.send(JSON.stringify(createFrame))
  const created = await pending
  if (!created.ok) throw new Error(JSON.stringify(created))

  const patchFrame = req('sessions.patch', {
    key: created.payload.key,
    verboseLevel: 'full',
  })
  pending = wait(patchFrame.id)
  ws.send(JSON.stringify(patchFrame))
  const patched = await pending
  if (!patched.ok) throw new Error(JSON.stringify(patched))

  console.log(created.payload.key)
  ws.close()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
