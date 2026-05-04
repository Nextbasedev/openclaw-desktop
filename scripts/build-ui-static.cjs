const fs = require("node:fs")
const path = require("node:path")
const { spawnSync } = require("node:child_process")

const uiDir = path.resolve(__dirname, "..", "packages", "ui")
const nextDir = path.join(uiDir, ".next")
const stashTargets = [
  { source: path.join(uiDir, "app", "api"), stash: path.join(uiDir, ".api-stash") },
  { source: path.join(uiDir, "app", "[slug]"), stash: path.join(uiDir, ".[slug]-stash") },
]
const stashedTargets = []

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
  while (stashedTargets.length > 0) {
    const { source, stash } = stashedTargets.pop()
    if (fs.existsSync(stash)) {
      fs.rmSync(source, { recursive: true, force: true })
      fs.renameSync(stash, source)
    }
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

  for (const target of stashTargets) {
    if (!fs.existsSync(target.source)) continue
    fs.rmSync(target.stash, { recursive: true, force: true })
    fs.renameSync(target.source, target.stash)
    stashedTargets.push(target)
  }

  const result = runPnpm(["exec", "next", "build"])

  if (result.error) throw result.error
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1
  } else {
    const outDir = path.join(uiDir, "out")
    const indexHtml = path.join(outDir, "index.html")
    const notFoundHtml = path.join(outDir, "404.html")
    if (fs.existsSync(indexHtml)) {
      fs.copyFileSync(indexHtml, notFoundHtml)
      fs.writeFileSync(path.join(outDir, "_redirects"), "/* /index.html 200\n")
    }
  }
} finally {
  restore()
}
