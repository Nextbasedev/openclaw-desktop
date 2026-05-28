"use client"

import { useState, useRef, useEffect } from "react"
import { invoke } from "@/lib/ipc"
import { cn } from "@/lib/utils"
import { LuCheck, LuSearch } from "react-icons/lu"
import { GlassDialog } from "@/components/ui/GlassDialog"
import { useModels, isActiveModel } from "@/hooks/useModels"
import { ModelLogo } from "@/components/model/ModelLogo"

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
  const currentDisplayModel = currentModel ?? (current
    ? {
        id: current.includes("/") ? current.split(/\/(.+)/)[1] : current,
        name: current.includes("/") ? current.split(/\/(.+)/)[1] : current,
        provider: current.includes("/") ? current.split(/\/(.+)/)[0] : "custom",
      }
    : null)

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
      className="w-[min(520px,calc(100vw-32px))]"
    >
      <div className="mb-4 rounded-2xl border border-white/10 bg-white/[0.045] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
        <div className="flex items-center gap-3">
          <ModelLogo model={currentDisplayModel} modelId={current} size="md" />
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground/55">
              Active model
            </p>
            <p className="truncate text-[14px] font-semibold text-foreground">
              {label}
            </p>
            {currentDisplayModel && (
              <p className="truncate text-[11px] text-muted-foreground/55">
                {currentDisplayModel.provider}
              </p>
            )}
          </div>
        </div>
      </div>

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
              "h-9 w-full rounded-xl border pl-8 pr-3",
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
              className="cursor-pointer rounded-md px-3 py-1 text-[11px] text-foreground/70 hover:bg-foreground/5"
            >
              Retry
            </button>
          </div>
        )}
        {!loading && !error && filtered.map((model) => {
          const active = isActiveModel(current, model)
          return (
            <button
              key={`${model.provider}/${model.id}`}
              type="button"
              disabled={saving}
              onClick={() =>
                handleSelect(`${model.provider}/${model.id}`)
              }
              className={cn(
                "flex w-full cursor-pointer items-center gap-3 rounded-xl border px-2.5 py-2.5 text-left",
                "transition-all disabled:cursor-not-allowed",
                saving && "opacity-50",
                active
                  ? "border-white/14 bg-foreground/10 text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
                  : "border-transparent text-foreground/80 hover:border-white/8 hover:bg-foreground/5 hover:text-foreground",
              )}
            >
              <ModelLogo model={model} size="sm" />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-[13px] font-medium">
                    {model.name}
                  </span>
                </div>
                <div className="flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground/55">
                  <span className="truncate">{model.provider}</span>
                  {model.reasoning && (
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[9px] uppercase tracking-[0.08em] text-muted-foreground/65">
                      reasoning
                    </span>
                  )}
                </div>
              </div>
              {active && (
                <span className="flex shrink-0 items-center gap-1 rounded-full border border-white/10 bg-white/[0.08] px-2 py-1 text-[10px] font-medium text-foreground">
                  <LuCheck size={12} />
                  Active
                </span>
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
