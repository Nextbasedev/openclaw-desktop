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

function run(name, args) {
  const child = spawn(pnpmCommand, args, {
    stdio: 'inherit',
    env: sanitizeEnv(process.env),
    shell: isWindows,
    windowsHide: false,
  })

  child.on('error', (error) => {
    console.error(`[${name}] failed to start pnpm: ${error.message}`)
    process.exit(1)
  })

  child.on('exit', (code, signal) => {
    if (signal) {
      if (!isWindows) process.kill(process.pid, signal)
      process.exit(1)
    }
    if (code) process.exit(code)
  })
  return child
}

function stopChildren(children, code) {
  for (const child of children) {
    if (!child.killed) child.kill(isWindows ? undefined : 'SIGTERM')
  }
  process.exit(code)
}

console.log('Starting local OpenClaw Desktop stack: middleware + middleware-v2 + web UI')
const children = [
  run('middleware', ['dev:middleware']),
  run('middleware-v2', ['dev:middleware:v2']),
  run('web', ['dev:ui']),
]

process.on('SIGINT', () => stopChildren(children, 130))
process.on('SIGTERM', () => stopChildren(children, 143))
