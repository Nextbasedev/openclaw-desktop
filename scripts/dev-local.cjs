const { spawn } = require('node:child_process')

const isWindows = process.platform === 'win32'
const pnpmCommand = isWindows ? 'pnpm.cmd' : 'pnpm'

function sanitizeEnv(env) {
  return Object.fromEntries(
    Object.entries(env)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, String(value)]),
  )
}

const children = []
let stopping = false

function run(name, args) {
  const child = spawn(pnpmCommand, args, {
    stdio: 'inherit',
    env: sanitizeEnv(process.env),
    shell: isWindows,
    windowsHide: false,
  })

  child.on('error', (error) => {
    console.error(`[${name}] failed to start pnpm: ${error.message}`)
    stopChildren(1)
  })

  child.on('exit', (code, signal) => {
    if (stopping) return
    if (signal) return stopChildren(1)
    if (code) return stopChildren(code)
  })
  children.push(child)
  return child
}

function stopChildren(code) {
  if (stopping) return
  stopping = true
  for (const child of children) {
    if (!child.killed) child.kill(isWindows ? undefined : 'SIGTERM')
  }
  process.exit(code)
}

console.log('Starting local OpenClaw Desktop stack: middleware-v2 + web UI')
// Legacy middleware is intentionally disabled; middleware-v2 now owns the old 8787 port.
// run('middleware', ['dev:middleware'])
run('middleware-v2', ['dev:middleware:v2'])
run('web', ['dev:ui'])

process.on('SIGINT', () => stopChildren(130))
process.on('SIGTERM', () => stopChildren(143))
