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
import { LuPlus, LuX } from "react-icons/lu"
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

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

async function toSpaceIconImage(file: File): Promise<SpaceIconImage> {
  if (!file.type.startsWith("image/")) throw new Error("Please choose an image file.")
  if (file.size > MAX_ICON_BYTES) throw new Error("Image must be 10 MB or smaller.")

  const bytes = new Uint8Array(await file.arrayBuffer())
  return {
    name: file.name,
    mimeType: file.type || "image/png",
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
          "sm:max-w-[420px] rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-6",
          "shadow-[0_24px_64px_var(--glass-shadow),0_2px_12px_var(--glass-shadow),inset_0_1px_0_var(--glass-inset)]",
          "backdrop-blur-[40px] backdrop-saturate-[180%]",
        )}
      >
        <DialogHeader>
          <DialogTitle>New Space</DialogTitle>
          <DialogDescription>
            Create a project workspace to keep chats, repo context, and settings separated.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleIconChange}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
            className={cn(
              "group relative flex size-18 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] transition-colors",
              "shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_14px_32px_rgba(0,0,0,0.28)] backdrop-blur-xl",
              "hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60",
            )}
            aria-label="Upload space image"
          >
            {previewSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewSrc} alt="Space icon preview" className="size-full object-cover" />
            ) : (
              <div className="relative size-full overflow-hidden rounded-2xl bg-muted/25">
                <div className="absolute left-1/2 top-[22%] size-6 -translate-x-1/2 rounded-full bg-muted-foreground/18" />
                <div className="absolute -bottom-4 left-1/2 size-14 -translate-x-1/2 rounded-full bg-muted-foreground/18" />
              </div>
            )}
            <span className="absolute -bottom-0.5 -right-0.5 flex size-7 items-center justify-center rounded-xl border border-white/10 bg-[var(--glass-bg)] text-foreground shadow-lg backdrop-blur-2xl transition-colors group-hover:bg-muted">
              <LuPlus size={17} strokeWidth={2.2} />
            </span>
          </button>

          <div className="w-full min-w-0">
            <input
              ref={inputRef}
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void onSubmit()}
              className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.035] px-3 text-sm outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-colors focus:border-ring/40 focus:ring-2 focus:ring-ring/30"
            />
            <div className="min-h-5">
              {iconImage ? (
                <button
                  type="button"
                  onClick={() => onIconImageChange(null)}
                  disabled={busy}
                  className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
                >
                  <LuX size={13} /> Remove image
                </button>
              ) : null}
              {iconError ? <p className="mt-2 text-xs text-destructive">{iconError}</p> : null}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={() => void onSubmit()} disabled={busy || !name.trim()}>
            Create Space
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
