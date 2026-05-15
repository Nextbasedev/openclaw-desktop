"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { invoke } from "@/lib/ipc"

export type ModelEntry = {
  id: string
  name: string
  provider: string
  reasoning?: boolean
  health?: {
    status: "available" | "unavailable" | "degraded"
    reason?: string
    code?: string
  }
}

type RawModelEntry = ModelEntry | string | { id?: string; name?: string; provider?: string; model?: string; value?: string; reasoning?: boolean; health?: ModelEntry["health"] }

type ModelsResponse = {
  models?: RawModelEntry[]
  currentModel?: string | null
  defaultModel?: string | null
}

function normalizeModelEntry(entry: RawModelEntry): ModelEntry | null {
  if (typeof entry === "string") {
    const ref = entry
    if (!ref.trim()) return null
    const [provider, id] = ref.includes("/") ? ref.split(/\/(.+)/) : ["custom", ref]
    return { id, provider, name: id, reasoning: false }
  }

  const raw = entry as { id?: string; name?: string; provider?: string; model?: string; value?: string; reasoning?: boolean; health?: ModelEntry["health"] }
  const ref = String(raw.id || raw.model || raw.value || "")
  if (!ref.trim()) return null
  const [providerFromRef, idFromRef] = ref.includes("/") ? ref.split(/\/(.+)/) : ["custom", ref]
  const provider = String(raw.provider || providerFromRef || "custom")
  const id = String(raw.id || idFromRef || ref)
  return { id, provider, name: String(raw.name || id), reasoning: Boolean(raw.reasoning), health: raw.health }
}

function normalizeModelsResponse(response: ModelsResponse): { models: ModelEntry[]; currentModel: string | null } {
  const models = (response.models ?? []).map(normalizeModelEntry).filter((model): model is ModelEntry => Boolean(model))
  const currentModel = response.currentModel ?? response.defaultModel ?? null
  if (currentModel && !models.some((model) => model.id === currentModel || `${model.provider}/${model.id}` === currentModel)) {
    const current = normalizeModelEntry(currentModel)
    if (current) models.unshift(current)
  }
  return { models, currentModel }
}

let cachedModels: ModelEntry[] | null = null
let cachedCurrent: string | null = null
const currentModelListeners = new Set<(modelId: string | null) => void>()

export function setCachedCurrentModel(modelId: string | null) {
  cachedCurrent = modelId
  for (const listener of currentModelListeners) listener(modelId)
}

export function isActiveModel(
  current: string | null,
  model: ModelEntry,
): boolean {
  if (!current) return false
  const bare = current.includes("/") ? current.split(/\/(.+)/)[1] : current
  return model.id === current || `${model.provider}/${model.id}` === current || model.id === bare
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
      const normalized = normalizeModelsResponse(res)
      cachedModels = normalized.models
      cachedCurrent = normalized.currentModel
      setModels(cachedModels)
      setCurrentModel(cachedCurrent)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load models")
    }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    currentModelListeners.add(setCurrentModel)
    return () => {
      currentModelListeners.delete(setCurrentModel)
    }
  }, [])

  useEffect(() => {
    void load(false)
  }, [load])

  const ensureLoaded = useCallback(() => load(false), [load])
  const reload = useCallback(() => load(true), [load])
  const setCurrentModelOptimistic = useCallback((modelId: string | null) => {
    setCachedCurrentModel(modelId)
  }, [])

  return { models, currentModel, loading, error, reload, ensureLoaded, setCurrentModelOptimistic }
}
