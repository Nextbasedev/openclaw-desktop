import { getAllLocalSkills } from "./skills-local.js"

type InstalledResult = {
  slug: string
  name: string
  description: string
  source: string
  location: string
  installed: true
  enabled: boolean
}

function sortResults(results: InstalledResult[], sort: string): void {
  switch (sort) {
    case "name":
      results.sort((a, b) => a.name.localeCompare(b.name))
      break
    case "updated":
    case "downloads":
    case "stars":
    case "installs":
    case "trending":
      results.sort((a, b) => a.name.localeCompare(b.name))
      break
    default:
      break
  }
}

export function skillsInstalledLocal(input?: {
  query?: string
  sort?: string
}) {
  const query = input?.query?.trim()?.toLowerCase()
  const sort = input?.sort ?? "name"
  const all = getAllLocalSkills()
  const results: InstalledResult[] = all.map((s) => ({
    slug: s.slug,
    name: s.name,
    description: s.description,
    source: s.source,
    location: s.location,
    installed: true as const,
    enabled: s.enabled,
  }))
  const filtered = query
    ? results.filter(
        (s) =>
          s.name.toLowerCase().includes(query) ||
          s.description.toLowerCase().includes(query) ||
          s.slug.toLowerCase().includes(query),
      )
    : results
  sortResults(filtered, sort)
  return {
    query: input?.query ?? null,
    sort,
    results: filtered,
    warnings: [] as string[],
    sources: filtered.length > 0 ? ["local"] : ([] as string[]),
    nextCursor: null,
  }
}
