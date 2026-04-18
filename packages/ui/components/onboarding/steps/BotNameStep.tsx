import { useState, useEffect, useRef } from "react"
import { Icons } from "@/components/icons"
import { cn } from "@/lib/utils"
import { RiArrowDownSLine } from "react-icons/ri"

type Props = {
  initialName: string | null
  getBotName: () => Promise<{ botName: string | null }>
  setBotName: (name: string) => Promise<{ ok: boolean; botName: string }>
  onComplete: () => void
  onBack: () => void
}

const SUGGESTIONS = ["Jarvis", "Atlas", "Nova", "Echo", "Sage"]

export function BotNameStep({ initialName, getBotName, setBotName, onComplete, onBack }: Props) {
  const [name, setName] = useState(initialName || "")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!initialName) {
      getBotName()
        .then((result) => {
          if (result.botName) setName(result.botName)
        })
        .catch(() => { })
    }
  }, [initialName, getBotName])

  async function handleSubmit() {
    const trimmed = name.trim()
    if (!trimmed) {
      setError("Bot name cannot be empty")
      return
    }
    setSaving(true)
    setError(null)
    try {
      await setBotName(trimmed)
      onComplete()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <button
          onClick={onBack}
          className="mb-5 flex items-center gap-1.5 text-[13px] text-muted-foreground/60 transition-colors hover:text-foreground"
        >
          <Icons.Back size={13} strokeWidth={1.5} />
          Back
        </button>
        <div className="flex items-start gap-3.5">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-foreground/5">
            <Icons.BubbleChat size={20} className="text-foreground/70" />
          </div>
          <div>
            <h2 className="text-lg tracking-tight">Name Your Assistant</h2>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              Give your AI assistant a name. You can change this anytime.
            </p>
          </div>
        </div>
      </div>

      <NameInput
        name={name}
        error={error}
        onNameChange={(v: string) => { setName(v); setError(null) }}
        onSubmit={handleSubmit}
      />

      {error && (
        <div className="rounded-xl bg-destructive/[0.06] px-4 py-3 text-center">
          <p className="text-[13px] text-destructive">{error}</p>
        </div>
      )}

      <div className="flex justify-center pt-1">
        <button
          onClick={handleSubmit}
          disabled={saving || !name.trim()}
          className={cn(
            "rounded-md bg-foreground px-8 py-2.5 text-[14px] cursor-pointer font-medium text-background transition-all",
            "hover:bg-foreground/90 active:scale-[0.98]",
            "disabled:opacity-40 disabled:cursor-not-allowed",
          )}
        >
          {saving ? "Saving..." : "Continue"}
        </button>
      </div>
    </div>
  )
}

function NameInput({
  name,
  error,
  onNameChange,
  onSubmit,
}: {
  name: string
  error: string | null
  onNameChange: (value: string) => void
  onSubmit: () => void
}) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  const isExactMatch = SUGGESTIONS.some((s) => s.toLowerCase() === name.trim().toLowerCase())
  const filtered = !name.trim() || isExactMatch
    ? SUGGESTIONS
    : SUGGESTIONS.filter((s) => s.toLowerCase().startsWith(name.toLowerCase()))

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  return (
    <div ref={wrapperRef}>
      <div className="relative">
        <input
          value={name}
          onChange={(e) => {
            onNameChange(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim()) {
              setOpen(false)
              onSubmit()
            }
            if (e.key === "Escape") setOpen(false)
          }}
          placeholder="Type a name..."
          className={cn(
            "h-12 w-full rounded-xl bg-foreground/[0.04] px-4 pr-10 text-[15px] text-foreground outline-none transition-all",
            "placeholder:text-muted-foreground/40",
            "focus:bg-foreground/[0.06] focus:ring-2 focus:ring-foreground/10",
            error && "ring-2 ring-destructive/30",
          )}
          autoFocus
          spellCheck={false}
          autoComplete="off"
          aria-invalid={!!error}
        />
        <button
          type="button"
          onClick={() => setOpen((p) => !p)}
          className="cursor-pointer absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/40 transition-colors hover:text-foreground"
        >
          <RiArrowDownSLine
            size={18}
            className={cn("transition-transform duration-200", open && "rotate-180")}
          />
        </button>
      </div>

      {open && filtered.length > 0 && (
        <div
          className={cn(
            "mt-1.5 w-full overflow-hidden rounded-xl",
            "border border-white/[0.08] bg-card shadow-[0_12px_32px_rgba(0,0,0,0.4)]",
            "animate-in fade-in-0 slide-in-from-top-1 duration-150",
          )}
        >
          <div className="p-1">
            {filtered.map((suggestion) => (
              <button
                key={suggestion}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onNameChange(suggestion)
                }}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-md px-3 py-2.5 cursor-pointer text-left transition-colors",
                  name === suggestion
                    ? "bg-foreground/[0.08] text-foreground"
                    : "text-foreground/80 hover:bg-foreground/[0.05]",
                )}
              >
                <div
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-md text-[11px] font-bold",
                    name === suggestion
                      ? "bg-emerald-500/15 text-emerald-500"
                      : "bg-foreground/[0.06] text-muted-foreground",
                  )}
                >
                  {suggestion[0]}
                </div>
                <span className="text-[13px] font-medium">{suggestion}</span>
                {name === suggestion && (
                  <Icons.Check size={13} className="ml-auto text-emerald-500" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
