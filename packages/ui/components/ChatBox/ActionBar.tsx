"use client"

import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  PlusSignIcon,
  ArrowDown01Icon,
  AttachmentIcon,
  Cancel01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons"

import { cn } from "@/lib/utils"
import { GLASS_POPOVER } from "@/constants/glassPopover"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { WebSearchIcon, VoiceIcon, SendArrowIcon, StopSquareIcon } from "./Icons"
import { VoiceWaveIcon } from "./VoiceWaveIcon"
import type { ModelEntry } from "@/hooks/useModels"

type ActionBarProps = {
  hasInput: boolean
  onSend?: () => void
  onUploadClick?: () => void
  isGenerating?: boolean
  canSendWhileGenerating?: boolean
  onAbort?: () => void
  webSearchEnabled: boolean
  onWebSearchDisable: () => void
  plusOpen: boolean
  onPlusOpenChange: (open: boolean) => void
  modelOpen: boolean
  onModelOpenChange: (open: boolean) => void
  models: ModelEntry[]
  currentModelId: string | null
  modelLoading?: boolean
  modelError?: string | null
  onModelRefresh?: () => void
  onModelSelect: (model: ModelEntry) => void
  isRecording?: boolean
  onVoiceToggle?: () => void
  voiceSupported?: boolean
  voiceReady?: boolean
  voiceDisabledReason?: string
  attachmentCount?: number
  disableUpload?: boolean
}

export function ActionBar({
  hasInput,
  onSend,
  onUploadClick,
  isGenerating,
  canSendWhileGenerating = false,
  onAbort,
  webSearchEnabled,
  onWebSearchDisable,
  plusOpen,
  onPlusOpenChange,
  modelOpen,
  onModelOpenChange,
  models,
  currentModelId,
  modelLoading,
  modelError,
  onModelRefresh,
  onModelSelect,
  isRecording,
  onVoiceToggle,
  voiceSupported = true,
  voiceReady = voiceSupported,
  voiceDisabledReason,
  attachmentCount = 0,
  disableUpload = false,
}: ActionBarProps) {
  const activeModel = models.find((m) => {
    if (!currentModelId) return false
    const bare = currentModelId.includes("/")
      ? currentModelId.split(/\/(.+)/)[1]
      : currentModelId
    return m.id === currentModelId || `${m.provider}/${m.id}` === currentModelId || m.id === bare
  })
  const modelLabel = activeModel?.name ?? currentModelId ?? "Select model"
  const uniqueModels = models.filter(
    (m, i, arr) =>
      arr.findIndex(
        (x) => x.name.toLowerCase() === m.name.toLowerCase(),
      ) === i,
  )
  return (
    <div className="flex items-center justify-between px-3 pb-3 pt-2">
      {/* Left controls */}
      <div className="flex items-center gap-1.5">
        {/* + menu */}
        <Popover open={plusOpen} onOpenChange={onPlusOpenChange}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full border border-white/12 bg-white/[0.06] text-foreground/88 shadow-[0_10px_30px_-18px_rgba(0,0,0,0.85),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-xl transition-all hover:border-white/18 hover:bg-white/[0.1] hover:text-foreground"
              aria-label="Add"
            >
              <HugeiconsIcon icon={PlusSignIcon} size={19} />
            </button>
          </PopoverTrigger>
          <PopoverContent
            side="top"
            align="start"
            sideOffset={10}
            className={cn(
              "w-[190px] gap-0 py-2 px-2 shadow-2xl shadow-black/40 ring-1 ring-white/6",
              GLASS_POPOVER,
            )}
          >
            <button
              type="button"
              onClick={onUploadClick}
              disabled={disableUpload}
              className="flex w-full cursor-pointer items-center gap-1 text-sm font-medium text-popover-foreground transition-all disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-white/[0.08] bg-black/10 text-foreground/75">
                <HugeiconsIcon icon={AttachmentIcon} size={16} />
              </span>
              <span className="min-w-0 flex flex-1 flex-col">
                <span className="truncate">
                  {attachmentCount > 0 ? `Upload (${attachmentCount})` : "Add photos & files"}
                </span>
                
              </span>
            </button>
          </PopoverContent>
        </Popover>

        {/* Web search pill — desktop only */}
        {webSearchEnabled && (
          <button
            type="button"
            onClick={onWebSearchDisable}
            className="group hidden cursor-pointer items-center gap-2 rounded-full border border-foreground/60 bg-secondary px-3 py-1.5 text-xs font-medium text-foreground transition-all hover:bg-secondary/80 sm:flex"
          >
            <span className="relative size-4">
              <WebSearchIcon className="absolute inset-0 size-4 opacity-100 transition-opacity group-hover:opacity-0" />
              <HugeiconsIcon icon={Cancel01Icon} size={16} className="absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100" />
            </span>
            Web
          </button>
        )}
      </div>

      {/* Right controls */}
      <div className="flex items-center gap-0.5 sm:gap-1">
        {/* Model selector */}
        <Popover open={modelOpen} onOpenChange={onModelOpenChange}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex h-8 cursor-pointer items-center gap-1 rounded-full px-2 text-xs text-muted-foreground transition-all hover:text-foreground"
            >
              {modelLabel}
              <HugeiconsIcon icon={ArrowDown01Icon} size={12} />
            </button>
          </PopoverTrigger>
          <PopoverContent side="top" align="end" sideOffset={8} className="w-56 gap-0 p-1.5">
            <div className="max-h-60 overflow-y-auto">
              {modelLoading && (
                <p className="px-3 py-2 text-xs text-muted-foreground">
                  Loading models...
                </p>
              )}
              {modelError && (
                <div className="px-3 py-2">
                  <p className="text-xs text-rose-400">Models unavailable</p>
                  <button
                    type="button"
                    onClick={onModelRefresh}
                    className="mt-1 cursor-pointer text-xs text-foreground/70 hover:text-foreground"
                  >
                    Refresh
                  </button>
                </div>
              )}
              {uniqueModels.map((model) => {
                const isActive = activeModel?.id === model.id
                return (
                  <button
                    key={`${model.provider}/${model.id}`}
                    type="button"
                    className={cn(
                      "flex w-full cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-[13px] transition-colors hover:bg-muted",
                      isActive
                        ? "bg-foreground/10 font-medium text-foreground"
                        : "text-muted-foreground"
                    )}
                    onClick={() => onModelSelect(model)}
                  >
                    <span className="flex min-w-0 flex-col text-left">
                      <span className="truncate">{model.name}</span>
                    </span>
                    {isActive && (
                      <HugeiconsIcon icon={Tick02Icon} size={14} className="shrink-0 text-white" />
                    )}
                  </button>
                )
              })}
              {!modelLoading && !modelError && models.length === 0 && (
                <div className="px-3 py-2">
                  <p className="text-xs text-muted-foreground">
                    No models available
                  </p>
                  <button
                    type="button"
                    onClick={onModelRefresh}
                    className="mt-1 cursor-pointer text-xs text-foreground/70 hover:text-foreground"
                  >
                    Connect or refresh
                  </button>
                </div>
              )}
            </div>
          </PopoverContent>
        </Popover>

        {/* Voice button */}
        <button
          type="button"
          onClick={onVoiceToggle}
          disabled={!voiceSupported}
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-full transition-all",
            isRecording
              ? "cursor-pointer border border-foreground/60 bg-secondary text-foreground"
              : voiceSupported
                ? voiceReady
                  ? "cursor-pointer text-muted-foreground hover:text-foreground"
                  : "cursor-pointer text-muted-foreground/45 hover:text-foreground"
                : "cursor-not-allowed text-muted-foreground/30"
          )}
          aria-label={isRecording ? "Stop recording" : "Voice input"}
          title={
            !voiceSupported
              ? "Voice input not supported in this browser"
              : !voiceReady
                ? voiceDisabledReason || "Configure voice input"
                : isRecording
                  ? "Stop recording"
                  : "Voice input (Ctrl+Win)"
          }
        >
          {isRecording ? (
            <VoiceWaveIcon className="size-[20px]" />
          ) : (
            <VoiceIcon className="size-[26px]" />
          )}
        </button>

        {/* Send / Stop controls */}
        {isGenerating && !canSendWhileGenerating && (
          <button
            type="button"
            onClick={onAbort}
            className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full bg-foreground text-background shadow-sm transition-all hover:bg-foreground/90"
            aria-label="Stop generating"
          >
            <StopSquareIcon className="size-6" />
          </button>
        )}
        {(!isGenerating || canSendWhileGenerating) && (
          <button
            type="button"
            onClick={onSend}
            disabled={!hasInput}
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-full shadow-sm transition-all",
              hasInput
                ? "cursor-pointer bg-foreground text-background"
                : "bg-foreground/50 text-background"
            )}
            aria-label={isGenerating ? "Run command" : "Send message"}
          >
            <SendArrowIcon className="size-4" />
          </button>
        )}
      </div>
    </div>
  )
}
