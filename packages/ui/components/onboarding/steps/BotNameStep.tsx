import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Icons } from "@/components/icons"

type Props = {
  initialName: string | null
  getBotName: () => Promise<{ botName: string | null }>
  setBotName: (name: string) => Promise<{ ok: boolean; botName: string }>
  onComplete: () => void
  onBack: () => void
}

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
        .catch(() => {})
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
          className="mb-4 flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <Icons.Back size={14} strokeWidth={1.5} />
          Back
        </button>
        <h2 className="text-xl font-semibold tracking-tight">Name Your Assistant</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Give your AI assistant a name. You can change this anytime in settings.
        </p>
      </div>

      <div className="space-y-2">
        <Input
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            setError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim()) handleSubmit()
          }}
          placeholder="e.g. Jarvis, Atlas, Nova..."
          className="h-11 text-base"
          autoFocus
          spellCheck={false}
          aria-invalid={!!error}
        />
        <p className="text-xs text-muted-foreground">
          This name appears in the UI and identifies your assistant.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      <Button size="sm" onClick={handleSubmit} disabled={saving || !name.trim()}>
        {saving ? "Saving..." : "Continue"}
      </Button>
    </div>
  )
}
