"use client"

import { useState, useRef, useEffect } from "react"
import { invoke } from "@/lib/ipc"
import { cn } from "@/lib/utils"
import { LuCheck, LuSearch, LuTriangleAlert } from "react-icons/lu"
import { GlassDialog } from "@/components/ui/GlassDialog"
import { useModels, isActiveModel } from "@/hooks/useModels"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ModelSelector({ open, onOpenChange }: Props) {
  const {
    models,
    currentModel: current,
    loading,
    error,
    reload,
  } = useModels()
  const [saving, setSaving] = useState(false)
  const [query, setQuery] = useState("")
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setQuery("")
      reload()
      setTimeout(() => searchRef.current?.focus(), 50)
    }
  }, [reload, open])

  async function handleSelect(modelId: string) {
    const model = models.find((m) => `${m.provider}/${m.id}` === modelId || m.id === modelId)
    if (model?.health?.status === "unavailable") return
    setSaving(true)
    try {
      await invoke("middleware_models_set_default", {
        input: { modelId },
      })
      await reload()
    } catch {}
    finally {
      setSaving(false)
      onOpenChange(false)
    }
  }

  const currentModel = models.find((m) => isActiveModel(current, m))
  const label = currentModel?.name ?? current ?? "Select model"

  const unique = models.filter(
    (m, i, arr) =>
      arr.findIndex(
        (x) => x.name.toLowerCase() === m.name.toLowerCase(),
      ) === i,
  )

  const filtered = unique.filter((m) => {
    if (!query.trim()) return true
    const q = query.toLowerCase()
    return (
      m.name.toLowerCase().includes(q) ||
      m.provider.toLowerCase().includes(q)
    )
  })

  return (
    <GlassDialog
      open={open}
      onClose={() => onOpenChange(false)}
      title="Switch Model"
      description={`Current: ${label}`}
    >
      <div className="mb-3">
        <div className="relative">
          <LuSearch
            size={13}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50"
          />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search models..."
            className={cn(
              "h-8 w-full rounded-lg border pl-8 pr-3",
              "border-[var(--glass-input-border)] bg-[var(--glass-input-bg)]",
              "text-[12px] text-foreground outline-none",
              "placeholder:text-muted-foreground/40 focus:border-foreground/15",
            )}
          />
        </div>
      </div>

      <div className="h-[320px] overflow-y-auto">
        {loading && models.length === 0 && (
          <p className="px-2.5 py-4 text-center text-[12px] text-muted-foreground">
            Loading models...
          </p>
        )}
        {!loading && error && (
          <div className="flex flex-col items-center gap-2 px-2.5 py-4">
            <p className="text-center text-[12px] text-red-400">
              {error}
            </p>
            <button
              type="button"
              onClick={reload}
              className="rounded-md px-3 py-1 text-[11px] text-foreground/70 hover:bg-foreground/5"
            >
              Retry
            </button>
          </div>
        )}
        {!loading && !error && filtered.map((model) => {
          const active = isActiveModel(current, model)
          const unavailable = model.health?.status === "unavailable"
          return (
            <button
              key={`${model.provider}/${model.id}`}
              type="button"
              disabled={saving || unavailable}
              onClick={() =>
                handleSelect(`${model.provider}/${model.id}`)
              }
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left",
                "transition-colors",
                saving && "opacity-50",
                unavailable && "cursor-not-allowed opacity-45",
                active
                  ? "bg-foreground/8 text-foreground"
                  : "text-foreground/80 hover:bg-foreground/5 hover:text-foreground",
              )}
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-[13px] font-medium">
                    {model.name}
                  </span>
                  {unavailable && <LuTriangleAlert size={12} className="shrink-0 text-amber-400/80" />}
                </div>
                <span className={cn("text-[10px]", unavailable ? "text-amber-300/80" : "text-muted-foreground/50")}>
                  {unavailable ? model.health?.reason : model.reasoning ? "reasoning" : model.provider}
                </span>
              </div>
              {active && (
                <LuCheck
                  size={14}
                  className="shrink-0 text-white"
                />
              )}
            </button>
          )
        })}
        {!loading && !error && filtered.length === 0 && (
          <p className="px-2.5 py-4 text-center text-[12px] text-muted-foreground">
            No models match &ldquo;{query}&rdquo;
          </p>
        )}
      </div>
    </GlassDialog>
  )
}
