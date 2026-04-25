const fs = require("node:fs")
const path = require("node:path")
const { spawnSync } = require("node:child_process")

const uiDir = path.resolve(__dirname, "..", "packages", "ui")
const apiDir = path.join(uiDir, "app", "api")
const stashDir = path.join(uiDir, ".api-stash")
const nextDir = path.join(uiDir, ".next")

const apiExists = fs.existsSync(apiDir)
let stashed = false

function quoteWindowsArg(arg) {
  if (!/[ \t"]/u.test(arg)) return arg
  return `"${arg.replace(/"/g, '\\"')}"`
}

function runPnpm(args) {
  return process.platform === "win32"
    ? spawnSync(
        "cmd.exe",
        ["/d", "/s", "/c", ["pnpm", ...args].map(quoteWindowsArg).join(" ")],
        { cwd: uiDir, stdio: "inherit", shell: false },
      )
    : spawnSync("pnpm", args, {
        cwd: uiDir,
        stdio: "inherit",
        shell: false,
      })
}

function restore() {
  if (stashed && fs.existsSync(stashDir)) {
    fs.rmSync(apiDir, { recursive: true, force: true })
    fs.renameSync(stashDir, apiDir)
    stashed = false
  }
}

process.on("SIGINT", () => {
  restore()
  process.exit(130)
})
process.on("SIGTERM", () => {
  restore()
  process.exit(143)
})

try {
  fs.rmSync(nextDir, { recursive: true, force: true })

  if (apiExists) {
    fs.rmSync(stashDir, { recursive: true, force: true })
    fs.renameSync(apiDir, stashDir)
    stashed = true
  }

  const result = runPnpm(["exec", "next", "build"])

  if (result.error) throw result.error
  if (result.status !== 0) process.exitCode = result.status ?? 1
} finally {
  restore()
}
