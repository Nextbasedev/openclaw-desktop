"use client"

import { useState, useRef, useCallback, useEffect, useMemo } from "react"
import { cn } from "@/lib/utils"
import {
  VscFolder,
  VscFolderOpened,
  VscFile,
  VscJson,
  VscMarkdown,
  VscCode,
  VscChevronRight,
  VscChevronDown,
  VscNewFile,
  VscNewFolder,
  VscCollapseAll,
  VscArrowLeft,
  VscEdit,
  VscCloudDownload,
  VscTrash,
  VscSave,
  VscCheck,
  VscClose,
  VscOpenPreview,
} from "react-icons/vsc"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter"
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism"

/* ── Types ── */

interface FileNode {
  id: string
  name: string
  type: "file" | "dir"
  children?: FileNode[]
}

/* ── Mock data ── */

const MOCK_TREE: FileNode[] = [
  {
    id: "workspace",
    name: "workspace",
    type: "dir",
    children: [
      {
        id: "skills",
        name: "skills",
        type: "dir",
        children: [
          {
            id: "s1",
            name: "camoufox-browser",
            type: "dir",
            children: [{ id: "s1a", name: "SKILL.md", type: "file" }],
          },
          {
            id: "s2",
            name: "agent-brain",
            type: "dir",
            children: [{ id: "s2a", name: "SKILL.md", type: "file" }],
          },
        ],
      },
      {
        id: "memory",
        name: "memory",
        type: "dir",
        children: [
          { id: "m1", name: "2026-04-18.md", type: "file" },
          { id: "m2", name: "heartbeat-state.json", type: "file" },
        ],
      },
      { id: "f1", name: "AGENTS.md", type: "file" },
      { id: "f2", name: "SOUL.md", type: "file" },
      { id: "f3", name: "USER.md", type: "file" },
      { id: "f4", name: "MEMORY.md", type: "file" },
      { id: "f5", name: "TOOLS.md", type: "file" },
      { id: "f6", name: "IDENTITY.md", type: "file" },
    ],
  },
]

const MOCK_CONTENT: Record<string, string> = {
  s1a: "# Camoufox Browser Skill\n\nHeavy-duty stealth browser automation with Camoufox (Firefox).\n\n## Features\n- Scraping, forms, downloads, monitoring\n- Bypasses bot detection (Google, Cloudflare)\n- OAuth support included\n\n> Use for complex workflows that need stealth.",
  s2a: "# Agent Brain Skill\n\nTransform OpenClaw from a chatbot into a **proactive personal AI**.\n\n## Use When\n- Setting up your agent\n- Making it proactive\n- Configuring memory\n- Scheduling morning briefings",
  m1: "# 2026-04-18\n\n## Session Notes\n- Working on OpenClaw Desktop chatbox design\n- Terminal panel added with multi-tab support\n- Animated greeting component created",
  m2: '{\n  "lastChecks": {\n    "email": null,\n    "calendar": null,\n    "weather": null\n  }\n}',
  f1: "# AGENTS.md\n\nThis folder is home. Treat it that way.\n\n## Every Session\n1. Read `SOUL.md`\n2. Read `USER.md`\n3. Read memory files",
  f2: "# Soul\n\nYou are **Assistant** — a personal AI assistant.\n\n## Personality\nhelpful, friendly, and professional",
  f3: "# USER.md\n\n- **Name:** Krish Munjapara\n- **GitHub:** krishmunjapara\n- **Timezone:** UTC",
  f4: "# MEMORY.md - Long-Term Context\n\n## Current Projects\n- OpenClaw Desktop (Tauri + Next.js)\n- Ampere.sh marketplace",
  f5: "# TOOLS.md - Local Notes\n\nSkills define how tools work.\nThis file is for your specifics.",
  f6: "# IDENTITY.md\n\n- **Name:** Empire\n- **Creature:** AI assistant\n- **Vibe:** Competent, direct, warm",
}

/* ── Helpers ── */

function findNode(nodes: FileNode[], id: string): FileNode | null {
  for (const node of nodes) {
    if (node.id === id) return node
    if (node.children) {
      const found = findNode(node.children, id)
      if (found) return found
    }
  }
  return null
}

function getExt(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? ""
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

/* ── File icon by extension ── */

function FileIcon({ name }: { name: string }) {
  const ext = getExt(name)
  if (ext === "md") return <VscMarkdown className="size-4 shrink-0 text-blue-400/80" />
  if (ext === "json") return <VscJson className="size-4 shrink-0 text-amber-400/80" />
  if (["ts", "tsx", "js", "jsx"].includes(ext))
    return <VscCode className="size-4 shrink-0 text-sky-400/80" />
  return <VscFile className="size-4 shrink-0 text-muted-foreground/60" />
}

/* ── Tree node ── */

function TreeNode({
  node,
  depth,
  selectedId,
  onSelect,
  collapsedAll,
}: {
  node: FileNode
  depth: number
  selectedId: string | null
  onSelect: (id: string) => void
  collapsedAll: number
}) {
  const [open, setOpen] = useState(depth === 0)
  const isDir = node.type === "dir"
  const isSelected = selectedId === node.id

  useEffect(() => {
    if (collapsedAll > 0 && depth > 0) setOpen(false)
  }, [collapsedAll, depth])

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          if (isDir) setOpen((p) => !p)
          else onSelect(node.id)
        }}
        style={{ paddingLeft: `${12 + depth * 14}px` }}
        className={cn(
          "flex w-full cursor-pointer items-center gap-1.5 py-[4px] pr-3 text-left transition-colors",
          isSelected && !isDir
            ? "bg-secondary/60 text-foreground"
            : "text-foreground/80 hover:bg-secondary/30",
        )}
      >
        {isDir ? (
          <>
            <span className="flex size-3.5 items-center justify-center text-muted-foreground/60">
              {open ? <VscChevronDown className="size-3" /> : <VscChevronRight className="size-3" />}
            </span>
            {open ? (
              <VscFolderOpened className="size-3.5 shrink-0 text-amber-400/70" />
            ) : (
              <VscFolder className="size-3.5 shrink-0 text-amber-400/70" />
            )}
          </>
        ) : (
          <>
            <span className="size-3.5 shrink-0" />
            <FileIcon name={node.name} />
          </>
        )}
        <span className="truncate text-[11px]">{node.name}</span>
      </button>

      {isDir && open && node.children && (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
              collapsedAll={collapsedAll}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/* ── Code editor with line numbers (VS Code style) ── */

function CodeEditor({
  content,
  ext,
}: {
  content: string
  onChange: (v: string) => void
  ext: string
}) {
  const language =
    ext === "json"
      ? "json"
      : ext === "md"
        ? "markdown"
        : ext === "ts" || ext === "tsx"
          ? "typescript"
          : ext === "js" || ext === "jsx"
            ? "javascript"
            : "text"

  return (
    <div className="h-full overflow-auto bg-[#1A1A1A]">
      <div className="min-w-max">
        <SyntaxHighlighter
          language={language}
          style={vscDarkPlus}
          showLineNumbers
          wrapLines={false}
          wrapLongLines={false}
          customStyle={{
            margin: 0,
            minHeight: "100%",
            background: "#1A1A1A",
            fontSize: "11px",
            lineHeight: "20px",
            padding: "12px",
            overflow: "visible",
          }}
          lineNumberStyle={{
            minWidth: "2.5em",
            paddingRight: "1em",
            color: "#5C5C5C",
            borderRight: "1px solid #333333",
            marginRight: "12px",
          }}
          codeTagProps={{
            style: {
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
            },
          }}
        >
          {content}
        </SyntaxHighlighter>
      </div>
    </div>
  )
}

/* ── File preview pane ── */

function FilePreviewPane({
  fileId,
  fileName,
}: {
  fileId: string
  fileName: string
}) {
  const ext = getExt(fileName)
  const isMd = ext === "md"
  const originalContent = MOCK_CONTENT[fileId] ?? "// File content not available"

  const [content, setContent] = useState(originalContent)
  const [displayName, setDisplayName] = useState(fileName)
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(fileName)
  const [saved, setSaved] = useState(false)
  const [mode, setMode] = useState<"preview" | "edit">(isMd ? "preview" : "edit")

  const hasChanges = useMemo(() => content !== originalContent, [content, originalContent])

  // Reset state when file changes
  useEffect(() => {
    setContent(MOCK_CONTENT[fileId] ?? "// File content not available")
    setDisplayName(fileName)
    setIsRenaming(false)
    setSaved(false)
    setMode(getExt(fileName) === "md" ? "preview" : "edit")
  }, [fileId, fileName])

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
    if (renameValue.trim()) setDisplayName(renameValue.trim())
    setIsRenaming(false)
  }

  return (
    <div className="flex h-full flex-col">
      {/* Preview header */}
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border/40 px-2">
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
              className="h-5 w-fit min-w-16 rounded border border-border bg-background px-1.5 text-[11px] text-foreground outline-none"
              autoFocus
            />
            <IconBtn icon={VscCheck} label="Confirm" onClick={handleRenameConfirm} />
            <IconBtn icon={VscClose} label="Cancel" onClick={() => {
              setRenameValue(displayName)
              setIsRenaming(false)
            }} />
          </div>
        ) : (
          <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground">
            {displayName}
          </span>
        )}

        <div className="flex-1" />

        {/* Md toggle */}
        {isMd && (
          <>
            <IconBtn icon={VscOpenPreview} label="Preview" onClick={() => setMode("preview")} active={mode === "preview"} />
            <IconBtn icon={VscCode} label="Edit" onClick={() => setMode("edit")} active={mode === "edit"} />
            <div className="mx-0.5 h-3.5 w-px bg-border/40" />
          </>
        )}

        {/* Actions */}
        {!isRenaming && (
          <>
            <IconBtn icon={VscEdit} label="Rename" onClick={() => {
              setRenameValue(displayName)
              setIsRenaming(true)
            }} />
            <IconBtn icon={VscCloudDownload} label="Download" onClick={handleDownload} />
            <IconBtn icon={VscTrash} label="Delete" onClick={() => {}} className="hover:!text-destructive" />
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
      <div className="flex-1 overflow-hidden">
        {isMd && mode === "preview" ? (
          <div className="h-full overflow-auto p-3 text-[12px] leading-6 text-foreground/85 [&_a]:text-blue-400 [&_blockquote]:border-l-2 [&_blockquote]:border-muted-foreground/30 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_code]:rounded [&_code]:bg-secondary/60 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[11px] [&_h1]:text-base [&_h1]:font-semibold [&_h1]:text-foreground [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:text-foreground [&_h3]:text-xs [&_h3]:font-semibold [&_h3]:text-foreground [&_li]:text-foreground/85 [&_ol]:list-decimal [&_ol]:pl-4 [&_p]:text-foreground/85 [&_pre]:rounded-lg [&_pre]:bg-secondary/40 [&_pre]:p-3 [&_strong]:text-foreground [&_ul]:list-disc [&_ul]:pl-4">
            <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
          </div>
        ) : (
          <CodeEditor content={content} onChange={setContent} ext={ext} />
        )}
      </div>
    </div>
  )
}

/* ── Empty state ── */

function EmptyPreview() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <VscFile className="size-10 text-muted-foreground/20" />
      <div>
        <p className="text-[12px] font-medium text-muted-foreground/50">No file selected</p>
        <p className="mt-1 text-[11px] text-muted-foreground/30">Select a file from the tree to preview</p>
      </div>
    </div>
  )
}

/* ── Workspace tab (split pane) ── */

const FILE_SIDEBAR_MIN = 140
const FILE_SIDEBAR_MAX = 260
const FILE_SIDEBAR_DEFAULT = 180

export function WorkspaceTab() {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [collapsedAll, setCollapsedAll] = useState(0)
  const [sidebarWidth, setSidebarWidth] = useState(FILE_SIDEBAR_DEFAULT)
  const [isDragging, setIsDragging] = useState(false)
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)

  const selectedNode = selectedId ? findNode(MOCK_TREE, selectedId) : null

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      dragRef.current = { startX: e.clientX, startWidth: sidebarWidth }
      setIsDragging(true)
    },
    [sidebarWidth],
  )

  useEffect(() => {
    if (!isDragging) return
    function onMouseMove(e: MouseEvent) {
      if (!dragRef.current) return
      const delta = e.clientX - dragRef.current.startX
      const newWidth = Math.min(FILE_SIDEBAR_MAX, Math.max(FILE_SIDEBAR_MIN, dragRef.current.startWidth + delta))
      setSidebarWidth(newWidth)
    }
    function onMouseUp() {
      setIsDragging(false)
      dragRef.current = null
    }
    document.addEventListener("mousemove", onMouseMove)
    document.addEventListener("mouseup", onMouseUp)
    return () => {
      document.removeEventListener("mousemove", onMouseMove)
      document.removeEventListener("mouseup", onMouseUp)
    }
  }, [isDragging])

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: file tree sidebar */}
      <div
        className="flex shrink-0 flex-col border-r border-border/30"
        style={{ width: sidebarWidth }}
      >
        {/* File sidebar header */}
        <div className="flex h-7 shrink-0 items-center justify-between border-b border-border/30 px-2">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
            Files
          </span>
          <div className="flex items-center gap-0">
            <IconBtn icon={VscNewFile} label="New file" onClick={() => {}} />
            <IconBtn icon={VscNewFolder} label="New folder" onClick={() => {}} />
            <IconBtn icon={VscCollapseAll} label="Collapse all" onClick={() => setCollapsedAll((c) => c + 1)} />
          </div>
        </div>

        {/* Tree */}
        <div className="flex-1 overflow-y-auto py-0.5">
          {MOCK_TREE.map((node) => (
            <TreeNode
              key={node.id}
              node={node}
              depth={0}
              selectedId={selectedId}
              onSelect={setSelectedId}
              collapsedAll={collapsedAll}
            />
          ))}
        </div>
      </div>

      {/* Resize handle */}
      <div
        onMouseDown={handleDragStart}
        className="w-[3px] shrink-0 cursor-col-resize bg-transparent hover:bg-ring/30 transition-colors"
      />

      {/* Right: preview pane */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {selectedNode ? (
          <FilePreviewPane fileId={selectedId!} fileName={selectedNode.name} />
        ) : (
          <EmptyPreview />
        )}
      </div>

      {/* Prevent text selection while dragging */}
      {isDragging && <div className="fixed inset-0 z-50 cursor-col-resize" />}
    </div>
  )
}
