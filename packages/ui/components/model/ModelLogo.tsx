"use client"

import { ModelIcon, ProviderIcon } from "@lobehub/icons"
import { cn } from "@/lib/utils"
import type { ModelEntry } from "@/hooks/useModels"

type ModelLogoModel = Pick<ModelEntry, "id" | "name" | "provider">

type ModelLogoProps = {
  model?: ModelLogoModel | null
  modelId?: string | null
  size?: "xs" | "sm" | "md"
  className?: string
  iconClassName?: string
}

const DIRECT_PROVIDER_ALIASES: Record<string, string> = {
  "anthropic": "anthropic",
  "cerebras": "cerebras",
  "cohere": "cohere",
  "deepinfra": "deepinfra",
  "deepseek": "deepseek",
  "gemini": "gemini",
  "google": "google",
  "groq": "groq",
  "meta": "meta",
  "mistral": "mistral",
  "ollama": "ollama",
  "openai": "openai",
  "openrouter": "openrouter",
  "perplexity": "perplexity",
  "qwen": "qwen",
  "replicate": "replicate",
  "together": "togetherai",
  "togetherai": "togetherai",
  "xai": "xai",
}

const MODEL_PROVIDER_HINTS: Array<[RegExp, string]> = [
  [/claude/i, "anthropic"],
  [/gemini/i, "gemini"],
  [/gpt|o\d|chatgpt|openai|codex/i, "openai"],
  [/deepseek/i, "deepseek"],
  [/llama|meta/i, "meta"],
  [/mistral|mixtral|codestral/i, "mistral"],
  [/qwen|qwq/i, "qwen"],
  [/grok|xai/i, "xai"],
  [/command-r|cohere/i, "cohere"],
  [/sonar|perplexity/i, "perplexity"],
  [/cerebras/i, "cerebras"],
  [/groq/i, "groq"],
]

const SIZE_STYLES = {
  xs: { tile: "size-5 rounded-md", icon: 15, text: "text-[8px]" },
  sm: { tile: "size-7 rounded-lg", icon: 18, text: "text-[9px]" },
  md: { tile: "size-9 rounded-xl", icon: 23, text: "text-[10px]" },
} as const

function cleanProvider(provider?: string | null) {
  return provider
    ?.trim()
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/-coding|-responses|-gateway|-api$/g, "")
}

export function normalizedModelProvider(model?: ModelLogoModel | null, modelId?: string | null) {
  const provider = cleanProvider(model?.provider ?? modelId?.split("/")[0])
  if (provider) {
    const direct = DIRECT_PROVIDER_ALIASES[provider] ?? DIRECT_PROVIDER_ALIASES[provider.replace(/-/g, "")]
    if (direct) return direct
  }

  const haystack = [model?.id, model?.name, model?.provider, modelId].filter(Boolean).join(" ")
  for (const [pattern, mapped] of MODEL_PROVIDER_HINTS) {
    if (pattern.test(haystack)) return mapped
  }

  return provider || "custom"
}

export function modelInitials(model?: ModelLogoModel | null, modelId?: string | null) {
  const label = model?.name || model?.id || modelId || "AI"
  const words = label
    .replace(/^[^/]+\//, "")
    .replace(/[-_.:]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)

  if (words.length >= 2) return `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}`.toUpperCase()
  return (words[0] ?? "AI").slice(0, 2).toUpperCase()
}

export function ModelLogo({ model, modelId, size = "sm", className, iconClassName }: ModelLogoProps) {
  const style = SIZE_STYLES[size]
  const modelRef = model?.id || model?.name || modelId || undefined
  const provider = normalizedModelProvider(model, modelId)
  const initials = modelInitials(model, modelId)

  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden border border-white/10",
        "bg-white/[0.06] text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]",
        style.tile,
        className,
      )}
      aria-hidden="true"
    >
      <span className="absolute inset-0 bg-gradient-to-br from-white/10 via-transparent to-black/15" />
      <span className={cn("relative flex items-center justify-center", iconClassName)}>
        {provider === "custom" ? (
          <span className={cn("font-semibold tracking-tight text-foreground/70", style.text)}>{initials}</span>
        ) : modelRef ? (
          <ModelIcon model={modelRef} size={style.icon} type="color" />
        ) : (
          <ProviderIcon provider={provider} size={style.icon} type="color" />
        )}
      </span>
    </span>
  )
}
