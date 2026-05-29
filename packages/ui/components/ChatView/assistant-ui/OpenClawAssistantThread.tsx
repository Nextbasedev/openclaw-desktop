"use client"

import { createContext, useContext, useMemo, type FC } from "react"
import {
  ActionBarPrimitive,
  AuiIf,
  AuiProvider,
  ComposerPrimitive,
  ExternalThread,
  InMemoryThreadList,
  MessagePrimitive,
  ThreadPrimitive,
  useAui,
  useAuiState,
} from "@assistant-ui/react"
import { LuCheck, LuCopy, LuRefreshCw, LuSquare, LuArrowUp, LuChevronDown } from "react-icons/lu"
import { MarkdownContent } from "../MarkdownContent"
import { ToolCallSteps } from "../ToolCallSteps"
import type { ChatMessage } from "../types"
import { assistantTextFromAppendMessage, toAssistantMessages } from "./adapter"
import { cn } from "@/lib/utils"

type ApprovalDecision = "allow-once" | "allow-always" | "deny"

export type OpenClawAssistantThreadProps = {
  messages: readonly ChatMessage[]
  isRunning: boolean
  onSendText: (text: string) => void | Promise<void>
  onAbort: () => void | Promise<void>
  onSelectTool?: (toolCallId: string) => void
  onResolveApproval?: (
    approvalId: string,
    decision: ApprovalDecision
  ) => Promise<void> | void
  className?: string
}

type OpenClawAssistantThreadCallbacks = Pick<
  OpenClawAssistantThreadProps,
  "onSelectTool" | "onResolveApproval"
>

const OpenClawAssistantThreadCallbacksContext =
  createContext<OpenClawAssistantThreadCallbacks>({})

export function OpenClawAssistantThread(props: OpenClawAssistantThreadProps) {
  const assistantMessages = useMemo(
    () => toAssistantMessages(props.messages),
    [props.messages]
  )

  const aui = useAui({
    threads: InMemoryThreadList({
      thread: () =>
        ExternalThread({
          messages: assistantMessages,
          isRunning: props.isRunning,
          onNew: async (message) => {
            const text = assistantTextFromAppendMessage(message)
            if (text.trim()) await props.onSendText(text)
          },
          onCancel: async () => {
            await props.onAbort()
          },
        }),
    }),
  })

  return (
    <AuiProvider value={aui}>
      <AssistantThreadSurface {...props} />
    </AuiProvider>
  )
}

function AssistantThreadSurface({
  className,
  onSelectTool,
  onResolveApproval,
}: OpenClawAssistantThreadProps) {
  const callbacks = useMemo(
    () => ({ onSelectTool, onResolveApproval }),
    [onResolveApproval, onSelectTool]
  )

  return (
    <OpenClawAssistantThreadCallbacksContext.Provider value={callbacks}>
      <ThreadPrimitive.Root
        className={cn(
          "aui-root aui-thread-root bg-background @container flex h-full min-h-0 flex-col",
          className
        )}
        style={{
          ["--thread-max-width" as string]: "52rem",
          ["--composer-radius" as string]: "24px",
          ["--composer-padding" as string]: "10px",
        }}
      >
        <ThreadPrimitive.Viewport
          turnAnchor="top"
          data-slot="aui_thread-viewport"
          className="relative flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto scroll-smooth"
        >
          <div className="mx-auto flex w-full max-w-(--thread-max-width) flex-1 flex-col px-4 pt-4">
            <AuiIf condition={(s) => s.thread.isEmpty}>
              <ThreadWelcome />
            </AuiIf>

            <div
              data-slot="aui_message-group"
              className="mb-10 flex flex-col gap-y-8 empty:hidden"
            >
              <ThreadPrimitive.Messages>{() => <ThreadMessage />}</ThreadPrimitive.Messages>
            </div>

            <ThreadPrimitive.ViewportFooter className="aui-thread-footer sticky bottom-0 mt-auto flex flex-col gap-4 overflow-visible rounded-t-(--composer-radius) bg-background/95 pb-4 pt-2 backdrop-blur-xl md:pb-6">
              <ThreadScrollToBottom />
              <Composer />
            </ThreadPrimitive.ViewportFooter>
          </div>
        </ThreadPrimitive.Viewport>
      </ThreadPrimitive.Root>
    </OpenClawAssistantThreadCallbacksContext.Provider>
  )
}

const ThreadWelcome: FC = () => (
  <div className="mx-auto my-auto flex w-full max-w-(--thread-max-width) flex-col px-2 py-12">
    <h1 className="text-2xl font-semibold">
      Welcome
    </h1>
    <p className="text-xl text-muted-foreground">
      How can I help you today?
    </p>
  </div>
)

const ThreadScrollToBottom: FC = () => (
  <ThreadPrimitive.ScrollToBottom asChild>
    <button
      type="button"
      className="absolute -top-10 self-center rounded-full border border-border/50 bg-background p-2 text-muted-foreground shadow-sm transition hover:text-foreground disabled:invisible"
      aria-label="Scroll to bottom"
    >
      <LuChevronDown className="size-4" />
    </button>
  </ThreadPrimitive.ScrollToBottom>
)

const ThreadMessage: FC = () => {
  const role = useAuiState((s) => s.message.role)
  if (role === "user") return <UserMessage />
  return <AssistantMessage />
}

const AssistantMessage: FC = () => {
  const { onSelectTool, onResolveApproval } = useContext(
    OpenClawAssistantThreadCallbacksContext
  )
  const openclaw = useAuiState(
    (s) => s.message.metadata?.custom?.openclaw as ChatMessage | undefined
  )

  return (
    <MessagePrimitive.Root
      data-slot="aui_assistant-message-root"
      className="aui-assistant-message relative"
      data-role="assistant"
    >
      <div
        data-slot="aui_assistant-message-content"
        className="px-2 text-[14px] leading-7 text-foreground"
      >
        <MessagePrimitive.Unstable_PartsGrouped
          groupingFunction={(parts) =>
            parts.map((_, index) => ({ groupKey: undefined, indices: [index] }))
          }
          components={{
            Reasoning: ({ text }) => (
              <div className="mb-3 rounded-xl border border-border/30 bg-foreground/[0.025] px-3 py-2 text-xs text-muted-foreground">
                <p className="whitespace-pre-wrap">{text}</p>
              </div>
            ),
            Text: ({ text }) => (
              <MarkdownContent
                text={text}
                embeds={openclaw?.embeds}
                streaming={false}
                revealMode="immediate"
              />
            ),
            tools: { Override: () => null },
          }}
        />

        {openclaw?.toolCalls?.length ? (
          <ToolCallSteps
            tools={openclaw.toolCalls}
            defaultOpen={openclaw.toolCalls.length === 1}
            onSelectTool={onSelectTool}
            onResolveApproval={onResolveApproval}
          />
        ) : null}
      </div>
      <AssistantActionBar />
    </MessagePrimitive.Root>
  )
}

const UserMessage: FC = () => {
  const openclaw = useAuiState(
    (s) => s.message.metadata?.custom?.openclaw as ChatMessage | undefined
  )
  return (
    <MessagePrimitive.Root
      data-slot="aui_user-message-root"
      className="aui-user-message grid auto-rows-auto grid-cols-[minmax(72px,1fr)_auto] content-start gap-y-2 px-2"
      data-role="user"
    >
      <div className="col-start-2 max-w-[min(680px,85vw)] rounded-2xl bg-muted px-4 py-2.5 text-[14px] leading-6 text-foreground">
        <MessagePrimitive.Unstable_PartsGrouped
          groupingFunction={(parts) =>
            parts.map((_, index) => ({ groupKey: undefined, indices: [index] }))
          }
          components={{
            Text: ({ text }) => (
              <MarkdownContent text={text} embeds={openclaw?.embeds} />
            ),
            tools: { Override: () => null },
          }}
        />
      </div>
      <div className="col-start-2 mt-1 justify-self-end">
        <UserActionBar />
      </div>
    </MessagePrimitive.Root>
  )
}

const AssistantActionBar: FC = () => (
  <ActionBarPrimitive.Root
    hideWhenRunning
    autohide="not-last"
    className="ml-2 mt-1 flex gap-1 text-muted-foreground"
  >
    <ActionBarPrimitive.Copy asChild>
      <button type="button" className="rounded-md p-1.5 transition hover:bg-muted hover:text-foreground" aria-label="Copy message">
        <AuiIf condition={(s) => s.message.isCopied}>
          <LuCheck className="size-3.5" />
        </AuiIf>
        <AuiIf condition={(s) => !s.message.isCopied}>
          <LuCopy className="size-3.5" />
        </AuiIf>
      </button>
    </ActionBarPrimitive.Copy>
    <ActionBarPrimitive.Reload asChild>
      <button type="button" className="rounded-md p-1.5 transition hover:bg-muted hover:text-foreground" aria-label="Regenerate response">
        <LuRefreshCw className="size-3.5" />
      </button>
    </ActionBarPrimitive.Reload>
  </ActionBarPrimitive.Root>
)

const UserActionBar: FC = () => (
  <ActionBarPrimitive.Root hideWhenRunning autohide="not-last" className="flex gap-1 text-muted-foreground">
    <ActionBarPrimitive.Copy asChild>
      <button type="button" className="rounded-md p-1.5 transition hover:bg-muted hover:text-foreground" aria-label="Copy message">
        <AuiIf condition={(s) => s.message.isCopied}>
          <LuCheck className="size-3.5" />
        </AuiIf>
        <AuiIf condition={(s) => !s.message.isCopied}>
          <LuCopy className="size-3.5" />
        </AuiIf>
      </button>
    </ActionBarPrimitive.Copy>
  </ActionBarPrimitive.Root>
)

const Composer: FC = () => (
  <ComposerPrimitive.Root className="relative flex w-full flex-col">
    <div
      data-slot="aui_composer-shell"
      className="flex w-full flex-col gap-2 rounded-(--composer-radius) border border-border/50 bg-card p-(--composer-padding) shadow-sm transition focus-within:border-foreground/20 focus-within:ring-1 focus-within:ring-ring/10"
    >
      <ComposerPrimitive.Input
        placeholder="Message… (Shift+Enter for new line)"
        rows={1}
        autoFocus
        className="max-h-[200px] min-h-[24px] w-full resize-none bg-transparent text-[14px] leading-[22px] text-foreground outline-none placeholder:text-muted-foreground/40"
        aria-label="Message input"
      />
      <div className="flex items-center justify-end">
        <AuiIf condition={(s) => !s.thread.isRunning}>
          <ComposerPrimitive.Send asChild>
            <button type="button" className="flex size-8 items-center justify-center rounded-full bg-foreground text-background transition hover:bg-foreground/90" aria-label="Send message">
              <LuArrowUp className="size-4" />
            </button>
          </ComposerPrimitive.Send>
        </AuiIf>
        <AuiIf condition={(s) => s.thread.isRunning}>
          <ComposerPrimitive.Cancel asChild>
            <button type="button" className="flex size-8 items-center justify-center rounded-full bg-foreground text-background transition hover:bg-foreground/90" aria-label="Stop generating">
              <LuSquare className="size-3 fill-current" />
            </button>
          </ComposerPrimitive.Cancel>
        </AuiIf>
      </div>
    </div>
  </ComposerPrimitive.Root>
)
