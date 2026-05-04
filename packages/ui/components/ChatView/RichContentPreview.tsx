"use client"

import * as React from "react"
import Image from "next/image"
import { LuFile, LuImage, LuMusic, LuFileText, LuX } from "react-icons/lu"
import type { ChatMessage } from "./types"

type Attachment = NonNullable<ChatMessage["attachments"]>[number]

function attachmentUrl(attachment: Attachment) {
  if (attachment.url) return attachment.url
  if (!attachment.content) return null
  return `data:${attachment.mimeType};base64,${attachment.content}`
}

function ImageLightbox({
  src,
  alt,
  onClose,
}: {
  src: string
  alt: string
  onClose: () => void
}) {
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 flex size-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
        aria-label="Close"
      >
        <LuX className="size-5" />
      </button>
      <img
        src={src}
        alt={alt}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
      />
    </div>
  )
}

function ImageThumbnail({
  attachment,
  url,
  solo,
}: {
  attachment: Attachment
  url: string
  solo: boolean
}) {
  const [lightboxOpen, setLightboxOpen] = React.useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setLightboxOpen(true)}
        className="overflow-hidden rounded-xl border border-border/20 bg-card/40 transition-opacity hover:opacity-80"
      >
        <Image
          src={url}
          alt={attachment.name}
          width={solo ? 320 : 160}
          height={solo ? 200 : 120}
          unoptimized
          className={
            solo
              ? "max-h-72 w-auto object-contain"
              : "h-32 w-full object-cover"
          }
        />
      </button>
      {lightboxOpen && (
        <ImageLightbox
          src={url}
          alt={attachment.name}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </>
  )
}

export function RichContentPreview({ message }: { message: ChatMessage }) {
  const attachments = message.attachments ?? []
  if (attachments.length === 0 && !message.voice) return null

  const images: Array<{ attachment: Attachment; url: string }> = []
  const others: Attachment[] = []

  for (const attachment of attachments) {
    const url = attachmentUrl(attachment)
    if (attachment.mimeType.startsWith("image/") && url) {
      images.push({ attachment, url })
    } else {
      others.push(attachment)
    }
  }

  const solo = images.length === 1

  return (
    <div className="mt-2 flex max-w-full flex-col gap-2">
      {images.length > 0 && (
        <div
          className={
            solo
              ? "flex"
              : "grid grid-cols-2 gap-2"
          }
        >
          {images.map(({ attachment, url }) => (
            <ImageThumbnail
              key={attachment.name}
              attachment={attachment}
              url={url}
              solo={solo}
            />
          ))}
        </div>
      )}

      {others.map((attachment) => {
        const url = attachmentUrl(attachment)

        if (attachment.mimeType === "application/pdf" && url) {
          return (
            <a
              key={attachment.name}
              href={url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 rounded-xl border border-border/20 bg-card/40 px-3 py-2 text-[12px] text-foreground/70 hover:bg-foreground/5"
            >
              <LuFileText className="size-4 text-rose-300" />
              <span className="truncate">{attachment.name}</span>
              <span className="ml-auto text-muted-foreground/45">PDF</span>
            </a>
          )
        }

        return (
          <div
            key={attachment.name}
            className="flex items-center gap-2 rounded-xl border border-border/20 bg-card/40 px-3 py-2 text-[12px] text-foreground/70"
          >
            {attachment.mimeType.startsWith("image/") ? (
              <LuImage className="size-4 text-blue-300" />
            ) : attachment.mimeType.startsWith("audio/") ? (
              <LuMusic className="size-4 text-emerald-300" />
            ) : (
              <LuFile className="size-4 text-muted-foreground" />
            )}
            <span className="truncate">{attachment.name}</span>
            <span className="ml-auto text-muted-foreground/45">
              {attachment.mimeType}
            </span>
          </div>
        )
      })}

      {message.voice && (
        <div className="rounded-xl border border-border/20 bg-card/40 px-3 py-2">
          <div className="flex items-center gap-2 text-[12px] text-foreground/70">
            <LuMusic className="size-4 text-emerald-300" />
            <span>Voice message</span>
            {message.voice.duration && (
              <span className="ml-auto text-muted-foreground/45">
                {Math.round(message.voice.duration)}s
              </span>
            )}
          </div>
          <audio src={message.voice.url} controls className="mt-2 w-full" />
          {message.voice.transcript && (
            <p className="mt-2 text-[12px] text-muted-foreground">
              {message.voice.transcript}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
