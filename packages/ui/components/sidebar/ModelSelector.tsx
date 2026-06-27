"use client"

import { useState, useRef, useEffect } from "react"
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
    ensureLoaded,
    setDefaultModel,
  } = useModels()
  const [saving, setSaving] = useState(false)
  const [query, setQuery] = useState("")
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setQuery("")
    // Use the already-loaded list (loaded once on app start / connection change).
    // Only force a refetch when the cache looks degenerate (empty, or just the
    // synthesized current-model entry) so the list never opens blank.
    if (models.length <= 1) {
      void reload()
    } else {
      void ensureLoaded()
    }
    const t = setTimeout(() => searchRef.current?.focus(), 50)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  async function handleSelect(modelId: string) {
    const target = models.find((m) => `${m.provider}/${m.id}` === modelId)
    if (target && isActiveModel(current, target)) {
      onOpenChange(false)
      return
    }
    setSaving(true)
    try {
      // Persist + broadcast: every useModels() consumer (chat composer, footer
      // trigger button, this dialog) updates its selected model in place, no
      // app reload required.
      await setDefaultModel(modelId)
    } catch {
      // swallow; selection simply stays unchanged
    } finally {
      setSaving(false)
      onOpenChange(false)
    }
  }

  const unique = models.filter(
    (m, i, arr) =>
      arr.findIndex((x) => x.name.toLowerCase() === m.name.toLowerCase()) === i
  )

  const filtered = unique.filter((m) => {
    if (!query.trim()) return true
    const q = query.toLowerCase()
    return (
      m.name.toLowerCase().includes(q) || m.provider.toLowerCase().includes(q)
    )
  })

  return (
    <GlassDialog
      open={open}
      onClose={() => onOpenChange(false)}
      title="Switch model"
      className="w-[min(460px,calc(100vw-32px))]"
    >
      <div className="pt-1 pb-4">
        <div className="relative rounded-xl border border-black/[0.06] bg-black/[0.03] transition-colors focus-within:border-black/[0.12] focus-within:bg-black/[0.045] dark:border-white/[0.08] dark:bg-white/[0.035] dark:focus-within:border-white/[0.14] dark:focus-within:bg-white/[0.05]">
          <LuSearch
            size={14}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground/55"
          />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by model or provider"
            className={cn(
              "h-10 w-full rounded-xl border-0 bg-transparent pr-3 pl-9",
              "text-[13px] text-foreground outline-none",
              "placeholder:text-muted-foreground/45"
            )}
          />
        </div>
      </div>

      <div className="max-h-[320px] space-y-1 overflow-y-auto pr-1">
        {loading && models.length === 0 && (
          <p className="px-2.5 py-4 text-center text-[12px] text-muted-foreground">
            Loading models...
          </p>
        )}
        {!loading && error && (
          <div className="flex flex-col items-center gap-2 px-2.5 py-4">
            <p className="text-center text-[12px] text-red-400">{error}</p>
            <button
              type="button"
              onClick={reload}
              className="cursor-pointer rounded-md px-3 py-1 text-[11px] text-foreground/70 hover:bg-foreground/5"
            >
              Retry
            </button>
          </div>
        )}
        {!loading &&
          !error &&
          filtered.map((model) => {
            const active = isActiveModel(current, model)
            return (
              <button
                key={`${model.provider}/${model.id}`}
                type="button"
                disabled={saving}
                onClick={() => handleSelect(`${model.provider}/${model.id}`)}
                className={cn(
                  "group flex w-full cursor-pointer items-center gap-3 rounded-xl border px-2.5 py-2.5 text-left",
                  "transition-[background-color,border-color,box-shadow] disabled:cursor-not-allowed",
                  "focus-visible:ring-1 focus-visible:ring-foreground/20 focus-visible:outline-none",
                  saving && "opacity-50",
                  active
                    ? "border-emerald-400/20 bg-emerald-400/[0.08] text-foreground shadow-[inset_3px_0_0_rgba(52,211,153,0.65)]"
                    : "border-transparent text-foreground/82 hover:border-black/[0.06] hover:bg-black/[0.035] hover:text-foreground dark:hover:border-white/[0.08] dark:hover:bg-white/[0.045]"
                )}
              >
                <ModelLogo model={model} size="sm" />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-[13px] font-medium">
                      {model.name}
                    </span>
                    {model.reasoning && (
                      <span className="shrink-0 rounded-full bg-foreground/[0.06] px-1.5 py-0.5 text-[9px] tracking-[0.08em] text-muted-foreground/70 uppercase">
                        Reasoning
                      </span>
                    )}
                  </div>
                  <span className="truncate text-[11px] text-muted-foreground/58">
                    {model.provider}
                  </span>
                </div>
                {active && (
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-emerald-400/15 text-emerald-500 dark:text-emerald-300">
                    <LuCheck size={13} />
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
