"use client"

import { useEffect, useRef, useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { FaArrowLeft } from "react-icons/fa"
import {
  CheckmarkCircle02Icon,
  ComputerIcon,
  Copy01Icon,
  EyeIcon,
  Globe02Icon,
  ServerStack01Icon,
  Unlink03Icon,
  ViewOffIcon,
} from "@hugeicons/core-free-icons"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import ConnectionErrorGuide from "@/components/connect/ConnectionErrorGuide"
import { LOCAL_OPENCLAW_PROMPT, VPS_OPENCLAW_PROMPT } from "@/lib/connectSetupPrompt"

type ConnectionStatus = {
  gatewayConfigured: boolean
  gatewayUrl?: string | null
  gatewayToken?: string | null
  hasConnection: boolean
  status: string
}

type ConnectResult = {
  ok: boolean
  url?: string
  message?: string
  error?: string
  errorTitle?: string
  isLocal?: boolean
  isTailscale?: boolean
  addedOrigins?: string[]
  fix?: {
    description: string
    origins: string[]
    example: Record<string, unknown>
  }
}

type DetectMessage = { ok: boolean; text: string }

type ConnectPageViewProps = {
  url: string
  token: string
  showToken: boolean
  setupMode: "choice" | "local" | "remote"
  status: ConnectionStatus | null
  connectResult: ConnectResult | null
  error: string | null
  testing: boolean
  saving: boolean
  disconnecting: boolean
  loadingStatus: boolean
  isConnected: boolean
  autoDetect: boolean
  detecting: boolean
  detectMessage: DetectMessage | null
  onUrlChange: (value: string) => void
  onTokenChange: (value: string) => void
  onShowTokenChange: (show: boolean) => void
  onSetupModeChange: (mode: "choice" | "local" | "remote") => void
  onAutoDetectChange: (enabled: boolean) => void
  onTest: () => void
  onSave: () => void
  onDisconnect: () => void
}

export function ConnectPageView({
  url,
  token,
  showToken,
  setupMode,
  status,
  connectResult,
  error,
  testing,
  saving,
  disconnecting,
  loadingStatus,
  isConnected,
  detecting,
  detectMessage,
  onUrlChange,
  onTokenChange,
  onShowTokenChange,
  onSetupModeChange,
  onAutoDetectChange,
  onTest,
  onSave,
  onDisconnect,
}: ConnectPageViewProps) {
  const busy = testing || saving || disconnecting || detecting
  const missingConfig =
    setupMode === "local" ? !url.trim() : !url.trim() || !token.trim()
  const showSplitShell = !loadingStatus && !isConnected
  const errorBlockRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (isConnected || (!error && !connectResult)) return
    errorBlockRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    })
  }, [connectResult, error, isConnected])

  return (
    <div className="h-full min-h-0 w-full overflow-y-auto bg-background px-4 py-4 sm:px-6 sm:py-6">
      <div
        className={cn(
          "mx-auto flex min-h-full w-full items-center justify-center",
          showSplitShell ? "max-w-[1500px]" : "max-w-[720px]"
        )}
      >
        <div
          className={cn(
            "grid w-full items-center gap-10 md:gap-20",
            showSplitShell
              ? "lg:grid-cols-[minmax(520px,1fr)_minmax(360px,720px)]"
              : "justify-center"
          )}
        >
          <div
            className={cn(
              "overflow-hidden rounded-md p-6 sm:p-8",
              showSplitShell
                ? "flex h-[min(820px,calc(100vh-120px))] items-center justify-center xl:pr-2"
                : ""
            )}
          >
            {showSplitShell ? (
              <div className="flex h-full w-full max-w-[640px] flex-col">
                <div className="flex items-center justify-between pb-6">
                  <p className="text-md font-medium text-zinc-100">OpenClaw</p>
                  {setupMode !== "choice" && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => onSetupModeChange("choice")}
                      className="h-7 gap-1 px-1.5 text-xs font-normal text-zinc-400 hover:text-zinc-100"
                    >
                      <span className="flex h-3 w-3 items-center justify-center">
                        <FaArrowLeft className="h-2.5 w-2.5" />
                      </span>
                      Back
                    </Button>
                  )}
                </div>

                <header className="space-y-3 pb-6 text-left">
                  <div className="flex size-12 items-center justify-center rounded-md border border-white/10 bg-white/5">
                    <HugeiconsIcon
                      icon={ServerStack01Icon}
                      size={22}
                      className="text-zinc-200"
                    />
                  </div>
                  <div>
                    <p className="text-xl font-semibold tracking-tight text-white">
                      Connect OpenClaw Middleware
                    </p>
                    <p className="mt-2 text-sm leading-relaxed text-zinc-500">
                      Ask OpenClaw to prepare the Middleware, then paste the URL
                      and pairing code here.
                    </p>
                  </div>
                </header>

                <div className="min-h-0 flex-1 overflow-y-auto pr-2">
                  <div className="space-y-6">
                    {setupMode === "choice" ? (
                      <ChoiceScreen onSelect={onSetupModeChange} alignLeft />
                    ) : setupMode === "local" ? (
                      <LocalOpenClawPanel
                        url={url}
                        busy={busy}
                        saving={saving}
                        missingConfig={missingConfig}
                        loadingStatus={loadingStatus}
                        detectMessage={detectMessage}
                        onDetect={() => onAutoDetectChange(true)}
                        onUrlChange={onUrlChange}
                        onSave={onSave}
                      />
                    ) : (
                      <VpsOpenClawPanel
                        url={url}
                        token={token}
                        showToken={showToken}
                        busy={busy}
                        saving={saving}
                        missingConfig={missingConfig}
                        onUrlChange={onUrlChange}
                        onTokenChange={onTokenChange}
                        onShowTokenChange={onShowTokenChange}
                        onSave={onSave}
                      />
                    )}

                    {setupMode !== "choice" && (
                      <details className="rounded-xl border border-white/10 bg-black/20 p-4">
                        <summary className="cursor-pointer text-sm font-medium text-zinc-300 select-none hover:text-white">
                          Advanced manual setup
                        </summary>
                        <div className="mt-4 space-y-4">
                          <ManualFields
                            url={url}
                            token={token}
                            showToken={showToken}
                            disabled={busy}
                            onUrlChange={onUrlChange}
                            onTokenChange={onTokenChange}
                            onShowTokenChange={onShowTokenChange}
                          />
                          <div className="grid grid-cols-2 gap-3">
                            <Button
                              onClick={onTest}
                              disabled={busy || missingConfig}
                              variant="outline"
                              size="sm"
                            >
                              {testing ? "Testing..." : "Test"}
                            </Button>
                            <Button
                              onClick={onSave}
                              disabled={busy || missingConfig}
                              size="sm"
                            >
                              {saving ? "Connecting..." : "Save"}
                            </Button>
                          </div>
                        </div>
                      </details>
                    )}

                    {(error || connectResult) && (
                      <div ref={errorBlockRef}>
                        <ConnectionErrorGuide
                          result={connectResult}
                          rawError={error}
                          gatewayUrl={url}
                        />
                      </div>
                    )}
                  </div>
                </div>

                <ConnectProgressRail
                  setupMode={setupMode}
                  url={url}
                  token={token}
                  detectMessage={detectMessage}
                  connectResult={connectResult}
                />
              </div>
            ) : (
              <div className="mx-auto w-full max-w-[560px] space-y-6">
                {loadingStatus ? (
                  <ConnectPageSkeleton />
                ) : (
                  <>
                    <header className="space-y-3 text-center">
                      <div className="mx-auto flex size-12 items-center justify-center rounded-md border border-white/10 bg-white/5">
                        <HugeiconsIcon
                          icon={ServerStack01Icon}
                          size={22}
                          className="text-zinc-200"
                        />
                      </div>
                      <div>
                        <p className="text-xl font-semibold tracking-tight text-white">
                          Where is OpenClaw running?
                        </p>
                        <p className="mt-2 text-sm leading-relaxed text-zinc-500">
                          Choose where OpenClaw runs. Desktop must be able to reach
                          that machine over your network.
                        </p>
                      </div>
                    </header>

                    {isConnected ? (
                  <ConnectedState
                    url={connectResult?.url || status?.gatewayUrl || url}
                    busy={busy}
                    disconnecting={disconnecting}
                    onDisconnect={onDisconnect}
                  />
                    ) : (
                      <>
                        {setupMode === "choice" ? (
                          <ChoiceScreen onSelect={onSetupModeChange} />
                        ) : setupMode === "local" ? (
                          <LocalOpenClawPanel
                            url={url}
                            busy={busy}
                            saving={saving}
                            missingConfig={missingConfig}
                            loadingStatus={loadingStatus}
                            detectMessage={detectMessage}
                            onDetect={() => onAutoDetectChange(true)}
                            onUrlChange={onUrlChange}
                            onSave={onSave}
                          />
                        ) : (
                          <VpsOpenClawPanel
                            url={url}
                            token={token}
                            showToken={showToken}
                            busy={busy}
                            saving={saving}
                            missingConfig={missingConfig}
                            onUrlChange={onUrlChange}
                            onTokenChange={onTokenChange}
                            onShowTokenChange={onShowTokenChange}
                            onSave={onSave}
                          />
                        )}

                        {setupMode !== "choice" && (
                          <details className="rounded-xl border border-white/10 bg-black/20 p-4">
                            <summary className="cursor-pointer text-sm font-medium text-zinc-300 select-none hover:text-white">
                              Advanced manual setup
                            </summary>
                            <div className="mt-4 space-y-4">
                              <ManualFields
                                url={url}
                                token={token}
                                showToken={showToken}
                                disabled={busy}
                                onUrlChange={onUrlChange}
                                onTokenChange={onTokenChange}
                                onShowTokenChange={onShowTokenChange}
                              />
                              <div className="grid grid-cols-2 gap-3">
                                <Button
                                  onClick={onTest}
                                  disabled={busy || missingConfig}
                                  variant="outline"
                                  size="sm"
                                >
                                  {testing ? "Testing..." : "Test"}
                                </Button>
                                <Button
                                  onClick={onSave}
                                  disabled={busy || missingConfig}
                                  size="sm"
                                >
                                  {saving ? "Connecting..." : "Save"}
                                </Button>
                              </div>
                            </div>
                          </details>
                        )}
                      </>
                    )}

                    {!isConnected && (error || connectResult) && (
                      <div ref={errorBlockRef}>
                        <ConnectionErrorGuide
                          result={connectResult}
                          rawError={error}
                          gatewayUrl={url}
                        />
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          {showSplitShell && <ConnectShowcasePanel />}
        </div>
      </div>
    </div>
  )
}

function ChoiceScreen({
  onSelect,
  alignLeft = false,
}: {
  onSelect: (mode: "local" | "remote") => void
  alignLeft?: boolean
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <ModeCard
          active={false}
          icon={ComputerIcon}
          title="OpenClaw is on this computer"
          description="Choose this if OpenClaw runs locally on this machine."
          onClick={() => onSelect("local")}
        />
        <ModeCard
          active={false}
          icon={Globe02Icon}
          title="OpenClaw is on a VPS"
          description="Choose this if OpenClaw runs on a server or cloud machine."
          onClick={() => onSelect("remote")}
        />
      </div>
      <p
        className={cn(
          "text-xs text-zinc-500",
          alignLeft ? "text-left" : "text-center"
        )}
      >
        Pick one. The next screen will guide that setup.
      </p>
    </div>
  )
}

function ConnectShowcasePanel() {
  return (
    <div className="hidden lg:flex lg:items-center lg:justify-center lg:pl-2">
      <div className="w-full max-w-[760px] overflow-hidden rounded-sm border border-white/10 bg-[#0d0d10] shadow-[0_30px_80px_rgba(0,0,0,0.45)]">
        <img
          src="/images/connect-showcase.png"
          alt="OpenClaw connect page preview"
          className="aspect-[4/3] w-full object-cover"
          loading="eager"
          decoding="async"
        />
      </div>
    </div>
  )
}

function ConnectProgressRail({
  setupMode,
  url,
  token,
  detectMessage,
  connectResult,
}: {
  setupMode: "choice" | "local" | "remote"
  url: string
  token: string
  detectMessage: DetectMessage | null
  connectResult: ConnectResult | null
}) {
  const firstStepProgress = setupMode === "choice" ? 0 : 100

  let secondStepProgress = 0
  if (setupMode === "local") {
    secondStepProgress = url.trim() ? 70 : 0
    if (detectMessage?.ok || connectResult?.ok) secondStepProgress = 100
  } else if (setupMode === "remote") {
    secondStepProgress += url.trim() ? 50 : 0
    secondStepProgress += token.trim() ? 50 : 0
    if (connectResult?.ok) secondStepProgress = 100
  }

  return (
    <div className="flex w-full items-center justify-start gap-2 pt-6 sm:gap-3">
      <ProgressSegment progress={firstStepProgress} />
      <ProgressSegment progress={secondStepProgress} />
    </div>
  )
}

function ProgressSegment({ progress }: { progress: number }) {
  const clamped = Math.max(0, Math.min(100, progress))

  return (
    <span className="relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/12 sm:h-2">
      <span
        className="absolute inset-y-0 left-0 rounded-full bg-white transition-[width] duration-500 ease-out"
        style={{ width: `${clamped}%` }}
      />
    </span>
  )
}

function ModeCard({
  active,
  icon,
  title,
  description,
  onClick,
}: {
  active: boolean
  icon: typeof ComputerIcon
  title: string
  description: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md border p-5 text-left transition-all",
        active
          ? "border-emerald-500/40 bg-emerald-500/10 shadow-[0_0_0_1px_rgba(16,185,129,0.08)]"
          : "border-white/10 bg-white/[0.025] hover:border-white/20 hover:bg-white/[0.04]"
      )}
    >
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "flex size-9 items-center justify-center rounded-md",
            active
              ? "bg-emerald-500/15 text-emerald-300"
              : "bg-white/5 text-zinc-400"
          )}
        >
          <HugeiconsIcon icon={icon} size={18} />
        </div>
        <p className="text-sm font-medium text-zinc-100">{title}</p>
      </div>
      <p className="mt-4 text-xs leading-relaxed text-zinc-500">
        {description}
      </p>
    </button>
  )
}

function LocalOpenClawPanel({
  url,
  busy,
  saving,
  missingConfig,
  loadingStatus,
  detectMessage,
  onDetect,
  onUrlChange,
  onSave,
}: {
  url: string
  busy: boolean
  saving: boolean
  missingConfig: boolean
  loadingStatus: boolean
  detectMessage: DetectMessage | null
  onDetect: () => void
  onUrlChange: (value: string) => void
  onSave: () => void
}) {
  const checking = busy || loadingStatus

  return (
    <div className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <StepBadge step="2" label="Check local OpenClaw" />
      <div>
        <p className="text-sm font-medium text-zinc-100">
          We&apos;ll look for OpenClaw on this machine.
        </p>
        <p className="mt-1 text-xs leading-relaxed text-zinc-500">
          If OpenClaw is running on this computer, Desktop connects locally. No
          pairing code or token needed.
        </p>
      </div>
      <StatusMessage
        message={detectMessage}
        fallback="Checking for local OpenClaw..."
      />
      <Button
        type="button"
        onClick={onDetect}
        disabled={checking}
        className="w-full"
      >
        {checking ? "Checking..." : "Start / detect local backend"}
      </Button>
      <div className="rounded-xl border border-white/10 bg-black/20 p-3">
        <p className="text-xs font-medium text-zinc-300">Manual local URL</p>
        <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
          Only use this if auto-detect cannot find the local Middleware. Leave
          pairing/token empty for local setup.
        </p>
        <div className="mt-3 space-y-3">
          <div className="space-y-2">
            <Label
              htmlFor="local-middleware-url"
              className="text-xs text-zinc-300"
            >
              Middleware URL
            </Label>
            <Input
              id="local-middleware-url"
              value={url}
              onChange={(event) => onUrlChange(event.target.value)}
              placeholder="http://127.0.0.1:8787"
              disabled={busy}
              className="border-white/10 bg-black/30 text-zinc-100 placeholder:text-zinc-600"
            />
          </div>
          <Button
            onClick={onSave}
            disabled={busy || missingConfig}
            className="w-full"
            size="sm"
          >
            {saving ? "Connecting..." : "Connect local backend"}
          </Button>
        </div>
      </div>
      <PromptBox
        title="If OpenClaw is not running, ask your local OpenClaw:"
        prompt={LOCAL_OPENCLAW_PROMPT}
      />
    </div>
  )
}

function VpsOpenClawPanel(props: {
  url: string
  token: string
  showToken: boolean
  busy: boolean
  saving: boolean
  missingConfig: boolean
  onUrlChange: (value: string) => void
  onTokenChange: (value: string) => void
  onShowTokenChange: (show: boolean) => void
  onSave: () => void
}) {
  return (
    <div className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <StepBadge step="2" label="Prepare the VPS" />
      <PromptBox
        title="Ask OpenClaw on your VPS:"
        prompt={VPS_OPENCLAW_PROMPT}
      />
      <StepBadge step="3" label="Paste the result" />
      <ManualFields
        url={props.url}
        token={props.token}
        showToken={props.showToken}
        disabled={props.busy}
        tokenLabel="Pairing code"
        tokenPlaceholder="ABC-123"
        onUrlChange={props.onUrlChange}
        onTokenChange={props.onTokenChange}
        onShowTokenChange={props.onShowTokenChange}
      />
      <Button
        onClick={props.onSave}
        disabled={props.busy || props.missingConfig}
        className="w-full"
      >
        {props.saving ? "Pairing..." : "Pair and continue"}
      </Button>
    </div>
  )
}

function StepBadge({ step, label }: { step: string; label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs font-medium text-zinc-300">
      <span className="flex size-5 items-center justify-center rounded-full bg-emerald-500/15 text-[11px] text-emerald-300">
        {step}
      </span>
      {label}
    </div>
  )
}

function StatusMessage({
  message,
  fallback,
}: {
  message: DetectMessage | null
  fallback: string
}) {
  return (
    <div
      className={cn(
        "rounded-xl border px-3 py-2 text-xs leading-relaxed",
        message?.ok
          ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-300"
          : "border-amber-500/20 bg-amber-500/5 text-amber-300"
      )}
    >
      {message?.text || fallback}
    </div>
  )
}

function PromptBox({ title, prompt }: { title: string; prompt: string }) {
  const [copied, setCopied] = useState(false)

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {}
  }

  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-zinc-300">{title}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={copyPrompt}
          className="h-7 px-2 text-[11px] active:translate-y-0"
        >
          <HugeiconsIcon icon={Copy01Icon} size={13} />
          {copied ? "Copied!" : "Copy"}
        </Button>
      </div>
      <pre className="mt-3 h-[244px] overflow-y-auto rounded-lg bg-black/30 p-3 text-[11px] leading-relaxed whitespace-pre-wrap text-zinc-400">
        {prompt}
      </pre>
    </div>
  )
}

function ManualFields({
  url,
  token,
  showToken,
  disabled,
  tokenLabel = "Access token",
  tokenPlaceholder = "Paste token",
  onUrlChange,
  onTokenChange,
  onShowTokenChange,
}: {
  url: string
  token: string
  showToken: boolean
  disabled: boolean
  tokenLabel?: string
  tokenPlaceholder?: string
  onUrlChange: (value: string) => void
  onTokenChange: (value: string) => void
  onShowTokenChange: (show: boolean) => void
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="middleware-url" className="text-xs">
          Middleware URL
        </Label>
        <Input
          id="middleware-url"
          value={url}
          onChange={(event) => onUrlChange(event.target.value)}
          placeholder="https://domain.com or http://100.x.y.z:8787"
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="middleware-token" className="text-xs">
          {tokenLabel}
        </Label>
        <div className="flex gap-2">
          <Input
            id="middleware-token"
            value={token}
            onChange={(event) => onTokenChange(event.target.value)}
            type={showToken ? "text" : "password"}
            placeholder={tokenPlaceholder}
            disabled={disabled}
            autoComplete="off"
            spellCheck={false}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => onShowTokenChange(!showToken)}
            disabled={disabled}
          >
            <HugeiconsIcon icon={showToken ? ViewOffIcon : EyeIcon} size={15} />
          </Button>
        </div>
      </div>
    </div>
  )
}

function ConnectedState({
  url,
  busy,
  disconnecting,
  onDisconnect,
}: {
  url?: string | null
  busy: boolean
  disconnecting: boolean
  onDisconnect: () => void
}) {
  return (
    <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.05] p-5 text-center">
      <div className="mx-auto flex size-11 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-300">
        <HugeiconsIcon icon={CheckmarkCircle02Icon} size={22} />
      </div>
      <p className="mt-3 text-sm font-medium text-emerald-100">
        Workspace ready
      </p>
      <p className="mt-1 text-xs leading-relaxed text-emerald-100/60">
        OpenClaw is connected to {url || "Middleware"}. Projects, terminal, git,
        chats, and files will run there.
      </p>
      <Button
        onClick={onDisconnect}
        disabled={busy}
        variant="outline"
        size="sm"
        className="mt-4 border-emerald-500/20 text-emerald-200 hover:bg-emerald-500/10"
      >
        <HugeiconsIcon icon={Unlink03Icon} size={14} />
        {disconnecting ? "Disconnecting..." : "Disconnect"}
      </Button>
    </div>
  )
}

function ConnectStatusSkeleton() {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-center">
      <div className="mx-auto flex size-11 animate-pulse items-center justify-center rounded-2xl bg-white/8" />
      <div className="mt-3 flex flex-col items-center gap-2">
        <div className="h-4 w-32 animate-pulse rounded-md bg-white/10" />
        <div className="h-3 w-72 max-w-full animate-pulse rounded-md bg-white/6" />
        <div className="h-3 w-56 max-w-full animate-pulse rounded-md bg-white/5" />
      </div>
      <div className="mx-auto mt-4 h-8 w-28 animate-pulse rounded-md bg-white/8" />
    </div>
  )
}

function ConnectPageSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="size-12 animate-pulse rounded-md border border-white/10 bg-white/6" />
        <div className="space-y-2">
          <div className="mx-auto h-6 w-64 animate-pulse rounded-md bg-white/10" />
          <div className="mx-auto h-4 w-80 max-w-full animate-pulse rounded-md bg-white/6" />
          <div className="mx-auto h-4 w-72 max-w-full animate-pulse rounded-md bg-white/5" />
        </div>
      </div>

      <ConnectStatusSkeleton />
    </div>
  )
}
