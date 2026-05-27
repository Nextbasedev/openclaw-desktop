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
import { LuImagePlus, LuPlus, LuX } from "react-icons/lu"
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
          "sm:max-w-[560px] overflow-hidden rounded-3xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-0",
          "shadow-[0_24px_64px_var(--glass-shadow),0_2px_12px_var(--glass-shadow),inset_0_1px_0_var(--glass-inset)]",
          "backdrop-blur-[40px] backdrop-saturate-[180%]",
        )}
      >
        <div className="p-6 pb-4">
          <DialogHeader className="flex-row items-start gap-4 space-y-0 text-left">
            <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.045] text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_12px_28px_rgba(0,0,0,0.22)] backdrop-blur-xl">
              <LuImagePlus size={28} strokeWidth={1.8} />
            </div>
            <div className="min-w-0 pt-0.5">
              <DialogTitle>New Space</DialogTitle>
              <DialogDescription className="mt-1.5 leading-relaxed">
                Create a project workspace to keep chats, repo context, and settings separated.
              </DialogDescription>
            </div>
          </DialogHeader>

          <input
            ref={fileInputRef}
            type="file"
            accept=".png,.svg,.jpe,.jpg,.jpeg,image/png,image/svg+xml,image/jpeg"
            className="hidden"
            onChange={handleIconChange}
          />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
            className={cn(
              "mt-5 flex min-h-32 w-full cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.025] px-5 py-5 text-center transition-colors",
              "shadow-[inset_0_1px_0_rgba(255,255,255,0.035)] hover:border-white/18 hover:bg-white/[0.04]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60",
              previewSrc && "border-solid border-white/16 bg-white/[0.035]",
            )}
            aria-label="Upload space image"
          >
            <span className="relative flex size-18 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] shadow-[0_14px_32px_rgba(0,0,0,0.28),inset_0_1px_0_rgba(255,255,255,0.08)]">
              {previewSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previewSrc} alt="Space icon preview" className="size-full object-cover" />
              ) : (
                <LuImagePlus size={30} strokeWidth={1.7} className="text-muted-foreground" />
              )}
              <span
                role={previewSrc ? "button" : undefined}
                tabIndex={previewSrc ? 0 : undefined}
                onClick={(event) => {
                  if (!previewSrc) return
                  event.stopPropagation()
                  onIconImageChange(null)
                }}
                onKeyDown={(event) => {
                  if (!previewSrc || (event.key !== "Enter" && event.key !== " ")) return
                  event.preventDefault()
                  event.stopPropagation()
                  onIconImageChange(null)
                }}
                className="absolute -bottom-0.5 -right-0.5 flex size-7 items-center justify-center rounded-xl border border-white/10 bg-[var(--glass-bg)] text-foreground shadow-lg backdrop-blur-2xl"
                aria-label={previewSrc ? "Remove space image" : undefined}
              >
                {previewSrc ? <LuX size={16} strokeWidth={2.2} /> : <LuPlus size={17} strokeWidth={2.2} />}
              </span>
            </span>
            <span className="mt-3 text-[13px] font-medium text-foreground">Upload space image (optional)</span>
            <span className="mt-1 text-xs text-muted-foreground">PNG, SVG, JPE, JPG, or JPEG up to 10 MB</span>
          </button>

          <div className="mt-4 space-y-2">
            <label className="text-[13px] font-medium text-muted-foreground" htmlFor="space-name-input">
              Space name
            </label>
            <input
              id="space-name-input"
              ref={inputRef}
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void onSubmit()}
              placeholder="e.g. Marketing Website"
              className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.035] px-3 text-sm outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-colors placeholder:text-muted-foreground/60 focus:border-ring/40 focus:ring-2 focus:ring-ring/30"
            />
            {iconError ? <p className="text-xs text-destructive">{iconError}</p> : null}
          </div>
        </div>

        <DialogFooter className="border-t border-white/[0.06] bg-white/[0.015] px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={() => void onSubmit()} disabled={busy || !name.trim()}>
            Create Space
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
