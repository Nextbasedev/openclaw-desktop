"use client"

import { useState, useMemo } from "react"
import { cn } from "@/lib/utils"
import {
  VscArrowLeft,
  VscEdit,
  VscCloudDownload,
  VscTrash,
  VscSave,
  VscCheck,
  VscClose,
  VscOpenPreview,
  VscCode,
} from "react-icons/vsc"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"

/* ── Mock file content ── */

const MOCK_CONTENT: Record<string, string> = {
  s1a: `# Camoufox Browser Skill\n\nHeavy-duty stealth browser automation with Camoufox (Firefox).\n\n## Features\n- Scraping, forms, downloads, monitoring\n- Bypasses bot detection (Google, Cloudflare)\n- OAuth support included\n\n> Use for complex workflows that need stealth.`,
  s2a: `# Agent Brain Skill\n\nTransform OpenClaw from a chatbot into a **proactive personal AI**.\n\n## Use When\n- Setting up your agent\n- Making it proactive\n- Configuring memory\n- Scheduling morning briefings`,
  m1: `# 2026-04-18\n\n## Session Notes\n- Working on OpenClaw Desktop chatbox design\n- Terminal panel added with multi-tab support\n- Animated greeting component created`,
  m2: `{\n  "lastChecks": {\n    "email": null,\n    "calendar": null,\n    "weather": null\n  }\n}`,
  f1: `# AGENTS.md\n\nThis folder is home. Treat it that way.\n\n## Every Session\n1. Read \`SOUL.md\`\n2. Read \`USER.md\`\n3. Read memory files`,
  f2: `# Soul\n\nYou are **Assistant** — a personal AI assistant.\n\n## Personality\nhelpful, friendly, and professional`,
  f3: `# USER.md\n\n- **Name:** Krish Munjapara\n- **GitHub:** krishmunjapara\n- **Timezone:** UTC`,
  f4: `# MEMORY.md - Long-Term Context\n\n## Current Projects\n- OpenClaw Desktop (Tauri + Next.js)\n- Ampere.sh marketplace`,
  f5: `# TOOLS.md - Local Notes\n\nSkills define how tools work.\nThis file is for your specifics.`,
  f6: `# IDENTITY.md\n\n- **Name:** Empire\n- **Creature:** AI assistant\n- **Vibe:** Competent, direct, warm`,
}

function getExt(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? ""
}

type FilePreviewProps = {
  fileId: string
  fileName: string
  onBack: () => void
}

export function FilePreview({ fileId, fileName, onBack }: FilePreviewProps) {
  const ext = getExt(fileName)
  const isMd = ext === "md"
  const originalContent = MOCK_CONTENT[fileId] ?? "// File content not available"

  const [content, setContent] = useState(originalContent)
  const [displayName, setDisplayName] = useState(fileName)
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(fileName)
  const [saved, setSaved] = useState(false)
  // For md files: "preview" or "edit". For non-md: always "edit"
  const [mode, setMode] = useState<"preview" | "edit">(isMd ? "preview" : "edit")

  const hasChanges = useMemo(() => content !== originalContent, [content, originalContent])

  function handleSave() {
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  function handleDownload() {
    const blob = new Blob([content], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = displayName
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleRenameConfirm() {
    if (renameValue.trim()) {
      setDisplayName(renameValue.trim())
    }
    setIsRenaming(false)
  }

  return (
    <div
      className={cn(
        "absolute inset-0 z-20 flex flex-col bg-card",
        "animate-in slide-in-from-right duration-200"
      )}
    >
      {/* Single header — back, filename, action icons */}
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border/50 px-2">
        {/* Back */}
        <IconBtn icon={VscArrowLeft} label="Back" onClick={onBack} />

        {/* Filename */}
        {isRenaming ? (
          <div className="flex min-w-0 items-center gap-1">
            <input
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRenameConfirm()
                if (e.key === "Escape") {
                  setRenameValue(displayName)
                  setIsRenaming(false)
                }
              }}
              size={Math.max(4, renameValue.length + 1)}
              className="h-6 w-fit min-w-16 rounded border border-border bg-background px-1.5 text-[11px] text-foreground outline-none"
              autoFocus
            />
            <IconBtn icon={VscCheck} label="Confirm" onClick={handleRenameConfirm} />
            <IconBtn
              icon={VscClose}
              label="Cancel"
              onClick={() => {
                setRenameValue(displayName)
                setIsRenaming(false)
              }}
            />
          </div>
        ) : (
          <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground">
            {displayName}
          </span>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Md toggle: preview / edit */}
        {isMd && (
          <>
            <IconBtn
              icon={VscOpenPreview}
              label="Preview"
              onClick={() => setMode("preview")}
              active={mode === "preview"}
            />
            <IconBtn
              icon={VscCode}
              label="Edit"
              onClick={() => setMode("edit")}
              active={mode === "edit"}
            />
            <div className="mx-1 h-4 w-px bg-border/40" />
          </>
        )}

        {/* Action icons */}
        {!isRenaming && (
          <>
            <IconBtn icon={VscEdit} label="Rename" onClick={() => {
              setRenameValue(displayName)
              setIsRenaming(true)
            }} />
            <IconBtn icon={VscCloudDownload} label="Download" onClick={handleDownload} />
            <IconBtn icon={VscTrash} label="Delete" onClick={onBack} className="hover:!text-destructive" />
            <IconBtn
              icon={saved ? VscCheck : VscSave}
              label={saved ? "Saved" : "Save"}
              onClick={handleSave}
              disabled={!hasChanges && !saved}
            />
          </>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {isMd && mode === "preview" ? (
          <div className="prose prose-sm prose-invert max-w-none p-4 text-[12px] leading-6 text-foreground/85 [&_a]:text-blue-400 [&_code]:rounded [&_code]:bg-secondary/60 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[11px] [&_h1]:text-base [&_h1]:font-semibold [&_h1]:text-foreground [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:text-foreground [&_h3]:text-xs [&_h3]:font-semibold [&_h3]:text-foreground [&_blockquote]:border-l-2 [&_blockquote]:border-muted-foreground/30 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_li]:text-foreground/85 [&_p]:text-foreground/85 [&_strong]:text-foreground [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_pre]:rounded-lg [&_pre]:bg-secondary/40 [&_pre]:p-3">
            <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
          </div>
        ) : (
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="h-full w-full resize-none bg-transparent p-4 font-mono text-[12px] leading-5 text-foreground/85 outline-none"
            spellCheck={false}
          />
        )}
      </div>
    </div>
  )
}

/* ── Icon button with tooltip ── */

function IconBtn({
  icon: Icon,
  label,
  onClick,
  disabled,
  active,
  className,
}: {
  icon: React.ElementType
  label: string
  onClick: () => void
  disabled?: boolean
  active?: boolean
  className?: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          className={cn(
            "flex size-6 cursor-pointer items-center justify-center rounded transition-colors",
            "text-muted-foreground hover:bg-secondary hover:text-foreground",
            active && "bg-secondary text-foreground",
            disabled && "cursor-default opacity-30 hover:bg-transparent hover:text-muted-foreground",
            className,
          )}
        >
          <Icon className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        {label}
      </TooltipContent>
    </Tooltip>
  )
}
