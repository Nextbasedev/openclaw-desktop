"use client"

import * as React from "react"
import { motion, AnimatePresence } from "framer-motion"

import { cn } from "@/lib/utils"
import { ActionBar } from "./ActionBar"
import { AttachmentPreviewList } from "./AttachmentPreviewList"
import { SlashCommandMenu, getFilteredCommands } from "./SlashCommandMenu"
import { useSlashCommands } from "@/hooks/useSlashCommands"
import { useChatComposerAttachments } from "@/hooks/useChatComposerAttachments"
import { useModels } from "@/hooks/useModels"
import { useVoiceInput } from "@/hooks/useVoiceInput"
import {
  stripComposerAttachment,
  type ChatComposerSubmit,
} from "@/lib/chatAttachments"

type Props = {
  initialPrompt?: string
  onSend?: (payload: ChatComposerSubmit) => void | Promise<void>
  disabled?: boolean
  isGenerating?: boolean
  onAbort?: () => void
}

export function ChatBox({ onSend, disabled, isGenerating, onAbort, initialPrompt }: Props) {
  const [input, setInput] = React.useState(initialPrompt ?? "")
  const [planEnabled, setPlanEnabled] = React.useState(false)
  const [webSearchEnabled, setWebSearchEnabled] = React.useState(false)
  const [plusOpen, setPlusOpen] = React.useState(false)
  const [modelOpen, setModelOpen] = React.useState(false)
  const [isFocused, setIsFocused] = React.useState(false)
  const [slashMenuOpen, setSlashMenuOpen] = React.useState(false)
  const [slashFilter, setSlashFilter] = React.useState("")
  const [slashSelectedIndex, setSlashSelectedIndex] = React.useState(0)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  const { commands } = useSlashCommands()
  const { models, currentModel } = useModels()
  const autoResize = React.useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    const maxH = 8 * 24
    el.style.height = Math.max(56, Math.min(el.scrollHeight, maxH)) + "px"
  }, [])
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

  function updateSlashMenu(value: string) {
    const match = value.match(/^\/(\S*)$/)
    if (match) {
      setSlashMenuOpen(true)
      setSlashFilter(match[1])
      setSlashSelectedIndex(0)
    } else {
      setSlashMenuOpen(false)
    }
  }

  function handleSlashSelect(cmd: import("@/hooks/useSlashCommands").SlashCommand) {
    setInput(`/${cmd.name} `)
    setSlashMenuOpen(false)
    textareaRef.current?.focus()
  }

  async function handleSend() {
    const text = input.trim()
    if (!text || disabled || isPreparingAttachments) return
    try {
      await onSend?.({
        text,
        attachments: attachments.length > 0
          ? attachments.map(stripComposerAttachment)
          : undefined,
      })
      setInput("")
      clearAttachments()
      setAttachmentError(null)
      setSlashMenuOpen(false)
      if (textareaRef.current) textareaRef.current.style.height = "auto"
    } catch {
      setAttachmentError("Message failed to send. Try again.")
    }
  }

  function handleWebSearchToggle() {
    setWebSearchEnabled((prev) => !prev)
    setPlusOpen(false)
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
        className={cn(
          "relative flex flex-col rounded-2xl border bg-card transition-all",
          isFocused
            ? "border-foreground/25 shadow-[0_0_0_1px_hsl(var(--border))] ring-1 ring-ring/10"
            : "border-border/50"
        )}
      >
        <AttachmentPreviewList
          attachments={attachments}
          isPreparing={isPreparingAttachments}
          onRemove={removeAttachment}
        />
        {slashMenuOpen && commands.length > 0 && (
          <SlashCommandMenu
            commands={commands}
            filter={slashFilter}
            selectedIndex={slashSelectedIndex}
            onSelect={handleSlashSelect}
          />
        )}
        <div className="flex w-full flex-col pt-3">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              updateSlashMenu(e.target.value)
              autoResize()
            }}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            onKeyDown={(e) => {
              if (slashMenuOpen) {
                const filtered = getFilteredCommands(commands, slashFilter)
                if (e.key === "ArrowDown") {
                  e.preventDefault()
                  setSlashSelectedIndex((i) => Math.min(i + 1, filtered.length - 1))
                  return
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault()
                  setSlashSelectedIndex((i) => Math.max(i - 1, 0))
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
            plusOpen={plusOpen}
            onPlusOpenChange={setPlusOpen}
            modelOpen={modelOpen}
            onModelOpenChange={setModelOpen}
            models={models}
            currentModelId={currentModel}
            onModelSelect={(model) => {
              const modelId = `${model.provider}/${model.id}`
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
