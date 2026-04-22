import fs from "node:fs"
import path from "node:path"
import os from "node:os"

type LoadedSkill = {
  slug: string
  name: string
  description: string
  content: string
}

type SkillCache = {
  skills: LoadedSkill[]
  loadedAt: number
}

type SkillsConfig = {
  disabled: string[]
}

const CACHE_TTL_MS = 30_000
let cache: SkillCache | null = null

const injectedSessions = new Set<string>()

function openclawRoot(): string {
  return path.join(os.homedir(), ".openclaw")
}

function openclawSkillsDir(): string {
  return path.join(openclawRoot(), "skills")
}

function configPath(): string {
  return path.join(openclawRoot(), "skills-config.json")
}

function readConfig(): SkillsConfig {
  try {
    const raw = fs.readFileSync(configPath(), "utf-8")
    const parsed = JSON.parse(raw) as Partial<SkillsConfig>
    return { disabled: Array.isArray(parsed.disabled) ? parsed.disabled : [] }
  } catch {
    return { disabled: [] }
  }
}

function writeConfig(config: SkillsConfig): void {
  const dir = openclawRoot()
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2), "utf-8")
}

export function isSkillEnabled(slug: string): boolean {
  const config = readConfig()
  return !config.disabled.includes(slug)
}

export function setSkillEnabled(slug: string, enabled: boolean): { slug: string; enabled: boolean } {
  const config = readConfig()

  if (enabled) {
    config.disabled = config.disabled.filter((s) => s !== slug)
  } else {
    if (!config.disabled.includes(slug)) {
      config.disabled.push(slug)
    }
  }

  writeConfig(config)
  invalidateSkillCache()
  return { slug, enabled }
}

export function getSkillEnabledMap(): Record<string, boolean> {
  const config = readConfig()
  const disabledSet = new Set(config.disabled)
  const all = scanInstalledSkills()
  const result: Record<string, boolean> = {}
  for (const skill of all) {
    result[skill.slug] = !disabledSet.has(skill.slug)
  }
  return result
}

function loadSkillFromDir(dir: string): LoadedSkill | null {
  const skillFile = path.join(dir, "SKILL.md")
  if (!fs.existsSync(skillFile)) return null

  try {
    const raw = fs.readFileSync(skillFile, "utf-8")
    const slug = path.basename(dir)

    const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/)
    let name = slug
    let description = ""

    if (fmMatch) {
      const block = fmMatch[1]
      const nameMatch = block.match(/^name:\s*(.+)$/m)
      if (nameMatch) name = nameMatch[1].trim()
      const descMatch = block.match(/^description:\s*(.+)$/m)
      if (descMatch) description = descMatch[1].trim()
    }

    const content = fmMatch
      ? raw.slice(fmMatch[0].length).trim()
      : raw.trim()

    if (!content) return null

    return { slug, name, description, content }
  } catch {
    return null
  }
}

function scanInstalledSkills(): LoadedSkill[] {
  const dir = openclawSkillsDir()
  if (!fs.existsSync(dir)) return []

  const skills: LoadedSkill[] = []
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const skill = loadSkillFromDir(path.join(dir, entry.name))
      if (skill) skills.push(skill)
    }
  } catch {
    // ignore scan errors
  }

  return skills
}

export function getInstalledSkills(): LoadedSkill[] {
  const now = Date.now()
  if (cache && now - cache.loadedAt < CACHE_TTL_MS) {
    return cache.skills
  }

  const config = readConfig()
  const disabledSet = new Set(config.disabled)
  const skills = scanInstalledSkills().filter((s) => !disabledSet.has(s.slug))
  cache = { skills, loadedAt: now }
  return skills
}

export function invalidateSkillCache(): void {
  cache = null
}

export function buildSkillContext(skills: LoadedSkill[]): string {
  if (skills.length === 0) return ""

  const blocks = skills.map(
    (s) =>
      `<skill name="${s.name}">\n${s.content}\n</skill>`,
  )

  return [
    "<system-skills>",
    "The following skills are installed and active. Follow their instructions when relevant to the user's request.",
    "",
    ...blocks,
    "</system-skills>",
  ].join("\n")
}

export function shouldInjectSkills(sessionKey: string): boolean {
  return !injectedSessions.has(sessionKey)
}

export function markSkillsInjected(sessionKey: string): void {
  injectedSessions.add(sessionKey)
}

export function clearSessionTracking(sessionKey: string): void {
  injectedSessions.delete(sessionKey)
}

export function prependSkillContext(
  text: string,
  sessionKey: string,
): string {
  if (!shouldInjectSkills(sessionKey)) return text

  const skills = getInstalledSkills()
  if (skills.length === 0) {
    markSkillsInjected(sessionKey)
    return text
  }

  const context = buildSkillContext(skills)
  markSkillsInjected(sessionKey)

  return `${context}\n\n${text}`
}
