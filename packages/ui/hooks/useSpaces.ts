"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { invoke } from "@/lib/ipc"
import { on } from "@/lib/events"
import { localSyncSubscribeBootstrap } from "@/lib/localFirstSync"
import { MIDDLEWARE_CONNECTION_CHANGED_EVENT } from "@/lib/middleware-client"
import { renameSpace } from "@/lib/api/spaces"
import {
  invalidateMiddlewareStartupBootstrap,
  loadMiddlewareStartupBootstrap,
} from "@/lib/startupBootstrap"
import type { Space } from "@/types/space"

type SpacesResponse = {
  spaces: Space[]
  activeSpaceId: string
}

type SpaceIconImage = NonNullable<Space["iconImage"]>

function spaceIconPayload(iconImage?: SpaceIconImage | null) {
  return iconImage ? { iconImage, ImageIcon: iconImage } : {}
}

function normalizeSpaceIcon(space: Space): Space {
  const iconImage = space.iconImage ?? space.ImageIcon ?? space.imageIcon ?? space.icon_image
  return iconImage ? { ...space, iconImage } : space
}

function upsertSpace(spaces: Space[], nextSpace: Space) {
  if (!nextSpace?.id) return spaces
  const found = spaces.some((space) => space.id === nextSpace.id)
  const next = found
    ? spaces.map((space) => space.id === nextSpace.id ? nextSpace : space)
    : [...spaces, nextSpace]
  return next.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
}

type SpaceMutationResponse = {
  ok?: boolean
  space?: Space
  activeSpaceId?: string
}

const DEFAULT_SPACE_ID = "space_default"
const DEFAULT_SPACE_NAME = "My Workspace"

function normalizeSpaces(spaces: Space[] = []) {
  return spaces.map((space) =>
    normalizeSpaceIcon(space.id === DEFAULT_SPACE_ID
      ? { ...space, name: DEFAULT_SPACE_NAME, archived: false }
      : space),
  )
}

export function useSpaces() {
  const [spaces, setSpaces] = useState<Space[]>([])
  const [activeSpaceId, setActiveSpaceId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const loadRequestRef = useRef(0)
  const activeSpaceOverrideRef = useRef<string | null>(null)

  const applySpaces = useCallback((nextSpaces: Space[], requestedActiveSpaceId?: string | null) => {
    const normalized = normalizeSpaces(nextSpaces || [])
    const override = activeSpaceOverrideRef.current
    const overrideStillExists = Boolean(override && normalized.some((space) => space.id === override))
    setSpaces((prev) => {
      const previousById = new Map(prev.map((space) => [space.id, space]))
      return normalized.map((space) => {
        const previous = previousById.get(space.id)
        return !space.iconImage && previous?.iconImage
          ? { ...space, iconImage: previous.iconImage }
          : space
      })
    })
    setActiveSpaceId(
      overrideStillExists
        ? override
        : requestedActiveSpaceId || normalized[0]?.id || null,
    )
    return normalized
  }, [])

  const loadSpacesFresh = useCallback(async () => {
    const requestId = ++loadRequestRef.current
    const result = await invoke<SpacesResponse>("middleware_spaces_list", { input: {} })
    if (loadRequestRef.current !== requestId) return result
    applySpaces(result.spaces || [], result.activeSpaceId)
    return result
  }, [applySpaces])

  const loadSpaces = useCallback(async () => {
    const requestId = ++loadRequestRef.current
    setLoading(true)
    try {
      const bootstrap = await loadMiddlewareStartupBootstrap()
      if (bootstrap && loadRequestRef.current === requestId) {
        applySpaces(bootstrap.spaces || [], bootstrap.activeSpaceId)
      }
      await loadSpacesFresh()
    } finally {
      if (loadRequestRef.current >= requestId) setLoading(false)
    }
  }, [applySpaces, loadSpacesFresh])

  useEffect(() => {
    void loadSpaces()
  }, [loadSpaces])

  useEffect(() => {
    return localSyncSubscribeBootstrap((bootstrap) => {
      applySpaces(bootstrap.spaces || [], bootstrap.activeSpaceId)
    })
  }, [applySpaces])

  useEffect(() => {
    function handleConnectionChanged() {
      invalidateMiddlewareStartupBootstrap()
      loadRequestRef.current += 1
      activeSpaceOverrideRef.current = null
      setSpaces([])
      setActiveSpaceId(null)
      setLoading(true)
      void loadSpacesFresh().finally(() => setLoading(false))
    }

    window.addEventListener(MIDDLEWARE_CONNECTION_CHANGED_EVENT, handleConnectionChanged)
    return () =>
      window.removeEventListener(
        MIDDLEWARE_CONNECTION_CHANGED_EVENT,
        handleConnectionChanged,
      )
  }, [loadSpacesFresh])

  useEffect(() => on("archive:changed", loadSpacesFresh), [loadSpacesFresh])

  const createSpace = useCallback(async (name?: string, iconImage?: SpaceIconImage | null) => {
    invalidateMiddlewareStartupBootstrap()
    const result = await invoke<{ space: Space; activeSpaceId: string }>("middleware_spaces_create", {
      input: { name: name?.trim() || undefined, ...spaceIconPayload(iconImage) },
    })

    let createdSpace = normalizeSpaceIcon(result.space)
    if (iconImage && !createdSpace.iconImage) {
      createdSpace = { ...createdSpace, iconImage }
      try {
        const persisted = await invoke<SpaceMutationResponse>("middleware_spaces_update", {
          input: { spaceId: result.space.id, ...spaceIconPayload(iconImage) },
        })
        if (persisted.space) {
          const persistedSpace = normalizeSpaceIcon(persisted.space)
          if (persistedSpace.iconImage) createdSpace = persistedSpace
        }
      } catch (error) {
        console.error("[Spaces] icon persistence fallback failed", error)
      }
    }

    invalidateMiddlewareStartupBootstrap()
    activeSpaceOverrideRef.current = result.activeSpaceId || createdSpace.id
    setSpaces((prev) => upsertSpace(prev, createdSpace))
    setActiveSpaceId(result.activeSpaceId || createdSpace.id)
    const fresh = await loadSpacesFresh().catch((error) => {
      console.error("[Spaces] refresh after create failed", error)
      return null
    })
    const freshSpace = fresh?.spaces?.find((space) => space.id === createdSpace.id)
    const normalizedFreshSpace = freshSpace ? normalizeSpaceIcon(freshSpace) : null
    if (iconImage && !normalizedFreshSpace?.iconImage) {
      try {
        const persisted = await invoke<SpaceMutationResponse>("middleware_spaces_update", {
          input: { spaceId: createdSpace.id, ...spaceIconPayload(iconImage) },
        })
        if (persisted.space) {
          const persistedSpace = normalizeSpaceIcon(persisted.space)
          if (persistedSpace.iconImage) {
            createdSpace = persistedSpace
            setSpaces((prev) => upsertSpace(prev, persistedSpace))
          }
        }
      } catch (error) {
        console.error("[Spaces] icon verification fallback failed", error)
      }
    }
    return normalizedFreshSpace?.iconImage ? normalizedFreshSpace : createdSpace
  }, [loadSpacesFresh])

  const updateSpace = useCallback(async (spaceId: string, input: { name?: string; iconImage?: SpaceIconImage | null; repoRoot?: string | null; projectId?: string | null }) => {
    invalidateMiddlewareStartupBootstrap()
    const optimisticUpdatedAt = new Date().toISOString()
    const optimisticPatch = {
      ...input,
      iconImage: input.iconImage ?? undefined,
      repoRoot: input.repoRoot ?? undefined,
      projectId: input.projectId ?? undefined,
    }
    setSpaces((prev) =>
      prev.map((space) =>
        space.id === spaceId
          ? {
              ...space,
              ...optimisticPatch,
              updatedAt: optimisticUpdatedAt,
            }
          : space,
      ),
    )
    const isRenameOnly = Boolean(input.name) && input.iconImage === undefined && input.repoRoot === undefined && input.projectId === undefined
    const result = isRenameOnly
      ? await renameSpace(spaceId, input.name!.trim())
      : await invoke<SpaceMutationResponse>("middleware_spaces_update", {
          input: { spaceId, ...input, ...(input.iconImage !== undefined ? spaceIconPayload(input.iconImage) : {}) },
        })
    invalidateMiddlewareStartupBootstrap()
    if (result.space) {
      setSpaces((prev) => upsertSpace(prev, normalizeSpaceIcon(result.space as Space)))
    }
    const fresh = await loadSpacesFresh().catch((error) => {
      console.error("[Spaces] refresh after update failed", error)
      return null
    })
    return (
      fresh?.spaces?.find((space) => space.id === spaceId) ??
      result.space ??
      null
    )
  }, [loadSpacesFresh])

  const switchSpace = useCallback(async (spaceId: string) => {
    const previousActiveSpaceId = activeSpaceId
    invalidateMiddlewareStartupBootstrap()
    activeSpaceOverrideRef.current = spaceId
    setActiveSpaceId(spaceId)
    try {
      await invoke("middleware_spaces_switch", { input: { spaceId } })
    } catch (error) {
      activeSpaceOverrideRef.current = previousActiveSpaceId
      setActiveSpaceId(previousActiveSpaceId)
      throw error
    }
    invalidateMiddlewareStartupBootstrap()
    setActiveSpaceId(spaceId)
    void loadSpacesFresh().catch((error) => console.error("[Spaces] refresh after switch failed", error))
  }, [activeSpaceId, loadSpacesFresh])

  const archiveSpace = useCallback(async (spaceId: string) => {
    invalidateMiddlewareStartupBootstrap()
    if (activeSpaceOverrideRef.current === spaceId) activeSpaceOverrideRef.current = null
    await invoke<{ ok: true; activeSpaceId?: string }>("middleware_spaces_archive", { input: { spaceId } })
    invalidateMiddlewareStartupBootstrap()
    setSpaces((prev) => prev.filter((space) => space.id !== spaceId))
    const result = await loadSpacesFresh()
    return result.activeSpaceId
  }, [loadSpacesFresh])

  const deleteSpace = useCallback(async (spaceId: string) => {
    invalidateMiddlewareStartupBootstrap()
    if (activeSpaceOverrideRef.current === spaceId) activeSpaceOverrideRef.current = null
    await invoke<{ ok: true; activeSpaceId?: string }>("middleware_spaces_delete", { input: { spaceId } })
    invalidateMiddlewareStartupBootstrap()
    setSpaces((prev) => prev.filter((space) => space.id !== spaceId))
    const result = await loadSpacesFresh()
    return result.activeSpaceId
  }, [loadSpacesFresh])

  return {
    spaces,
    activeSpaceId,
    activeSpace: spaces.find((space) => space.id === activeSpaceId) ?? null,
    loading,
    loadSpaces,
    createSpace,
    updateSpace,
    archiveSpace,
    switchSpace,
    deleteSpace,
  }
}
