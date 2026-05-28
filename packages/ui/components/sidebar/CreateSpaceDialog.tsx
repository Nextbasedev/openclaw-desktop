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
import { useMemo, useState, type RefObject } from "react"
import { LuBriefcase, LuClock3, LuHeart, LuMessageSquare, LuSearch, LuSmile, LuSparkles, LuZap } from "react-icons/lu"
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

type EmojiCategory = {
  id: string
  label: string
  icon: React.ReactNode
  emojis: SpaceIconEmoji[]
}

const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    id: "recent",
    label: "Popular",
    icon: <LuClock3 size={14} />,
    emojis: [
      { emoji: "✨", label: "sparkles" },
      { emoji: "🚀", label: "rocket launch startup" },
      { emoji: "💼", label: "briefcase business" },
      { emoji: "🎨", label: "art design creative" },
      { emoji: "📣", label: "marketing announcement" },
      { emoji: "⚡", label: "energy fast lightning" },
      { emoji: "🧠", label: "brain research ai" },
      { emoji: "🛠️", label: "tools build engineering" },
    ],
  },
  {
    id: "work",
    label: "Work",
    icon: <LuBriefcase size={14} />,
    emojis: [
      { emoji: "📁", label: "folder files" },
      { emoji: "📊", label: "chart analytics" },
      { emoji: "📈", label: "growth metrics" },
      { emoji: "🗂️", label: "organize tabs" },
      { emoji: "📝", label: "notes writing" },
      { emoji: "🔎", label: "search research" },
      { emoji: "🏢", label: "office company" },
      { emoji: "🤝", label: "partnership sales" },
      { emoji: "💰", label: "money finance" },
      { emoji: "🎯", label: "target goal" },
      { emoji: "🏆", label: "trophy wins" },
      { emoji: "📦", label: "package product" },
      { emoji: "🧾", label: "invoice receipt" },
      { emoji: "📅", label: "calendar planning" },
      { emoji: "🔐", label: "security lock" },
      { emoji: "🌐", label: "web global" },
    ],
  },
  {
    id: "creative",
    label: "Creative",
    icon: <LuSparkles size={14} />,
    emojis: [
      { emoji: "🎬", label: "video film" },
      { emoji: "📸", label: "camera photo" },
      { emoji: "🎧", label: "audio music" },
      { emoji: "🎤", label: "microphone voice" },
      { emoji: "🪄", label: "magic wand" },
      { emoji: "💎", label: "diamond premium" },
      { emoji: "🌈", label: "rainbow color" },
      { emoji: "🔥", label: "fire hot" },
      { emoji: "⭐", label: "star favorite" },
      { emoji: "🌟", label: "glowing star" },
      { emoji: "🦄", label: "unicorn unique" },
      { emoji: "🎁", label: "gift launch" },
      { emoji: "👑", label: "crown premium" },
      { emoji: "💡", label: "idea lightbulb" },
      { emoji: "🎮", label: "game gaming" },
      { emoji: "🧩", label: "puzzle components" },
    ],
  },
  {
    id: "communication",
    label: "Communication",
    icon: <LuMessageSquare size={14} />,
    emojis: [
      { emoji: "💬", label: "chat message" },
      { emoji: "📞", label: "phone call" },
      { emoji: "📨", label: "mail inbox" },
      { emoji: "📢", label: "megaphone broadcast" },
      { emoji: "🤖", label: "robot bot ai" },
      { emoji: "👀", label: "eyes review" },
      { emoji: "🙌", label: "celebrate hands" },
      { emoji: "✅", label: "check done" },
      { emoji: "❗", label: "important alert" },
      { emoji: "❓", label: "question help" },
      { emoji: "📍", label: "pin location" },
      { emoji: "🔔", label: "notification bell" },
    ],
  },
  {
    id: "energy",
    label: "Energy",
    icon: <LuZap size={14} />,
    emojis: [
      { emoji: "🚗", label: "car travel" },
      { emoji: "✈️", label: "plane travel" },
      { emoji: "🏠", label: "home house" },
      { emoji: "☀️", label: "sun bright" },
      { emoji: "🌙", label: "moon night" },
      { emoji: "🌍", label: "earth world" },
      { emoji: "🧪", label: "experiment lab" },
      { emoji: "🧬", label: "dna science" },
      { emoji: "🛰️", label: "satellite space" },
      { emoji: "⏱️", label: "timer speed" },
      { emoji: "🔋", label: "battery power" },
      { emoji: "🧭", label: "compass direction" },
    ],
  },
  {
    id: "favorites",
    label: "Favorites",
    icon: <LuHeart size={14} />,
    emojis: [
      { emoji: "❤️", label: "heart love" },
      { emoji: "💜", label: "purple heart" },
      { emoji: "💚", label: "green heart" },
      { emoji: "😍", label: "happy love" },
      { emoji: "😎", label: "cool" },
      { emoji: "🥳", label: "party celebration" },
      { emoji: "🤩", label: "excited wow" },
      { emoji: "🫡", label: "salute" },
      { emoji: "🙏", label: "thanks prayer" },
      { emoji: "💪", label: "strong muscle" },
      { emoji: "👌", label: "ok perfect" },
      { emoji: "👏", label: "clap applause" },
    ],
  },
]

const ALL_EMOJIS = EMOJI_CATEGORIES.flatMap((category) => category.emojis)

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
  const [activeCategoryId, setActiveCategoryId] = useState(EMOJI_CATEGORIES[0]?.id ?? "recent")
  const [emojiQuery, setEmojiQuery] = useState("")
  const activeCategory = EMOJI_CATEGORIES.find((category) => category.id === activeCategoryId) ?? EMOJI_CATEGORIES[0]
  const visibleEmojis = useMemo(() => {
    const query = emojiQuery.trim().toLowerCase()
    const source = query ? ALL_EMOJIS : activeCategory.emojis
    if (!query) return source
    return source.filter((item) => `${item.emoji} ${item.label ?? ""}`.toLowerCase().includes(query))
  }, [activeCategory.emojis, emojiQuery])

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
          <div className="mb-4 flex items-center gap-3.5">
            <div className="flex size-[52px] shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-400 to-blue-400 text-2xl shadow-[0_14px_28px_rgba(0,0,0,0.28)]">
              {iconEmoji.emoji}
            </div>
            <div className="min-w-0 flex-1">
              <label className="mb-1 block text-[11px] font-medium text-cyan-300/80" htmlFor="space-name-input">
                Project name
              </label>
              <input
                id="space-name-input"
                ref={inputRef}
                value={name}
                onChange={(e) => onNameChange(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void onSubmit()}
                placeholder="e.g. Q3 Marketing campaign"
                className="h-8 w-full border-0 border-b border-cyan-300/70 bg-transparent px-0 text-[14px] text-white outline-none placeholder:text-white/30 focus:border-cyan-200"
              />
            </div>
          </div>

          <p className="mb-3 border-t border-white/[0.07] pt-3 text-[12px] text-white/42">
            Choose a project name and icon
          </p>

          <div className="mb-2 flex items-center gap-1.5 overflow-x-auto pb-1">
            {EMOJI_CATEGORIES.map((category) => {
              const selected = category.id === activeCategoryId && !emojiQuery.trim()
              return (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => {
                    setActiveCategoryId(category.id)
                    setEmojiQuery("")
                  }}
                  className={cn(
                    "flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-white/42 transition-colors hover:bg-white/[0.08] hover:text-white/70",
                    selected && "bg-white/[0.10] text-cyan-200",
                  )}
                  title={category.label}
                  aria-label={`Show ${category.label} emojis`}
                >
                  {category.icon}
                </button>
              )
            })}
          </div>

          <div className="mb-3 flex h-9 items-center gap-2 rounded-full bg-white/[0.07] px-3 text-white/38">
            <LuSearch size={15} strokeWidth={1.8} />
            <input
              value={emojiQuery}
              onChange={(event) => setEmojiQuery(event.target.value)}
              placeholder="Search"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-white outline-none placeholder:text-white/35"
            />
            <LuSmile size={15} strokeWidth={1.8} />
          </div>

          <div className="h-[214px] overflow-y-auto pr-1">
            <div className="grid grid-cols-8 gap-1.5">
              {visibleEmojis.map((item) => {
                const selected = item.emoji === iconEmoji.emoji
                return (
                  <button
                    key={`${item.emoji}-${item.label}`}
                    type="button"
                    onClick={() => selectEmoji(item)}
                    className={cn(
                      "flex size-9 cursor-pointer items-center justify-center rounded-lg text-[22px] transition-all hover:bg-white/[0.08]",
                      selected && "bg-cyan-300/15 ring-1 ring-cyan-200/35",
                    )}
                    aria-label={`Use ${item.label} emoji`}
                    aria-pressed={selected}
                  >
                    {item.emoji}
                  </button>
                )
              })}
            </div>
            {visibleEmojis.length === 0 ? (
              <div className="flex h-28 items-center justify-center text-[12px] text-white/38">No emoji found</div>
            ) : null}
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
