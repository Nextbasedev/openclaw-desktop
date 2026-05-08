import http from 'k6/http'
import { check, sleep } from 'k6'
import exec from 'k6/execution'

const BASE_URL = (__ENV.BASE_URL || 'http://127.0.0.1:8787').replace(/\/+$/, '')
const TOKEN = __ENV.MIDDLEWARE_TOKEN || 'test-token'
const RUN_ID = __ENV.RUN_ID || `${Date.now()}`
const SPACE_COUNT = Number(__ENV.SPACE_COUNT || 3)
const SESSION_COUNT = Number(__ENV.SESSION_COUNT || __ENV.VUS || 12)
const HISTORY_REQUIRED = __ENV.GATEWAY_HISTORY_REQUIRED === 'true'

export const options = {
  scenarios: {
    reliability_tab_switch: {
      executor: 'constant-vus',
      vus: Number(__ENV.VUS || 12),
      duration: __ENV.DURATION || '2m',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<10000'],
    checks: ['rate>0.99'],
  },
}

const headers = {
  Authorization: `Bearer ${TOKEN}`,
  'Content-Type': 'application/json',
}

function request(method, path, body = undefined, required = true) {
  const res = http.request(method, `${BASE_URL}${path}`, body === undefined ? null : JSON.stringify(body), {
    headers,
    timeout: '30s',
  })
  const ok = check(res, {
    [`${method} ${path} 2xx`]: (r) => r.status >= 200 && r.status < 300,
  })
  if (required && !ok) {
    sleep(0.25)
    throw new Error(`${method} ${path} failed ${res.status}: ${String(res.body).slice(0, 300)}`)
  }
  try { return res.json() } catch { return null }
}

function command(name, input = {}, required = true) {
  return request('POST', `/api/commands/${encodeURIComponent(name)}`, { input }, required)
}

export function setup() {
  const version = request('GET', '/api/version')
  check(version, { 'middleware reachable': (v) => v && v.service === 'openclaw-middleware' })

  const spaces = []
  for (let i = 0; i < SPACE_COUNT; i += 1) {
    const created = request('POST', '/api/spaces', { name: `reliability ${RUN_ID}-${i}` })
    spaces.push(created.space)
  }
  const sessions = []
  for (let i = 0; i < SESSION_COUNT; i += 1) {
    const space = spaces[i % spaces.length]
    request('POST', `/api/spaces/${space.id}/switch`, {})
    const created = request('POST', '/api/sessions', { label: `reliability-${RUN_ID}-session-${i}`, projectId: null, topicId: null }).session
    sessions.push({ ...(created || {}), spaceId: space.id })
  }
  return { spaces, sessions }
}

export default function (data) {
  const vu = exec.vu.idInTest
  const iter = exec.scenario.iterationInTest
  const space = data.spaces[(vu + iter) % data.spaces.length]
  const a = data.sessions[(vu + iter) % data.sessions.length]
  const b = data.sessions[(vu + iter + 1) % data.sessions.length]
  const aKey = a.sessionKey || a.key
  const bKey = b.sessionKey || b.key

  request('POST', `/api/spaces/${space.id}/switch`, {})

  // Simulate Chat A -> Chat B -> Chat A tab switching read pattern.
  command('middleware_chat_history', { sessionKey: aKey }, HISTORY_REQUIRED)
  command('middleware_branch_list', { sourceSessionKey: aKey }, false)
  command('middleware_voice_settings_get', {}, false)

  command('middleware_chat_history', { sessionKey: bKey }, HISTORY_REQUIRED)
  command('middleware_branch_list', { sourceSessionKey: bKey }, false)
  command('middleware_voice_settings_get', {}, false)

  command('middleware_chat_history', { sessionKey: aKey }, HISTORY_REQUIRED)

  request('GET', '/api/sessions')
  request('GET', `/api/chats?spaceId=${encodeURIComponent(space.id)}`)
  request('GET', `/api/projects?spaceId=${encodeURIComponent(space.id)}`)
  command('middleware_usage', { days: 7 }, false)
  command('middleware_usage_daily', { days: 7 }, false)

  sleep(0.1)
}

export function teardown(data) {
  for (const space of data.spaces || []) {
    http.del(`${BASE_URL}/api/spaces/${space.id}`, null, { headers })
  }
}
