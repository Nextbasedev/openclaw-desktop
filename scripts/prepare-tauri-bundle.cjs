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
  "middleware",
)
const bundledNodeDir = path.join(bundledServerDir, "bin")
const bundledNodePath = path.join(
  bundledNodeDir,
  process.platform === "win32" ? "node.exe" : "node",
)
const bundledTopLevelNodeModulesDir = path.join(
  bundledServerDir,
  "node_modules",
)
const bundledPnpmNodeModulesDir = path.join(
  bundledTopLevelNodeModulesDir,
  ".pnpm",
  "node_modules",
)

function run(command, args) {
  const result =
    process.platform === "win32"
      ? spawnSync("cmd.exe", ["/d", "/s", "/c", [command, ...args].map(quoteWindowsArg).join(" ")], {
          cwd: repoRoot,
          stdio: "inherit",
          shell: false,
        })
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

function runNode(scriptPath, args) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
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

function resolveTypeScriptCli() {
  const pnpmDir = path.join(repoRoot, "node_modules", ".pnpm")
  const typescriptDir = fs
    .readdirSync(pnpmDir, { withFileTypes: true })
    .find((entry) => entry.isDirectory() && entry.name.startsWith("typescript@"))

  if (!typescriptDir) {
    throw new Error("Unable to locate the local TypeScript package")
  }

  return path.join(
    pnpmDir,
    typescriptDir.name,
    "node_modules",
    "typescript",
    "bin",
    "tsc",
  )
}

function updateBundledWorkspacePackage(name) {
  const packageDir = path.join(
    bundledTopLevelNodeModulesDir,
    ".pnpm",
    `${name}@file+packages+${name}`,
    "node_modules",
    name,
  )
  const distSource = path.join(repoRoot, "packages", name, "dist")
  const distTarget = path.join(packageDir, "dist")
  const packageJsonPath = path.join(packageDir, "package.json")
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"))

  fs.rmSync(distTarget, { recursive: true, force: true })
  fs.cpSync(distSource, distTarget, { recursive: true })

  packageJson.main = "./dist/index.js"
  packageJson.types = "./dist/index.d.ts"
  packageJson.type = "module"

  fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)
}

function removeBundledWorkspaceLinks(names) {
  for (const name of names) {
    fs.rmSync(path.join(bundledPnpmNodeModulesDir, name), {
      recursive: true,
      force: true,
    })
  }
}

function rebuildTopLevelNodeModules() {
  const keep = new Set([".pnpm", ".modules.yaml"])

  for (const entry of fs.readdirSync(bundledTopLevelNodeModulesDir, { withFileTypes: true })) {
    if (!keep.has(entry.name)) {
      fs.rmSync(path.join(bundledTopLevelNodeModulesDir, entry.name), {
        recursive: true,
        force: true,
      })
    }
  }

  for (const entry of fs.readdirSync(bundledPnpmNodeModulesDir, { withFileTypes: true })) {
    const source = path.join(bundledPnpmNodeModulesDir, entry.name)
    const target = path.join(bundledTopLevelNodeModulesDir, entry.name)

    fs.cpSync(source, target, {
      recursive: true,
      dereference: true,
      force: true,
    })
  }
}

function updateServerPackageJson() {
  const packageJsonPath = path.join(bundledServerDir, "package.json")
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"))

  packageJson.main = "./dist/index.js"

  fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)
}

function main() {
  const pnpm = "pnpm"
  const tscCli = resolveTypeScriptCli()

  fs.rmSync(bundledServerDir, { recursive: true, force: true })

  if (process.env.SKIP_UI_BUILD !== "1") {
    run(pnpm, ["--filter", "ui", "build"])
  }

  // Legacy middleware is intentionally disabled; middleware-v2 now owns the old 8787 port.
  // run(pnpm, ["--filter", "@openclaw/desktop-middleware", "build"])
  // run(pnpm, [
  //   "--filter",
  //   "@openclaw/desktop-middleware",
  //   "deploy",
  //   "--legacy",
  //   "--prod",
  //   bundledServerDir,
  // ])
  run(pnpm, ["--filter", "@openclaw/desktop-middleware-v2", "build"])
  run(pnpm, [
    "--filter",
    "@openclaw/desktop-middleware-v2",
    "deploy",
    "--legacy",
    "--prod",
    bundledServerDir,
  ])

  updateServerPackageJson()
  rebuildTopLevelNodeModules()

  fs.mkdirSync(bundledNodeDir, { recursive: true })
  fs.copyFileSync(process.execPath, bundledNodePath)

  if (process.platform !== "win32") {
    fs.chmodSync(bundledNodePath, 0o755)
  }
}

main()
