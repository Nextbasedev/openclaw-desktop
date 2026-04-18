export type DiscoveredSkill = {
  id: string
  slug: string
  name: string
  summary: string | null
  description: string | null
  source: "clawhub" | "local" | "github"
  version: string | null
  installed: boolean
  installSource: "clawhub" | "github" | "local"
  repoUrl: string | null
  homepageUrl: string | null
  localPath: string | null
  tags: string[]
}

export type SkillDiscoverResponse = {
  query: string
  results: DiscoveredSkill[]
  warnings: string[]
  sources: Array<"clawhub" | "local" | "github">
}

export async function discoverSkills(query = "", limit = 20): Promise<SkillDiscoverResponse | null> {
  if (typeof window === "undefined" || !window.__TAURI_INTERNALS__) {
    return null
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core")
    const result = await invoke<SkillDiscoverResponse>("middleware_skills_discover", {
      input: {
        query,
        limit,
        includeLocal: true,
        includeClawHub: true,
        includeGithubProbe: true,
      },
    })

    return result
  } catch (error) {
    console.error("Failed to discover skills via middleware", error)
    return null
  }
}

export function mapDiscoveredSkillCategory(skill: DiscoveredSkill): "Recommended" | "System" | "Personal" {
  if (skill.source === "local") return "Personal"

  const tags = skill.tags.map((tag) => tag.toLowerCase())
  if (tags.includes("system") || skill.installed) return "System"

  return "Recommended"
}
