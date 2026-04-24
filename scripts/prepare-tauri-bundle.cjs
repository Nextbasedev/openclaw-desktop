const fs = require("node:fs")
const path = require("node:path")
const { spawnSync } = require("node:child_process")

const repoRoot = path.resolve(__dirname, "..")
const bundledServerDir = path.join(
  repoRoot,
  "packages",
  "desktop",
  "src-tauri",
  "bundled",
  "server",
)
const bundledNodeDir = path.join(bundledServerDir, "bin")
const bundledNodePath = path.join(
  bundledNodeDir,
  process.platform === "win32" ? "node.exe" : "node",
)

function run(command, args) {
  const result =
    process.platform === "win32"
      ? spawnSync(
          "cmd.exe",
          ["/d", "/s", "/c", `"${[command, ...args].map(quoteWindowsArg).join(" ")}"`],
          {
            cwd: repoRoot,
            stdio: "inherit",
            shell: false,
          },
        )
      : spawnSync(command, args, {
          cwd: repoRoot,
          stdio: "inherit",
          shell: false,
        })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

function quoteWindowsArg(arg) {
  if (!/[ \t"]/u.test(arg)) {
    return arg
  }

  return `"${arg.replace(/"/g, '\\"')}"`
}

function main() {
  const pnpm = "pnpm"

  fs.rmSync(bundledServerDir, { recursive: true, force: true })

  if (process.env.SKIP_UI_BUILD !== "1") {
    run(pnpm, ["--filter", "ui", "build"])
  }
  run(pnpm, ["--filter", "server", "build"])
  run(pnpm, [
    "--filter",
    "server",
    "deploy",
    "--legacy",
    "--prod",
    bundledServerDir,
  ])

  fs.mkdirSync(bundledNodeDir, { recursive: true })
  fs.copyFileSync(process.execPath, bundledNodePath)

  if (process.platform !== "win32") {
    fs.chmodSync(bundledNodePath, 0o755)
  }
}

main()
