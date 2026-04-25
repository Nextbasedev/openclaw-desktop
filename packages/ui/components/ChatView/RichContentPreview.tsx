"use client"

import Image from "next/image"
import { LuFile, LuImage, LuMusic, LuFileText } from "react-icons/lu"
import type { ChatMessage } from "./types"

function attachmentUrl(
  attachment: NonNullable<ChatMessage["attachments"]>[number],
) {
  if (attachment.url) return attachment.url
  if (!attachment.content) return null
  return `data:${attachment.mimeType};base64,${attachment.content}`
}

export function RichContentPreview({ message }: { message: ChatMessage }) {
  const attachments = message.attachments ?? []
  if (attachments.length === 0 && !message.voice) return null

  return (
    <div className="mt-2 flex max-w-full flex-col gap-2">
      {attachments.map((attachment) => {
        const url = attachmentUrl(attachment)
        if (attachment.mimeType.startsWith("image/") && url) {
          return (
            <div
              key={attachment.name}
              className="overflow-hidden rounded-xl border border-border/20 bg-card/40"
            >
              <Image
                src={url}
                alt={attachment.name}
                width={320}
                height={200}
                unoptimized
                className="max-h-72 w-auto object-contain"
              />
            </div>
          )
        }

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
