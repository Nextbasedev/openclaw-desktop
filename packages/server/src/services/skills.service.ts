import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { ensureGatewayClient, isGatewayConnected } from "../gateway/client.js"
import { invalidateSkillCache, isSkillEnabled } from "./skill-runtime.service.js"
import { SKILL_TEMPLATES } from "./skill-templates.js"

type CatalogSkill = {
  slug: string
  name: string
  description: string
  source: string
  version: string
}

function openclawUserRoot(): string {
  return path.join(os.homedir(), ".openclaw")
}

function catalogPath(): string {
  return path.join(openclawUserRoot(), "skills-catalog.json")
}

function openclawSkillRootForScope(scope: string): string {
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
  if (nameMatch) result.name = nameMatch[1].trim()

  const descMatch = block.match(/^description:\s*(.+)$/m)
  if (descMatch) result.description = descMatch[1].trim()

  return result
}

const DEFAULT_CATALOG: CatalogSkill[] = [
  { slug: "code-review", name: "Code Review", description: "Automated code review with suggestions", source: "catalog", version: "1.0.0" },
  { slug: "git-commit", name: "Git Commit", description: "Smart commit message generation", source: "catalog", version: "1.0.0" },
  { slug: "test-gen", name: "Test Generator", description: "Generate unit tests for functions", source: "catalog", version: "1.0.0" },
  { slug: "refactor", name: "Refactor", description: "Suggest and apply code refactorings", source: "catalog", version: "1.0.0" },
  { slug: "doc-gen", name: "Documentation Generator", description: "Generate documentation for code", source: "catalog", version: "1.0.0" },
  { slug: "bug-finder", name: "Bug Finder", description: "Detect potential bugs and edge cases in code", source: "catalog", version: "1.0.0" },
  { slug: "api-designer", name: "API Designer", description: "Design RESTful API endpoints and schemas", source: "catalog", version: "1.0.0" },
  { slug: "sql-helper", name: "SQL Helper", description: "Write and optimize SQL queries", source: "catalog", version: "1.0.0" },
  { slug: "playwright-browser", name: "Browser Automation", description: "Generate Playwright tests and browser scripts", source: "catalog", version: "1.0.0" },
  { slug: "code-explainer", name: "Code Explainer", description: "Break down complex code into simple explanations", source: "catalog", version: "1.0.0" },
  { slug: "security-audit", name: "Security Audit", description: "Scan code for vulnerabilities and security issues", source: "catalog", version: "1.0.0" },
  { slug: "performance-optimizer", name: "Performance Optimizer", description: "Find and fix performance bottlenecks", source: "catalog", version: "1.0.0" },
  { slug: "regex-builder", name: "Regex Builder", description: "Create and explain regular expressions", source: "catalog", version: "1.0.0" },
  { slug: "csv-excel-processor", name: "CSV & Excel Processor", description: "Parse, transform, and analyze spreadsheet data", source: "catalog", version: "1.0.0" },
  { slug: "image-describer", name: "Image Describer", description: "Analyze and describe images with AI vision", source: "catalog", version: "1.0.0" },
  { slug: "pdf-reader", name: "PDF Reader", description: "Extract and summarize content from PDF documents", source: "catalog", version: "1.0.0" },
  { slug: "slides-creator", name: "Slides Creator", description: "Generate presentation slides from content", source: "catalog", version: "1.0.0" },
]

function readCatalog(): CatalogSkill[] {
  const filePath = catalogPath()
  try {
    const raw = fs.readFileSync(filePath, "utf-8")
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
  fs.writeFileSync(catalogPath(), JSON.stringify(catalog, null, 2), "utf-8")
}

export function getSkillCatalog(): CatalogSkill[] {
  return readCatalog()
}

export function addSkillToCatalog(skill: CatalogSkill): CatalogSkill {
  const catalog = readCatalog()
  const existing = catalog.findIndex((s) => s.slug === skill.slug)
  if (existing >= 0) {
    catalog[existing] = skill
  } else {
    catalog.push(skill)
  }
  writeCatalog(catalog)
  return skill
}

export function removeSkillFromCatalog(slug: string): { removed: boolean; slug: string } {
  const catalog = readCatalog()
  const filtered = catalog.filter((s) => s.slug !== slug)
  const removed = filtered.length < catalog.length
  if (removed) writeCatalog(filtered)
  return { removed, slug }
}

function scanLocalSkills(
  dir: string,
): Array<{
  slug: string
  name: string
  description: string
  source: string
  location: string
}> {
  const results: Array<{
    slug: string
    name: string
    description: string
    source: string
    location: string
  }> = []

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
      })
    }
  } catch {
    /* ignore read errors */
  }

  return results
}

export async function skillsDiscover(input?: {
  query?: string
  limit?: number
  includeLocal?: boolean
  includeClawHub?: boolean
  includeGithubProbe?: boolean
}) {
  const query = input?.query?.toLowerCase()
  const limit = input?.limit ?? 50
  const includeLocal = input?.includeLocal ?? true
  const includeClawHub = input?.includeClawHub ?? false
  const warnings: string[] = []
  const sources: string[] = []

  let results: Array<{
    slug: string
    name: string
    description: string
    source: string
    version?: string
    location?: string
    installed?: boolean
    enabled?: boolean
  }> = []

  const catalog = getSkillCatalog()
  const userSkillRoot = path.join(openclawUserRoot(), "skills")
  results.push(
    ...catalog.map((s) => {
      const installed = fs.existsSync(path.join(userSkillRoot, s.slug, "SKILL.md"))
      return {
        ...s,
        installed,
        enabled: installed ? isSkillEnabled(s.slug) : false,
      }
    }),
  )
  sources.push("catalog")

  if (includeLocal) {
    const catalogSlugs = new Set(catalog.map((s) => s.slug))
    const userSkills = scanLocalSkills(
      path.join(openclawUserRoot(), "skills"),
    ).filter((s) => !catalogSlugs.has(s.slug))
    const workspaceSkills = scanLocalSkills(
      path.join(openclawUserRoot(), "workspace", "skills"),
    )
    const localWithEnabled = [...userSkills, ...workspaceSkills].map((s) => ({
      ...s,
      installed: true,
      enabled: isSkillEnabled(s.slug),
    }))
    results.push(...localWithEnabled)
    if (userSkills.length > 0 || workspaceSkills.length > 0) {
      sources.push("local")
    }
  }

  if (includeClawHub) {
    try {
      const gw = await ensureGatewayClient()
      const res = await gw.request<{
        results: Array<{
          slug: string
          name: string
          description: string
          version?: string
          tags?: string[]
        }>
      }>("skills.search", {
        query: input?.query ?? "",
        limit,
      })
      if (res.ok && res.payload?.results) {
        const existingSlugs = new Set(results.map((s) => s.slug))
        for (const hub of res.payload.results) {
          if (existingSlugs.has(hub.slug)) continue
          const installed = fs.existsSync(
            path.join(userSkillRoot, hub.slug, "SKILL.md"),
          )
          results.push({
            slug: hub.slug,
            name: hub.name,
            description: hub.description ?? "",
            source: "clawhub",
            version: hub.version,
            installed,
            enabled: installed ? isSkillEnabled(hub.slug) : false,
          })
        }
        sources.push("clawhub")
      }
    } catch {
      if (!isGatewayConnected()) {
        warnings.push("Gateway not connected — showing local catalog only")
      } else {
        warnings.push("ClawHub search failed — showing local catalog only")
      }
    }
  }

  if (input?.includeGithubProbe) {
    warnings.push("GitHub probe discovery not yet implemented")
  }

  if (query) {
    results = results.filter(
      (s) =>
        s.name.toLowerCase().includes(query) ||
        s.slug.toLowerCase().includes(query) ||
        s.description.toLowerCase().includes(query),
    )
  }

  results = results.slice(0, limit)

  return {
    query: input?.query ?? null,
    results,
    warnings,
    sources,
  }
}

export async function skillsInstall(input: {
  source: string
  slug?: string
  version?: string
  repoUrl?: string
  gitRef?: string
  localPath?: string
  scope?: string
  force?: boolean
}) {
  const scope = input.scope ?? "user"

  if (input.source === "local") {
    const localPath = input.localPath
    if (!localPath) {
      throw new Error("localPath is required for local source")
    }
    if (!fs.existsSync(localPath)) {
      throw new Error(`Local path not found: ${localPath}`)
    }

    const skillFile = path.join(localPath, "SKILL.md")
    if (!fs.existsSync(skillFile)) {
      throw new Error(
        `No SKILL.md found in ${localPath}`,
      )
    }

    const raw = fs.readFileSync(skillFile, "utf-8")
    const meta = parseSkillFrontmatter(raw)
    const slug = input.slug ?? path.basename(localPath)
    const targetRoot = openclawSkillRootForScope(scope)
    const targetDir = path.join(targetRoot, slug)

    if (fs.existsSync(targetDir) && !input.force) {
      throw new Error(
        `Skill '${slug}' already installed at ${targetDir}. Use force to overwrite.`,
      )
    }

    fs.mkdirSync(targetDir, { recursive: true })
    copyDirSync(localPath, targetDir)
    invalidateSkillCache()

    return {
      status: "installed",
      skill: {
        slug,
        name: meta.name ?? slug,
        description: meta.description ?? "",
        source: "local",
      },
      location: targetDir,
      actions: [],
      warnings: [],
    }
  }

  if (input.source === "catalog" || input.source === "builtin") {
    const catalog = getSkillCatalog()
    const entry = catalog.find((s) => s.slug === input.slug)
    if (!entry) {
      throw new Error(`Unknown catalog skill: ${input.slug}`)
    }

    const targetRoot = openclawSkillRootForScope(scope)
    const targetDir = path.join(targetRoot, entry.slug)

    if (fs.existsSync(path.join(targetDir, "SKILL.md")) && !input.force) {
      return {
        status: "already-installed",
        skill: { ...entry, installed: true },
        location: targetDir,
        actions: [],
        warnings: [],
      }
    }

    fs.mkdirSync(targetDir, { recursive: true })
    const template = SKILL_TEMPLATES[entry.slug]
    const body = template ?? entry.description
    const skillMd = [
      "---",
      `name: ${entry.name}`,
      `description: ${entry.description}`,
      `version: ${entry.version}`,
      `source: catalog`,
      "---",
      "",
      `# ${entry.name}`,
      "",
      body,
      "",
    ].join("\n")
    fs.writeFileSync(path.join(targetDir, "SKILL.md"), skillMd, "utf-8")
    invalidateSkillCache()

    return {
      status: "installed",
      skill: { ...entry, installed: true },
      location: targetDir,
      actions: ["created SKILL.md"],
      warnings: [],
    }
  }

  if (input.source === "clawhub") {
    const slug = input.slug
    if (!slug) {
      throw new Error("slug is required for clawhub source")
    }

    const gw = await ensureGatewayClient()
    const res = await gw.request<{
      slug: string
      name: string
      description: string
      version?: string
      content?: string
    }>("skills.detail", { slug })

    if (!res.ok || !res.payload) {
      throw new Error(
        res.error?.message ?? `Skill "${slug}" not found on ClawHub`,
      )
    }

    const detail = res.payload
    const targetRoot = openclawSkillRootForScope(scope)
    const targetDir = path.join(targetRoot, detail.slug)

    if (fs.existsSync(path.join(targetDir, "SKILL.md")) && !input.force) {
      return {
        status: "already-installed",
        skill: { slug: detail.slug, name: detail.name, description: detail.description, source: "clawhub", installed: true },
        location: targetDir,
        actions: [],
        warnings: [],
      }
    }

    fs.mkdirSync(targetDir, { recursive: true })
    const body = detail.content ?? SKILL_TEMPLATES[detail.slug] ?? detail.description
    const skillMd = [
      "---",
      `name: ${detail.name}`,
      `description: ${detail.description}`,
      `version: ${detail.version ?? "1.0.0"}`,
      `source: clawhub`,
      "---",
      "",
      `# ${detail.name}`,
      "",
      body,
      "",
    ].join("\n")
    fs.writeFileSync(path.join(targetDir, "SKILL.md"), skillMd, "utf-8")

    addSkillToCatalog({
      slug: detail.slug,
      name: detail.name,
      description: detail.description,
      source: "clawhub",
      version: detail.version ?? "1.0.0",
    })
    invalidateSkillCache()

    return {
      status: "installed",
      skill: { slug: detail.slug, name: detail.name, description: detail.description, source: "clawhub", installed: true },
      location: targetDir,
      actions: ["created SKILL.md", "added to catalog"],
      warnings: [],
    }
  }

  if (input.source === "github") {
    throw new Error("GitHub skill installation not yet implemented")
  }

  throw new Error(`Unsupported skill source: ${input.source}`)
}

function wrapGatewayError(error: unknown): never {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase()
    if (
      msg.includes("enoent") ||
      msg.includes("token is missing") ||
      msg.includes("websocket") ||
      msg.includes("timeout") ||
      msg.includes("connect")
    ) {
      throw new Error(
        "Gateway not connected. Start the OpenClaw Gateway first.",
      )
    }
  }
  throw error
}

export async function skillsInstalled(input?: {
  agentId?: string
}) {
  try {
    const gw = await ensureGatewayClient()
    const res = await gw.request<Record<string, unknown>>(
      "skills.status",
      { agentId: input?.agentId },
    )
    if (!res.ok) {
      throw new Error(
        res.error?.message ?? "skills.status failed",
      )
    }
    return res.payload
  } catch (error) {
    wrapGatewayError(error)
  }
}

export async function skillsSearchHub(input?: {
  query?: string
  limit?: number
}) {
  try {
    const gw = await ensureGatewayClient()
    const res = await gw.request<{
      results: Array<Record<string, unknown>>
    }>("skills.search", {
      query: input?.query,
      limit: input?.limit,
    })
    if (!res.ok) {
      throw new Error(
        res.error?.message ?? "skills.search failed",
      )
    }
    return res.payload
  } catch (error) {
    wrapGatewayError(error)
  }
}

export async function commandsList(input?: {
  agentId?: string
  provider?: string
  scope?: "native" | "text" | "both"
  includeArgs?: boolean
}) {
  try {
    const gw = await ensureGatewayClient()
    const res = await gw.request<{
      commands: Array<{
        name: string
        nativeName?: string
        textAliases?: string[]
        description: string
        category?: string
        source: "native" | "skill" | "plugin"
        scope: "text" | "native" | "both"
        acceptsArgs: boolean
        args?: Array<{
          name: string
          description: string
          type: string
          required?: true
          choices?: Array<{ value: string; label: string }>
          dynamic?: true
        }>
      }>
    }>("commands.list", {
      agentId: input?.agentId,
      provider: input?.provider,
      scope: input?.scope,
      includeArgs: input?.includeArgs,
    })
    if (!res.ok) {
      throw new Error(
        res.error?.message ?? "commands.list failed",
      )
    }
    return res.payload
  } catch (error) {
    wrapGatewayError(error)
  }
}

export async function toolsCatalog(input?: {
  agentId?: string
  includePlugins?: boolean
}) {
  try {
    const gw = await ensureGatewayClient()
    const res = await gw.request<{
      agentId: string
      profiles: Array<{ id: string; label: string }>
      groups: Array<{
        id: string
        label: string
        source: "core" | "plugin"
        pluginId?: string
        tools: Array<{
          id: string
          label: string
          description: string
          source: "core" | "plugin"
          pluginId?: string
          optional?: boolean
          defaultProfiles: string[]
        }>
      }>
    }>("tools.catalog", {
      agentId: input?.agentId,
      includePlugins: input?.includePlugins,
    })
    if (!res.ok) {
      throw new Error(
        res.error?.message ?? "tools.catalog failed",
      )
    }
    return res.payload
  } catch (error) {
    wrapGatewayError(error)
  }
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
