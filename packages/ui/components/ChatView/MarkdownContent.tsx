"use client"

import { useState, useCallback } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter"
import oneDark from "react-syntax-highlighter/dist/esm/styles/prism/one-dark"
import { cn } from "@/lib/utils"
import { LuCopy, LuCheck } from "react-icons/lu"

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

function CodeBlock({ language, children }: { language?: string; children: string }) {
  const code = children.replace(/\n$/, "")
  return (
    <div className="group/code relative my-2 overflow-hidden rounded-lg border border-border/20 bg-[#1a1a1e]">
      <div className="absolute right-2 top-2"><CopyBtn text={code} /></div>
      {language ? (
        <div className="overflow-x-auto px-4 py-3">
          <SyntaxHighlighter
            style={cleanStyle}
            language={language}
            PreTag="div"
            customStyle={{ background: "transparent", margin: 0, padding: 0, fontSize: "13px" }}
            codeTagProps={{ style: { background: "transparent" } }}
          >
            {code}
          </SyntaxHighlighter>
        </div>
      ) : (
        <div className="overflow-x-auto px-4 py-3">
          <pre className="whitespace-pre font-mono text-[13px] leading-[1.6] text-foreground/80">{code}</pre>
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
    if (isBlock) return <CodeBlock language={match?.[1]}>{text}</CodeBlock>
    return <code className="rounded-md bg-foreground/[0.07] px-1.5 py-0.5 text-[0.85em] font-mono text-foreground/90" {...rest}>{children}</code>
  },
  table({ children }: { children?: React.ReactNode }) {
    return (<div className="my-3 overflow-x-auto rounded-lg border border-border/25 bg-foreground/2"><table className="w-full border-collapse text-[13px]">{children}</table></div>)
  },
  thead({ children }: { children?: React.ReactNode }) { return <thead className="border-b border-border/30 bg-foreground/5">{children}</thead> },
  tr({ children }: { children?: React.ReactNode }) { return <tr className="border-b border-border/10 last:border-0 transition-colors hover:bg-foreground/2">{children}</tr> },
  th({ children }: { children?: React.ReactNode }) { return <th className="px-3 py-2 text-left text-[12px] font-semibold text-foreground/80">{children}</th> },
  td({ children }: { children?: React.ReactNode }) { return <td className="px-3 py-2 text-foreground/70">{children}</td> },
  a({ href, children }: { href?: string; children?: React.ReactNode }) {
    return <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-400 underline decoration-blue-400/30 underline-offset-2 transition-colors hover:text-blue-300 hover:decoration-blue-300/50">{children}</a>
  },
  h1({ children }: { children?: React.ReactNode }) { return <h1 className="mb-3 mt-6 border-b border-border/20 pb-2 text-[18px] font-bold text-foreground first:mt-0">{children}</h1> },
  h2({ children }: { children?: React.ReactNode }) { return <h2 className="mb-2.5 mt-5 border-b border-border/15 pb-1.5 text-[16px] font-semibold text-foreground first:mt-0">{children}</h2> },
  h3({ children }: { children?: React.ReactNode }) { return <h3 className="mb-2 mt-4 text-[15px] font-semibold text-foreground first:mt-0">{children}</h3> },
  h4({ children }: { children?: React.ReactNode }) { return <h4 className="mb-1.5 mt-3 text-[14px] font-medium text-foreground first:mt-0">{children}</h4> },
  p({ children }: { children?: React.ReactNode }) { return <p className="my-2.5 leading-[1.75] text-foreground/85 first:mt-0 last:mb-0">{children}</p> },
  ul({ children }: { children?: React.ReactNode }) { return <ul className="my-2.5 list-disc space-y-1.5 pl-5 text-foreground/85 marker:text-foreground/30">{children}</ul> },
  ol({ children }: { children?: React.ReactNode }) { return <ol className="my-2.5 list-decimal space-y-2 pl-5 text-foreground/85 marker:text-foreground/50 marker:font-semibold">{children}</ol> },
  li({ children }: { children?: React.ReactNode }) { return <li className="pl-1 leading-[1.75] [&>ol]:my-1 [&>p]:my-1 [&>ul]:my-1">{children}</li> },
  blockquote({ children }: { children?: React.ReactNode }) { return <blockquote className="my-3 rounded-r-lg border-l-[3px] border-blue-400/40 bg-blue-400/4 py-2 pl-4 pr-3 text-foreground/70 [&>p]:my-1">{children}</blockquote> },
  hr() { return <hr className="my-5 border-border/25" /> },
  strong({ children }: { children?: React.ReactNode }) { return <strong className="font-semibold text-foreground">{children}</strong> },
  em({ children }: { children?: React.ReactNode }) { return <em className="italic text-foreground/75">{children}</em> },
  img({ src, alt }: { src?: string | Blob; alt?: string }) { return <span className="my-3 block"><img src={typeof src === "string" ? src : undefined} alt={alt || ""} className="max-w-full rounded-lg border border-border/20" loading="lazy" /></span> },
}

export function MarkdownContent({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn("prose-chat", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
        {text}
      </ReactMarkdown>
    </div>
  )
}
