"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { invoke } from "@/lib/ipc"

export type ModelEntry = {
  id: string
  name: string
  provider: string
  reasoning?: boolean
}

type ModelsResponse = {
  models: ModelEntry[]
  currentModel: string | null
}

let cachedModels: ModelEntry[] | null = null
let cachedCurrent: string | null = null

export function isActiveModel(
  current: string | null,
  model: ModelEntry,
): boolean {
  if (!current) return false
  const bare = current.includes("/") ? current.split("/")[1] : current
  return model.id === current || model.id === bare
}

export function useModels() {
  const [models, setModels] = useState<ModelEntry[]>(cachedModels ?? [])
  const [currentModel, setCurrentModel] = useState<string | null>(
    cachedCurrent,
  )
  const [loading, setLoading] = useState(!cachedModels)
  const [error, setError] = useState<string | null>(null)
  const fetched = useRef(false)

  const load = useCallback(async (force = false) => {
    if (!force && fetched.current && cachedModels) return
    fetched.current = true
    setError(null)
    setLoading(true)
    try {
      const res = await invoke<ModelsResponse>("middleware_models_list", {
        input: {},
      })
      cachedModels = res.models ?? []
      cachedCurrent = res.currentModel ?? null
      setModels(cachedModels)
      setCurrentModel(cachedCurrent)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load models")
    }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    void load(false)
  }, [load])

  const ensureLoaded = useCallback(() => load(false), [load])
  const reload = useCallback(() => load(true), [load])

  return { models, currentModel, loading, error, reload, ensureLoaded }
}
