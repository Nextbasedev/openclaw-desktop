"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import Image from "next/image"
import { motion } from "framer-motion"
import { LuChevronLeft, LuChevronRight, LuFile, LuFileText, LuImage, LuMusic, LuX } from "react-icons/lu"
import type { ChatMessage } from "./types"
import { cn } from "@/lib/utils"

type Attachment = NonNullable<ChatMessage["attachments"]>[number]
type ImageAttachment = { attachment: Attachment; url: string }

const STACK_ROTATIONS = [-7, 5, -3, 7, -5]
const MAX_STACKED_IMAGES = 5

function attachmentUrl(attachment: Attachment) {
  if (attachment.url) return attachment.url
  if (!attachment.content) return null
  return `data:${attachment.mimeType};base64,${attachment.content}`
}

function ImageLightbox({
  images,
  index,
  onIndexChange,
  onClose,
}: {
  images: ImageAttachment[]
  index: number
  onIndexChange: (index: number) => void
  onClose: () => void
}) {
  const image = images[index]
  const hasMultiple = images.length > 1

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
      if (e.key === "ArrowLeft" && hasMultiple) {
        onIndexChange((index - 1 + images.length) % images.length)
      }
      if (e.key === "ArrowRight" && hasMultiple) {
        onIndexChange((index + 1) % images.length)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [hasMultiple, images.length, index, onClose, onIndexChange])

  if (!image) return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/85 p-4 backdrop-blur-md"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Image preview"
    >
      <div className="absolute left-4 top-4 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-[12px] text-white/70 backdrop-blur-sm">
        {image.attachment.name}
        {hasMultiple && <span className="ml-2 text-white/40">{index + 1}/{images.length}</span>}
      </div>

      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 flex size-9 cursor-pointer items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
        aria-label="Close image preview"
      >
        <LuX className="size-5" />
      </button>

      {hasMultiple && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onIndexChange((index - 1 + images.length) % images.length)
          }}
          className="absolute left-4 top-1/2 flex size-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
          aria-label="Previous image"
        >
          <LuChevronLeft className="size-5" />
        </button>
      )}

      <motion.img
        key={image.url}
        src={image.url}
        alt={image.attachment.name}
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.16, ease: "easeOut" }}
        className="max-h-[88vh] max-w-[90vw] cursor-default rounded-2xl object-contain shadow-2xl shadow-black/60"
      />

      {hasMultiple && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onIndexChange((index + 1) % images.length)
          }}
          className="absolute right-4 top-1/2 flex size-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
          aria-label="Next image"
        >
          <LuChevronRight className="size-5" />
        </button>
      )}
    </div>,
    document.body,
  )
}

function ImageTile({
  image,
  index,
  count,
  onOpen,
}: {
  image: ImageAttachment
  index: number
  count: number
  onOpen: (index: number) => void
}) {
  const solo = count === 1
  const paired = count === 2

  return (
    <motion.button
      type="button"
      onClick={() => onOpen(index)}
      initial={{ opacity: 0, y: 4, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.14, delay: index * 0.025, ease: "easeOut" }}
      className={cn(
        "group relative cursor-zoom-in overflow-hidden border border-white/10 bg-card/50 shadow-lg shadow-black/10 transition-all hover:-translate-y-0.5 hover:border-white/20 hover:shadow-black/20",
        solo && "max-w-[320px] rounded-2xl",
        paired && "rounded-2xl",
      )}
    >
      <Image
        src={image.url}
        alt={image.attachment.name}
        width={solo ? 360 : 170}
        height={solo ? 240 : 190}
        unoptimized
        className={cn(
          "bg-black/10 transition-transform duration-300 group-hover:scale-[1.03]",
          solo && "max-h-[260px] w-auto object-contain",
          paired && "h-[160px] w-[132px] object-cover sm:h-[180px] sm:w-[150px]",
        )}
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
    </motion.button>
  )
}

function ImageStack({ images, onOpen }: { images: ImageAttachment[]; onOpen: (index: number) => void }) {
  const visible = images.slice(0, MAX_STACKED_IMAGES)
  const extra = images.length - visible.length

  return (
    <div className="flex max-w-[330px] items-end justify-end overflow-visible pb-3 pt-2">
      {visible.map((image, index) => {
        const rotation = STACK_ROTATIONS[index] ?? 0
        const isLast = index === visible.length - 1
        return (
          <motion.button
            key={`${image.attachment.name}-${index}`}
            type="button"
            onClick={() => onOpen(index)}
            initial={{ opacity: 0, y: 10, rotate: 0 }}
            animate={{ opacity: 1, y: 0, rotate: rotation }}
            whileHover={{ y: -12, rotate: 0, scale: 1.18, zIndex: 30 }}
            transition={{ duration: 0.22, delay: index * 0.035, ease: [0.34, 1.4, 0.64, 1] }}
            className="group relative h-[112px] w-[86px] shrink-0 cursor-zoom-in overflow-hidden rounded-2xl border border-white/12 bg-card shadow-xl shadow-black/20"
            style={{ marginRight: isLast ? 0 : -22, zIndex: index + 1, transformOrigin: "bottom center" }}
          >
            <Image
              src={image.url}
              alt={image.attachment.name}
              width={96}
              height={124}
              unoptimized
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
            {extra > 0 && index === visible.length - 1 && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/55 text-[18px] font-semibold text-white backdrop-blur-[1px]">
                +{extra}
              </div>
            )}
          </motion.button>
        )
      })}
    </div>
  )
}

function ImageGallery({ images }: { images: ImageAttachment[] }) {
  const [previewIndex, setPreviewIndex] = React.useState<number | null>(null)
  const count = images.length

  return (
    <>
      <div className={cn("overflow-visible", count === 2 ? "flex gap-1.5" : "flex")}>
        {count >= 3 ? (
          <ImageStack images={images} onOpen={setPreviewIndex} />
        ) : (
          images.map((image, index) => (
            <ImageTile
              key={`${image.attachment.name}-${index}`}
              image={image}
              index={index}
              count={count}
              onOpen={setPreviewIndex}
            />
          ))
        )}
      </div>
      {previewIndex !== null && (
        <ImageLightbox
          images={images}
          index={previewIndex}
          onIndexChange={setPreviewIndex}
          onClose={() => setPreviewIndex(null)}
        />
      )}
    </>
  )
}

export function RichContentPreview({ message }: { message: ChatMessage }) {
  const attachments = message.attachments ?? []
  if (attachments.length === 0 && !message.voice) return null

  const images: ImageAttachment[] = []
  const others: Attachment[] = []

  for (const attachment of attachments) {
    const url = attachmentUrl(attachment)
    if (attachment.mimeType.startsWith("image/")) {
      if (url) images.push({ attachment, url })
    } else {
      others.push(attachment)
    }
  }

  return (
    <div className="my-2 flex max-w-full flex-col gap-2 overflow-visible">
      {images.length > 0 && <ImageGallery images={images} />}

      {others.map((attachment, index) => {
        const url = attachmentUrl(attachment)

        if (attachment.mimeType === "application/pdf" && url) {
          return (
            <a
              key={`${attachment.name}-${index}`}
              href={url}
              target="_blank"
              rel="noreferrer"
              className="flex cursor-pointer items-center gap-2 rounded-xl border border-border/20 bg-card/40 px-3 py-2 text-[12px] text-foreground/70 hover:bg-foreground/5"
            >
              <LuFileText className="size-4 text-rose-300" />
              <span className="truncate">{attachment.name}</span>
              <span className="ml-auto text-muted-foreground/45">PDF</span>
            </a>
          )
        }

        return (
          <div
            key={`${attachment.name}-${index}`}
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
