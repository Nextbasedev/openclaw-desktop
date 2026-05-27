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
import { LuCamera, LuX } from "react-icons/lu"
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
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>New Space</DialogTitle>
          <DialogDescription>
            Create a project workspace to keep chats, repo context, and settings separated.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-4">
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
              "group relative flex size-20 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-3xl border border-border bg-muted/30 transition-colors",
              "hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60",
            )}
            aria-label="Upload space image"
          >
            {previewSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewSrc} alt="Space icon preview" className="size-full object-cover" />
            ) : (
              <div className="relative size-full overflow-hidden rounded-3xl bg-muted/40">
                <div className="absolute left-1/2 top-[22%] size-7 -translate-x-1/2 rounded-full bg-muted-foreground/20" />
                <div className="absolute -bottom-5 left-1/2 size-16 -translate-x-1/2 rounded-full bg-muted-foreground/20" />
              </div>
            )}
            <span className="absolute -bottom-0.5 -right-0.5 flex size-8 items-center justify-center rounded-xl border border-border bg-popover text-foreground shadow-lg transition-colors group-hover:bg-muted">
              <LuCamera size={17} strokeWidth={2} />
            </span>
          </button>

          <div className="min-w-0 flex-1">
            <input
              ref={inputRef}
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void onSubmit()}
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
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
