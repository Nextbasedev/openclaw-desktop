const fs = require("node:fs")
const path = require("node:path")
const { spawnSync } = require("node:child_process")

const uiDir = path.resolve(__dirname, "..", "packages", "ui")
const apiDir = path.join(uiDir, "app", "api")
const stashDir = path.join(uiDir, ".api-stash")

const apiExists = fs.existsSync(apiDir)
let stashed = false

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
  if (apiExists) {
    fs.rmSync(stashDir, { recursive: true, force: true })
    fs.renameSync(apiDir, stashDir)
    stashed = true
  }

  const result = spawnSync("pnpm", ["exec", "next", "build"], {
    cwd: uiDir,
    stdio: "inherit",
    shell: false,
  })

  if (result.error) throw result.error
  if (result.status !== 0) process.exitCode = result.status ?? 1
} finally {
  restore()
}
