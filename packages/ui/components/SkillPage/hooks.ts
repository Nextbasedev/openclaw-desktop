"use client"

import * as React from "react"
import { invoke } from "@/lib/ipc"
import type {
  SortOption,
  DiscoveredSkill,
  SkillDiscoverResponse,
  SkillDetailResponse,
  SkillVersionsResponse,
} from "./types"

function normalizeSkillDiscoverResponse(response: SkillDiscoverResponse | { skills?: DiscoveredSkill[] }): SkillDiscoverResponse {
  const legacySkills = (response as { skills?: DiscoveredSkill[] }).skills
  const results = Array.isArray((response as SkillDiscoverResponse).results)
    ? (response as SkillDiscoverResponse).results
    : Array.isArray(legacySkills)
      ? legacySkills
      : []

  return {
    query: (response as SkillDiscoverResponse).query ?? null,
    sort: (response as SkillDiscoverResponse).sort ?? "name",
    results,
    warnings: (response as SkillDiscoverResponse).warnings ?? [],
    sources: (response as SkillDiscoverResponse).sources ?? [],
    nextCursor: (response as SkillDiscoverResponse).nextCursor ?? null,
  }
}

export function useSkillsDiscovery(installedOnly?: boolean) {
  const [skills, setSkills] = React.useState<DiscoveredSkill[]>(
    [],
  )
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [sort, setSort] = React.useState<SortOption>("downloads")
  const [query, setQuery] = React.useState("")
  const [sources, setSources] = React.useState<string[]>([])
  const [nextCursor, setNextCursor] = React.useState<
    string | null
  >(null)
  const [installedCount, setInstalledCount] = React.useState(0)
  const debounceRef =
    React.useRef<ReturnType<typeof setTimeout>>(undefined)

  const fetchSkills = React.useCallback(
    async (params: {
      query?: string
      sort?: SortOption
      cursor?: string
      append?: boolean
    }) => {
      if (!params.append) setLoading(true)
      setError(null)
      try {
        const endpoint = installedOnly
          ? "middleware_skills_installed_local"
          : "middleware_skills_discover"
        const input = installedOnly
          ? {
              query: params.query || undefined,
              sort: params.sort ?? sort,
            }
          : {
              query: params.query || undefined,
              limit: 50,
              sort: params.sort ?? sort,
              cursor: params.cursor,
              includeLocal: true,
              includeClawHub: true,
            }
        const raw = await invoke<SkillDiscoverResponse | { skills?: DiscoveredSkill[] }>(
          endpoint,
          { input },
        )
        const res = normalizeSkillDiscoverResponse(raw)
        if (params.append) {
          setSkills((prev) => [...prev, ...res.results])
        } else {
          setSkills(res.results)
        }
        setSources(res.sources)
        setNextCursor(installedOnly ? null : res.nextCursor)
      } catch {
        setError("Unable to load skills.")
        if (!params.append) setSkills([])
      } finally {
        setLoading(false)
      }
    },
    [sort, installedOnly],
  )

  const refreshInstalledCount = React.useCallback(() => {
    invoke<SkillDiscoverResponse | { skills?: DiscoveredSkill[] }>(
      "middleware_skills_installed_local",
      { input: {} },
    )
      .then((res) => setInstalledCount(normalizeSkillDiscoverResponse(res).results.length))
      .catch(() => {})
  }, [])

  React.useEffect(() => {
    const defaultSort: SortOption = "downloads"
    setSort(defaultSort)
    setQuery("")
    fetchSkills({ sort: defaultSort, query: "" })
    refreshInstalledCount()
  }, [installedOnly]) // eslint-disable-line react-hooks/exhaustive-deps

  const onSortChange = React.useCallback(
    (newSort: SortOption) => {
      setSort(newSort)
      fetchSkills({ query, sort: newSort })
    },
    [query, fetchSkills],
  )

  const onQueryChange = React.useCallback(
    (newQuery: string) => {
      setQuery(newQuery)
      clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        fetchSkills({ query: newQuery, sort })
      }, 350)
    },
    [sort, fetchSkills],
  )

  const loadMore = React.useCallback(() => {
    if (!nextCursor) return
    fetchSkills({
      query,
      sort,
      cursor: nextCursor,
      append: true,
    })
  }, [query, sort, nextCursor, fetchSkills])

  const updateSkill = React.useCallback(
    (slug: string, patch: Partial<DiscoveredSkill>) => {
      setSkills((prev) =>
        prev.map((s) =>
          s.slug === slug ? { ...s, ...patch } : s,
        ),
      )
    },
    [],
  )

  const removeSkill = React.useCallback((slug: string) => {
    setSkills((prev) => prev.filter((s) => s.slug !== slug))
  }, [])

  return {
    skills,
    loading,
    error,
    sort,
    query,
    sources,
    nextCursor,
    installedCount,
    onSortChange,
    onQueryChange,
    loadMore,
    updateSkill,
    removeSkill,
    refetch: () => {
      fetchSkills({ query, sort })
      refreshInstalledCount()
    },
  }
}

export function useSkillDetail(slug: string | null) {
  const [detail, setDetail] =
    React.useState<SkillDetailResponse | null>(null)
  const [versions, setVersions] =
    React.useState<SkillVersionsResponse | null>(null)
  const [loading, setLoading] = React.useState(false)

  React.useEffect(() => {
    if (!slug) {
      setDetail(null)
      setVersions(null)
      return
    }
    let cancelled = false
    setLoading(true)

    Promise.all([
      invoke<SkillDetailResponse>("middleware_skills_detail", {
        input: { slug },
      }),
      invoke<SkillVersionsResponse>(
        "middleware_skills_versions",
        {
          input: { slug, limit: 10 },
        },
      ).catch(() => null),
    ])
      .then(([d, v]) => {
        if (cancelled) return
        setDetail(d)
        setVersions(v)
        setLoading(false)
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [slug])

  return { detail, versions, loading }
}
