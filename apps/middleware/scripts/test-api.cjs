#!/usr/bin/env node
const fs = require('fs')
const cp = require('child_process')
const { createRequire } = require('module')

const BASE = process.env.MIDDLEWARE_TEST_URL || 'http://127.0.0.1:8787'
const TOKEN = process.env.MIDDLEWARE_TOKEN || 'test-token'
const DB_FILE = process.env.MIDDLEWARE_DB_FILE || process.env.MIDDLEWARE_DB || '/tmp/ocmw-api-suite'
const SQLITE_FILE = DB_FILE.endsWith('.sqlite') || DB_FILE.endsWith('.sqlite3') || DB_FILE.endsWith('.db')
  ? DB_FILE
  : DB_FILE.endsWith('.json')
    ? DB_FILE.replace(/\.json$/, '.sqlite')
    : `${DB_FILE}.sqlite`
const JSON_FILE = DB_FILE.endsWith('.json') ? DB_FILE : `${DB_FILE}.json`
const WORKSPACE = process.env.MIDDLEWARE_TEST_WORKSPACE || '/tmp/ocmw-workspace'
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }

async function req(path, opts = {}) {
  const res = await fetch(BASE + path, { ...opts, headers: { ...H, ...(opts.headers || {}) } })
  const text = await res.text()
  const body = text ? JSON.parse(text) : null
  if (!res.ok) throw new Error(`${opts.method || 'GET'} ${path} ${res.status}: ${text}`)
  return body
}
function assert(value, message) { if (!value) throw new Error(message) }

async function main() {
  fs.rmSync(WORKSPACE, { recursive: true, force: true })
  fs.mkdirSync(`${WORKSPACE}/repo`, { recursive: true })
  cp.execSync('git init && git config user.email test@example.com && git config user.name Test && echo base > file.txt && git add file.txt && git commit -m init && echo change >> file.txt', { cwd: `${WORKSPACE}/repo`, stdio: 'ignore' })

  const health = await (await fetch(BASE + '/health')).json()
  assert(health.service === 'openclaw-middleware', 'health')
  assert((await req('/api/version')).service === 'openclaw-middleware', 'version')
  assert((await (await fetch(`${BASE}/api/version?token=${encodeURIComponent(TOKEN)}`)).json()).service === 'openclaw-middleware', 'query-token auth')

  const project = (await req('/api/projects', { method: 'POST', body: JSON.stringify({ name: 'API Project', workspaceRoot: `${WORKSPACE}/repo`, repoRoot: `${WORKSPACE}/repo` }) })).project
  assert((await req(`/api/projects/${project.id}`, { method: 'PATCH', body: JSON.stringify({ name: 'API Project 2', pinned: true }) })).project.pinned, 'project update/pin')
  assert((await req('/api/projects')).projects.some(p => p.id === project.id && p.pinned), 'projects list')

  assert((await req('/api/repos/select', { method: 'POST', body: JSON.stringify({ path: `${WORKSPACE}/repo`, name: 'repo' }) })).ok, 'repo select')
  assert((await req('/api/repos/recent')).repos.some(r => r.path === `${WORKSPACE}/repo`), 'repo recent')
  assert(Array.isArray((await req('/api/repos/scan', { method: 'POST' })).repos), 'repo scan')

  const status = await req(`/api/projects/${project.id}/git/status`)
  assert(status.branch && status.dirty && status.files.some(f => f.path === 'file.txt'), 'git status')
  assert((await req(`/api/projects/${project.id}/git/diff?path=file.txt`)).patch.includes('+change'), 'git diff')
  assert((await req(`/api/projects/${project.id}/git/branches`)).branches.length, 'git branches')

  assert((await req(`/api/projects/${project.id}/workspace/tree`)).entries.some(e => e.name === 'file.txt'), 'workspace tree')
  await req(`/api/projects/${project.id}/workspace/file`, { method: 'PUT', body: JSON.stringify({ path: 'dir/hello.txt', content: 'HELLO_SQLITE' }) })
  assert((await req(`/api/projects/${project.id}/workspace/file?path=dir%2Fhello.txt`)).file.content === 'HELLO_SQLITE', 'workspace read/write')
  assert((await fetch(BASE + `/api/projects/${project.id}/workspace/file?path=..%2Fetc%2Fpasswd`, { headers: H })).status === 403, 'workspace traversal blocked')

  const topic = (await req('/api/topics', { method: 'POST', body: JSON.stringify({ projectId: project.id, name: 'Topic A' }) })).topic
  assert((await req(`/api/topics/${topic.id}`, { method: 'PATCH', body: JSON.stringify({ name: 'Topic B', pinned: true }) })).topic.pinned, 'topic update/pin')
  assert((await req(`/api/topics?projectId=${project.id}`)).topics.some(t => t.id === topic.id && t.pinned), 'topics list')
  assert((await req(`/api/topics/${topic.id}/archive`, { method: 'POST', body: JSON.stringify({ archived: true }) })).archived, 'topic archive')
  await req(`/api/topics/${topic.id}/archive`, { method: 'POST', body: JSON.stringify({ archived: false }) })

  const session = (await req('/api/sessions', { method: 'POST', body: JSON.stringify({ projectId: project.id, topicId: topic.id, label: 'Session A' }) })).session
  assert(session.sessionKey && (await req('/api/sessions')).sessions.some(s => s.sessionKey === session.sessionKey), 'session create/list')

  const chat = (await req('/api/chats', { method: 'POST', body: JSON.stringify({ name: 'Chat A', sessionKey: session.sessionKey, agentId: 'main' }) })).chat
  assert((await req(`/api/chats/${chat.id}/rename`, { method: 'POST', body: JSON.stringify({ name: 'Chat B' }) })).chat.name === 'Chat B', 'chat rename')
  assert((await req(`/api/chats/${chat.id}`, { method: 'PATCH', body: JSON.stringify({ pinned: true }) })).chat.pinned, 'chat pin')
  assert((await req(`/api/chats/${chat.id}/session`, { method: 'POST', body: JSON.stringify({ sessionKey: 'agent:main:test-attached' }) })).chat.sessionKey === 'agent:main:test-attached', 'chat attach')
  assert((await req('/api/chats')).chats.some(c => c.id === chat.id && c.pinned), 'chats list')
  assert((await req(`/api/chats/${chat.id}/archive`, { method: 'POST', body: JSON.stringify({ archived: true }) })).archived, 'chat archive')

  const term = await req(`/api/projects/${project.id}/terminal/spawn`, { method: 'POST', body: JSON.stringify({ cols: 80, rows: 24 }) })
  assert(term.terminalId, 'terminal spawn')
  assert((await req(`/api/terminal/${term.terminalId}/resize`, { method: 'POST', body: JSON.stringify({ cols: 100, rows: 30 }) })).ok, 'terminal resize')
  assert((await req(`/api/terminal/${term.terminalId}/write`, { method: 'POST', body: JSON.stringify({ data: 'echo TERM_OK\\n' }) })).ok, 'terminal write')
  assert((await req(`/api/terminal/${term.terminalId}/kill`, { method: 'POST' })).ok, 'terminal kill')

  assert((await req('/api/commands/middleware_pins_add', { method: 'POST', body: JSON.stringify({ input: { sessionKey: session.sessionKey, messageId: 'm1', messageText: 'Pinned text' } }) })).pin, 'message pin add')
  assert((await req('/api/commands/middleware_pins_list', { method: 'POST', body: JSON.stringify({ input: { sessionKey: session.sessionKey } }) })).pins.some(p => p.messageId === 'm1'), 'message pin list')
  assert((await req('/api/commands/middleware_pins_remove', { method: 'POST', body: JSON.stringify({ input: { sessionKey: session.sessionKey, messageId: 'm1' } }) })).ok, 'message pin remove')
  const cron = await req('/api/commands/middleware_cron_create_job', { method: 'POST', body: JSON.stringify({ input: { name: 'job', schedule: '* * * * *', command: 'echo ok' } }) })
  assert(cron.job.id, 'cron create')
  assert((await req('/api/commands/middleware_cron_list_jobs', { method: 'POST', body: JSON.stringify({ input: {} }) })).jobs.some(j => j.id === cron.job.id), 'cron list')
  assert((await req('/api/commands/middleware_cron_delete_job', { method: 'POST', body: JSON.stringify({ input: { id: cron.job.id } }) })).ok, 'cron delete')
  assert((await req('/api/commands/middleware_branch_list', { method: 'POST', body: JSON.stringify({ input: { sessionKey: session.sessionKey } }) })).branches.length >= 0, 'branch list')
  assert((await req('/api/commands/middleware_models_list', { method: 'POST', body: JSON.stringify({ input: {} }) })).models !== undefined, 'models list')
  assert(typeof (await req('/api/commands/middleware_connect_status', { method: 'POST', body: JSON.stringify({ input: {} }) })) === 'object', 'connect status')
  assert((await req('/api/commands/middleware_memory_write', { method: 'POST', body: JSON.stringify({ input: { path: 'memory/api-test.md', content: 'MEMORY_SQLITE_OK' } }) })).ok, 'memory write')
  assert((await req('/api/commands/middleware_memory_read', { method: 'POST', body: JSON.stringify({ input: { path: 'memory/api-test.md' } }) })).content.includes('MEMORY_SQLITE_OK'), 'memory read')
  assert(Array.isArray((await req('/api/commands/middleware_skills_installed_local', { method: 'POST', body: JSON.stringify({ input: {} }) })).skills), 'skills local')

  await req(`/api/chats/${chat.id}`, { method: 'DELETE' })
  await req(`/api/topics/${topic.id}`, { method: 'DELETE' })
  await req(`/api/projects/${project.id}`, { method: 'DELETE' })

  assert(fs.existsSync(SQLITE_FILE), 'sqlite file exists')
  assert(!fs.existsSync(JSON_FILE), 'json state file should not be created')
  const repoRequire = createRequire(process.cwd() + '/apps/middleware/package.json')
  const Database = repoRequire('better-sqlite3')
  const db = new Database(SQLITE_FILE)
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name).join(' ')
  db.close()
  assert(tables.includes('kv_state') && tables.includes('schema_migrations'), 'sqlite tables')

  console.log('ALL_MIDDLEWARE_API_SQLITE_TESTS_OK')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
