"use client"

import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  PlusSignIcon,
  ArrowDown01Icon,
  AttachmentIcon,
  Cancel01Icon,
  Tick02Icon,
  HandHelpingIcon,
  Shield01Icon,
  AiSecurity01Icon,
} from "@hugeicons/core-free-icons"

import { cn } from "@/lib/utils"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { WebSearchIcon, VoiceIcon, SendArrowIcon, StopSquareIcon } from "./Icons"
import { VoiceWaveIcon } from "./VoiceWaveIcon"
import type { ModelEntry } from "@/hooks/useModels"
import type { ChatAutonomyMode } from "@/lib/chatAttachments"

type ActionBarProps = {
  hasInput: boolean
  onSend?: () => void
  onUploadClick?: () => void
  isGenerating?: boolean
  onAbort?: () => void
  webSearchEnabled: boolean
  onWebSearchDisable: () => void
  autonomyMode: ChatAutonomyMode
  onAutonomyModeChange: (mode: ChatAutonomyMode) => void
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
  attachmentCount?: number
  disableUpload?: boolean
}

export function ActionBar({
  hasInput,
  onSend,
  onUploadClick,
  isGenerating,
  onAbort,
  webSearchEnabled,
  onWebSearchDisable,
  autonomyMode,
  onAutonomyModeChange,
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
  const [permissionsOpen, setPermissionsOpen] = React.useState(false)
  const permissionOptions = [
    {
      mode: "manual" as const,
      label: "Default permissions",
      icon: HandHelpingIcon,
    },
    {
      mode: "supervised" as const,
      label: "Auto-review",
      icon: Shield01Icon,
    },
    {
      mode: "full" as const,
      label: "Full access",
      icon: AiSecurity01Icon,
    },
  ]
  const activePermission = permissionOptions.find((option) => option.mode === autonomyMode) ?? permissionOptions[0]
  const uniqueModels = models.filter(
    (m, i, arr) =>
      arr.findIndex(
        (x) => x.name.toLowerCase() === m.name.toLowerCase(),
      ) === i,
  )
  return (
    <div className="flex items-center justify-between px-3 pb-3 pt-2">
      {/* Left controls */}
      <div className="flex items-center gap-0.5 sm:gap-1">
        {/* + menu */}
        <Popover open={plusOpen} onOpenChange={onPlusOpenChange}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full border border-foreground/15 bg-foreground/5 text-foreground shadow-sm transition-all hover:bg-foreground/10"
              aria-label="Add"
            >
              <HugeiconsIcon icon={PlusSignIcon} size={19} />
            </button>
          </PopoverTrigger>
          <PopoverContent side="top" align="start" sideOffset={8} className="w-56 gap-0 p-1.5">
            <button
              type="button"
              onClick={onUploadClick}
              disabled={disableUpload}
              className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm text-popover-foreground transition-colors hover:bg-muted"
            >
              <HugeiconsIcon icon={AttachmentIcon} size={16} />
              {attachmentCount > 0 ? `Upload (${attachmentCount})` : "Add photos & files"}
            </button>
          </PopoverContent>
        </Popover>

        {/* Permissions selector */}
        <Popover open={permissionsOpen} onOpenChange={setPermissionsOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="group flex h-8 cursor-pointer items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.08] px-2.5 text-[12px] font-medium text-muted-foreground shadow-sm backdrop-blur-md transition-all hover:bg-white/[0.12] hover:text-foreground"
              aria-label="Permissions mode"
            >
              <HugeiconsIcon icon={activePermission.icon} size={15} className="text-foreground/55 transition-colors group-hover:text-foreground/75" />
              <span className="hidden max-w-[132px] truncate sm:inline">{activePermission.label}</span>
              <HugeiconsIcon icon={ArrowDown01Icon} size={12} className="text-foreground/45" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            side="top"
            align="start"
            sideOffset={8}
            className="w-[218px] overflow-hidden rounded-xl border border-border/50 bg-popover/70 p-1.5 text-popover-foreground shadow-2xl shadow-black/35 ring-1 ring-foreground/10 backdrop-blur-xl backdrop-saturate-150"
          >
            <div className="space-y-0.5">
              {permissionOptions.map((option) => {
                const selected = autonomyMode === option.mode
                return (
                  <button
                    key={option.mode}
                    type="button"
                    onClick={() => {
                      onAutonomyModeChange(option.mode)
                      setPermissionsOpen(false)
                    }}
                    className={cn(
                      "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-semibold transition-colors",
                      selected
                        ? "text-foreground"
                        : "text-muted-foreground hover:bg-muted/45 hover:text-foreground",
                    )}
                  >
                    <HugeiconsIcon icon={option.icon} size={17} className="shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    {selected && (
                      <HugeiconsIcon icon={Tick02Icon} size={16} className="shrink-0 text-foreground/80" />
                    )}
                  </button>
                )
              })}
            </div>
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
                const unavailable = model.health?.status === "unavailable"
                return (
                  <button
                    key={`${model.provider}/${model.id}`}
                    type="button"
                    disabled={unavailable}
                    className={cn(
                      "flex w-full items-center justify-between rounded-lg px-3 py-2 text-[13px] transition-colors hover:bg-muted",
                      unavailable ? "cursor-not-allowed opacity-45 hover:bg-transparent" : "cursor-pointer",
                      isActive
                        ? "bg-foreground/10 font-medium text-foreground"
                        : "text-muted-foreground"
                    )}
                    onClick={() => !unavailable && onModelSelect(model)}
                    title={model.health?.reason}
                  >
                    <span className="flex min-w-0 flex-col text-left">
                      <span className="truncate">{model.name}</span>
                      {unavailable && (
                        <span className="truncate text-[10px] font-normal text-amber-300/80">
                          {model.health?.reason}
                        </span>
                      )}
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
                ? "cursor-pointer text-muted-foreground hover:text-foreground"
                : "cursor-not-allowed text-muted-foreground/30"
          )}
          aria-label={isRecording ? "Stop recording" : "Voice input"}
          title={
            !voiceSupported
              ? "Voice input not supported in this browser"
              : isRecording
                ? "Stop recording"
                : "Voice input"
          }
        >
          {isRecording ? (
            <VoiceWaveIcon className="size-[20px]" />
          ) : (
            <VoiceIcon className="size-[26px]" />
          )}
        </button>

        {/* Send / Stop controls */}
        {isGenerating && (
          <button
            type="button"
            onClick={onAbort}
            className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full bg-foreground text-background shadow-sm transition-all hover:bg-foreground/90"
            aria-label="Stop generating"
          >
            <StopSquareIcon className="size-6" />
          </button>
        )}
        {!isGenerating && (
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
            aria-label="Send message"
          >
            <SendArrowIcon className="size-4" />
          </button>
        )}
      </div>
    </div>
  )
}
