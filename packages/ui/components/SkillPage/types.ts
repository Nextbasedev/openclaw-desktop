export type SortOption =
  | "downloads"
  | "updated"
  | "stars"
  | "installs"
  | "trending"
  | "name"

export type DiscoveredSkill = {
  slug: string
  name: string
  description: string | null
  source: "clawhub" | "local" | "github" | "builtin" | "catalog"
  version: string | null
  installed: boolean
  enabled: boolean
  owner?: string
  updatedAt?: number
  createdAt?: number
}

export type SkillDiscoverResponse = {
  query: string | null
  sort: string
  results: DiscoveredSkill[]
  warnings: string[]
  sources: string[]
  nextCursor: string | null
}

export type SkillDetailResponse = {
  skill: {
    slug: string
    displayName: string
    summary?: string
    tags?: Record<string, string>
    stats?: {
      downloads?: number
      installsAllTime?: number
      installsCurrent?: number
      stars?: number
      versions?: number
    }
    createdAt: number
    updatedAt: number
  } | null
  latestVersion?: {
    version: string
    createdAt: number
    changelog?: string
  } | null
  metadata?: {
    os?: string[] | null
    systems?: string[] | null
  } | null
  owner?: {
    handle?: string | null
    displayName?: string | null
    image?: string | null
  } | null
  installed: boolean
  enabled: boolean
  package?: {
    channel: string
    isOfficial: boolean
    verification?: {
      tier?: string
      scope?: string
      summary?: string
      sourceRepo?: string
      hasProvenance?: boolean
      scanStatus?: string
    } | null
    verificationTier?: string | null
  } | null
}

export type SkillVersionItem = {
  version: string
  createdAt: number
  changelog?: string
}

export type SkillVersionsResponse = {
  items: SkillVersionItem[]
  nextCursor: string | null
}
