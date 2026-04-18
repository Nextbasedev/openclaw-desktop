"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import {
  VscArrowLeft,
  VscEdit,
  VscSave,
  VscCloudDownload,
  VscClose,
  VscCheck,
} from "react-icons/vsc"

/* ── Mock file content by id ── */

const MOCK_CONTENT: Record<string, string> = {
  s1a: `# Camoufox Browser Skill\n\nHeavy-duty stealth browser automation with Camoufox (Firefox).\nFor scraping, forms, downloads, monitoring, and complex workflows.\nBypasses bot detection (Google, Cloudflare).`,
  s2a: `# Agent Brain Skill\n\nTransform OpenClaw from a chatbot into a proactive personal AI.\nUse when the user wants to set up their agent, make it proactive,\nconfigure memory, schedule morning briefings.`,
  m1: `# 2026-04-18\n\n## Session Notes\n- Working on OpenClaw Desktop chatbox design\n- Terminal panel added with multi-tab support\n- Animated greeting component created`,
  m2: `{\n  "lastChecks": {\n    "email": null,\n    "calendar": null,\n    "weather": null\n  }\n}`,
  f1: `# AGENTS.md\n\nThis folder is home. Treat it that way.\n\n## Every Session\n1. Read SOUL.md\n2. Read USER.md\n3. Read memory files`,
  f2: `# Soul\n\nYou are **Assistant** — a personal AI assistant.\n\n## Personality\nhelpful, friendly, and professional`,
  f3: `# USER.md\n\n- **Name:** Krish Munjapara\n- **GitHub:** krishmunjapara\n- **Timezone:** UTC`,
  f4: `# MEMORY.md - Long-Term Context\n\n## Current Projects\n- OpenClaw Desktop (Tauri + Next.js)\n- Ampere.sh marketplace`,
  f5: `# TOOLS.md - Local Notes\n\nSkills define how tools work.\nThis file is for your specifics.`,
  f6: `# IDENTITY.md\n\n- **Name:** Empire\n- **Creature:** AI assistant\n- **Vibe:** Competent, direct, warm`,
}

function getFileExtension(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? ""
}

type FilePreviewProps = {
  fileId: string
  fileName: string
  onBack: () => void
}

export function FilePreview({ fileId, fileName, onBack }: FilePreviewProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [isRenaming, setIsRenaming] = useState(false)
  const [editedName, setEditedName] = useState(fileName)
  const [content, setContent] = useState(MOCK_CONTENT[fileId] ?? "// File content not available")
  const [saved, setSaved] = useState(false)
  const ext = getFileExtension(fileName)

  function handleSave() {
    setSaved(true)
    setIsEditing(false)
    setTimeout(() => setSaved(false), 2000)
  }

  function handleRename() {
    setIsRenaming(false)
    // In production this would call the Gateway API
  }

  function handleDownload() {
    const blob = new Blob([content], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = editedName
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-card">
      {/* Header */}
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border/50 px-2">
        <button
          type="button"
          onClick={onBack}
          className="flex size-6 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          aria-label="Back"
        >
          <VscArrowLeft className="size-3.5" />
        </button>

        {isRenaming ? (
          <div className="flex flex-1 items-center gap-1">
            <input
              type="text"
              value={editedName}
              onChange={(e) => setEditedName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRename()
                if (e.key === "Escape") {
                  setEditedName(fileName)
                  setIsRenaming(false)
                }
              }}
              className="h-6 flex-1 rounded border border-border bg-background px-1.5 text-[11px] text-foreground outline-none"
              autoFocus
            />
            <button
              type="button"
              onClick={handleRename}
              className="flex size-5 cursor-pointer items-center justify-center rounded text-green-400 hover:bg-secondary"
            >
              <VscCheck className="size-3" />
            </button>
            <button
              type="button"
              onClick={() => {
                setEditedName(fileName)
                setIsRenaming(false)
              }}
              className="flex size-5 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-secondary"
            >
              <VscClose className="size-3" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setIsRenaming(true)}
            className="flex-1 cursor-pointer truncate text-left text-[12px] font-medium text-foreground hover:text-foreground/80"
            title="Click to rename"
          >
            {editedName}
          </button>
        )}
      </div>

      {/* Action bar */}
      <div className="flex items-center gap-1 border-b border-border/30 px-2 py-1.5">
        {isEditing ? (
          <>
            <ActionButton
              icon={VscSave}
              label="Save"
              onClick={handleSave}
            />
            <ActionButton
              icon={VscClose}
              label="Cancel"
              onClick={() => {
                setContent(MOCK_CONTENT[fileId] ?? "")
                setIsEditing(false)
              }}
            />
          </>
        ) : (
          <ActionButton
            icon={VscEdit}
            label="Edit"
            onClick={() => setIsEditing(true)}
          />
        )}
        <ActionButton
          icon={VscCloudDownload}
          label="Download"
          onClick={handleDownload}
        />
        {saved && (
          <span className="ml-auto flex items-center gap-1 text-[10px] text-green-400">
            <VscCheck className="size-3" />
            Saved
          </span>
        )}
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto p-3">
        {isEditing ? (
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="h-full w-full resize-none rounded bg-background p-3 font-mono text-[12px] leading-5 text-foreground outline-none"
            spellCheck={false}
          />
        ) : (
          <pre
            className={cn(
              "whitespace-pre-wrap font-mono text-[12px] leading-5 text-foreground/85",
              ext === "json" && "text-amber-300/80",
              ext === "md" && "text-blue-300/80",
            )}
          >
            {content}
          </pre>
        )}
      </div>
    </div>
  )
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ElementType
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      title={label}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  )
}
