const { spawn } = require("node:child_process")
const http = require("node:http")
const path = require("node:path")

function checkHttp(url, match) {
  return new Promise((resolve) => {
    const request = http.get(url, { timeout: 2000 }, (response) => {
      const ok = match(response)
      response.resume()
      resolve(ok)
    })

    request.on("error", () => resolve(false))
    request.on("timeout", () => {
      request.destroy()
      resolve(false)
    })
  })
}

function checkNextServer() {
  return checkHttp("http://127.0.0.1:3000", (response) =>
    response.headers["x-powered-by"] === "Next.js",
  )
}

function spawnNode(scriptPath) {
  const absoluteScriptPath = path.resolve(__dirname, "..", scriptPath)

  return spawn(process.execPath, [absoluteScriptPath], {
    stdio: "inherit",
    env: process.env,
    cwd: process.cwd(),
  })
}

async function main() {
  const nextRunning = await checkNextServer()

  if (nextRunning) {
    console.log("Reusing existing Next.js dev server on http://localhost:3000")
    return
  }

  const child = spawnNode("scripts/run-ui-dev.cjs")

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal)
      return
    }
    process.exit(code ?? 1)
  })

  child.on("error", (error) => {
    console.error("Failed to start the UI dev server.")
    console.error(error.message)
    process.exit(1)
  })

  process.on("SIGINT", () => {
    child.kill("SIGINT")
    process.exit(130)
  })

  process.on("SIGTERM", () => {
    child.kill("SIGTERM")
    process.exit(143)
  })
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
