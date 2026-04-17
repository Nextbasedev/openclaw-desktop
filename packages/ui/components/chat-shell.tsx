import type { ReactNode } from "react"

import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowUpRight01Icon,
  Mic01Icon,
  PlusSignIcon,
  SparklesIcon,
} from "@hugeicons/core-free-icons"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type MessageRole = "assistant" | "user"

type Message = {
  id: string
  role: MessageRole
  content: string
}

const sampleMessages: Message[] = [
  {
    id: "assistant-intro",
    role: "assistant",
    content:
      "Ready to shape the new desktop chat experience. Start with the middle chatbox design and we’ll build the rest around it.",
  },
  {
    id: "user-brief",
    role: "user",
    content:
      "Build a clean centered chatbox with a premium input area, model selector, quick action chip, and space for future streaming states.",
  },
]

function ChatBubble({ role, content }: Message) {
  return (
    <div className={cn("flex w-full", role === "user" ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[82%] rounded-[1.75rem] border px-4 py-3 text-sm leading-7 shadow-sm transition-colors sm:px-5",
          role === "user"
            ? "border-foreground/10 bg-foreground text-background dark:border-white/5"
            : "border-border/70 bg-card/90 text-card-foreground backdrop-blur-sm"
        )}
      >
        {content}
      </div>
    </div>
  )
}

function ComposerChip({
  children,
  active = false,
  className,
}: {
  children: ReactNode
  active?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors outline-none",
        "focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/20",
        active
          ? "border-border/80 bg-secondary text-secondary-foreground"
          : "border-border/60 bg-background/75 text-muted-foreground hover:bg-muted hover:text-foreground",
        className
      )}
    >
      {children}
    </button>
  )
}

function ComposerIconButton({
  children,
  label,
  emphasis = false,
}: {
  children: ReactNode
  label: string
  emphasis?: boolean
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      className={cn(
        "size-11 rounded-full border shadow-sm transition-colors",
        emphasis
          ? "border-transparent bg-foreground text-background hover:bg-foreground/85"
          : "border-border/60 bg-background/75 text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      {children}
    </Button>
  )
}

function ChatComposer() {
  return (
    <div className="rounded-[2rem] border border-border/70 bg-card/95 p-3 shadow-[0_24px_80px_-28px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:p-4">
      <div className="rounded-[1.6rem] border border-transparent bg-transparent px-2 pb-2 pt-1 sm:px-3">
        <textarea
          className="h-28 w-full resize-none bg-transparent px-2 py-2 text-[15px] leading-7 text-foreground outline-none placeholder:text-muted-foreground/90 sm:h-32 sm:text-base"
          placeholder="Message..."
          defaultValue=""
        />
      </div>

      <div className="flex flex-col gap-3 border-t border-border/60 px-1 pt-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <ComposerIconButton label="Add attachment">
            <HugeiconsIcon icon={PlusSignIcon} className="size-5" />
          </ComposerIconButton>

          <ComposerChip active>
            <HugeiconsIcon icon={SparklesIcon} className="size-4" />
            Plan
          </ComposerChip>
        </div>

        <div className="flex items-center justify-end gap-2">
          <ComposerChip className="min-w-[124px] justify-center">
            GPT-5.2
            <span className="text-muted-foreground">⌄</span>
          </ComposerChip>

          <ComposerIconButton label="Voice input">
            <HugeiconsIcon icon={Mic01Icon} className="size-5" />
          </ComposerIconButton>

          <ComposerIconButton label="Send message" emphasis>
            <HugeiconsIcon icon={ArrowUpRight01Icon} className="size-5" />
          </ComposerIconButton>
        </div>
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-1 items-end justify-center px-2 pb-4 pt-12 sm:pb-6">
      <div className="w-full max-w-3xl text-center">
        <div className="mb-6 space-y-3 sm:mb-8">
          <div className="inline-flex items-center rounded-full border border-border/70 bg-card/80 px-3 py-1 text-xs font-medium tracking-wide text-muted-foreground uppercase backdrop-blur-sm">
            OpenClaw Desktop
          </div>
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Build in the middle. Control everything around it.
            </h1>
            <p className="mx-auto max-w-2xl text-sm leading-7 text-muted-foreground sm:text-base">
              A focused chat experience first, with space for streaming, tool activity, and the rest of the mission-control UI later.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

export function ChatShell() {
  return (
    <main className="min-h-svh bg-background text-foreground">
      <div className="mx-auto flex min-h-svh w-full max-w-6xl flex-col px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col">
          <EmptyState />

          <section className="flex flex-1 flex-col justify-end gap-4 px-1 pb-4">
            <div className="space-y-4">
              {sampleMessages.map((message) => (
                <ChatBubble
                  key={message.id}
                  id={message.id}
                  role={message.role}
                  content={message.content}
                />
              ))}
            </div>
          </section>

          <section className="sticky bottom-0 pb-2 sm:pb-4">
            <ChatComposer />
          </section>
        </div>
      </div>
    </main>
  )
}
