import http from 'k6/http'
import { check, sleep } from 'k6'
import exec from 'k6/execution'

const BASE_URL = (__ENV.BASE_URL || 'http://127.0.0.1:8787').replace(/\/+$/, '')
const TOKEN = __ENV.MIDDLEWARE_TOKEN || 'test-token'
const RUN_ID = __ENV.RUN_ID || `${Date.now()}`
const SPACE_COUNT = Number(__ENV.SPACE_COUNT || 2)

export const options = {
  scenarios: {
    tab_api_smoke: {
      executor: 'constant-vus',
      vus: Number(__ENV.VUS || 2),
      duration: __ENV.DURATION || '10s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<750'],
  },
}

const headers = {
  Authorization: `Bearer ${TOKEN}`,
  'Content-Type': 'application/json',
}

function request(method, path, body = undefined) {
  const res = http.request(method, `${BASE_URL}${path}`, body === undefined ? null : JSON.stringify(body), { headers })
  check(res, {
    [`${method} ${path} status 2xx`]: (r) => r.status >= 200 && r.status < 300,
  })
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`${method} ${path} failed ${res.status}: ${res.body}`)
  }
  return res.json()
}

export function setup() {
  const version = request('GET', '/api/version')
  check(version, { 'middleware reachable': (v) => v && v.service === 'openclaw-middleware' })

  const spaces = []
  for (let i = 0; i < SPACE_COUNT; i += 1) {
    const created = request('POST', '/api/spaces', { name: `k6 Space ${RUN_ID}-${i}` })
    spaces.push(created.space)
  }
  return { spaces }
}

export default function (data) {
  const vu = exec.vu.idInTest
  const iter = exec.scenario.iterationInTest
  const space = data.spaces[(vu + iter) % data.spaces.length]
  const label = `k6-${RUN_ID}-vu${vu}-iter${iter}`

  request('POST', `/api/spaces/${space.id}/switch`, {})

  const session = request('POST', '/api/sessions', {
    label,
    projectId: null,
    topicId: null,
  }).session

  const chat = request('POST', '/api/chats', {
    name: label,
    sessionKey: session.sessionKey || session.key,
    agentId: 'main',
    spaceId: space.id,
  }).chat

  request('GET', `/api/chats?spaceId=${encodeURIComponent(space.id)}`)
  request('GET', `/api/projects?spaceId=${encodeURIComponent(space.id)}`)
  request('GET', `/api/sessions`)
  request('POST', '/api/commands/middleware_chat_history', {
    input: { sessionKey: chat.sessionKey || session.sessionKey || session.key },
  })

  request('POST', `/api/chats/${chat.id}/archive`, { archived: true })
  sleep(0.1)
}

export function teardown(data) {
  for (const space of data.spaces || []) {
    http.del(`${BASE_URL}/api/spaces/${space.id}`, null, { headers })
  }
}
