const { spawn } = require('node:child_process')

function run(name, args) {
  const child = spawn(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', args, {
    stdio: 'inherit',
    env: process.env,
  })
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal)
    if (code) process.exit(code)
  })
  return child
}

console.log('Starting local OpenClaw Desktop stack: middleware + web UI')
const children = [
  run('middleware', ['dev:middleware']),
  run('web', ['--filter', 'ui', 'dev']),
]
process.on('SIGINT', () => { children.forEach(c => c.kill('SIGINT')); process.exit(130) })
process.on('SIGTERM', () => { children.forEach(c => c.kill('SIGTERM')); process.exit(143) })
