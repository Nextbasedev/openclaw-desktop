import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { invalidateSkillCache, isSkillEnabled } from "./skill-runtime.service.js"
import { SKILL_TEMPLATES } from "./skill-templates.js"

export type LocalSkillEntry = {
  slug: string
  name: string
  description: string
  source: string
  location: string
  installed: true
  enabled: boolean
}

export function openclawUserRoot(): string {
  return path.join(os.homedir(), ".openclaw")
}

export function openclawSkillRootForScope(scope: string): string {
  const root =
    scope === "workspace"
      ? path.join(openclawUserRoot(), "workspace", "skills")
      : path.join(openclawUserRoot(), "skills")
  fs.mkdirSync(root, { recursive: true })
  return root
}

export function parseSkillFrontmatter(
  raw: string,
): { name?: string; description?: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return {}
  const block = match[1]
  const result: { name?: string; description?: string } = {}
  const nameMatch = block.match(/^name:\s*(.+)$/m)
  const nameVal = nameMatch?.[1]?.trim()
  if (nameVal && nameVal !== "undefined") result.name = nameVal
  const descMatch = block.match(/^description:\s*(.+)$/m)
  const descVal = descMatch?.[1]?.trim()
  if (descVal && descVal !== "undefined") result.description = descVal
  return result
}

export function scanLocalSkills(dir: string): LocalSkillEntry[] {
  const results: LocalSkillEntry[] = []
  if (!fs.existsSync(dir)) return results
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const skillFile = path.join(dir, entry.name, "SKILL.md")
      if (!fs.existsSync(skillFile)) continue
      const raw = fs.readFileSync(skillFile, "utf-8")
      const meta = parseSkillFrontmatter(raw)
      results.push({
        slug: entry.name,
        name: meta.name ?? entry.name,
        description: meta.description ?? "",
        source: "local",
        location: path.join(dir, entry.name),
        installed: true,
        enabled: isSkillEnabled(entry.name),
      })
    }
  } catch {
    /* ignore read errors */
  }
  return results
}

export function getAllLocalSkills(): LocalSkillEntry[] {
  const userSkills = scanLocalSkills(
    path.join(openclawUserRoot(), "skills"),
  )
  const workspaceSkills = scanLocalSkills(
    path.join(openclawUserRoot(), "workspace", "skills"),
  )
  return [...userSkills, ...workspaceSkills]
}

export function isSkillInstalled(slug: string): boolean {
  const userRoot = path.join(openclawUserRoot(), "skills")
  return fs.existsSync(path.join(userRoot, slug, "SKILL.md"))
}

type LocalDetail = { name: string; description: string; content: string; version: string; location: string }

export function getLocalSkillDetail(slug: string): LocalDetail | null {
  const root = openclawUserRoot()
  const dirs = [path.join(root, "skills", slug), path.join(root, "workspace", "skills", slug)]
  for (const dir of dirs) {
    const file = path.join(dir, "SKILL.md")
    if (!fs.existsSync(file)) continue
    try {
      const raw = fs.readFileSync(file, "utf-8")
      const meta = parseSkillFrontmatter(raw)
      const fm = raw.match(/^---\n([\s\S]*?)\n---/)
      const content = fm ? raw.slice(fm[0].length).trim() : raw.trim()
      const ver = fm?.[1].match(/^version:\s*(.+)$/m)?.[1]?.trim()
      return { name: meta.name ?? slug, description: meta.description ?? "", content, version: ver ?? "1.0.0", location: dir }
    } catch { continue }
  }
  return null
}

export function uninstallSkill(slug: string): { removed: boolean; slug: string } {
  const root = openclawUserRoot()
  const dirs = [path.join(root, "skills", slug), path.join(root, "workspace", "skills", slug)]
  let removed = false
  for (const dir of dirs) {
    if (fs.existsSync(dir)) { fs.rmSync(dir, { recursive: true, force: true }); removed = true }
  }
  if (removed) { removeSkillFromCatalog(slug); invalidateSkillCache() }
  return { removed, slug }
}

function copyDirSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true })
  const entries = fs.readdirSync(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

export function installLocalSkill(params: {
  localPath: string
  slug?: string
  scope?: string
  force?: boolean
}) {
  const { localPath, scope = "user", force = false } = params
  if (!fs.existsSync(localPath)) {
    throw new Error(`Local path not found: ${localPath}`)
  }
  const skillFile = path.join(localPath, "SKILL.md")
  if (!fs.existsSync(skillFile)) {
    throw new Error(`No SKILL.md found in ${localPath}`)
  }
  const raw = fs.readFileSync(skillFile, "utf-8")
  const meta = parseSkillFrontmatter(raw)
  const slug = params.slug ?? path.basename(localPath)
  const targetRoot = openclawSkillRootForScope(scope)
  const targetDir = path.join(targetRoot, slug)
  if (fs.existsSync(targetDir) && !force) {
    throw new Error(
      `Skill '${slug}' already installed at ${targetDir}. Use force to overwrite.`,
    )
  }
  fs.mkdirSync(targetDir, { recursive: true })
  copyDirSync(localPath, targetDir)
  invalidateSkillCache()
  return {
    status: "installed" as const,
    skill: {
      slug,
      name: meta.name ?? slug,
      description: meta.description ?? "",
      source: "local",
    },
    location: targetDir,
    actions: [] as string[],
    warnings: [] as string[],
  }
}

export type CatalogSkill = {
  slug: string
  name: string
  description: string
  source: string
  version: string
}

const DEFAULT_CATALOG: CatalogSkill[] = [
  { slug: "code-review", name: "Code Review", description: "Automated code review with suggestions", source: "catalog", version: "1.0.0" },
  { slug: "git-commit", name: "Git Commit", description: "Smart commit message generation", source: "catalog", version: "1.0.0" },
  { slug: "test-gen", name: "Test Generator", description: "Generate unit tests for functions", source: "catalog", version: "1.0.0" },
  { slug: "refactor", name: "Refactor", description: "Suggest and apply code refactorings", source: "catalog", version: "1.0.0" },
  { slug: "doc-gen", name: "Documentation Generator", description: "Generate documentation for code", source: "catalog", version: "1.0.0" },
]

function catalogPath(): string {
  return path.join(openclawUserRoot(), "skills-catalog.json")
}

function readCatalog(): CatalogSkill[] {
  try {
    const raw = fs.readFileSync(catalogPath(), "utf-8")
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) return parsed as CatalogSkill[]
    return DEFAULT_CATALOG
  } catch {
    writeCatalog(DEFAULT_CATALOG)
    return DEFAULT_CATALOG
  }
}

function writeCatalog(catalog: CatalogSkill[]): void {
  const dir = openclawUserRoot()
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    catalogPath(),
    JSON.stringify(catalog, null, 2),
    "utf-8",
  )
}

export function getSkillCatalog(): CatalogSkill[] {
  return readCatalog()
}

export function addSkillToCatalog(
  skill: CatalogSkill,
): CatalogSkill {
  const catalog = readCatalog()
  const idx = catalog.findIndex((s) => s.slug === skill.slug)
  if (idx >= 0) catalog[idx] = skill
  else catalog.push(skill)
  writeCatalog(catalog)
  return skill
}

export function removeSkillFromCatalog(
  slug: string,
): { removed: boolean; slug: string } {
  const catalog = readCatalog()
  const filtered = catalog.filter((s) => s.slug !== slug)
  const removed = filtered.length < catalog.length
  if (removed) writeCatalog(filtered)
  return { removed, slug }
}

export function installCatalogSkill(params: {
  slug: string
  name: string
  description: string
  version: string
  scope?: string
  force?: boolean
}) {
  const { slug, name, description, version } = params
  const scope = params.scope ?? "user"
  const force = params.force ?? false
  const targetRoot = openclawSkillRootForScope(scope)
  const targetDir = path.join(targetRoot, slug)

  if (
    fs.existsSync(path.join(targetDir, "SKILL.md")) &&
    !force
  ) {
    return {
      status: "already-installed" as const,
      skill: { slug, name, description, source: "catalog", installed: true },
      location: targetDir,
      actions: [] as string[],
      warnings: [] as string[],
    }
  }

  fs.mkdirSync(targetDir, { recursive: true })
  const template = SKILL_TEMPLATES[slug]
  const body = template ?? description
  const skillMd = [
    "---",
    `name: ${name}`,
    `description: ${description}`,
    `version: ${version}`,
    `source: catalog`,
    "---",
    "",
    `# ${name}`,
    "",
    body,
    "",
  ].join("\n")
  fs.writeFileSync(
    path.join(targetDir, "SKILL.md"),
    skillMd,
    "utf-8",
  )
  invalidateSkillCache()
  return {
    status: "installed" as const,
    skill: { slug, name, description, source: "catalog", installed: true },
    location: targetDir,
    actions: ["created SKILL.md"],
    warnings: [] as string[],
  }
}
