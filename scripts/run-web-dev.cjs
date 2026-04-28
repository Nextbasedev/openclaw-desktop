const { spawn } = require("node:child_process")
const http = require("node:http")
const path = require("node:path")

function checkHttp(url, match) {
  return new Promise((resolve) => {
    const request = http.get(
      url,
      { timeout: 2000 },
      (response) => {
        const ok = match(response)
        response.resume()
        resolve(ok)
      },
    )

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

function checkJarvisServer() {
  return checkHttp("http://127.0.0.1:4000/health", (response) =>
    response.statusCode === 200,
  )
}

function spawnPnpm(args) {
  if (process.platform === "win32") {
    const command = ["pnpm", ...args].map(quoteWindowsArg).join(" ")
    return spawn("cmd.exe", ["/d", "/s", "/c", command], {
      stdio: "inherit",
      env: process.env,
    })
  }

  return spawn("pnpm", args, {
    stdio: "inherit",
    env: process.env,
  })
}

function spawnNode(scriptPath) {
  const absoluteScriptPath = path.resolve(__dirname, "..", scriptPath)

  return spawn(process.execPath, [absoluteScriptPath], {
    stdio: "inherit",
    env: process.env,
    cwd: process.cwd(),
  })
}

function quoteWindowsArg(arg) {
  if (!/[ \t"]/u.test(arg)) {
    return arg
  }

  return `"${arg.replace(/"/g, '\\"')}"`
}

async function main() {
  const [nextRunning, serverRunning] = await Promise.all([
    checkNextServer(),
    checkJarvisServer(),
  ])

  if (nextRunning) {
    console.log("Reusing existing Next.js dev server on http://localhost:3000")
  }

  if (serverRunning) {
    console.log("Reusing existing Jarvis server on http://127.0.0.1:4000")
  }

  const children = []

  if (!serverRunning) {
    children.push(spawnPnpm(["--filter", "server", "dev"]))
  }

  if (!nextRunning) {
    children.push(spawnNode("scripts/run-ui-dev.cjs"))
  }

  if (children.length === 0) {
    return
  }

  let settled = false

  const shutdownChildren = (signal = "SIGTERM") => {
    for (const child of children) {
      if (!child.killed) {
        child.kill(signal)
      }
    }
  }

  for (const child of children) {
    child.on("exit", (code, signal) => {
      if (settled) {
        return
      }

      settled = true
      shutdownChildren(signal ?? "SIGTERM")

      if (signal) {
        process.kill(process.pid, signal)
        return
      }

      process.exit(code ?? 1)
    })

    child.on("error", (error) => {
      if (settled) {
        return
      }

      settled = true
      shutdownChildren()
      console.error("Failed to start the local dev stack.")
      console.error(error.message)
      process.exit(1)
    })
  }

  process.on("SIGINT", () => {
    shutdownChildren("SIGINT")
    process.exit(130)
  })

  process.on("SIGTERM", () => {
    shutdownChildren("SIGTERM")
    process.exit(143)
  })
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
