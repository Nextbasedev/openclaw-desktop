const CLAWHUB_BASE_URL = "https://clawhub.ai"
const CLAWHUB_TIMEOUT_MS = 15_000

export type ClawHubSortOption =
  | "updated"
  | "downloads"
  | "stars"
  | "installs"
  | "installsAllTime"
  | "trending"

export type ClawHubSkillListItem = {
  slug: string
  displayName: string
  summary?: string
  tags?: Record<string, string>
  latestVersion?: {
    version: string
    createdAt: number
    changelog?: string
  } | null
  metadata?: {
    os?: string[] | null
    systems?: string[] | null
  } | null
  createdAt: number
  updatedAt: number
}

export type ClawHubSkillListResponse = {
  items: ClawHubSkillListItem[]
  nextCursor?: string | null
}

export type ClawHubSkillSearchResult = {
  score: number
  slug: string
  displayName: string
  summary?: string
  version?: string
  updatedAt?: number
}

export type ClawHubSkillDetail = {
  skill: {
    slug: string
    displayName: string
    summary?: string
    tags?: Record<string, string>
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
}

export type ClawHubSkillVersionItem = {
  version: string
  createdAt: number
  changelog?: string
}

export type ClawHubSkillVersionsResponse = {
  items: ClawHubSkillVersionItem[]
  nextCursor?: string | null
}

async function clawhubFetch<T>(
  urlPath: string,
  params: Record<string, string | undefined>,
): Promise<T> {
  const url = new URL(urlPath, CLAWHUB_BASE_URL)
  for (const [k, v] of Object.entries(params)) {
    if (v) url.searchParams.set(k, v)
  }
  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(),
    CLAWHUB_TIMEOUT_MS,
  )
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      throw new Error(
        `ClawHub ${urlPath} failed (${res.status}): ${body || res.statusText}`,
      )
    }
    return (await res.json()) as T
  } finally {
    clearTimeout(timeout)
  }
}

export async function listClawHubSkills(params?: {
  limit?: number
  cursor?: string
  sort?: ClawHubSortOption
}): Promise<ClawHubSkillListResponse> {
  return await clawhubFetch<ClawHubSkillListResponse>(
    "/api/v1/skills",
    {
      limit: params?.limit ? String(params.limit) : undefined,
      cursor: params?.cursor,
      sort: params?.sort,
    },
  )
}

export async function searchClawHubSkills(params: {
  query: string
  limit?: number
  highlightedOnly?: boolean
  nonSuspiciousOnly?: boolean
}): Promise<ClawHubSkillSearchResult[]> {
  const result = await clawhubFetch<{
    results: ClawHubSkillSearchResult[]
  }>("/api/v1/search", {
    q: params.query.trim(),
    limit: params.limit ? String(params.limit) : undefined,
    highlightedOnly: params.highlightedOnly ? "true" : undefined,
    nonSuspiciousOnly: params.nonSuspiciousOnly
      ? "true"
      : undefined,
  })
  return result.results ?? []
}

export async function fetchClawHubSkillDetail(
  slug: string,
): Promise<ClawHubSkillDetail> {
  return await clawhubFetch<ClawHubSkillDetail>(
    `/api/v1/skills/${encodeURIComponent(slug)}`,
    {},
  )
}

export type ClawHubPackageDetail = {
  package: {
    name: string
    displayName: string
    family: string
    channel: string
    isOfficial: boolean
    summary?: string | null
    ownerHandle?: string | null
    latestVersion?: string | null
    verificationTier?: string | null
    verification?: {
      tier?: string
      scope?: string
      summary?: string
      sourceRepo?: string
      sourceCommit?: string
      hasProvenance?: boolean
      scanStatus?: string
    } | null
  } | null
  owner?: {
    handle?: string | null
    displayName?: string | null
    image?: string | null
  } | null
}

export async function fetchClawHubPackageDetail(
  name: string,
): Promise<ClawHubPackageDetail> {
  return await clawhubFetch<ClawHubPackageDetail>(
    `/api/v1/packages/${encodeURIComponent(name)}`,
    {},
  )
}

export async function fetchClawHubSkillVersions(params: {
  slug: string
  limit?: number
  cursor?: string
}): Promise<ClawHubSkillVersionsResponse> {
  return await clawhubFetch<ClawHubSkillVersionsResponse>(
    `/api/v1/skills/${encodeURIComponent(params.slug)}/versions`,
    {
      limit: params.limit ? String(params.limit) : undefined,
      cursor: params.cursor,
    },
  )
}
