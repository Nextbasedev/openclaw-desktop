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
import { LuPalette } from "react-icons/lu"
import type { Space } from "@/types/space"
import { ALL_PROJECT_EMOJIS, PROJECT_AVATAR_COLORS } from "./CreateSpaceDialog"

type SpaceIconEmoji = NonNullable<Space["iconEmoji"]>

type Props = {
  busy: boolean
  name: string
  iconEmoji: SpaceIconEmoji
  inputRef: RefObject<HTMLInputElement | null>
  renameOpen: boolean
  deleteOpen: boolean
  deleteTarget: Space | null
  onNameChange: (value: string) => void
  onIconEmojiChange: (value: SpaceIconEmoji) => void
  onRenameOpenChange: (open: boolean) => void
  onDeleteOpenChange: (open: boolean) => void
  onRenameSubmit: () => void | Promise<void>
  onDeleteConfirm: () => void | Promise<void>
}

export function SpaceDialogs({
  busy,
  name,
  iconEmoji,
  inputRef,
  renameOpen,
  deleteOpen,
  deleteTarget,
  onNameChange,
  onIconEmojiChange,
  onRenameOpenChange,
  onDeleteOpenChange,
  onRenameSubmit,
  onDeleteConfirm,
}: Props) {
  const avatarColor = iconEmoji.color || PROJECT_AVATAR_COLORS[0]

  function selectEmoji(nextIcon: SpaceIconEmoji) {
    onIconEmojiChange({ ...nextIcon, color: avatarColor })
  }

  function selectColor(color: string) {
    onIconEmojiChange({ ...iconEmoji, color })
  }

  return (
    <>
      <Dialog open={renameOpen} onOpenChange={onRenameOpenChange}>
        <DialogContent className="overflow-hidden rounded-2xl border border-white/10 bg-[#1a1a1a] p-0 sm:max-w-[460px]">
          <DialogHeader className="border-b border-white/[0.07] px-6 py-5 text-left">
            <DialogTitle className="text-sm font-medium text-white">Edit project</DialogTitle>
            <DialogDescription className="mt-0.5 text-[11px] text-white/40">
              Update the project name, emoji, and background color.
            </DialogDescription>
          </DialogHeader>

          <div className="px-6 py-5">
            <div className="mb-4 flex items-center gap-3.5">
              <div className={cn("flex size-[52px] shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-2xl shadow-[0_14px_28px_rgba(0,0,0,0.28)]", avatarColor)}>
                {iconEmoji.emoji}
              </div>
              <div className="min-w-0 flex-1">
                <label className="mb-1 block text-[11px] font-medium text-cyan-300/80" htmlFor="space-rename-input">
                  Project name
                </label>
                <input
                  id="space-rename-input"
                  ref={inputRef}
                  value={name}
                  onChange={(e) => onNameChange(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void onRenameSubmit()}
                  className="h-8 w-full border-0 border-b border-cyan-300/70 bg-transparent px-0 text-[14px] text-white outline-none placeholder:text-white/30 focus:border-cyan-200"
                />
              </div>
            </div>

            <div className="mb-4">
              <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.04em] text-white/45">
                <LuPalette size={13} /> Background color
              </div>
              <div className="flex gap-2">
                {PROJECT_AVATAR_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => selectColor(color)}
                    className={cn(
                      "size-7 cursor-pointer rounded-full bg-gradient-to-br transition-transform hover:scale-105",
                      color,
                      color === avatarColor && "ring-2 ring-cyan-200/60 ring-offset-2 ring-offset-[#1a1a1a]",
                    )}
                    aria-label="Change project background color"
                  />
                ))}
              </div>
            </div>

            <div>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.04em] text-white/45">Project emoji</p>
              <div className="h-[180px] overflow-y-auto px-1 py-0.5">
                <div className="grid grid-cols-8 gap-1.5">
                  {ALL_PROJECT_EMOJIS.map((item) => {
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
              </div>
            </div>
          </div>

          <DialogFooter className="border-t border-white/[0.07] bg-black/20 px-6 py-4">
            <Button variant="outline" onClick={() => onRenameOpenChange(false)} disabled={busy}>Cancel</Button>
            <Button onClick={() => void onRenameSubmit()} disabled={busy || !name.trim()}>
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={onDeleteOpenChange}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Delete Project</DialogTitle>
            <DialogDescription>
              Remove {deleteTarget?.name ?? "this project"} from your spaces list.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => onDeleteOpenChange(false)} disabled={busy}>Cancel</Button>
            <Button variant="destructive" onClick={() => void onDeleteConfirm()} disabled={busy}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
