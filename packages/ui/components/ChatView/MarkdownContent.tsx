"use client"

import { useState, useCallback, useMemo } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkBreaks from "remark-breaks"
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter"
import oneDark from "react-syntax-highlighter/dist/esm/styles/prism/one-dark"
import { cn } from "@/lib/utils"
import { LuCopy, LuCheck } from "react-icons/lu"
import { LanguageIcon } from "@/components/icons/LanguageIcon"
import { MermaidBlock } from "./MermaidBlock"
import { useStreamingText } from "./useStreamingText"
import { openExternalUrl } from "@/lib/ipc"

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [text])
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="flex size-6 cursor-pointer items-center justify-center rounded-md text-foreground/25 transition-colors hover:text-foreground/50"
    >
      {copied ? <LuCheck className="size-3.5" /> : <LuCopy className="size-3.5" />}
    </button>
  )
}

const cleanStyle: Record<string, React.CSSProperties> = Object.fromEntries(
  Object.entries(oneDark).map(([key, val]) => {
    if (typeof val === "object" && val !== null) {
      const { background, backgroundColor, ...rest } = val as Record<string, unknown>
      return [key, rest as React.CSSProperties]
    }
    return [key, val]
  }),
)

function langDisplayName(lang?: string): string {
  if (!lang) return "Code"
  const names: Record<string, string> = {
    js: "JavaScript", javascript: "JavaScript",
    ts: "TypeScript", typescript: "TypeScript",
    tsx: "TSX", jsx: "JSX",
    py: "Python", python: "Python",
    rb: "Ruby", ruby: "Ruby",
    rs: "Rust", rust: "Rust",
    go: "Go", java: "Java", cpp: "C++", c: "C",
    cs: "C#", csharp: "C#",
    php: "PHP", swift: "Swift", kotlin: "Kotlin",
    sh: "Shell", bash: "Bash", zsh: "Zsh",
    powershell: "PowerShell", ps1: "PowerShell",
    sql: "SQL", html: "HTML", css: "CSS",
    scss: "SCSS", less: "Less", sass: "Sass",
    json: "JSON", yaml: "YAML", yml: "YAML",
    xml: "XML", toml: "TOML", ini: "INI",
    md: "Markdown", markdown: "Markdown",
    graphql: "GraphQL", docker: "Dockerfile",
    dockerfile: "Dockerfile",
  }
  return names[lang.toLowerCase()] ?? lang.charAt(0).toUpperCase() + lang.slice(1)
}

function CodeBlock({ language, children }: { language?: string; children: string }) {
  const code = children.replace(/\n$/, "")
  const displayLang = langDisplayName(language)
  return (
    <div className="group/code relative my-2 max-w-full min-w-0 overflow-hidden rounded-xl border border-border/20 bg-[#1a1a1e]">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border/15 bg-[#252529] px-4 py-2">
        <span className="flex items-center gap-2 text-[12px] font-medium text-foreground/60">
          <LanguageIcon lang={language} className="size-4" />
          {displayLang}
        </span>
        <CopyBtn text={code} />
      </div>
      {language ? (
        <div className="max-w-full overflow-x-auto rounded-b-xl px-4 py-4">
          <SyntaxHighlighter
            style={cleanStyle}
            language={language}
            PreTag="div"
            customStyle={{
              background: "transparent",
              margin: 0,
              padding: "4px 0",
              fontSize: "13px",
              minWidth: 0,
            }}
            codeTagProps={{ style: { background: "transparent" } }}
          >
            {code}
          </SyntaxHighlighter>
        </div>
      ) : (
        <div className="max-w-full overflow-x-auto rounded-b-xl px-4 py-4">
          <pre className="min-w-0 whitespace-pre font-mono text-[13px] leading-[1.6] text-foreground/80">{code}</pre>
        </div>
      )}
    </div>
  )
}

const mdComponents = {
  pre({ children }: { children?: React.ReactNode }) { return <>{children}</> },
  code(props: { className?: string; children?: React.ReactNode }) {
    const { className, children, ...rest } = props
    const text = String(children)
    const match = /language-(\w+)/.exec(className || "")
    const isBlock = match || text.includes("\n") || /[┌┐└┘│─├┤┬┴┼╔╗╚╝║═╠╣╦╩╬]/.test(text) || (text.length > 60 && /[{[\]()→←↑↓|>]/.test(text))
    if (isBlock) {
      if (match?.[1] === "mermaid") return <MermaidBlock code={text} />
      return <CodeBlock language={match?.[1]}>{text}</CodeBlock>
    }
    return <code className="break-words rounded-md bg-foreground/[0.07] px-1.5 py-0.5 text-[0.85em] font-mono text-foreground/90 [overflow-wrap:anywhere]" {...rest}>{children}</code>
  },
  table({ children }: { children?: React.ReactNode }) {
    return (<div className="my-3 max-w-full overflow-hidden rounded-xl border border-border/25 bg-foreground/2"><div className="max-w-full overflow-x-auto"><table className="w-full border-collapse text-[13px]">{children}</table></div></div>)
  },
  thead({ children }: { children?: React.ReactNode }) { return <thead className="border-b border-border/30 bg-foreground/5">{children}</thead> },
  tr({ children }: { children?: React.ReactNode }) { return <tr className="border-b border-border/10 last:border-0 transition-colors hover:bg-foreground/2">{children}</tr> },
  th({ children }: { children?: React.ReactNode }) { return <th className="px-3 py-2 text-left text-[12px] font-semibold text-foreground/80">{children}</th> },
  td({ children }: { children?: React.ReactNode }) { return <td className="break-words px-3 py-2 text-foreground/70 [overflow-wrap:anywhere]">{children}</td> },
  a({ href, children }: { href?: string; children?: React.ReactNode }) {
    const safeHref = typeof href === "string" ? href : ""
    const canOpen = /^(https?:|mailto:|tel:)/i.test(safeHref)
    return (
      <a
        href={safeHref}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(event) => {
          if (!canOpen) return
          event.preventDefault()
          openExternalUrl(safeHref).catch(() => {
            window.open(safeHref, "_blank", "noopener,noreferrer")
          })
        }}
        className="cursor-pointer text-blue-400 underline decoration-blue-400/30 underline-offset-2 transition-colors hover:text-blue-300 hover:decoration-blue-300/50"
      >
        {children}
      </a>
    )
  },
  h1({ children }: { children?: React.ReactNode }) { return <h1 className="mb-3 mt-6 border-b border-border/20 pb-2 text-[18px] font-bold text-foreground first:mt-0">{children}</h1> },
  h2({ children }: { children?: React.ReactNode }) { return <h2 className="mb-2.5 mt-5 border-b border-border/15 pb-1.5 text-[16px] font-semibold text-foreground first:mt-0">{children}</h2> },
  h3({ children }: { children?: React.ReactNode }) { return <h3 className="mb-2 mt-4 text-[15px] font-semibold text-foreground first:mt-0">{children}</h3> },
  h4({ children }: { children?: React.ReactNode }) { return <h4 className="mb-1.5 mt-3 text-[14px] font-medium text-foreground first:mt-0">{children}</h4> },
  p({ children }: { children?: React.ReactNode }) { return <p className="my-2.5 break-words leading-[1.75] text-foreground/85 [overflow-wrap:anywhere] first:mt-0 last:mb-0">{children}</p> },
  ul({ children }: { children?: React.ReactNode }) { return <ul className="my-2.5 list-disc space-y-1.5 pl-5 text-foreground/85 marker:text-foreground/30">{children}</ul> },
  ol({ children }: { children?: React.ReactNode }) { return <ol className="my-2.5 list-decimal space-y-2 pl-5 text-foreground/85 marker:text-foreground/50 marker:font-semibold">{children}</ol> },
  li({ children }: { children?: React.ReactNode }) { return <li className="break-words pl-1 leading-[1.75] [overflow-wrap:anywhere] [&>ol]:my-1 [&>p]:my-1 [&>ul]:my-1">{children}</li> },
  blockquote({ children }: { children?: React.ReactNode }) { return <blockquote className="my-3 rounded-r-lg border-l-[3px] border-blue-400/40 bg-blue-400/4 py-2 pl-4 pr-3 text-foreground/70 [&>p]:my-1">{children}</blockquote> },
  hr() { return <hr className="my-5 border-border/25" /> },
  strong({ children }: { children?: React.ReactNode }) { return <strong className="font-semibold text-foreground">{children}</strong> },
  em({ children }: { children?: React.ReactNode }) { return <em className="italic text-foreground/75">{children}</em> },
  img({ src, alt }: { src?: string | Blob; alt?: string }) { return <span className="my-3 block"><img src={typeof src === "string" ? src : undefined} alt={alt || ""} className="max-w-full rounded-lg border border-border/20" loading="lazy" /></span> },
}

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
    if (embed) {
      parts.push({ type: "embed", embed })
    }
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) {
    parts.push({ type: "text", value: text.slice(lastIndex) })
  }
  return parts
}

export function MarkdownContent({
  text,
  className,
  embeds,
  streaming,
  onRevealComplete,
}: {
  text: string
  className?: string
  embeds?: EmbedContent[]
  streaming?: boolean
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
    <div className={cn("prose-chat max-w-full min-w-0 overflow-hidden break-words [overflow-wrap:anywhere]", isRevealing && "streaming-text", className)}>
      {parts.map((part, i) =>
        part.type === "embed" ? (
          <EmbedBlock key={`embed-${i}`} embed={part.embed} />
        ) : (
          <ReactMarkdown key={`md-${i}`} remarkPlugins={[remarkGfm, remarkBreaks]} components={mdComponents}>
            {part.value}
          </ReactMarkdown>
        ),
      )}
    </div>
  )
}
