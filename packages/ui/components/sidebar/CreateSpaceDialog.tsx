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
import { LuImagePlus, LuPlus, LuSparkles } from "react-icons/lu"
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
          "overflow-hidden rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-0 sm:max-w-[560px]",
          "shadow-[0_24px_64px_var(--glass-shadow),0_2px_12px_var(--glass-shadow),inset_0_1px_0_var(--glass-inset)]",
          "backdrop-blur-[40px] backdrop-saturate-[180%]",
        )}
      >
        <div className="p-6 pb-4">
          <DialogHeader className="flex-row items-start gap-4 space-y-0 text-left">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.045] text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_12px_28px_rgba(0,0,0,0.22)] backdrop-blur-xl">
              <LuSparkles size={24} strokeWidth={1.8} />
            </div>
            <div className="min-w-0 pt-0.5">
              <DialogTitle>Create project</DialogTitle>
              <DialogDescription className="mt-1.5 leading-relaxed">
                Give the project rail a clear identity and keep related chats separated.
              </DialogDescription>
            </div>
          </DialogHeader>

          <div className="mt-5 rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
            <div className="flex items-start gap-3">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy}
                className="group relative flex size-14 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-cyan-300 via-violet-400 to-rose-400 text-lg font-semibold text-white shadow-[0_16px_34px_-20px_rgba(0,0,0,0.85)] transition-transform hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                aria-label="Choose project image"
              >
                {previewSrc ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={previewSrc} alt="Project image preview" className="size-full object-cover" />
                ) : (
                  <>
                    <span className="absolute inset-0 bg-[radial-gradient(circle_at_30%_18%,rgba(255,255,255,0.30),transparent_38%)]" />
                    <span className="relative">{previewInitial}</span>
                  </>
                )}
                <span className="absolute -bottom-0.5 -right-0.5 flex size-6 items-center justify-center rounded-lg border border-white/10 bg-[var(--glass-bg)] text-foreground shadow-lg backdrop-blur-2xl">
                  <LuPlus size={14} strokeWidth={2.2} />
                </span>
              </button>
              <div className="min-w-0 flex-1 space-y-2">
                <div>
                  <p className="truncate text-sm font-semibold text-foreground">{previewName}</p>
                  <p className="mt-0.5 text-[11.5px] text-muted-foreground">Appears in the project rail with separated chats and context.</p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[12px] font-medium text-muted-foreground" htmlFor="space-name-input">
                    Project name
                  </label>
                  <input
                    id="space-name-input"
                    ref={inputRef}
                    value={name}
                    onChange={(e) => onNameChange(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && void onSubmit()}
                    placeholder="e.g. Desktop task B"
                    className="h-10 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-colors placeholder:text-muted-foreground/60 focus:border-ring/40 focus:ring-2 focus:ring-ring/30"
                  />
                </div>
              </div>
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".png,.svg,.jpe,.jpg,.jpeg,image/png,image/svg+xml,image/jpeg"
            className="hidden"
            onChange={handleIconChange}
          />

          <div className="mt-3 flex items-center gap-2 rounded-xl border border-white/[0.06] bg-black/[0.03] px-3 py-2 text-[11.5px] text-muted-foreground">
            <LuImagePlus size={13} />
            <span>Click the avatar to add an optional PNG, SVG, JPE, JPG, or JPEG image.</span>
          </div>
          {iconError ? <p className="mt-2 text-xs text-destructive">{iconError}</p> : null}
        </div>

        <DialogFooter className="border-t border-white/[0.06] bg-white/[0.015] px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={() => void onSubmit()} disabled={busy || !name.trim()}>
            Create project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
