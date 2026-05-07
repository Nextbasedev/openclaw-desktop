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
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder"
import { invoke } from "@/lib/ipc"
import { GlassDialog } from "@/components/ui/GlassDialog"
import { LuX } from "react-icons/lu"
import {
  execPolicyForAutonomyMode,
  stripComposerAttachment,
  toChatComposerAttachment,
  type ChatComposerSubmit,
} from "@/lib/chatAttachments"
import type { ReplyTo } from "@/components/ChatView/types"
import { composerReducer, initialComposerState } from "@/lib/composerState"
import { clampCommandIndex } from "@/lib/slashCommandFilter"
import {
  canRunSlashCommandWhileGenerating,
  isStopSlashCommand,
} from "@/lib/controlSlashCommands"

type VoiceSettingsPayload = {
  settings?: {
    enabled?: boolean
    provider?: string
    model?: string
  }
  status?: {
    apiKeyConfigured?: boolean
  }
}

type VoiceTranscribePayload = {
  transcript?: string
}

function isVoiceConfigurationError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "")
  return /not configured|configure voice|add a voice provider|no api key|api key found/i.test(
    message
  )
}

type Props = {
  initialPrompt?: string
  errorMessage?: string | null
  historyMessages?: string[]
  onSend?: (payload: ChatComposerSubmit) => void | Promise<void>
  disabled?: boolean
  isGenerating?: boolean
  onAbort?: () => void
  replyTo?: ReplyTo | null
  onCancelReply?: () => void
  onModelSelect?: (modelId: string) => void | Promise<void>
  modelSwitching?: boolean
  glowOnMount?: boolean
}

export function ChatBox({
  onSend,
  disabled,
  isGenerating,
  onAbort,
  initialPrompt,
  errorMessage,
  historyMessages = [],
  replyTo,
  onCancelReply,
  onModelSelect,
  modelSwitching = false,
  glowOnMount = false,
}: Props) {
  const [input, setInput] = React.useState(initialPrompt ?? "")
  const [webSearchEnabled, setWebSearchEnabled] = React.useState(false)
  const [plusOpen, setPlusOpen] = React.useState(false)
  const [modelOpen, setModelOpen] = React.useState(false)
  const [sessionModelId, setSessionModelId] = React.useState<string | null>(
    null
  )
  const [isFocused, setIsFocused] = React.useState(false)
  const [slashMenuOpen, setSlashMenuOpen] = React.useState(false)
  const [voiceSetupOpen, setVoiceSetupOpen] = React.useState(false)
  const [slashFilter, setSlashFilter] = React.useState("")
  const [commandPrefix, setCommandPrefix] = React.useState<"/" | "@">("/")
  const [slashSelectedIndex, setSlashSelectedIndex] = React.useState(0)
  const [historyIndex, setHistoryIndex] = React.useState<number | null>(null)
  const draftBeforeHistoryRef = React.useRef("")
  const [composerState, dispatchComposer] = React.useReducer(
    composerReducer,
    initialComposerState
  )
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
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
  const isComposerDisabled = Boolean(disabled || modelSwitching)
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
    disabled: isComposerDisabled,
    onFilesProcessed: () => {
      setPlusOpen(false)
      textareaRef.current?.focus()
    },
  })
  const canSendWhileGenerating = Boolean(
    isGenerating &&
    input.trim().startsWith("/") &&
    attachments.length === 0 &&
    !replyTo &&
    canRunSlashCommandWhileGenerating(input, commands)
  )
  const {
    state: voiceState,
    isSupported: recorderSupported,
    start: startVoice,
    stop: stopVoice,
    toggle: toggleVoice,
  } = useVoiceRecorder({
    onAudioFile: async (file) => {
      const attachment = await toChatComposerAttachment(file)
      try {
        const payload = await invoke<VoiceTranscribePayload>(
          "middleware_voice_transcribe",
          {
            input: { attachment: stripComposerAttachment(attachment) },
          }
        )
        const transcript = payload.transcript?.trim()
        if (!transcript) throw new Error("Voice transcription returned no text")
        setInput((prev) => {
          const prefix = prev.trim().length > 0 ? `${prev.trimEnd()} ` : ""
          return `${prefix}${transcript}`
        })
        requestAnimationFrame(() => {
          autoResize()
          textareaRef.current?.focus()
        })
      } catch (error) {
        if (isVoiceConfigurationError(error)) {
          setVoiceSetupOpen(true)
        }
        setAttachmentError(
          error instanceof Error
            ? error.message
            : "Voice transcription is not configured"
        )
      }
    },
    onError: (message) => {
      setAttachmentError(message)
    },
  })
  const [voiceModelActive, setVoiceModelActive] = React.useState(false)
  const [voiceStatusLoading, setVoiceStatusLoading] = React.useState(true)

  React.useEffect(() => {
    let cancelled = false
    async function loadVoiceStatus() {
      setVoiceStatusLoading(true)
      try {
        const payload = await invoke<VoiceSettingsPayload>(
          "middleware_voice_settings_get"
        )
        if (cancelled) return
        const settings = payload.settings
        setVoiceModelActive(
          Boolean(
            settings?.enabled !== false &&
            settings?.provider &&
            settings.provider !== "auto" &&
            settings.model &&
            payload.status?.apiKeyConfigured
          )
        )
      } catch {
        if (!cancelled) {
          setVoiceModelActive(false)
        }
      } finally {
        if (!cancelled) setVoiceStatusLoading(false)
      }
    }
    void loadVoiceStatus()
    window.addEventListener("openclaw:voice-settings-changed", loadVoiceStatus)
    return () => {
      cancelled = true
      window.removeEventListener(
        "openclaw:voice-settings-changed",
        loadVoiceStatus
      )
    }
  }, [])

  const voiceConfigured = !voiceStatusLoading && voiceModelActive
  const voiceSupported = recorderSupported && voiceConfigured
  const voiceDisabledReason = !recorderSupported
    ? "Voice recording is not supported in this app window"
    : voiceStatusLoading
      ? "Checking voice model setup…"
      : "Set an active voice provider and audio model in Settings → Voice"

  function openVoiceSettings() {
    setVoiceSetupOpen(false)
    window.dispatchEvent(
      new CustomEvent("openclaw:open-settings", {
        detail: { section: "voice" },
      })
    )
  }

  function handleVoiceToggle() {
    if (!recorderSupported) {
      setAttachmentError("Voice recording is not supported in this app window")
      return
    }
    if (!voiceConfigured) {
      setVoiceSetupOpen(true)
      return
    }
    toggleVoice()
  }

  function handleVoiceStart() {
    if (!recorderSupported) {
      setAttachmentError("Voice recording is not supported in this app window")
      return
    }
    if (!voiceConfigured) {
      setVoiceSetupOpen(true)
      return
    }
    if (voiceState === "idle" || voiceState === "error") {
      void startVoice()
    }
  }

  function handleVoiceStop() {
    if (voiceState === "recording") {
      stopVoice()
    }
  }

  const voiceShortcutRef = React.useRef({
    pushToTalkActive: false,
    ctrlTapCandidate: false,
  })

  React.useEffect(() => {
    function isPushToTalkEvent(event: KeyboardEvent) {
      return (
        event.code === "Space" &&
        (event.metaKey || event.getModifierState("Meta"))
      )
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.repeat) return
      const shortcut = voiceShortcutRef.current

      if (
        event.key === "Control" &&
        !event.metaKey &&
        !event.altKey &&
        !event.shiftKey
      ) {
        shortcut.ctrlTapCandidate = true
        return
      }
      if (shortcut.ctrlTapCandidate && event.key !== "Control") {
        shortcut.ctrlTapCandidate = false
      }

      if (isPushToTalkEvent(event)) {
        event.preventDefault()
        shortcut.pushToTalkActive = true
        handleVoiceStart()
      }
    }

    function onKeyUp(event: KeyboardEvent) {
      const shortcut = voiceShortcutRef.current

      if (
        (event.code === "Space" || event.key === "Meta") &&
        shortcut.pushToTalkActive
      ) {
        event.preventDefault()
        shortcut.pushToTalkActive = false
        handleVoiceStop()
        return
      }

      if (event.key === "Control" && shortcut.ctrlTapCandidate) {
        shortcut.ctrlTapCandidate = false
        handleVoiceToggle()
      }
    }

    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("keyup", onKeyUp)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("keyup", onKeyUp)
    }
  }, [handleVoiceStart, handleVoiceStop, handleVoiceToggle])

  React.useEffect(() => {
    if (initialPrompt != null) {
      setInput(initialPrompt)
      setHistoryIndex(null)
      draftBeforeHistoryRef.current = ""
    }
  }, [initialPrompt])

  React.useEffect(() => {
    setHistoryIndex(null)
    draftBeforeHistoryRef.current = ""
  }, [historyMessages])

  React.useEffect(() => {
    if (errorMessage) {
      setAttachmentError(errorMessage)
    }
  }, [errorMessage, setAttachmentError])

  React.useEffect(() => {
    if (initialPrompt && textareaRef.current) {
      textareaRef.current.focus()
      textareaRef.current.setSelectionRange(
        initialPrompt.length,
        initialPrompt.length
      )
      autoResize()
    }
  }, [initialPrompt, autoResize])

  // Focus back to textarea after voice recording stops
  React.useEffect(() => {
    if (voiceState === "idle") {
      textareaRef.current?.focus()
    }
  }, [voiceState])

  const hasInput = input.trim().length > 0 || attachments.length > 0
  const isSlashCommandInput = /^([/@])\S*/.test(input)
  const selectedModelRef = sessionModelId ?? currentModel
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

  function handleSlashSelect(
    cmd: import("@/hooks/useSlashCommands").SlashCommand
  ) {
    setInput(`${commandPrefix}${cmd.name} `)
    setHistoryIndex(null)
    draftBeforeHistoryRef.current = ""
    setSlashMenuOpen(false)
    textareaRef.current?.focus()
  }

  function isCaretOnFirstLine(target: HTMLTextAreaElement) {
    const start = target.selectionStart
    const end = target.selectionEnd
    return start === end && !target.value.slice(0, start).includes("\n")
  }

  function isCaretOnLastLine(target: HTMLTextAreaElement) {
    const start = target.selectionStart
    const end = target.selectionEnd
    return start === end && !target.value.slice(end).includes("\n")
  }

  function isSingleLineInput(target: HTMLTextAreaElement) {
    return !target.value.includes("\n")
  }

  function canNavigateHistoryUp(target: HTMLTextAreaElement) {
    return isSingleLineInput(target) || isCaretOnFirstLine(target)
  }

  function canNavigateHistoryDown(target: HTMLTextAreaElement) {
    return isSingleLineInput(target) || isCaretOnLastLine(target)
  }

  function applyHistoryInput(value: string) {
    setInput(value)
    setSlashMenuOpen(false)
    requestAnimationFrame(() => {
      autoResize()
      const textarea = textareaRef.current
      if (!textarea) return
      const pos = value.length
      textarea.focus()
      textarea.setSelectionRange(pos, pos)
    })
  }

  async function handleSend() {
    const text = input.trim()
    if (modelSwitching) {
      setAttachmentError("Switching model… please wait")
      return
    }
    if (
      (!text && attachments.length === 0) ||
      isComposerDisabled ||
      isPreparingAttachments
    )
      return
    if (
      isGenerating &&
      attachments.length === 0 &&
      !replyTo &&
      isStopSlashCommand(text)
    ) {
      setInput("")
      setHistoryIndex(null)
      draftBeforeHistoryRef.current = ""
      if (textareaRef.current) textareaRef.current.style.height = "auto"
      setSlashMenuOpen(false)
      dispatchComposer({ type: "stop_start" })
      try {
        await onAbort?.()
        dispatchComposer({ type: "stop_done" })
      } catch {
        dispatchComposer({
          type: "send_failed",
          error: "Could not stop generation. Try again.",
        })
        setAttachmentError("Could not stop generation. Try again.")
      }
      return
    }
    const payload: ChatComposerSubmit = {
      text: text || "Please transcribe and respond to the attached audio.",
      attachments:
        attachments.length > 0
          ? attachments.map(stripComposerAttachment)
          : undefined,
      runWhileGenerating: canSendWhileGenerating,
      replyTo: replyTo ?? undefined,
      autonomyMode: "manual",
      execPolicy: execPolicyForAutonomyMode("manual"),
    }
    setInput("")
    setHistoryIndex(null)
    draftBeforeHistoryRef.current = ""
    if (textareaRef.current) textareaRef.current.style.height = "auto"
    if (isGenerating) {
      dispatchComposer({ type: "restart_start", payload })
      try {
        await onSend?.(payload)
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
    dispatchComposer({ type: "send_start", payload, generating: false })
    try {
      await onSend?.(payload)
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
    if (isComposerDisabled || isPreparingAttachments) return
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
      if (isComposerDisabled || isPreparingAttachments) return
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
          "relative flex flex-col rounded-[24px] border bg-white/[0.04] shadow-[0_24px_64px_-36px_rgba(0,0,0,0.9),inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-2xl transition-all",
          glowOnMount && "chatbox-glow",
          isFocused
            ? "border-white/18 ring-1 ring-white/10"
            : "border-white/10",
          isDragOver && "border-primary/50 ring-2 ring-primary/20"
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
              <div className="flex items-start gap-2 rounded-t-[22px] border-b border-white/8 bg-white/[0.03] px-3 pt-2.5 pb-2">
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
          {slashMenuOpen &&
            (commandPrefix === "@"
              ? installedSkills.length > 0
              : commands.length > 0) && (
              <SlashCommandMenu
                commands={commandPrefix === "@" ? installedSkills : commands}
                filter={slashFilter}
                selectedIndex={slashSelectedIndex}
                onSelect={handleSlashSelect}
                prefix={commandPrefix}
                groupLabel={
                  commandPrefix === "@" ? "Installed Skills" : undefined
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
              if (historyIndex !== null) setHistoryIndex(null)
              draftBeforeHistoryRef.current = ""
              if (attachmentError) setAttachmentError(null)
              updateSlashMenu(e.target.value)
              autoResize()
            }}
            onPaste={handlePaste}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            onKeyDown={(e) => {
              if (slashMenuOpen) {
                const activeCommands =
                  commandPrefix === "@" ? installedSkills : commands
                const filtered = getFilteredCommands(
                  activeCommands,
                  slashFilter
                )
                if (e.key === "ArrowDown") {
                  e.preventDefault()
                  setSlashSelectedIndex((i) =>
                    clampCommandIndex(i + 1, filtered)
                  )
                  return
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault()
                  setSlashSelectedIndex((i) =>
                    clampCommandIndex(i - 1, filtered)
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
              if (
                e.key === "ArrowUp" &&
                !e.shiftKey &&
                !e.altKey &&
                !e.ctrlKey &&
                !e.metaKey &&
                !slashMenuOpen &&
                historyMessages.length > 0 &&
                canNavigateHistoryUp(e.currentTarget)
              ) {
                if (historyIndex === 0) return
                e.preventDefault()
                const nextIndex =
                  historyIndex === null
                    ? historyMessages.length - 1
                    : historyIndex - 1
                if (historyIndex === null) {
                  draftBeforeHistoryRef.current = input
                }
                setHistoryIndex(nextIndex)
                applyHistoryInput(historyMessages[nextIndex] ?? "")
                return
              }
              if (
                e.key === "ArrowDown" &&
                !e.shiftKey &&
                !e.altKey &&
                !e.ctrlKey &&
                !e.metaKey &&
                !slashMenuOpen &&
                historyIndex !== null &&
                canNavigateHistoryDown(e.currentTarget)
              ) {
                e.preventDefault()
                if (historyIndex >= historyMessages.length - 1) {
                  setHistoryIndex(null)
                  applyHistoryInput(draftBeforeHistoryRef.current)
                  draftBeforeHistoryRef.current = ""
                } else {
                  const nextIndex = historyIndex + 1
                  setHistoryIndex(nextIndex)
                  applyHistoryInput(historyMessages[nextIndex] ?? "")
                }
                return
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                void handleSend()
              }
            }}
            placeholder="Message... (type / for commands and @ for skills)"
            rows={1}
            disabled={isComposerDisabled}
            className={cn(
              "w-full resize-none bg-transparent px-3 py-1 text-[15.5px] leading-[26px] text-foreground outline-none placeholder:text-muted-foreground/60 disabled:opacity-50",
              isSlashCommandInput &&
                "text-[15px] font-[family:var(--font-jetbrains-mono)]"
            )}
            style={{ minHeight: "68px", maxHeight: "250px" }}
            autoFocus
          />

          {attachmentError && (
            <div className="px-3 pb-1">
              <p className="text-[12px] text-red-400/80">{attachmentError}</p>
            </div>
          )}

          {composerState.interrupted && (
            <div className="px-3 pb-1">
              <p className="text-[12px] text-blue-300/80">
                Interrupted — regenerating with your update...
              </p>
            </div>
          )}

          <AnimatePresence initial={false}>
            {(voiceState === "recording" || voiceState === "processing") && (
              <motion.div
                initial={{ maxHeight: 0, opacity: 0 }}
                animate={{ maxHeight: 40, opacity: 1 }}
                exit={{ maxHeight: 0, opacity: 0 }}
                transition={{ duration: 0.25, ease: "easeInOut" }}
                className="overflow-hidden"
              >
                <div className="px-3 pb-1 text-[13px] text-muted-foreground/60 italic">
                  {voiceState === "processing"
                    ? "Transcribing voice…"
                    : "Recording voice…"}
                  <span className="ml-1 inline-block h-4 w-0.5 animate-pulse bg-muted-foreground/40 align-middle" />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <ActionBar
            hasInput={hasInput}
            onSend={() => {
              if (modelSwitching) {
                setAttachmentError("Switching model… please wait")
                return
              }
              void handleSend()
            }}
            onUploadClick={() => {
              setPlusOpen(false)
              handleUploadClick()
            }}
            isGenerating={isGenerating}
            canSendWhileGenerating={canSendWhileGenerating}
            onAbort={onAbort}
            webSearchEnabled={webSearchEnabled}
            onWebSearchDisable={() => setWebSearchEnabled(false)}
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
              setModelOpen(false)
              const applyModel = onModelSelect
                ? onModelSelect(modelId)
                : invoke("middleware_models_set_default", {
                    input: { modelId },
                  }).then(() => reloadModels())
              Promise.resolve(applyModel).catch((error) => {
                setAttachmentError(
                  error instanceof Error
                    ? error.message
                    : "Failed to switch model"
                )
                setSessionModelId(null)
              })
            }}
            isRecording={voiceState === "recording"}
            onVoiceToggle={handleVoiceToggle}
            voiceSupported={recorderSupported}
            voiceReady={voiceSupported}
            voiceDisabledReason={voiceDisabledReason}
            attachmentCount={attachments.length}
            disableUpload={isComposerDisabled || isPreparingAttachments}
          />
        </div>

        <GlassDialog
          open={voiceSetupOpen}
          onClose={() => setVoiceSetupOpen(false)}
          title="Set up voice input"
          description="Add a Voice provider/API key and choose a transcription model. After that, the mic will transcribe your speech into this text box so you can edit before sending."
          className="w-[min(440px,calc(100vw-24px))]"
        >
          <div className="space-y-4">
            <div className="rounded-xl bg-[var(--glass-input-bg)] px-3 py-2.5 text-[12px] leading-relaxed text-muted-foreground">
              Current status: {voiceDisabledReason}
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setVoiceSetupOpen(false)}
                className="glass-btn-secondary"
              >
                Not now
              </button>
              <button
                type="button"
                onClick={openVoiceSettings}
                className="glass-btn-primary"
              >
                Open Voice settings
              </button>
            </div>
          </div>
        </GlassDialog>
      </div>
    </div>
  )
}
