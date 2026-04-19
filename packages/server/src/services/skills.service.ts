import fs from "node:fs"
import path from "node:path"
import os from "node:os"

function openclawUserRoot(): string {
  return path.join(os.homedir(), ".openclaw")
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

const BUILTIN_SKILLS = [
  {
    slug: "code-review",
    name: "Code Review",
    description: "Automated code review with suggestions",
    source: "builtin",
    version: "1.0.0",
  },
  {
    slug: "git-commit",
    name: "Git Commit",
    description: "Smart commit message generation",
    source: "builtin",
    version: "1.0.0",
  },
  {
    slug: "test-gen",
    name: "Test Generator",
    description: "Generate unit tests for functions",
    source: "builtin",
    version: "1.0.0",
  },
  {
    slug: "refactor",
    name: "Refactor",
    description: "Suggest and apply code refactorings",
    source: "builtin",
    version: "1.0.0",
  },
  {
    slug: "doc-gen",
    name: "Documentation Generator",
    description: "Generate documentation for code",
    source: "builtin",
    version: "1.0.0",
  },
]

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

export function skillsDiscover(input?: {
  query?: string
  limit?: number
  includeLocal?: boolean
  includeClawHub?: boolean
  includeGithubProbe?: boolean
}) {
  const query = input?.query?.toLowerCase()
  const limit = input?.limit ?? 50
  const includeLocal = input?.includeLocal ?? true
  const warnings: string[] = []
  const sources: string[] = []

  let results: Array<{
    slug: string
    name: string
    description: string
    source: string
    version?: string
    location?: string
  }> = []

  results.push(...BUILTIN_SKILLS)
  sources.push("builtin")

  if (includeLocal) {
    const userSkills = scanLocalSkills(
      path.join(openclawUserRoot(), "skills"),
    )
    const workspaceSkills = scanLocalSkills(
      path.join(openclawUserRoot(), "workspace", "skills"),
    )
    results.push(...userSkills, ...workspaceSkills)
    if (userSkills.length > 0 || workspaceSkills.length > 0) {
      sources.push("local")
    }
  }

  if (input?.includeClawHub) {
    warnings.push("ClawHub discovery not yet implemented")
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

export function skillsInstall(input: {
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

  if (input.source === "clawhub") {
    throw new Error("ClawHub skill installation not yet implemented")
  }

  if (input.source === "github") {
    throw new Error("GitHub skill installation not yet implemented")
  }

  throw new Error(`Unsupported skill source: ${input.source}`)
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
