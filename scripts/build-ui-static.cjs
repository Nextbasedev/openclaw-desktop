const fs = require("node:fs")
const path = require("node:path")
const { spawnSync } = require("node:child_process")

const uiDir = path.resolve(__dirname, "..", "packages", "ui")
const nextDir = path.join(uiDir, ".next")
const stashRoot = path.join(uiDir, `.static-build-stash-${process.pid}-${Date.now()}`)
const stashTargets = [
  { source: path.join(uiDir, "app", "api"), name: "api" },
  { source: path.join(uiDir, "app", "[slug]"), name: "slug" },
]
const stashedTargets = []

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function retryFs(action, label, attempts = process.platform === "win32" ? 8 : 3) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return action()
    } catch (error) {
      lastError = error
      const retryable = error && ["EPERM", "EBUSY", "ENOTEMPTY", "EACCES"].includes(error.code)
      if (!retryable || attempt === attempts) break
      sleepSync(75 * attempt)
    }
  }
  if (lastError && process.platform === "win32" && ["EPERM", "EBUSY", "EACCES"].includes(lastError.code)) {
    lastError.message = `${lastError.message}\n\n${label} failed because Windows denied access to a build folder. Close any running Next/dev/Tauri process, editor terminal, Explorer window, or antivirus scan that may be holding packages/ui/app, then retry.`
  }
  throw lastError
}

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
      retryFs(() => fs.rmSync(source, { recursive: true, force: true }), `restore cleanup ${source}`)
      retryFs(() => fs.renameSync(stash, source), `restore ${source}`)
    }
  }
  retryFs(() => fs.rmSync(stashRoot, { recursive: true, force: true }), `cleanup ${stashRoot}`)
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
  fs.mkdirSync(stashRoot, { recursive: true })

  for (const target of stashTargets) {
    if (!fs.existsSync(target.source)) continue
    const stash = path.join(stashRoot, target.name)
    retryFs(() => fs.renameSync(target.source, stash), `stash ${target.source}`)
    stashedTargets.push({ source: target.source, stash })
  }

  // Next 16's default Turbopack build has been unreliable on this host under
  // process/thread pressure (`EAGAIN` / Rayon pool init failures). The desktop
  // static export is stable with webpack, so force that path here.
  const result = runPnpm(["exec", "next", "build", "--webpack"])

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
