"use client"

import { useMemo } from "react"
import { cn } from "@/lib/utils"
import { useStreamingText } from "./useStreamingText"
import type { EmbedContent } from "./types"

const EMBED_RE = /\[embed\s+ref="([^"]+)"(?:\s+title="([^"]*)")?(?:\s+height="([^"]*)")?\s*\/?\]/g

function EmbedBlock({ embed }: { embed: EmbedContent }) {
  const html = embed.content
  const wrapped = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;color:#e4e4e7;background:transparent;padding:12px}
    table{width:100%;border-collapse:collapse;border:1px solid #333}
    th,td{padding:8px 12px;text-align:left;border:1px solid #333}
    th{background:#252529;font-weight:600;color:#a1a1aa}
    tr:nth-child(even){background:#1a1a1e}
    tr:hover{background:#252529}
    a{color:#60a5fa;text-decoration:underline}
  </style></head><body>${html}</body></html>`

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-border/20 bg-[#1a1a1e]">
      {embed.title && (
        <div className="border-b border-border/15 bg-[#252529] px-4 py-2 text-[12px] font-medium text-foreground/60">
          {embed.title}
        </div>
      )}
      <iframe
        srcDoc={wrapped}
        sandbox="allow-same-origin"
        className="w-full border-0"
        style={{ minHeight: 120, height: 400 }}
        onLoad={(e) => {
          const frame = e.currentTarget
          const doc = frame.contentDocument
          if (doc?.body) {
            frame.style.height = `${doc.body.scrollHeight + 24}px`
          }
        }}
      />
    </div>
  )
}

function splitTextAndEmbeds(text: string, embeds?: EmbedContent[]) {
  EMBED_RE.lastIndex = 0
  const hasEmbedRef = EMBED_RE.test(text)
  EMBED_RE.lastIndex = 0

  if (!embeds || embeds.length === 0 || !hasEmbedRef) {
    return [{ type: "text" as const, value: text }]
  }

  const embedMap = new Map(embeds.map((e) => [e.ref, e]))
  const parts: Array<{ type: "text"; value: string } | { type: "embed"; embed: EmbedContent }> = []
  let lastIndex = 0

  let match: RegExpExecArray | null
  while ((match = EMBED_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: "text", value: text.slice(lastIndex, match.index) })
    }
    const ref = match[1]
    const embed = embedMap.get(ref)
    if (embed) parts.push({ type: "embed", embed })
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) parts.push({ type: "text", value: text.slice(lastIndex) })
  return parts
}

function StreamingTextBlock({ text }: { text: string }) {
  const segments = text.split(/(```[\s\S]*?(?:```|$))/g).filter(Boolean)

  return (
    <div className="max-w-full min-w-0 break-words text-foreground/85 [overflow-wrap:anywhere]">
      {segments.map((segment, index) => {
        if (segment.startsWith("```")) {
          const body = segment
            .replace(/^```[^\n]*\n?/, "")
            .replace(/```$/, "")
          return (
            <pre
              key={index}
              className="my-2 max-w-full overflow-x-auto rounded-xl border border-border/20 bg-black/25 px-4 py-3 font-mono text-[13px] leading-[1.65] text-foreground/80"
            >
              {body}
            </pre>
          )
        }

        return segment.split(/\n{2,}/).map((paragraph, paragraphIndex) => {
          if (!paragraph) return null
          return (
            <p
              key={`${index}-${paragraphIndex}`}
              className="my-2.5 whitespace-pre-wrap break-words leading-[1.75] text-foreground/85 [overflow-wrap:anywhere] first:mt-0 last:mb-0"
            >
              {paragraph}
            </p>
          )
        })
      })}
    </div>
  )
}

export function MarkdownContent({
  text,
  className,
  embeds,
  streaming,
  cursorActive,
  onRevealComplete,
}: {
  text: string
  className?: string
  embeds?: EmbedContent[]
  streaming?: boolean
  cursorActive?: boolean
  onRevealComplete?: () => void
}) {
  const { displayText, isRevealing } = useStreamingText(
    text,
    streaming,
    onRevealComplete,
  )
  const parts = useMemo(
    () => splitTextAndEmbeds(displayText, embeds),
    [displayText, embeds],
  )

  return (
    <div
      className={cn(
        "prose-chat max-w-full min-w-0 overflow-hidden break-words [overflow-wrap:anywhere]",
        isRevealing && "streaming-text",
        cursorActive && "streaming-cursor",
        className,
      )}
    >
      {parts.map((part, i) =>
        part.type === "embed" ? (
          <EmbedBlock key={`embed-${i}`} embed={part.embed} />
        ) : (
          <StreamingTextBlock key={`text-${i}`} text={part.value} />
        ),
      )}
    </div>
  )
}
