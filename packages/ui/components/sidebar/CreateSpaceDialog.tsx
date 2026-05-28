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
import { useRef, type ChangeEvent, type RefObject } from "react"
import { LuMessageSquare, LuPanelLeft, LuPlus, LuSparkles } from "react-icons/lu"
import type { Space } from "@/types/space"

type SpaceIconImage = NonNullable<Space["iconImage"]>

type Props = {
  open: boolean
  busy: boolean
  name: string
  iconImage: SpaceIconImage | null
  iconError?: string | null
  inputRef: RefObject<HTMLInputElement | null>
  onOpenChange: (open: boolean) => void
  onNameChange: (value: string) => void
  onIconImageChange: (value: SpaceIconImage | null) => void
  onIconErrorChange?: (value: string | null) => void
  onSubmit: () => void | Promise<void>
}

const MAX_ICON_BYTES = 10 * 1024 * 1024
const ALLOWED_ICON_EXTENSIONS = new Set(["png", "svg", "jpe", "jpeg", "jpg"])
const ALLOWED_ICON_MIME_TYPES = new Set(["image/png", "image/svg+xml", "image/jpeg"])

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

function iconExtension(filename: string): string {
  return filename.toLowerCase().split(".").pop() ?? ""
}

async function toSpaceIconImage(file: File): Promise<SpaceIconImage> {
  const extension = iconExtension(file.name)
  const mimeType = file.type || (extension === "svg" ? "image/svg+xml" : extension === "png" ? "image/png" : "image/jpeg")
  if (!ALLOWED_ICON_EXTENSIONS.has(extension) || !ALLOWED_ICON_MIME_TYPES.has(mimeType)) {
    throw new Error("Please choose a PNG, SVG, JPE, JPG, or JPEG image.")
  }
  if (file.size > MAX_ICON_BYTES) throw new Error("Image must be 10 MB or smaller.")

  const bytes = new Uint8Array(await file.arrayBuffer())
  return {
    name: file.name,
    mimeType,
    content: bytesToBase64(bytes),
    encoding: "base64",
    size: file.size,
  }
}

export function CreateSpaceDialog({
  open,
  busy,
  name,
  iconImage,
  iconError,
  inputRef,
  onOpenChange,
  onNameChange,
  onIconImageChange,
  onIconErrorChange,
  onSubmit,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const previewSrc = iconImage ? `data:${iconImage.mimeType};base64,${iconImage.content}` : null
  const previewName = name.trim() || "New Project"
  const previewInitial = previewName.slice(0, 1).toUpperCase()

  async function handleIconChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return

    try {
      onIconErrorChange?.(null)
      onIconImageChange(await toSpaceIconImage(file))
    } catch (error) {
      onIconErrorChange?.(error instanceof Error ? error.message : "Could not read image.")
    }
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
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
              className="group relative flex size-[52px] shrink-0 cursor-pointer items-center justify-center overflow-visible rounded-xl bg-gradient-to-br from-violet-400 to-blue-400 text-xl font-semibold text-white shadow-[0_14px_28px_rgba(0,0,0,0.28)] transition-transform hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
              title="Click to change image"
              aria-label="Choose project image"
            >
              {previewSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previewSrc} alt="Project image preview" className="size-full rounded-xl object-cover" />
              ) : (
                <span>{previewInitial}</span>
              )}
              <span className="absolute -bottom-1 -right-1 flex size-[18px] items-center justify-center rounded-full border border-white/15 bg-[#1a1a1a] text-white/60">
                <LuPlus size={10} strokeWidth={2.2} />
              </span>
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-white">{previewName}</p>
              <p className="mt-0.5 text-[11px] text-white/40">Click the avatar to add a custom image</p>
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".png,.svg,.jpe,.jpg,.jpeg,image/png,image/svg+xml,image/jpeg"
            className="hidden"
            onChange={handleIconChange}
          />

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
