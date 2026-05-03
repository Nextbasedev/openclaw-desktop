"use client"

import * as React from "react"
import { motion, AnimatePresence } from "framer-motion"

import { cn } from "@/lib/utils"
import { ActionBar } from "./ActionBar"
import { AttachmentPreviewList } from "./AttachmentPreviewList"
import { SlashCommandMenu, getFilteredCommands } from "./SlashCommandMenu"
import { useSlashCommands } from "@/hooks/useSlashCommands"
import { useChatComposerAttachments } from "@/hooks/useChatComposerAttachments"
import { isActiveModel, useModels } from "@/hooks/useModels"
import { useVoiceInput } from "@/hooks/useVoiceInput"
import { LuX } from "react-icons/lu"
import {
  stripComposerAttachment,
  type ChatComposerSubmit,
} from "@/lib/chatAttachments"
import type { ReplyTo } from "@/components/ChatView/types"
import {
  composeBatch,
  composerReducer,
  initialComposerState,
} from "@/lib/composerState"
import { clampCommandIndex } from "@/lib/slashCommandFilter"

const PLAN_SYSTEM_PROMPT = `You are a planning assistant. You help users create detailed plan.md documents.

If the user's request is clear enough, generate a detailed plan.md in Markdown.

The plan MUST include:
- Title (H1) and brief summary
- Overview with goals and scope
- Architecture / Approach
- Implementation Steps as a checklist with [P1]/[P2]/[P3] priority labels
- Timeline / Milestones
- Risks & Mitigations
- Open Questions

After generating the plan, stop. Output only the plan.md Markdown.`

type Props = {
  initialPrompt?: string
  errorMessage?: string | null
  onSend?: (payload: ChatComposerSubmit) => void | Promise<void>
  disabled?: boolean
  isGenerating?: boolean
  onAbort?: () => void
  replyTo?: ReplyTo | null
  onCancelReply?: () => void
}

export function ChatBox({
  onSend,
  disabled,
  isGenerating,
  onAbort,
  initialPrompt,
  errorMessage,
  replyTo,
  onCancelReply,
}: Props) {
  const [input, setInput] = React.useState(initialPrompt ?? "")
  const [planEnabled, setPlanEnabled] = React.useState(false)
  const [webSearchEnabled, setWebSearchEnabled] = React.useState(false)
  const [autonomyMode, setAutonomyMode] = React.useState<
    "full" | "supervised" | "manual"
  >("full")
  const [plusOpen, setPlusOpen] = React.useState(false)
  const [modelOpen, setModelOpen] = React.useState(false)
  const [sessionModelId, setSessionModelId] = React.useState<string | null>(null)
  const [modelNotice, setModelNotice] = React.useState<string | null>(null)
  const [isFocused, setIsFocused] = React.useState(false)
  const [slashMenuOpen, setSlashMenuOpen] = React.useState(false)
  const [slashFilter, setSlashFilter] = React.useState("")
  const [commandPrefix, setCommandPrefix] = React.useState<"/" | "@">("/")
  const [slashSelectedIndex, setSlashSelectedIndex] = React.useState(0)
  const [composerState, dispatchComposer] = React.useReducer(
    composerReducer,
    initialComposerState,
  )
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  const batchRef = React.useRef<ChatComposerSubmit[]>([])
  const batchTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const {
    commands,
    installedSkills,
    ensureLoaded: ensureSlashCommandsLoaded,
  } = useSlashCommands()
  const {
    models,
    currentModel,
    loading: modelsLoading,
    error: modelsError,
    reload: reloadModels,
  } = useModels()
  const autoResize = React.useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    const maxH = 8 * 24
    el.style.height = Math.max(56, Math.min(el.scrollHeight, maxH)) + "px"
  }, [])
  const [isDragOver, setIsDragOver] = React.useState(false)
  const dragCounterRef = React.useRef(0)
  const {
    attachments,
    attachmentError,
    isPreparingAttachments,
    fileInputRef,
    clearAttachments,
    removeAttachment,
    setAttachmentError,
    handleUploadClick,
    handleFileChange,
    processFiles,
  } = useChatComposerAttachments({
    disabled,
    onFilesProcessed: () => {
      setPlusOpen(false)
      textareaRef.current?.focus()
    },
  })
  const { state: voiceState, interimTranscript, isSupported: voiceSupported, toggle: toggleVoice } = useVoiceInput({
    onTranscript: (text) => {
      setInput((prev) => {
        const separator = prev.length > 0 && !prev.endsWith(" ") ? " " : ""
        return prev + separator + text
      })
      // Auto-resize textarea as text grows
      requestAnimationFrame(() => autoResize())
    },
  })

  React.useEffect(() => {
    if (initialPrompt != null) {
      setInput(initialPrompt)
    }
  }, [initialPrompt])

  React.useEffect(() => {
    if (errorMessage) {
      setAttachmentError(errorMessage)
    }
  }, [errorMessage, setAttachmentError])

  React.useEffect(() => {
    if (initialPrompt && textareaRef.current) {
      textareaRef.current.focus()
      textareaRef.current.setSelectionRange(initialPrompt.length, initialPrompt.length)
      autoResize()
    }
  }, [initialPrompt, autoResize])

  // Focus back to textarea after voice input stops
  React.useEffect(() => {
    if (voiceState === "idle") {
      textareaRef.current?.focus()
    }
  }, [voiceState])

  const hasInput = input.trim().length > 0
  const selectedModelRef = sessionModelId ?? currentModel
  const selectedModel = models.find((model) => isActiveModel(selectedModelRef, model))
  const fallbackModel = models.find((model) => model.health?.status !== "unavailable")
  const selectedModelUnavailable = selectedModel?.health?.status === "unavailable"

  async function sendWithHealthyModel(payload: ChatComposerSubmit) {
    if (selectedModelUnavailable && fallbackModel) {
      const fallbackRef = `${fallbackModel.provider}/${fallbackModel.id}`
      setSessionModelId(fallbackRef)
      setModelNotice(`${selectedModel.name} is unavailable, so this message is using ${fallbackModel.name}.`)
      await onSend?.({ text: `/model ${fallbackRef}` })
    } else {
      setModelNotice(null)
    }
    await onSend?.(payload)
  }

  function composedPlanText(promptText: string) {
    if (!planEnabled) return promptText
    return [
      "Planner system prompt:",
      PLAN_SYSTEM_PROMPT,
      "",
      "User request:",
      promptText,
    ].join("\n")
  }

  React.useEffect(() => {
    return () => {
      if (batchTimerRef.current) clearTimeout(batchTimerRef.current)
    }
  }, [])

  function updateSlashMenu(value: string) {
    const match = value.match(/^([/@])(\S*)$/)
    if (match) {
      ensureSlashCommandsLoaded()
      setSlashMenuOpen(true)
      setCommandPrefix(match[1] as "/" | "@")
      setSlashFilter(match[2])
      setSlashSelectedIndex(0)
    } else {
      setSlashMenuOpen(false)
    }
  }

  function handleSlashSelect(cmd: import("@/hooks/useSlashCommands").SlashCommand) {
    setInput(`${commandPrefix}${cmd.name} `)
    setSlashMenuOpen(false)
    textareaRef.current?.focus()
  }

  async function flushBatch() {
    const payload = composeBatch(batchRef.current)
    if (!payload.text.trim()) return
    batchRef.current = []
    dispatchComposer({ type: "batch_flush" })
    try {
      await sendWithHealthyModel(payload)
      dispatchComposer({ type: "send_success" })
      clearAttachments()
      setAttachmentError(null)
      setSlashMenuOpen(false)
      if (textareaRef.current) textareaRef.current.style.height = "auto"
    } catch {
      setInput(payload.text)
      dispatchComposer({
        type: "send_failed",
        error: "Message failed to send. Try again.",
      })
      setAttachmentError("Message failed to send. Try again.")
      requestAnimationFrame(() => {
        textareaRef.current?.focus()
        autoResize()
      })
    }
  }

  function queueSend(payload: ChatComposerSubmit) {
    batchRef.current = [...batchRef.current, payload]
    dispatchComposer({ type: "batch_add", payload })
    if (batchTimerRef.current) clearTimeout(batchTimerRef.current)
    batchTimerRef.current = setTimeout(() => {
      batchTimerRef.current = null
      void flushBatch()
    }, 500)
  }

  async function handleSend() {
    const text = composedPlanText(input.trim()).trim()
    if (!text || disabled || isPreparingAttachments) return
    const payload: ChatComposerSubmit = {
      text,
      attachments: attachments.length > 0
        ? attachments.map(stripComposerAttachment)
        : undefined,
      replyTo: replyTo ?? undefined,
    }
    setInput("")
    if (textareaRef.current) textareaRef.current.style.height = "auto"
    if (isGenerating) {
      dispatchComposer({ type: "restart_start", payload })
      try {
        await sendWithHealthyModel(payload)
        dispatchComposer({ type: "send_success" })
        clearAttachments()
        setAttachmentError(null)
        setSlashMenuOpen(false)
      } catch {
        setInput(payload.text)
        dispatchComposer({
          type: "send_failed",
          error: "Message failed to send. Try again.",
        })
        setAttachmentError("Message failed to send. Try again.")
        requestAnimationFrame(() => {
          textareaRef.current?.focus()
          autoResize()
        })
      }
      return
    }
    queueSend(payload)
  }

  function handleWebSearchToggle() {
    setWebSearchEnabled((prev) => !prev)
    setPlusOpen(false)
  }

  function handleDragEnter(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current += 1
    if (e.dataTransfer.types.includes("Files")) {
      setIsDragOver(true)
    }
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current -= 1
    if (dragCounterRef.current === 0) {
      setIsDragOver(false)
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current = 0
    setIsDragOver(false)
    if (disabled || isPreparingAttachments) return
    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0) {
      void processFiles(files)
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    const items = Array.from(e.clipboardData.items)
    const files: File[] = []
    for (const item of items) {
      if (item.kind === "file") {
        const file = item.getAsFile()
        if (file) files.push(file)
      }
    }
    if (files.length > 0) {
      e.preventDefault()
      if (disabled || isPreparingAttachments) return
      void processFiles(files)
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-2 sm:px-4">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileChange}
      />
      <div
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className={cn(
          "relative flex flex-col rounded-2xl border bg-card transition-all",
          isFocused
            ? "border-foreground/25 shadow-[0_0_0_1px_hsl(var(--border))] ring-1 ring-ring/10"
            : "border-border/50",
          isDragOver && "border-primary/50 ring-2 ring-primary/20",
        )}
      >
        {isDragOver && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-primary/5">
            <p className="text-sm font-medium text-primary/70">
              Drop files to attach
            </p>
          </div>
        )}
        <AnimatePresence initial={false}>
          {replyTo && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
              className="overflow-hidden"
            >
              <div className="flex items-start gap-2 border-b border-border/30 px-3 pb-2 pt-2.5 bg-[#252529] rounded-t-xl">
                <div className="min-w-0 flex-1">
                  <span className="text-[11px] font-medium text-muted-foreground/70">
                    {replyTo.role === "user" ? "You" : "Assistant"}
                  </span>
                  <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-foreground/60">
                    {replyTo.text}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onCancelReply}
                  className="mt-0.5 flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-foreground/30 transition-colors hover:text-foreground/60"
                  aria-label="Cancel reply"
                >
                  <LuX className="size-3.5" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <AttachmentPreviewList
          attachments={attachments}
          isPreparing={isPreparingAttachments}
          onRemove={removeAttachment}
        />
        <AnimatePresence initial={false}>
          {slashMenuOpen && (commandPrefix === "@"
            ? installedSkills.length > 0
            : commands.length > 0) && (
            <SlashCommandMenu
              commands={
                commandPrefix === "@"
                  ? installedSkills
                  : commands
              }
              filter={slashFilter}
              selectedIndex={slashSelectedIndex}
              onSelect={handleSlashSelect}
              prefix={commandPrefix}
              groupLabel={
                commandPrefix === "@"
                  ? "Installed Skills"
                  : undefined
              }
            />
          )}
        </AnimatePresence>
        <div className="flex w-full flex-col pt-3">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              if (attachmentError) setAttachmentError(null)
              updateSlashMenu(e.target.value)
              autoResize()
            }}
            onPaste={handlePaste}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            onKeyDown={(e) => {
              if (slashMenuOpen) {
                const activeCommands = commandPrefix === "@"
                  ? installedSkills
                  : commands
                const filtered = getFilteredCommands(activeCommands, slashFilter)
                if (e.key === "ArrowDown") {
                  e.preventDefault()
                  setSlashSelectedIndex((i) =>
                    clampCommandIndex(i + 1, filtered),
                  )
                  return
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault()
                  setSlashSelectedIndex((i) =>
                    clampCommandIndex(i - 1, filtered),
                  )
                  return
                }
                if (e.key === "Enter" || e.key === "Tab") {
                  if (filtered[slashSelectedIndex]) {
                    e.preventDefault()
                    handleSlashSelect(filtered[slashSelectedIndex])
                    return
                  }
                }
                if (e.key === "Escape") {
                  e.preventDefault()
                  setSlashMenuOpen(false)
                  return
                }
              }
              if (e.key === "Escape" && replyTo && onCancelReply) {
                e.preventDefault()
                onCancelReply()
                return
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                void handleSend()
              }
            }}
            placeholder="Message... (type / for commands)"
            rows={1}
            disabled={disabled}
            className="w-full resize-none bg-transparent px-3 py-1 text-[15.5px] leading-[26px] text-foreground outline-none placeholder:text-muted-foreground/60 disabled:opacity-50"
            style={{ minHeight: "68px", maxHeight: "250px" }}
            autoFocus
          />

          {attachmentError && (
            <div className="px-3 pb-1">
              <p className="text-[12px] text-red-400/80">
                {attachmentError}
              </p>
            </div>
          )}

          {composerState.interrupted && (
            <div className="px-3 pb-1">
              <p className="text-[12px] text-blue-300/80">
                Interrupted — regenerating with your update...
              </p>
            </div>
          )}

          {modelNotice && (
            <div className="px-3 pb-1">
              <p className="text-[12px] text-amber-300/85">
                {modelNotice}
              </p>
            </div>
          )}

          <AnimatePresence initial={false}>
            {voiceState === "listening" && (
              <motion.div
                initial={{ maxHeight: 0, opacity: 0 }}
                animate={{ maxHeight: 40, opacity: 1 }}
                exit={{ maxHeight: 0, opacity: 0 }}
                transition={{ duration: 0.25, ease: "easeInOut" }}
                className="overflow-hidden"
              >
                <div className="px-3 pb-1 text-[13px] text-muted-foreground/60 italic">
                  {interimTranscript || "Listening…"}
                  <span className="ml-1 inline-block h-4 w-0.5 animate-pulse bg-muted-foreground/40 align-middle" />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <ActionBar
            hasInput={hasInput}
            onSend={() => {
              void handleSend()
            }}
            onUploadClick={() => {
              setPlusOpen(false)
              handleUploadClick()
            }}
            isGenerating={isGenerating}
            onAbort={onAbort}
            planEnabled={planEnabled}
            onPlanToggle={() => setPlanEnabled((prev) => !prev)}
            webSearchEnabled={webSearchEnabled}
            onWebSearchToggle={handleWebSearchToggle}
            onWebSearchDisable={() => setWebSearchEnabled(false)}
            autonomyMode={autonomyMode}
            onAutonomyModeChange={setAutonomyMode}
            onPauseResume={() => {
              void onSend?.({ text: isGenerating ? "/pause" : "/resume" })
              setPlusOpen(false)
            }}
            plusOpen={plusOpen}
            onPlusOpenChange={setPlusOpen}
            modelOpen={modelOpen}
            onModelOpenChange={setModelOpen}
            models={models}
            currentModelId={selectedModelRef}
            modelLoading={modelsLoading}
            modelError={modelsError}
            onModelRefresh={() => {
              void reloadModels()
            }}
            onModelSelect={(model) => {
              const modelId = `${model.provider}/${model.id}`
              setSessionModelId(modelId)
              void onSend?.({ text: `/model ${modelId}` })
              setModelOpen(false)
            }}
            isRecording={voiceState === "listening"}
            onVoiceToggle={toggleVoice}
            voiceSupported={voiceSupported}
            attachmentCount={attachments.length}
            disableUpload={disabled || isPreparingAttachments}
          />
        </div>
      </div>
    </div>
  )
}
