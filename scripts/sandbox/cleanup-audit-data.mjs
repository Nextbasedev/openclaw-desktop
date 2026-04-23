#!/usr/bin/env node

const DEFAULT_SERVER_URL = "http://127.0.0.1:3001"

function parseArgs(argv) {
  const options = { serverUrl: DEFAULT_SERVER_URL, dryRun: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--dry-run") {
      options.dryRun = true
      continue
    }
    if (!arg.startsWith("--")) continue
    const [key, inlineValue] = arg.slice(2).split("=", 2)
    const value = inlineValue ?? argv[index + 1]
    if (inlineValue === undefined) index += 1
    if (key === "server-url") options.serverUrl = value
    else throw new Error(`Unknown option: --${key}`)
  }
  return options
}

async function invoke(serverUrl, command, input = {}) {
  const response = await fetch(`${serverUrl}/api/ipc/${command}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input }),
  })
  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText)
    throw new Error(`${command} failed: ${response.status} ${text}`)
  }
  return response.json()
}

const options = parseArgs(process.argv.slice(2))
const result = await invoke(options.serverUrl, "middleware_sandbox_cleanup_audit_data", {
  dryRun: options.dryRun,
})

console.log(JSON.stringify(result, null, 2))
