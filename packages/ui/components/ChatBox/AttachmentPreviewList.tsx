"use client"

import Image from "next/image"
import { HugeiconsIcon } from "@hugeicons/react"
import { Cancel01Icon } from "@hugeicons/core-free-icons"
import type { ChatComposerAttachment } from "@/lib/chatAttachments"
import { formatAttachmentSize } from "@/lib/chatAttachments"

type Props = {
  attachments: ChatComposerAttachment[]
  isPreparing?: boolean
  onRemove: (attachmentId: string) => void
}

function truncateFileName(name: string, maxBaseLength = 18) {
  const lastDot = name.lastIndexOf(".")
  if (lastDot <= 0) {
    return name.length > maxBaseLength
      ? `${name.slice(0, maxBaseLength).trim()}...`
      : name
  }

  const base = name.slice(0, lastDot)
  const ext = name.slice(lastDot)
  if (base.length <= maxBaseLength) return name
  return `${base.slice(0, maxBaseLength).trim()}...${ext}`
}

function RemoveButton({
  attachmentId,
  onRemove,
}: {
  attachmentId: string
  onRemove: (attachmentId: string) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onRemove(attachmentId)}
      className="absolute right-1.5 top-1.5 flex size-5 cursor-pointer items-center justify-center rounded-full bg-black/55 text-white opacity-0 transition-all duration-150 group-hover/attachment:opacity-100 group-focus-within/attachment:opacity-100 hover:bg-black/75"
      aria-label="Remove attachment"
    >
      <HugeiconsIcon icon={Cancel01Icon} size={12} />
    </button>
  )
}

export function AttachmentPreviewList({
  attachments,
  isPreparing = false,
  onRemove,
}: Props) {
  if (attachments.length === 0 && !isPreparing) return null

  return (
    <div className="flex flex-wrap gap-2 px-3 pb-1 pt-2">
      {attachments.map((attachment) => {
        if (
          attachment.previewKind === "image" &&
          attachment.previewUrl
        ) {
          return (
            <div
              key={attachment.id}
              className="group/attachment relative h-16 w-16 overflow-hidden rounded-xl border border-border/60 bg-muted/20"
            >
              <Image
                src={attachment.previewUrl}
                alt={attachment.name}
                width={64}
                height={64}
                unoptimized
                className="h-full w-full object-cover"
              />
              <RemoveButton
                attachmentId={attachment.id}
                onRemove={onRemove}
              />
            </div>
          )
        }

        if (
          attachment.previewKind === "video" &&
          attachment.previewUrl
        ) {
          return (
            <div
              key={attachment.id}
              className="group/attachment relative h-16 w-24 overflow-hidden rounded-xl border border-border/60 bg-muted/20"
            >
              <video
                src={attachment.previewUrl}
                className="h-full w-full object-cover"
                muted
                playsInline
              />
              <div className="absolute inset-x-0 bottom-0 bg-black/50 px-2 py-1 text-[9px] text-white">
                {truncateFileName(attachment.name, 12)}
              </div>
              <RemoveButton
                attachmentId={attachment.id}
                onRemove={onRemove}
              />
            </div>
          )
        }

        return (
          <div
            key={attachment.id}
            className="group/attachment relative flex min-w-36 max-w-full items-center rounded-xl border border-border/60 bg-muted/20 px-3 py-2 pr-8"
          >
            <div className="min-w-0">
              <p className="truncate text-[11px] font-medium text-foreground">
                {truncateFileName(attachment.name)}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {formatAttachmentSize(attachment.size)}
              </p>
            </div>
            <RemoveButton
              attachmentId={attachment.id}
              onRemove={onRemove}
            />
          </div>
        )
      })}
      {isPreparing && (
        <div className="flex min-w-36 items-center gap-2 rounded-xl border border-dashed border-border/70 bg-muted/15 px-3 py-2">
          <div className="size-3 shrink-0 animate-spin rounded-full border border-muted-foreground/35 border-t-foreground/70" />
          <div className="min-w-0">
            <p className="truncate text-[11px] font-medium text-foreground">
              Preparing upload
            </p>
            <p className="text-[10px] text-muted-foreground">
              Getting preview ready...
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
