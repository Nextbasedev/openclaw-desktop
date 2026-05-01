import fs from "node:fs"
import path from "node:path"
import { ensureGatewayClient } from "../gateway/client.js"
import { invalidateSkillCache, isSkillEnabled } from "./skill-runtime.service.js"
import { SKILL_TEMPLATES } from "./skill-templates.js"
import {
  searchClawHubSkills,
  fetchClawHubSkillDetail as fetchDetail,
  fetchClawHubPackageDetail as fetchPkgDetail,
  fetchClawHubSkillVersions,
  type ClawHubSortOption,
} from "./clawhub-client.js"
import {
  getAllLocalSkills,
  isSkillInstalled,
  getLocalSkillDetail,
  installLocalSkill,
  installCatalogSkill,
  uninstallSkill,
  openclawUserRoot,
  openclawSkillRootForScope,
  getSkillCatalog,
  addSkillToCatalog,
  removeSkillFromCatalog,
} from "./skills-local.js"

export {
  getSkillCatalog,
  addSkillToCatalog,
  removeSkillFromCatalog,
  uninstallSkill,
}

type DiscoverResult = {
  slug: string
  name: string
  description: string
  source: string
  version?: string
  location?: string
  installed?: boolean
  enabled?: boolean
  owner?: string
  updatedAt?: number
  createdAt?: number
  downloads?: number
  stars?: number
  installs?: number
}

function sortResults(
  results: DiscoverResult[],
  sort: string,
): void {
  switch (sort) {
    case "downloads":
      results.sort(
        (a, b) => (b.downloads ?? 0) - (a.downloads ?? 0),
      )
      break
    case "stars":
      results.sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0))
      break
    case "installs":
      results.sort(
        (a, b) => (b.installs ?? 0) - (a.installs ?? 0),
      )
      break
    case "updated":
      results.sort(
        (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0),
      )
      break
    case "name":
      results.sort((a, b) =>
        (a.name ?? "").localeCompare(b.name ?? ""),
      )
      break
    case "trending":
      results.sort(
        (a, b) => (b.downloads ?? 0) - (a.downloads ?? 0),
      )
      break
    default:
      break
  }
}

export async function skillsDiscover(input?: {
  query?: string
  limit?: number
  sort?: ClawHubSortOption | "name" | "relevance"
  cursor?: string
  includeLocal?: boolean
  includeClawHub?: boolean
}) {
  const query = input?.query?.trim()
  const limit = input?.limit ?? 50
  const sort = input?.sort ?? "downloads"
  const includeLocal = input?.includeLocal ?? true
  const includeClawHub = input?.includeClawHub ?? true
  const warnings: string[] = []
  const sources: string[] = []
  let nextCursor: string | null = null
  const results: DiscoverResult[] = []

  if (includeLocal) {
    const localSkills = getAllLocalSkills()
    for (const s of localSkills) {
      results.push({
        slug: s.slug,
        name: s.name,
        description: s.description,
        source: s.source,
        location: s.location,
        installed: true,
        enabled: s.enabled,
      })
    }
    if (localSkills.length > 0) sources.push("local")
  }

  if (includeClawHub) {
    try {
      const seenSlugs = new Set(results.map((s) => s.slug))

      if (query) {
        const hubResults = await searchClawHubSkills({
          query,
          limit,
          nonSuspiciousOnly: true,
        })
        for (const h of hubResults) {
          if (seenSlugs.has(h.slug)) continue
          seenSlugs.add(h.slug)
          results.push({
            slug: h.slug,
            name: h.displayName ?? h.slug,
            description: h.summary ?? "",
            source: "clawhub",
            version: h.version,
            installed: isSkillInstalled(h.slug),
            enabled: isSkillInstalled(h.slug)
              ? isSkillEnabled(h.slug)
              : false,
            updatedAt: h.updatedAt,
          })
        }
      } else {
        const browseQueries = [
          "code", "test", "git", "api", "deploy",
          "security", "data", "review", "debug",
        ]
        const perQuery = Math.max(
          10,
          Math.ceil(limit / browseQueries.length),
        )
        for (const q of browseQueries) {
          if (results.length >= limit) break
          const hubResults = await searchClawHubSkills({
            query: q,
            limit: perQuery,
            nonSuspiciousOnly: true,
          })
          for (const h of hubResults) {
            if (seenSlugs.has(h.slug)) continue
            seenSlugs.add(h.slug)
            results.push({
              slug: h.slug,
              name: h.displayName ?? h.slug,
              description: h.summary ?? "",
              source: "clawhub",
              version: h.version,
              installed: isSkillInstalled(h.slug),
              enabled: isSkillInstalled(h.slug)
                ? isSkillEnabled(h.slug)
                : false,
              updatedAt: h.updatedAt,
            })
          }
        }
      }
      sources.push("clawhub")

      if (
        sort !== "relevance" &&
        sort !== "name" &&
        sort !== "updated"
      ) {
        const clawhubResults = results.filter(
          (r) => r.source === "clawhub",
        )
        const details = await Promise.allSettled(
          clawhubResults.map((r) => fetchDetail(r.slug)),
        )
        for (let i = 0; i < clawhubResults.length; i++) {
          const d = details[i]
          if (d.status !== "fulfilled" || !d.value.skill)
            continue
          const stats = (
            d.value.skill as Record<string, unknown>
          ).stats as {
            downloads?: number
            stars?: number
            installsAllTime?: number
          } | undefined
          if (!stats) continue
          clawhubResults[i].downloads = stats.downloads ?? 0
          clawhubResults[i].stars = stats.stars ?? 0
          clawhubResults[i].installs =
            stats.installsAllTime ?? 0
        }
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "unknown error"
      warnings.push(`ClawHub unavailable: ${msg}`)
    }
  }

  sortResults(results, sort)

  return {
    query: input?.query ?? null,
    sort,
    results: results.slice(0, limit),
    warnings,
    sources,
    nextCursor,
  }
}

export async function skillsDetail(input: { slug: string }) {
  const [detail, pkg] = await Promise.all([
    fetchDetail(input.slug).catch(() => ({ skill: null })),
    fetchPkgDetail(input.slug).catch(() => null),
  ])
  const installed = isSkillInstalled(input.slug)
  const local = installed
    ? getLocalSkillDetail(input.slug)
    : null
  return {
    ...detail,
    installed,
    enabled: installed ? isSkillEnabled(input.slug) : false,
    localContent: local?.content ?? null,
    localVersion: local?.version ?? null,
    package: pkg?.package
      ? {
          channel: pkg.package.channel,
          isOfficial: pkg.package.isOfficial,
          verification: pkg.package.verification ?? null,
          verificationTier: pkg.package.verificationTier ?? null,
        }
      : null,
  }
}

export async function skillsVersions(input: {
  slug: string
  limit?: number
  cursor?: string
}) {
  return await fetchClawHubSkillVersions({
    slug: input.slug,
    limit: input.limit,
    cursor: input.cursor,
  })
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
    if (!input.localPath) {
      throw new Error("localPath is required for local source")
    }
    return installLocalSkill({
      localPath: input.localPath,
      slug: input.slug,
      scope,
      force: input.force,
    })
  }

  if (
    input.source === "catalog" ||
    input.source === "builtin"
  ) {
    const catalog = getSkillCatalog()
    const entry = catalog.find((s) => s.slug === input.slug)
    if (!entry) {
      throw new Error(`Unknown catalog skill: ${input.slug}`)
    }
    return installCatalogSkill({
      slug: entry.slug,
      name: entry.name,
      description: entry.description,
      version: entry.version,
      scope,
      force: input.force,
    })
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
        res.error?.message ??
          `Skill "${slug}" not found on ClawHub`,
      )
    }
    const detail = res.payload
    const targetRoot = openclawSkillRootForScope(scope)
    const targetDir = path.join(targetRoot, detail.slug)

    if (
      fs.existsSync(path.join(targetDir, "SKILL.md")) &&
      !input.force
    ) {
      return {
        status: "already-installed",
        skill: {
          slug: detail.slug,
          name: detail.name,
          description: detail.description,
          source: "clawhub",
          installed: true,
        },
        location: targetDir,
        actions: [],
        warnings: [],
      }
    }

    fs.mkdirSync(targetDir, { recursive: true })
    const body =
      detail.content ??
      SKILL_TEMPLATES[detail.slug] ??
      detail.description
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
    fs.writeFileSync(
      path.join(targetDir, "SKILL.md"),
      skillMd,
      "utf-8",
    )
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
      skill: {
        slug: detail.slug,
        name: detail.name,
        description: detail.description,
        source: "clawhub",
        installed: true,
      },
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

export {
  skillsInstalled,
  skillsSearchHub,
  commandsList,
  toolsCatalog,
} from "./skills-gateway.service.js"
