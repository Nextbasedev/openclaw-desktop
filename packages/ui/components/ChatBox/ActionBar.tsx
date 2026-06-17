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
import type { SessionTokenUsage } from "@/lib/sessionContextUsage"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { WebSearchIcon, SendArrowIcon, StopSquareIcon } from "./Icons"
import type { ModelEntry } from "@/hooks/useModels"
import { ModelLogo } from "@/components/model/ModelLogo"

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
  sessionUsage?: SessionTokenUsage | null
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
  sessionUsage = null,
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
              className="flex size-9 shrink-0 cursor-pointer appearance-none items-center justify-center rounded-full border border-white/12 bg-white/[0.06] text-foreground/80 shadow-[0_10px_30px_-18px_rgba(0,0,0,0.85),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-xl transition-all hover:border-white/18 hover:bg-white/[0.1] hover:text-foreground [-webkit-appearance:none]"
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
              "z-[120] w-[190px] gap-0 overflow-hidden rounded-2xl p-1.5 ring-0 outline-none",
              "border border-black/[0.10] bg-[var(--glass-bg)] dark:border-black/70",
              "backdrop-blur-[40px] backdrop-saturate-[180%]",
              "shadow-[0_24px_64px_var(--glass-shadow),0_2px_12px_var(--glass-shadow),inset_0_1px_0_var(--glass-inset)]",
              "data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[side=top]:data-[state=open]:slide-in-from-bottom-1",
            )}
          >
            <button
              type="button"
              onClick={onUploadClick}
              disabled={disableUpload}
              className={cn(
                "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] font-medium transition-colors",
                "text-foreground/80 hover:bg-foreground/8 hover:text-foreground",
                "disabled:cursor-not-allowed disabled:opacity-50",
              )}
            >
              <HugeiconsIcon icon={AttachmentIcon} size={14} strokeWidth={1.5} />
              <span className="min-w-0 flex-1 truncate">
                {attachmentCount > 0 ? `Upload (${attachmentCount})` : "Add photos & files"}
              </span>
            </button>
          </PopoverContent>
        </Popover>

        <ContextUsageBadge usage={sessionUsage} />

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
              className="flex h-8 max-w-[210px] cursor-pointer items-center gap-1.5 rounded-full px-2 text-xs text-muted-foreground transition-all hover:bg-white/[0.04] hover:text-foreground"
            >
              <ModelLogo model={activeModel} modelId={currentModelId} size="xs" />
              <span className="truncate">{modelLabel}</span>
              <HugeiconsIcon icon={ArrowDown01Icon} size={12} />
            </button>
          </PopoverTrigger>
          <PopoverContent
            side="top"
            align="end"
            sideOffset={8}
            className={cn(
              "z-[120] w-72 gap-0 overflow-hidden rounded-2xl p-1.5 ring-0 outline-none",
              "border border-black/[0.10] bg-[var(--glass-bg)] dark:border-black/70",
              "backdrop-blur-[40px] backdrop-saturate-[180%]",
              "shadow-[0_24px_64px_var(--glass-shadow),0_2px_12px_var(--glass-shadow),inset_0_1px_0_var(--glass-inset)]",
              "data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[side=top]:data-[state=open]:slide-in-from-bottom-1",
            )}
          >
            <div className="max-h-60 overflow-y-auto pr-1">
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
                      "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors text-left",
                      isActive
                        ? "bg-foreground/8 font-medium text-foreground"
                        : "text-foreground/80 hover:bg-foreground/8 hover:text-foreground"
                    )}
                    onClick={() => onModelSelect(model)}
                  >
                    <ModelLogo model={model} size="sm" />
                    <span className="flex min-w-0 flex-1 flex-col text-left">
                      <span className="truncate text-foreground/90">{model.name}</span>
                      <span className="truncate text-[10px] font-normal text-muted-foreground/55">
                        {model.reasoning ? `${model.provider} · reasoning` : model.provider}
                      </span>
                    </span>
                    {isActive && (
                      <HugeiconsIcon icon={Tick02Icon} size={14} className="shrink-0 text-foreground" />
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

        {/*
          Voice-to-text button intentionally removed from the message input UI.
          (Keyboard shortcuts are also disabled in ChatBox.)
        */}

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
            onMouseDown={(event) => {
              if (hasInput) event.preventDefault()
            }}
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

function formatCompactNumber(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—"
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K`
  return value.toLocaleString()
}

function formatPercent(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0%"
  if (value < 1) return "<1%"
  return `${Math.min(100, value).toFixed(value < 10 ? 1 : 0)}%`
}

function ContextUsageBadge({ usage }: { usage?: SessionTokenUsage | null }) {
  if (!usage || usage.total <= 0) return null

  const contextLimit = usage.contextLimit && usage.contextLimit > 0 ? usage.contextLimit : 128_000
  const percent = Math.min(100, (usage.total / contextLimit) * 100)
  const ringOffset = 100 - percent

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="hidden h-8 cursor-pointer items-center gap-1.5 rounded-full px-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-black/[0.045] hover:text-foreground dark:hover:bg-white/[0.045] sm:flex"
          aria-label="Session context usage"
        >
          <span>{formatPercent(percent)}</span>
          <svg className="size-3.5 -rotate-90" viewBox="0 0 36 36" aria-hidden="true">
            <circle
              cx="18"
              cy="18"
              r="15.5"
              fill="none"
              className="stroke-foreground/15 dark:stroke-white/15"
              stroke="currentColor"
              strokeWidth="4"
            />
            <circle
              cx="18"
              cy="18"
              r="15.5"
              fill="none"
              className="stroke-foreground/75 dark:stroke-white/90"
              stroke="currentColor"
              strokeWidth="4"
              strokeLinecap="round"
              pathLength="100"
              strokeDasharray="100"
              strokeDashoffset={ringOffset}
            />
          </svg>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={10}
        className={cn(
          "z-[120] w-[252px] overflow-hidden rounded-2xl p-3 ring-0 outline-none",
          "border border-black/[0.10] bg-[var(--glass-bg)] dark:border-black/70",
          "backdrop-blur-[40px] backdrop-saturate-[180%]",
          "shadow-[0_24px_64px_var(--glass-shadow),0_2px_12px_var(--glass-shadow),inset_0_1px_0_var(--glass-inset)]",
        )}
      >
        <div className="space-y-3 text-[11px]">
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium text-foreground">{formatPercent(percent)}</span>
            <span className="font-mono text-muted-foreground/70">
              {formatCompactNumber(usage.total)} / {formatCompactNumber(contextLimit)}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/[0.08]">
            <div
              className="h-full rounded-full bg-white/85 transition-[width]"
              style={{ width: `${percent}%` }}
            />
          </div>
          <div className="space-y-1.5 border-t border-white/[0.07] pt-3 text-muted-foreground/70">
            <UsageRow label="Input" value={usage.input} />
            <UsageRow label="Output" value={usage.output} />
            {usage.cacheRead > 0 && <UsageRow label="Cache read" value={usage.cacheRead} />}
            {usage.cacheWrite > 0 && <UsageRow label="Cache write" value={usage.cacheWrite} />}
            {usage.totalCacheRead && usage.totalCacheRead > 0 && (
              <UsageRow label="Total cache read" value={usage.totalCacheRead} />
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function UsageRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between gap-3">
      <span>{label}</span>
      <span className="font-mono text-foreground/80">{formatCompactNumber(value)}</span>
    </div>
  )
}
