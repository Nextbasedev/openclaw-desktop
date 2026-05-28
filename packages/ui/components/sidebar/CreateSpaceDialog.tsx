"use client"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import type { RefObject } from "react"
import { LuMessageSquare, LuPanelLeft, LuSparkles } from "react-icons/lu"
import type { Space } from "@/types/space"

type SpaceIconImage = NonNullable<Space["iconImage"]>
type SpaceIconEmoji = NonNullable<Space["iconEmoji"]>

type Props = {
  open: boolean
  busy: boolean
  name: string
  iconImage: SpaceIconImage | null
  iconEmoji: SpaceIconEmoji
  iconError?: string | null
  inputRef: RefObject<HTMLInputElement | null>
  onOpenChange: (open: boolean) => void
  onNameChange: (value: string) => void
  onIconImageChange: (value: SpaceIconImage | null) => void
  onIconEmojiChange: (value: SpaceIconEmoji) => void
  onIconErrorChange?: (value: string | null) => void
  onSubmit: () => void | Promise<void>
}

const PROJECT_EMOJIS: SpaceIconEmoji[] = [
  { emoji: "✨", label: "sparkles" },
  { emoji: "🚀", label: "rocket" },
  { emoji: "💼", label: "briefcase" },
  { emoji: "🎨", label: "art" },
  { emoji: "📣", label: "marketing" },
  { emoji: "⚡", label: "energy" },
  { emoji: "🧠", label: "brain" },
  { emoji: "🛠️", label: "tools" },
]

export function CreateSpaceDialog({
  open,
  busy,
  name,
  iconEmoji,
  iconError,
  inputRef,
  onOpenChange,
  onNameChange,
  onIconImageChange,
  onIconEmojiChange,
  onIconErrorChange,
  onSubmit,
}: Props) {
  const previewName = name.trim() || "New Project"

  function selectEmoji(nextIcon: SpaceIconEmoji) {
    onIconImageChange(null)
    onIconErrorChange?.(null)
    onIconEmojiChange(nextIcon)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "overflow-hidden rounded-2xl border border-white/10 bg-[#1a1a1a] p-0 sm:max-w-[460px]",
          "shadow-[0_24px_64px_var(--glass-shadow),0_2px_12px_var(--glass-shadow),inset_0_1px_0_var(--glass-inset)]",
          "backdrop-blur-[40px] backdrop-saturate-[180%]",
        )}
      >
        <DialogHeader className="border-b border-white/[0.07] px-6 py-5 text-left">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.07] text-white/60">
              <LuSparkles size={16} strokeWidth={1.8} />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-sm font-medium text-white">Create project</DialogTitle>
              <DialogDescription className="mt-0.5 text-[11px] text-white/40">
                Keep related chats organized in one place
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="px-6 py-5">
          <div className="mb-5 flex items-center gap-3.5">
            <div className="flex size-[52px] shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-400 to-blue-400 text-2xl shadow-[0_14px_28px_rgba(0,0,0,0.28)]">
              {iconEmoji.emoji}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-white">{previewName}</p>
              <p className="mt-0.5 text-[11px] text-white/40">Pick an emoji for the project rail</p>
            </div>
          </div>

          <div className="mb-4">
            <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.04em] text-white/45" htmlFor="space-name-input">
              Project name
            </label>
            <input
              id="space-name-input"
              ref={inputRef}
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void onSubmit()}
              placeholder="e.g. Q3 Marketing campaign"
              className="h-10 w-full rounded-lg border border-white/[0.12] bg-white/[0.05] px-3 text-[13px] text-white outline-none transition-colors placeholder:text-white/30 focus:border-white/22 focus:ring-2 focus:ring-white/10"
            />
          </div>

          <div className="mb-4">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.04em] text-white/45">Project emoji</p>
            <div className="grid grid-cols-8 gap-1.5">
              {PROJECT_EMOJIS.map((item) => {
                const selected = item.emoji === iconEmoji.emoji
                return (
                  <button
                    key={`${item.emoji}-${item.label}`}
                    type="button"
                    onClick={() => selectEmoji(item)}
                    className={cn(
                      "flex size-9 cursor-pointer items-center justify-center rounded-lg border text-lg transition-all",
                      selected
                        ? "border-white/24 bg-white/14 shadow-[0_0_0_1px_rgba(255,255,255,0.08)]"
                        : "border-white/[0.07] bg-white/[0.04] hover:border-white/16 hover:bg-white/[0.08]",
                    )}
                    aria-label={`Use ${item.label} emoji`}
                    aria-pressed={selected}
                  >
                    {item.emoji}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="flex items-start gap-2 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2.5">
              <LuPanelLeft className="mt-0.5 shrink-0 text-white/35" size={14} strokeWidth={1.7} />
              <p className="text-[11px] leading-5 text-white/40">Own space in your sidebar with grouped chats</p>
            </div>
            <div className="flex items-start gap-2 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2.5">
              <LuMessageSquare className="mt-0.5 shrink-0 text-white/35" size={14} strokeWidth={1.7} />
              <p className="text-[11px] leading-5 text-white/40">Add chats and topics anytime after creating</p>
            </div>
          </div>
          {iconError ? <p className="mt-2 text-xs text-destructive">{iconError}</p> : null}
        </div>

        <DialogFooter className="border-t border-white/[0.07] bg-black/20 px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={() => void onSubmit()} disabled={busy || !name.trim()}>
            Create project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
