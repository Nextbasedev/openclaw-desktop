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

export function useSkillsDiscovery() {
  const [skills, setSkills] = React.useState<DiscoveredSkill[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [sort, setSort] = React.useState<SortOption>("downloads")
  const [query, setQuery] = React.useState("")
  const [sources, setSources] = React.useState<string[]>([])
  const [nextCursor, setNextCursor] = React.useState<string | null>(null)
  const debounceRef = React.useRef<ReturnType<typeof setTimeout>>(undefined)

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
        const res = await invoke<SkillDiscoverResponse>(
          "middleware_skills_discover",
          {
            input: {
              query: params.query || undefined,
              limit: 50,
              sort: params.sort ?? sort,
              cursor: params.cursor,
              includeLocal: true,
              includeClawHub: true,
            },
          },
        )
        if (params.append) {
          setSkills((prev) => [...prev, ...res.results])
        } else {
          setSkills(res.results)
        }
        setSources(res.sources)
        setNextCursor(res.nextCursor)
      } catch {
        setError("Unable to load skills.")
        if (!params.append) setSkills([])
      } finally {
        setLoading(false)
      }
    },
    [sort],
  )

  React.useEffect(() => {
    fetchSkills({ sort })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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
    fetchSkills({ query, sort, cursor: nextCursor, append: true })
  }, [query, sort, nextCursor, fetchSkills])

  const updateSkill = React.useCallback(
    (slug: string, patch: Partial<DiscoveredSkill>) => {
      setSkills((prev) =>
        prev.map((s) => (s.slug === slug ? { ...s, ...patch } : s)),
      )
    },
    [],
  )

  return {
    skills,
    loading,
    error,
    sort,
    query,
    sources,
    nextCursor,
    onSortChange,
    onQueryChange,
    loadMore,
    updateSkill,
  }
}

export function useSkillDetail(slug: string | null) {
  const [detail, setDetail] = React.useState<SkillDetailResponse | null>(null)
  const [versions, setVersions] = React.useState<SkillVersionsResponse | null>(null)
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
      invoke<SkillVersionsResponse>("middleware_skills_versions", {
        input: { slug, limit: 10 },
      }).catch(() => null),
    ]).then(([d, v]) => {
      if (cancelled) return
      setDetail(d)
      setVersions(v)
      setLoading(false)
    }).catch(() => {
      if (!cancelled) setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [slug])

  return { detail, versions, loading }
}
