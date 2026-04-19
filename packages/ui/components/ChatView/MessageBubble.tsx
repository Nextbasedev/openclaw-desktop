"use client"

import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter"
import oneDark from "react-syntax-highlighter/dist/esm/styles/prism/one-dark"
import { cn } from "@/lib/utils"
import type { ChatMessage } from "./types"

export function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user"

  return (
    <div className={cn("flex w-full gap-2", isUser ? "flex-row-reverse" : "flex-row")}>
      {/* Avatar dot */}
      <div className={cn(
        "mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
        isUser
          ? "bg-foreground text-background"
          : "bg-foreground/10 text-foreground/60",
      )}>
        {isUser ? "U" : "AI"}
      </div>

      <div className={cn("flex max-w-[80%] flex-col gap-1", isUser ? "items-end" : "items-start")}>
        <div
          className={cn(
            "rounded-2xl px-4 py-2.5 text-[14px] leading-relaxed",
            isUser
              ? "rounded-tr-sm bg-foreground text-background"
              : "rounded-tl-sm bg-card/80 text-foreground ring-1 ring-border/20 shadow-sm",
          )}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap">{message.text}</p>
          ) : (
            <div className="prose prose-sm max-w-none dark:prose-invert prose-p:leading-relaxed prose-pre:p-0 prose-pre:bg-transparent prose-p:my-1 prose-ul:my-1 prose-ol:my-1">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  code(props) {
                    const { className, children, ...rest } = props
                    const match = /language-(\w+)/.exec(className || "")
                    if (match) {
                      return (
                        <SyntaxHighlighter
                          style={oneDark}
                          language={match[1]}
                          PreTag="div"
                          customStyle={{ borderRadius: "0.5rem", fontSize: "13px", margin: "0.4rem 0" }}
                        >
                          {String(children).replace(/\n$/, "")}
                        </SyntaxHighlighter>
                      )
                    }
                    return (
                      <code className="rounded bg-foreground/8 px-1.5 py-0.5 text-[0.85em] font-mono" {...rest}>
                        {children}
                      </code>
                    )
                  },
                }}
              >
                {message.text}
              </ReactMarkdown>
            </div>
          )}
        </div>
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
