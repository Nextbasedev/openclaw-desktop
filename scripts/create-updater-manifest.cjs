const fs = require("node:fs")
const path = require("node:path")

const repo = process.env.GITHUB_REPOSITORY
const releaseTag = process.env.RELEASE_TAG || process.env.GITHUB_REF_NAME
const version = process.env.APP_VERSION || process.env.npm_package_version || releaseTag?.replace(/^v/, "")

if (!repo) throw new Error("GITHUB_REPOSITORY is required")
if (!releaseTag) throw new Error("RELEASE_TAG or GITHUB_REF_NAME is required")
if (!version) throw new Error("APP_VERSION, npm_package_version, or release tag is required")

const bundleRoot = path.join(__dirname, "..", "packages", "desktop", "src-tauri", "target", "release", "bundle")

function walk(dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    return entry.isDirectory() ? walk(full) : [full]
  })
}

const signedArtifacts = walk(bundleRoot)
  .filter((file) => file.endsWith(".sig"))
  .map((signaturePath) => ({ signaturePath, artifactPath: signaturePath.slice(0, -4) }))
  .filter(({ artifactPath }) => fs.existsSync(artifactPath))

function scoreArtifact(file) {
  const normalized = file.replace(/\\/g, "/").toLowerCase()
  if (normalized.includes("/nsis/") && normalized.endsWith(".exe")) return 100
  if (normalized.endsWith("setup.exe")) return 90
  if (normalized.includes("/msi/") && normalized.endsWith(".msi")) return 80
  if (normalized.endsWith(".zip")) return 70
  return 0
}

const selected = signedArtifacts
  .map((item) => ({ ...item, score: scoreArtifact(item.artifactPath) }))
  .filter((item) => item.score > 0)
  .sort((a, b) => b.score - a.score)[0]

if (!selected) {
  throw new Error(`No signed Windows updater artifact found under ${bundleRoot}`)
}

const artifactName = path.basename(selected.artifactPath)
const signature = fs.readFileSync(selected.signaturePath, "utf8").trim()
const url = `https://github.com/${repo}/releases/download/${releaseTag}/${encodeURIComponent(artifactName)}`

const manifest = {
  version: version.replace(/^v/, ""),
  notes: `OpenClaw Desktop ${version}`,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      signature,
      url,
    },
  },
}

const outPath = path.join(bundleRoot, "latest.json")
fs.writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`Wrote ${outPath}`)
console.log(`Using updater artifact ${selected.artifactPath}`)
