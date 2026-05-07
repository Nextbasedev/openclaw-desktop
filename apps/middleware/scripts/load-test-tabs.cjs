#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const root = path.resolve(__dirname, '..')
const script = path.join(root, 'load-tests', 'middleware-tabs.k6.js')
const baseUrl = process.env.BASE_URL || process.env.MIDDLEWARE_TEST_URL || 'http://127.0.0.1:8787'
const token = process.env.MIDDLEWARE_TOKEN || 'test-token'
const vus = process.env.VUS || '2'
const duration = process.env.DURATION || '10s'
const runId = process.env.RUN_ID || `local-${Date.now()}`

if (!fs.existsSync(script)) {
  console.error(`Missing k6 script: ${script}`)
  process.exit(1)
}

const env = {
  ...process.env,
  BASE_URL: baseUrl,
  MIDDLEWARE_TOKEN: token,
  VUS: vus,
  DURATION: duration,
  RUN_ID: runId,
}

function runLocalK6() {
  return spawnSync('k6', ['run', script], { stdio: 'inherit', env })
}

function runDockerK6() {
  const repoRoot = path.resolve(root, '..', '..')
  const inContainerScript = '/repo/apps/middleware/load-tests/middleware-tabs.k6.js'
  return spawnSync('docker', [
    'run', '--rm', '--network', 'host',
    '-e', `BASE_URL=${baseUrl}`,
    '-e', `MIDDLEWARE_TOKEN=${token}`,
    '-e', `VUS=${vus}`,
    '-e', `DURATION=${duration}`,
    '-e', `RUN_ID=${runId}`,
    '-v', `${repoRoot}:/repo:ro`,
    'grafana/k6:latest', 'run', inContainerScript,
  ], { stdio: 'inherit', env: process.env })
}

let result = runLocalK6()
if (result.error && result.error.code === 'ENOENT') {
  console.log('Local k6 not found; using docker grafana/k6:latest')
  result = runDockerK6()
}
if (result.error) {
  console.error(result.error)
  process.exit(1)
}
process.exit(result.status ?? 1)
