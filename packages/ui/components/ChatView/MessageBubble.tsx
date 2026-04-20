"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter"
import oneDark from "react-syntax-highlighter/dist/esm/styles/prism/one-dark"
import { cn } from "@/lib/utils"
import { LuCopy, LuCheck, LuChevronLeft, LuChevronRight, LuX, LuPenLine } from "react-icons/lu"
import { VscSend } from "react-icons/vsc"
import type { ChatMessage } from "./types"

function CopyButton({ text, className: cls }: { text: string; className?: string }) {
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
      className={cn(
        "flex size-6 items-center justify-center rounded-md",
        "transition-colors duration-150",
        "cursor-pointer text-foreground/30 hover:text-foreground/60",
        cls,
      )}
    >
      {copied ? <LuCheck className="size-3.5" /> : <LuCopy className="size-3.5" />}
    </button>
  )
}

function formatTime(dateStr?: string): string | null {
  if (!dateStr) return null
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return null
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  } catch {
    return null
  }
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
      <CopyButton text={code} className="absolute right-2 top-2 text-foreground/25 hover:text-foreground/50" />

      {language ? (
        <div className="overflow-x-auto px-4 py-3">
          <SyntaxHighlighter
            style={cleanStyle}
            language={language}
            PreTag="div"
            customStyle={{
              background: "transparent",
              margin: 0,
              padding: 0,
              fontSize: "13px",
            }}
            codeTagProps={{
              style: {
                background: "transparent",
              },
            }}
          >
            {code}
          </SyntaxHighlighter>
        </div>
      ) : (
        <div className="overflow-x-auto px-4 py-3">
          <pre className="text-[13px] leading-[1.6] font-mono text-foreground/80 whitespace-pre">
            {code}
          </pre>
        </div>
      )}
    </div>
  )
}

function BranchNav({
  branches,
  activeBranch,
  onSwitch,
}: {
  branches: NonNullable<ChatMessage["branches"]>
  activeBranch: number | undefined
  onSwitch: (index: number) => void
}) {
  const total = branches.length
  const current = activeBranch !== undefined ? activeBranch + 1 : total

  return (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        disabled={current <= 1}
        onClick={() => onSwitch(current - 2)}
        className="flex size-6 cursor-pointer items-center justify-center rounded text-foreground/40 transition-colors hover:text-foreground/70 disabled:cursor-default disabled:opacity-30"
      >
        <LuChevronLeft className="size-3.5" />
      </button>
      <span className="text-[11px] tabular-nums text-muted-foreground/60">
        {current}/{total}
      </span>
      <button
        type="button"
        disabled={current >= total}
        onClick={() => onSwitch(current)}
        className="flex size-6 cursor-pointer items-center justify-center rounded text-foreground/40 transition-colors hover:text-foreground/70 disabled:cursor-default disabled:opacity-30"
      >
        <LuChevronRight className="size-3.5" />
      </button>
    </div>
  )
}

export function MessageBubble({
  message,
  onEdit,
  onSwitchBranch,
  isGenerating,
}: {
  message: ChatMessage
  onEdit?: (messageId: string, newText: string) => void
  onSwitchBranch?: (messageId: string, branchIndex: number) => void
  isGenerating?: boolean
}) {
  const isUser = message.role === "user"
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const hasBranches = message.branches && message.branches.length > 0

  const startEdit = useCallback(() => {
    setEditText(message.text)
    setEditing(true)
  }, [message.text])

  const cancelEdit = useCallback(() => {
    setEditing(false)
    setEditText("")
  }, [])

  const submitEdit = useCallback(() => {
    const trimmed = editText.trim()
    if (!trimmed || trimmed === message.text) {
      cancelEdit()
      return
    }
    onEdit?.(message.messageId, trimmed)
    setEditing(false)
    setEditText("")
  }, [editText, message.text, message.messageId, onEdit, cancelEdit])

  useEffect(() => {
    if (editing && textareaRef.current) {
      const ta = textareaRef.current
      ta.focus()
      ta.setSelectionRange(ta.value.length, ta.value.length)
      ta.style.height = "auto"
      ta.style.height = `${ta.scrollHeight}px`
    }
  }, [editing])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        submitEdit()
      }
      if (e.key === "Escape") {
        cancelEdit()
      }
    },
    [submitEdit, cancelEdit],
  )

  return (
    <div className={cn("group/msg flex w-full", isUser ? "justify-end" : "justify-start")}>
      <div className={cn("flex max-w-[85%] flex-col", isUser ? "items-end" : "items-start")}>
        {isUser && editing ? (
          <div className="flex w-full min-w-[280px] flex-col gap-2 rounded-2xl border border-border/30 bg-foreground/5 p-3">
            <textarea
              ref={textareaRef}
              value={editText}
              onChange={(e) => {
                setEditText(e.target.value)
                e.target.style.height = "auto"
                e.target.style.height = `${e.target.scrollHeight}px`
              }}
              onKeyDown={handleKeyDown}
              className="w-full resize-none bg-transparent text-[14px] leading-relaxed text-foreground outline-none"
              rows={1}
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={cancelEdit}
                className="flex size-7 cursor-pointer items-center justify-center rounded-lg text-foreground/40 transition-colors hover:text-foreground/70"
              >
                <LuX className="size-4" />
              </button>
              <button
                type="button"
                onClick={submitEdit}
                className="flex size-7 cursor-pointer items-center justify-center rounded-lg bg-foreground text-background transition-colors hover:bg-foreground/80"
              >
                <VscSend className="size-3.5" />
              </button>
            </div>
          </div>
        ) : (
        <div
          className={cn(
            "text-[14px] leading-relaxed",
            isUser
              ? "rounded-2xl rounded-tr-sm bg-foreground px-4 py-2.5 text-background"
              : "text-foreground",
          )}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap">{message.text}</p>
          ) : (
            <div className="prose-chat">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  pre({ children }) {
                    return <>{children}</>
                  },

                  code(props) {
                    const { className, children, ...rest } = props
                    const text = String(children)
                    const match = /language-(\w+)/.exec(className || "")

                    const isBlock =
                      match ||
                      text.includes("\n") ||
                      /[┌┐└┘│─├┤┬┴┼╔╗╚╝║═╠╣╦╩╬]/.test(text) ||
                      (text.length > 60 && /[{[\]()→←↑↓|>]/.test(text))

                    if (isBlock) {
                      return <CodeBlock language={match?.[1]}>{text}</CodeBlock>
                    }

                    return (
                      <code
                        className="rounded-md bg-foreground/[0.07] px-1.5 py-0.5 text-[0.85em] font-mono text-foreground/90"
                        {...rest}
                      >
                        {children}
                      </code>
                    )
                  },

                  table({ children }) {
                    return (
                      <div className="my-3 overflow-x-auto rounded-lg border border-border/25 bg-foreground/2">
                        <table className="w-full border-collapse text-[13px]">
                          {children}
                        </table>
                      </div>
                    )
                  },
                  thead({ children }) {
                    return (
                      <thead className="border-b border-border/30 bg-foreground/5">
                        {children}
                      </thead>
                    )
                  },
                  tr({ children }) {
                    return (
                      <tr className="border-b border-border/10 last:border-0 transition-colors hover:bg-foreground/2">
                        {children}
                      </tr>
                    )
                  },
                  th({ children }) {
                    return (
                      <th className="px-3 py-2 text-left text-[12px] font-semibold text-foreground/80">
                        {children}
                      </th>
                    )
                  },
                  td({ children }) {
                    return (
                      <td className="px-3 py-2 text-foreground/70">
                        {children}
                      </td>
                    )
                  },

                  a({ href, children }) {
                    return (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 underline decoration-blue-400/30 underline-offset-2 transition-colors hover:text-blue-300 hover:decoration-blue-300/50"
                      >
                        {children}
                      </a>
                    )
                  },

                  h1({ children }) {
                    return (
                      <h1 className="mb-3 mt-6 border-b border-border/20 pb-2 text-[18px] font-bold text-foreground first:mt-0">
                        {children}
                      </h1>
                    )
                  },
                  h2({ children }) {
                    return (
                      <h2 className="mb-2.5 mt-5 border-b border-border/15 pb-1.5 text-[16px] font-semibold text-foreground first:mt-0">
                        {children}
                      </h2>
                    )
                  },
                  h3({ children }) {
                    return (
                      <h3 className="mb-2 mt-4 text-[15px] font-semibold text-foreground first:mt-0">
                        {children}
                      </h3>
                    )
                  },
                  h4({ children }) {
                    return (
                      <h4 className="mb-1.5 mt-3 text-[14px] font-medium text-foreground first:mt-0">
                        {children}
                      </h4>
                    )
                  },

                  p({ children }) {
                    return (
                      <p className="my-2.5 leading-[1.75] text-foreground/85 first:mt-0 last:mb-0">
                        {children}
                      </p>
                    )
                  },

                  ul({ children }) {
                    return (
                      <ul className="my-2.5 list-disc space-y-1.5 pl-5 text-foreground/85 marker:text-foreground/30">
                        {children}
                      </ul>
                    )
                  },
                  ol({ children }) {
                    return (
                      <ol className="my-2.5 list-decimal space-y-2 pl-5 text-foreground/85 marker:text-foreground/50 marker:font-semibold">
                        {children}
                      </ol>
                    )
                  },
                  li({ children }) {
                    return (
                      <li className="leading-[1.75] pl-1 [&>p]:my-1 [&>ul]:my-1 [&>ol]:my-1">
                        {children}
                      </li>
                    )
                  },

                  blockquote({ children }) {
                    return (
                      <blockquote className="my-3 rounded-r-lg border-l-[3px] border-blue-400/40 bg-blue-400/4 py-2 pl-4 pr-3 text-foreground/70 [&>p]:my-1">
                        {children}
                      </blockquote>
                    )
                  },

                  hr() {
                    return <hr className="my-5 border-border/25" />
                  },

                  strong({ children }) {
                    return <strong className="font-semibold text-foreground">{children}</strong>
                  },
                  em({ children }) {
                    return <em className="italic text-foreground/75">{children}</em>
                  },

                  img({ src, alt }) {
                    return (
                      <span className="my-3 block">
                        <img
                          src={src}
                          alt={alt || ""}
                          className="max-w-full rounded-lg border border-border/20"
                          loading="lazy"
                        />
                      </span>
                    )
                  },
                }}
              >
                {message.text}
              </ReactMarkdown>
            </div>
          )}
        </div>
        )}
        {isUser ? (
          <div className="mt-1 flex items-center gap-1 flex-row-reverse">
            {formatTime(message.createdAt) && (
              <span className="text-[10px] text-muted-foreground/40">
                {formatTime(message.createdAt)}
              </span>
            )}
            <div className="flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover/msg:opacity-100">
              {!isGenerating && onEdit && !editing && (
                <button
                  type="button"
                  onClick={startEdit}
                  className="flex size-6 cursor-pointer items-center justify-center rounded-md text-foreground/30 transition-colors hover:text-foreground/60"
                >
                  <LuPenLine className="size-3.5" />
                </button>
              )}
              <CopyButton text={message.text} />
            </div>
            {hasBranches && !editing && onSwitchBranch && (
              <BranchNav
                branches={message.branches!}
                activeBranch={message.activeBranch}
                onSwitch={(idx) => onSwitchBranch(message.messageId, idx)}
              />
            )}
          </div>
        ) : (
          <div className="mt-1 flex items-center gap-2">
            {formatTime(message.createdAt) && (
              <span className="text-[10px] text-muted-foreground/40">
                {formatTime(message.createdAt)}
              </span>
            )}
            <CopyButton text={message.text} />
          </div>
        )}
      </div>
    </div>
  )
}

export function TypingDots() {
  return (
    <span className="flex items-center gap-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-foreground/35"
          style={{ animationDelay: `${i * 0.15}s`, animationDuration: "0.8s" }}
        />
      ))}
    </span>
  )
}
