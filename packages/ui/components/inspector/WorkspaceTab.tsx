"use client"

import { useState, useRef, useCallback, useEffect, useMemo } from "react"
import { on } from "@/lib/events"
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
  VscCheck,
  VscClose,
  VscOpenPreview,
  VscRefresh,
} from "react-icons/vsc"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  PencilEdit02Icon,
  Delete02Icon,
  Download02Icon,
  FloppyDiskIcon,
  Tick02Icon,
  MoreVerticalIcon,
} from "@hugeicons/core-free-icons"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter"
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism"
import { invoke, streamUrl } from "@/lib/ipc"
import {
  createRemoteWorkspaceDirectory,
  deleteRemoteWorkspaceEntry,
  fetchRemoteWorkspaceCapabilities,
  fetchRemoteWorkspaceFile,
  type RemoteWorkspaceCapabilities,
  fetchRemoteWorkspaceTree,
  moveRemoteWorkspaceEntry,
  remoteWorkspaceDownloadUrl,
  saveRemoteWorkspaceFile,
} from "./workspace-api"
import { GLASS_POPOVER } from "@/constants/glassPopover"
import { MenuAction } from "@/components/sidebar/ProjectsSection/MenuAction"

/* ── Types ── */

interface FsEntry {
  name: string
  path: string
  type?: "file" | "directory"
  isFile?: boolean
  isDir?: boolean
  size: number
  modifiedAt?: string
}

interface FileNode {
  id: string
  name: string
  type: "file" | "dir"
  children?: FileNode[]
  loaded?: boolean
}

function mapRemoteEntriesToNodes(entries: FsEntry[]): FileNode[] {
  return entries
    .sort((a, b) => {
      const aDir = a.type === "directory" || a.type === ("dir" as any) || a.isDir === true
      const bDir = b.type === "directory" || b.type === ("dir" as any) || b.isDir === true
      if (aDir !== bDir) return aDir ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    .map((entry) => {
      const isDir = entry.type === "directory" || entry.type === ("dir" as any) || entry.isDir === true
      return {
        id: entry.path,
        name: entry.name,
        type: isDir ? "dir" as const : "file" as const,
        children: isDir ? [] : undefined,
        loaded: !isDir,
      }
    })
}

/* ── Helpers ── */

function getExt(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? ""
}

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

function isReadOnlyWorkspacePath(pathValue: string): boolean {
  return pathValue.startsWith("~/")
}

function workspaceDirname(pathValue: string): string {
  const normalized = pathValue.replace(/\/+$/, "")
  if (!normalized || !normalized.includes("/")) return ""
  return normalized.slice(0, normalized.lastIndexOf("/"))
}

function joinWorkspacePath(parentPath: string, name: string): string {
  const normalizedName = name.trim().replace(/^\/+/, "").replace(/\/+$/, "")
  if (!parentPath) return normalizedName
  return `${parentPath}/${normalizedName}`
}

let globalWorkspaceSessionKeyCache: string | null = null


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
  onExpand,
  expandedIds,
  onToggleExpand,
}: {
  node: FileNode
  depth: number
  selectedId: string | null
  onSelect: (id: string) => void
  onExpand: (id: string) => void
  expandedIds: Set<string>
  onToggleExpand: (id: string, open: boolean) => void
}) {
  const isDir = node.type === "dir"
  const isSelected = selectedId === node.id
  const open = isDir && expandedIds.has(node.id)

  const handleClick = useCallback(() => {
    if (isDir) {
      const willOpen = !open
      onToggleExpand(node.id, willOpen)
      if (willOpen && !node.loaded) onExpand(node.id)
    } else {
      onSelect(node.id)
    }
  }, [isDir, open, node.loaded, node.id, onExpand, onSelect, onToggleExpand])

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
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
          {!node.loaded ? (
            <div className="space-y-1 py-1" style={{ paddingLeft: `${26 + depth * 14}px` }}>
              <div className="h-3 w-3/4 animate-pulse rounded bg-secondary/60" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-secondary/40" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-secondary/30" />
            </div>
          ) : node.children.length === 0 ? (
            <div className="py-px" style={{ paddingLeft: `${26 + depth * 14}px` }}>
              <span className="text-[10px] text-muted-foreground/40 italic">empty</span>
            </div>
          ) : (
            node.children.map((child) => (
              <TreeNode
                key={child.id}
                node={child}
                depth={depth + 1}
                selectedId={selectedId}
                onSelect={onSelect}
                onExpand={onExpand}
                expandedIds={expandedIds}
                onToggleExpand={onToggleExpand}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}

/* ── Code editor with line numbers ── */

function CodeEditor({
  content,
  onChange,
  ext,
  readOnly,
}: {
  content: string
  onChange: (v: string) => void
  ext: string
  readOnly?: boolean
}) {
  const extToLang: Record<string, string> = {
    json: "json",
    md: "markdown",
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    py: "python",
    rs: "rust",
    go: "go",
    html: "html",
    htm: "html",
    css: "css",
    scss: "scss",
    sass: "sass",
    less: "less",
    xml: "xml",
    svg: "xml",
    yaml: "yaml",
    yml: "yaml",
    toml: "toml",
    sql: "sql",
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    ps1: "powershell",
    bat: "batch",
    cmd: "batch",
    rb: "ruby",
    java: "java",
    kt: "kotlin",
    kts: "kotlin",
    swift: "swift",
    c: "c",
    h: "c",
    cpp: "cpp",
    cxx: "cpp",
    hpp: "cpp",
    cs: "csharp",
    php: "php",
    lua: "lua",
    r: "r",
    dart: "dart",
    graphql: "graphql",
    gql: "graphql",
    dockerfile: "docker",
    makefile: "makefile",
    ini: "ini",
    env: "bash",
    conf: "ini",
    cfg: "ini",
    txt: "text",
  }
  const language = extToLang[ext] ?? "text"

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const highlightRef = useRef<HTMLDivElement>(null)
  const lineNumRef = useRef<HTMLDivElement>(null)
  const lineCount = content.split("\n").length

  const syncScroll = useCallback(() => {
    if (!textareaRef.current) return
    const { scrollTop, scrollLeft } = textareaRef.current
    if (highlightRef.current) {
      highlightRef.current.scrollTop = scrollTop
      highlightRef.current.scrollLeft = scrollLeft
    }
    if (lineNumRef.current) {
      lineNumRef.current.scrollTop = scrollTop
    }
  }, [])

  const monoFont =
    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
  const codePad = "12px"
  const gutterWidth = "48px"

  return (
    <div className="relative h-full overflow-hidden bg-[#121212]">
      {/* Line number gutter */}
      <div
        ref={lineNumRef}
        className="absolute bottom-0 left-0 top-0 z-20 select-none overflow-hidden border-r border-[#333333] bg-[#121212]"
        style={{ width: gutterWidth }}
      >
        <div style={{ paddingTop: codePad, paddingBottom: codePad }}>
          {Array.from({ length: lineCount }, (_, i) => (
            <div
              key={i}
              style={{
                fontFamily: monoFont,
                fontSize: "11px",
                lineHeight: "20px",
                paddingRight: "12px",
                textAlign: "right",
                color: "rgba(138, 138, 138, 1)",
              }}
            >
              {i + 1}
            </div>
          ))}
        </div>
      </div>

      {/* Syntax-highlighted layer (visible, not interactive) */}
      <div
        ref={highlightRef}
        className="pointer-events-none absolute inset-0 overflow-hidden"
        style={{ paddingLeft: gutterWidth }}
      >
        <div className="min-w-max">
          <SyntaxHighlighter
            language={language}
            style={vscDarkPlus}
            showLineNumbers={false}
            wrapLines={false}
            wrapLongLines={false}
            customStyle={{
              margin: 0,
              background: "transparent",
              fontSize: "11px",
              lineHeight: "20px",
              padding: `${codePad} ${codePad} ${codePad} ${codePad}`,
              overflow: "visible",
            }}
            codeTagProps={{
              style: { fontFamily: monoFont },
            }}
          >
            {content}
          </SyntaxHighlighter>
        </div>
      </div>

      {/* Transparent textarea (editable, on top) */}
      <textarea
        ref={textareaRef}
        value={content}
        onChange={(e) => onChange(e.target.value)}
        onScroll={syncScroll}
        spellCheck={false}
        readOnly={readOnly}
        className="absolute inset-0 z-10 size-full resize-none border-none bg-transparent text-transparent caret-[#aeafad] outline-none"
        style={{
          fontFamily: monoFont,
          fontSize: "11px",
          lineHeight: "20px",
          tabSize: 2,
          padding: codePad,
          paddingLeft: `calc(${gutterWidth} + ${codePad})`,
          whiteSpace: "pre",
          overflowWrap: "normal",
          wordBreak: "keep-all",
        }}
      />
    </div>
  )
}

/* ── File preview pane ── */

function FilePreviewPane({
  capabilities,
  sessionKey,
  filePath,
  fileName,
  compact,
  onDelete,
  onPathChange,
}: {
  capabilities: RemoteWorkspaceCapabilities | null
  sessionKey?: string | null
  filePath: string
  fileName: string
  compact: boolean
  onDelete?: () => void
  onPathChange?: (nextPath: string) => void
}) {
  const ext = getExt(fileName)
  const isMd = ext === "md"
  const readOnlyPath = isReadOnlyWorkspacePath(filePath)
  const canWrite = Boolean(capabilities?.canWrite) && !readOnlyPath
  const canDownload = Boolean(capabilities?.canDownloadFile)
  const canMove = Boolean(capabilities?.canMoveEntry) && !readOnlyPath
  const canDelete = Boolean(capabilities?.canDeleteEntry) && !readOnlyPath

  const [content, setContent] = useState("")
  const [originalContent, setOriginalContent] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(fileName)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [mode, setMode] = useState<"preview" | "edit">(isMd ? "preview" : "edit")
  const [menuOpen, setMenuOpen] = useState(false)

  const hasChanges = useMemo(() => content !== originalContent, [content, originalContent])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setIsRenaming(false)
    setRenameValue(fileName)
    setSaved(false)
    setMode(getExt(fileName) === "md" ? "preview" : "edit")

    const loadContent = fetchRemoteWorkspaceFile({
      sessionKey: sessionKey ?? "",
      path: filePath,
    }).then((file) => file.content)

    loadContent
      .then((text) => {
        if (cancelled) return
        setContent(text)
        setOriginalContent(text)
        if (!text.trim() && getExt(fileName) === "md") setMode("edit")
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : "Failed to load file")
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [filePath, fileName, sessionKey])

  const handleSave = useCallback(async () => {
    if (!canWrite) return
    setSaving(true)
    try {
      await saveRemoteWorkspaceFile({
        sessionKey: sessionKey ?? "",
        path: filePath,
        content,
      })
      setOriginalContent(content)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed")
    } finally {
      setSaving(false)
    }
  }, [canWrite, content, filePath, sessionKey])
  const [downloaded, setDownloaded] = useState(false)

  const handleDownload = useCallback(() => {
    const url = sessionKey
      ? remoteWorkspaceDownloadUrl(sessionKey, filePath)
      : URL.createObjectURL(new Blob([content], { type: "text/plain" }))
    const a = document.createElement("a")
    a.href = url
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    if (!sessionKey) {
      URL.revokeObjectURL(url)
    }
    setDownloaded(true)
    window.setTimeout(() => setDownloaded(false), 2000)
  }, [content, fileName, filePath, sessionKey])

  const handleRename = useCallback(async () => {
    if (!canMove) return

    const trimmed = renameValue.trim()
    if (!trimmed || trimmed === fileName) {
      setIsRenaming(false)
      return
    }

    try {
      const nextPath = joinWorkspacePath(workspaceDirname(filePath), trimmed)
      await moveRemoteWorkspaceEntry({
        sessionKey: sessionKey ?? "",
        fromPath: filePath,
        toPath: nextPath,
      })
      setIsRenaming(false)
      onPathChange?.(nextPath)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rename failed")
    }
  }, [canMove, fileName, filePath, onPathChange, renameValue, sessionKey])

  const handleDelete = useCallback(async () => {
    if (!canDelete) return

    try {
      await deleteRemoteWorkspaceEntry({
        sessionKey: sessionKey ?? "",
        path: filePath,
      })
      onDelete?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed")
    }
  }, [canDelete, filePath, onDelete, sessionKey])

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-foreground/50" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
        <p className="text-[12px] text-red-400">{error}</p>
        <button
          type="button"
          onClick={() => setError(null)}
          className="text-[11px] text-muted-foreground underline"
        >
          Dismiss
        </button>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* Preview header */}
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border/40 px-2">
        {isRenaming ? (
          <div className="flex min-w-0 items-center gap-1">
            <input
              type="text"
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void handleRename()
                }
                if (event.key === "Escape") {
                  setRenameValue(fileName)
                  setIsRenaming(false)
                }
              }}
              size={Math.max(4, renameValue.length + 1)}
              className="h-5 w-fit min-w-16 rounded border border-border bg-background px-1.5 text-[11px] text-foreground outline-none"
              autoFocus
            />
            <div className="flex shrink-0 items-center">
              <IconBtn icon={VscCheck} label="Confirm" onClick={() => void handleRename()} />
              <IconBtn
                icon={VscClose}
                label="Cancel"
                onClick={() => {
                  setRenameValue(fileName)
                  setIsRenaming(false)
                }}
              />
            </div>
          </div>
        ) : (
          <span className="min-w-0 shrink truncate text-[11px] font-medium text-foreground">
            {fileName}
          </span>
        )}
        {readOnlyPath && (
          <span className="rounded bg-white/6 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground/70">
            Read only
          </span>
        )}

        <div className="min-w-0 flex-1" />

        {isMd && (
          <>
            <IconBtn icon={VscOpenPreview} label="Preview" onClick={() => setMode("preview")} active={mode === "preview"} />
            <IconBtn icon={VscCode} label="Edit" onClick={() => setMode("edit")} active={mode === "edit"} />
            <div className="mx-0.5 h-3.5 w-px bg-border/40" />
          </>
        )}

        {!compact && (
          <div className="flex shrink-0 items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => {
                    if (!canMove) return
                    setRenameValue(fileName)
                    setIsRenaming(true)
                  }}
                  disabled={!canMove}
                  className={cn(
                    "flex size-7 cursor-pointer items-center justify-center rounded-md transition-colors",
                    canMove
                      ? "text-muted-foreground hover:bg-white/8 hover:text-foreground"
                      : "cursor-default text-muted-foreground/30",
                  )}
                >
                  <HugeiconsIcon icon={PencilEdit02Icon} size={14} strokeWidth={1.5} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                Rename
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handleDownload}
                  className={cn(
                    "flex size-7 cursor-pointer items-center justify-center rounded-md transition-colors",
                    !canDownload
                      ? "cursor-default text-muted-foreground/30"
                      : downloaded
                      ? "text-emerald-400"
                      : "text-muted-foreground hover:bg-white/8 hover:text-foreground",
                  )}
                  disabled={!canDownload}
                >
                  <HugeiconsIcon icon={downloaded ? Tick02Icon : Download02Icon} size={14} strokeWidth={1.5} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                {downloaded ? "Downloaded" : "Download"}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => void handleDelete()}
                  disabled={!canDelete}
                  className={cn(
                    "flex size-7 cursor-pointer items-center justify-center rounded-md transition-colors",
                    canDelete
                      ? "text-muted-foreground hover:bg-red-500/10 hover:text-red-400"
                      : "cursor-default text-muted-foreground/30",
                  )}
                >
                  <HugeiconsIcon icon={Delete02Icon} size={14} strokeWidth={1.5} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                Delete
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={!canWrite || (!hasChanges && !saved) || saving}
                  className={cn(
                    "flex size-7 cursor-pointer items-center justify-center rounded-md transition-colors",
                    saved
                      ? "text-emerald-400"
                      : hasChanges
                        ? "text-foreground hover:bg-white/8"
                        : "cursor-default text-muted-foreground/40",
                  )}
                >
                  <HugeiconsIcon icon={saved ? Tick02Icon : FloppyDiskIcon} size={14} strokeWidth={1.5} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                {saving ? "Saving..." : saved ? "Saved" : "Save"}
              </TooltipContent>
            </Tooltip>
          </div>
        )}

        {compact && (
          <Popover open={menuOpen} onOpenChange={setMenuOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={cn(
                  "flex size-6 shrink-0 cursor-pointer items-center justify-center rounded transition-all duration-100",
                  menuOpen
                    ? "text-foreground/80 opacity-100"
                    : "text-foreground/60 hover:text-foreground",
                )}
              >
                <HugeiconsIcon icon={MoreVerticalIcon} size={14} strokeWidth={1.5} />
              </button>
            </PopoverTrigger>
            <PopoverContent
              side="bottom"
              align="end"
              sideOffset={4}
              className={cn("w-40 gap-0 p-1", GLASS_POPOVER)}
            >
              <MenuAction
                label="Rename"
                icon={<HugeiconsIcon icon={PencilEdit02Icon} size={14} strokeWidth={1.5} />}
                onClick={() => {
                  setMenuOpen(false)
                  if (!canMove) return
                  setRenameValue(fileName)
                  setIsRenaming(true)
                }}
              />
              <MenuAction
                label={downloaded ? "Downloaded" : "Download"}
                icon={<HugeiconsIcon icon={downloaded ? Tick02Icon : Download02Icon} size={14} strokeWidth={1.5} />}
                onClick={() => { setMenuOpen(false); handleDownload() }}
              />
              <MenuAction
                label={saving ? "Saving..." : saved ? "Saved" : "Save"}
                icon={<HugeiconsIcon icon={saved ? Tick02Icon : FloppyDiskIcon} size={14} strokeWidth={1.5} />}
                onClick={() => {
                  if (!canWrite || saving) return
                  void handleSave()
                }}
              />
              <div className="my-0.5 h-px bg-border/20" />
              <MenuAction
                label="Delete"
                icon={<HugeiconsIcon icon={Delete02Icon} size={14} strokeWidth={1.5} />}
                onClick={() => {
                  setMenuOpen(false)
                  void handleDelete()
                }}
                danger
              />
            </PopoverContent>
          </Popover>
        )}

      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {isMd && mode === "preview" ? (
          <div className={cn(
            "prose prose-invert h-full max-w-none overflow-auto bg-[#121212] p-4 text-[13px] leading-7 text-foreground/90",
            "[&>*+*]:mt-3",
            "[&_h1]:mb-2 [&_h1]:mt-5 [&_h1]:border-b [&_h1]:border-foreground/10 [&_h1]:pb-2 [&_h1]:text-lg [&_h1]:font-bold [&_h1]:text-foreground [&_h1]:first:mt-0",
            "[&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-[15px] [&_h2]:font-semibold [&_h2]:text-foreground",
            "[&_h3]:mb-1 [&_h3]:mt-3 [&_h3]:text-[13px] [&_h3]:font-semibold [&_h3]:text-foreground",
            "[&_h4]:mb-1 [&_h4]:mt-2 [&_h4]:text-[12px] [&_h4]:font-semibold [&_h4]:text-foreground/90",
            "[&_p]:my-1.5 [&_p]:text-foreground/85",
            "[&_strong]:font-semibold [&_strong]:text-foreground",
            "[&_em]:italic [&_em]:text-foreground/90",
            "[&_a]:text-blue-400 [&_a]:underline [&_a]:underline-offset-2",
            "[&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5",
            "[&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5",
            "[&_li]:my-0.5 [&_li]:text-foreground/85 [&_li]:leading-6",
            "[&_li_p]:my-0",
            "[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-foreground/20 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-foreground/60",
            "[&_code]:rounded [&_code]:bg-white/8 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-[11px] [&_code]:text-[#e06c75]",
            "[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-white/5 [&_pre]:bg-black/40 [&_pre]:p-3",
            "[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-[11px] [&_pre_code]:leading-5 [&_pre_code]:text-foreground/80",
            "[&_hr]:my-4 [&_hr]:border-foreground/10",
            "[&_table]:my-2 [&_table]:w-full [&_table]:text-[12px]",
            "[&_th]:border [&_th]:border-foreground/10 [&_th]:bg-white/5 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-semibold",
            "[&_td]:border [&_td]:border-foreground/10 [&_td]:px-2 [&_td]:py-1",
          )}>
            <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
          </div>
        ) : (
          <CodeEditor
            content={content}
            onChange={setContent}
            ext={ext}
            readOnly={readOnlyPath}
          />
        )}
      </div>
    </div>
  )
}

/* ── Workspace tab (split pane) ── */

const FILE_SIDEBAR_MIN = 140
const FILE_SIDEBAR_MAX = 260
const FILE_SIDEBAR_DEFAULT = 180

function getFileSidebarDefaults() {
  if (typeof window === "undefined") {
    return {
      min: FILE_SIDEBAR_MIN,
      max: FILE_SIDEBAR_MAX,
      default: FILE_SIDEBAR_DEFAULT,
    }
  }

  if (window.innerWidth < 768) {
    return { min: 108, max: 168, default: 128 }
  }

  return {
    min: FILE_SIDEBAR_MIN,
    max: FILE_SIDEBAR_MAX,
    default: FILE_SIDEBAR_DEFAULT,
  }
}

export function WorkspaceTab({
  sessionKey,
}: {
  sessionKey?: string | null
}) {
  const [workspaceSessionKey, setWorkspaceSessionKey] = useState<string | null>(
    globalWorkspaceSessionKeyCache ?? sessionKey ?? null,
  )
  const fileSidebarRef = useRef(getFileSidebarDefaults())
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null)
  const [tree, setTree] = useState<FileNode[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [sidebarWidth, setSidebarWidth] = useState(fileSidebarRef.current.default)
  const [isDragging, setIsDragging] = useState(false)
  const [treeLoading, setTreeLoading] = useState(true)
  const [treeError, setTreeError] = useState<string | null>(null)
  const [capabilities, setCapabilities] =
    useState<RemoteWorkspaceCapabilities | null>(null)
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const [newItemType, setNewItemType] = useState<"file" | "folder" | null>(null)
  const [newItemName, setNewItemName] = useState("")
  const previewPaneRef = useRef<HTMLDivElement>(null)
  const [previewCompact, setPreviewCompact] = useState(false)
  const refreshTimeoutRef = useRef<number | null>(null)
  const effectiveSessionKey = workspaceSessionKey ?? sessionKey ?? null

  useEffect(() => {
    if (workspaceSessionKey) return
    if (sessionKey) {
      globalWorkspaceSessionKeyCache = sessionKey
      setWorkspaceSessionKey(sessionKey)
      return
    }

    let gwActive = false
    try {
      gwActive =
        localStorage.getItem("jarvis.gatewayActive") === "true"
    } catch {}
    if (!gwActive) return

    let cancelled = false
    void invoke<{
      sessions: Array<{ key: string; hidden?: boolean; source?: string }>
    }>("middleware_sessions_list", { input: {} })
      .then((result) => {
        if (cancelled) return
        const fallback =
          result.sessions.find((item) => !item.hidden && item.source === "jarvis")?.key ??
          result.sessions.find((item) => !item.hidden)?.key ??
          null
        if (!fallback) return
        globalWorkspaceSessionKeyCache = fallback
        setWorkspaceSessionKey(fallback)
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [sessionKey, workspaceSessionKey])

  useEffect(() => {
    const el = previewPaneRef.current
    if (!el) return
    const obs = new ResizeObserver(() => {
      setPreviewCompact(el.offsetWidth < 280)
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  useEffect(() => {
    function onResize() {
      const next = getFileSidebarDefaults()
      fileSidebarRef.current = next
      setSidebarWidth((prev) =>
        Math.min(next.max, Math.max(next.min, prev)),
      )
    }

    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  const expandedIdsRef = useRef(expandedIds)
  expandedIdsRef.current = expandedIds

  const loadRoot = useCallback(async (root: string, silent = false) => {
    if (!effectiveSessionKey) return
    const activeSessionKey = effectiveSessionKey
    if (!silent) setTreeLoading(true)
    setTreeError(null)
    try {
      const rootNodes = mapRemoteEntriesToNodes(
        (
          await fetchRemoteWorkspaceTree({
            sessionKey: activeSessionKey,
            path: root,
          })
        ).entries,
      )
      const snapshot = expandedIdsRef.current
      async function reloadExpanded(nodes: FileNode[]): Promise<FileNode[]> {
        return Promise.all(
          nodes.map(async (node) => {
            if (node.type === "dir" && snapshot.has(node.id)) {
              try {
                const children = mapRemoteEntriesToNodes(
                  (
                    await fetchRemoteWorkspaceTree({
                      sessionKey: activeSessionKey,
                      path: node.id,
                    })
                  ).entries,
                )
                const deep = await reloadExpanded(children)
                return { ...node, children: deep, loaded: true }
              } catch {
                return { ...node, children: [], loaded: true }
              }
            }
            return node
          }),
        )
      }
      const fullTree = await reloadExpanded(rootNodes)
      setTree(fullTree)
    } catch (err) {
      setTreeError(err instanceof Error ? err.message : "Failed to load workspace")
    } finally {
      if (!silent) setTreeLoading(false)
    }
  }, [effectiveSessionKey])

  const scheduleRefresh = useCallback((delayMs = 900) => {
    if (refreshTimeoutRef.current !== null) {
      window.clearTimeout(refreshTimeoutRef.current)
    }
    refreshTimeoutRef.current = window.setTimeout(() => {
      if (workspaceRoot !== null) {
        void loadRoot(workspaceRoot, true)
      }
      refreshTimeoutRef.current = null
    }, delayMs)
  }, [loadRoot, workspaceRoot])

  useEffect(() => {
    if (!effectiveSessionKey) {
      setCapabilities(null)
      setWorkspaceRoot(null)
      setTree([])
      setSelectedId(null)
      setTreeError(null)
      setTreeLoading(false)
      return
    }

    setWorkspaceRoot("")
    void fetchRemoteWorkspaceCapabilities(effectiveSessionKey)
      .then((result) => setCapabilities(result.capabilities))
      .catch(() => setCapabilities(null))
    void loadRoot("")
  }, [effectiveSessionKey, loadRoot])

  useEffect(() => {
    return () => {
      if (refreshTimeoutRef.current !== null) {
        window.clearTimeout(refreshTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    return on("sidebar:refresh", () => {
      let gwActive = false
      try {
        gwActive =
          localStorage.getItem("jarvis.gatewayActive") === "true"
      } catch {}

      if (!gwActive) {
        globalWorkspaceSessionKeyCache = null
        setWorkspaceSessionKey(null)
        setTree([])
        setSelectedId(null)
        setCapabilities(null)
        setWorkspaceRoot(null)
        return
      }

      void invoke<{
        sessions: Array<{
          key: string
          hidden?: boolean
          source?: string
        }>
      }>("middleware_sessions_list", { input: {} })
        .then((result) => {
          const key =
            result.sessions.find(
              (item) =>
                !item.hidden && item.source === "jarvis",
            )?.key ??
            result.sessions.find((item) => !item.hidden)
              ?.key ??
            null
          if (key) {
            globalWorkspaceSessionKeyCache = key
            setWorkspaceSessionKey(key)
          }
        })
        .catch(() => {})
    })
  }, [])

  useEffect(() => {
    if (workspaceRoot === null || !effectiveSessionKey) return

    const handleFocus = () => {
      if (document.visibilityState === "visible") {
        void loadRoot(workspaceRoot, true)
      }
    }

    window.addEventListener("focus", handleFocus)
    return () => {
      window.removeEventListener("focus", handleFocus)
    }
  }, [effectiveSessionKey, loadRoot, workspaceRoot])

  useEffect(() => {
    if (!effectiveSessionKey) return

    const source = new EventSource(
      streamUrl(`/api/stream/chat/${encodeURIComponent(effectiveSessionKey)}`),
    )

    const handleChatEvent = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data) as {
          type?: string
          phase?: string
          state?: string
        }

        if (payload.type === "chat.tool") {
          scheduleRefresh(payload.phase === "start" ? 1800 : 900)
          return
        }

        if (payload.type === "chat.status") {
          if (
            payload.state === "tool_running" ||
            payload.state === "done" ||
            payload.state === "error"
          ) {
            scheduleRefresh(payload.state === "tool_running" ? 1800 : 900)
          }
        }
      } catch {}
    }

    source.addEventListener("chat.tool", handleChatEvent)
    source.addEventListener("chat.status", handleChatEvent)

    return () => {
      source.removeEventListener("chat.tool", handleChatEvent)
      source.removeEventListener("chat.status", handleChatEvent)
      source.close()
    }
  }, [effectiveSessionKey, loadRoot, scheduleRefresh])

  const handleExpand = useCallback(async (nodeId: string) => {
    if (!effectiveSessionKey) return
    const activeSessionKey = effectiveSessionKey
    try {
      const children = mapRemoteEntriesToNodes(
        (
          await fetchRemoteWorkspaceTree({
            sessionKey: activeSessionKey,
            path: nodeId,
          })
        ).entries,
      )
      setTree((prev) => updateNodeChildren(prev, nodeId, children))
    } catch {
      setTree((prev) => updateNodeChildren(prev, nodeId, []))
    }
  }, [effectiveSessionKey])

  const handleToggleExpand = useCallback((id: string, open: boolean) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (open) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  const selectedNode = useMemo(() => {
    if (!selectedId) return null
    return findNode(tree, selectedId)
  }, [tree, selectedId])

  const selectedDirectoryPath = useMemo(() => {
    if (!selectedNode) return ""
    return selectedNode.type === "dir"
      ? selectedNode.id
      : workspaceDirname(selectedNode.id)
  }, [selectedNode])

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
      const { min, max } = fileSidebarRef.current
      const newWidth = Math.min(max, Math.max(min, dragRef.current.startWidth + delta))
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

  const handleNewItem = useCallback(async () => {
    if (!effectiveSessionKey || !newItemName.trim() || workspaceRoot === null) return
    try {
      const targetPath = joinWorkspacePath(selectedDirectoryPath, newItemName)
      if (newItemType === "folder") {
        await createRemoteWorkspaceDirectory({
          sessionKey: effectiveSessionKey,
          path: targetPath,
        })
      } else {
        await saveRemoteWorkspaceFile({
          sessionKey: effectiveSessionKey,
          path: targetPath,
          content: "",
        })
        setSelectedId(targetPath)
      }
      setNewItemType(null)
      setNewItemName("")
      void loadRoot(workspaceRoot, true)
    } catch (err) {
      setTreeError(err instanceof Error ? err.message : "Failed to create item")
    }
  }, [
    effectiveSessionKey,
    loadRoot,
    newItemName,
    newItemType,
    selectedDirectoryPath,
    workspaceRoot,
  ])

  const handleFileDeleted = useCallback(() => {
    setSelectedId(null)
    if (workspaceRoot !== null) {
      void loadRoot(workspaceRoot, true)
    }
  }, [loadRoot, workspaceRoot])

  const handlePathChange = useCallback((nextPath: string) => {
    setSelectedId(nextPath)
    if (workspaceRoot !== null) {
      void loadRoot(workspaceRoot, true)
    }
  }, [loadRoot, workspaceRoot])

  return (
    <div className="relative flex h-full overflow-hidden">
      {/* New item dialog — centered at top of full workspace */}
      {newItemType && (
        <div
          className="absolute inset-0 z-40 flex items-center justify-center bg-black/30 backdrop-blur-[2px]"
          onClick={() => setNewItemType(null)}
        >
          <div
            className="w-60 rounded-xl border border-white/10 shadow-2xl backdrop-blur-xl"
            style={{ background: "rgba(30, 30, 30, 0.8)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 px-4 pt-4 pb-3">
              {newItemType === "folder" ? (
                <VscNewFolder className="size-4 shrink-0 text-amber-400/80" />
              ) : (
                <VscNewFile className="size-4 shrink-0 text-blue-400/80" />
              )}
              <span className="text-[12px] font-medium text-foreground">
                New {newItemType}
              </span>
            </div>
            <div className="px-4">
              <input
                type="text"
                value={newItemName}
                onChange={(e) => setNewItemName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleNewItem()
                  if (e.key === "Escape") setNewItemType(null)
                }}
                placeholder={
                  newItemType === "folder"
                    ? "Enter folder name..."
                    : "Enter file name..."
                }
                className="h-8 w-full rounded-lg border-none bg-white/5 px-3 text-[12px] text-foreground placeholder-muted-foreground/40 outline-none transition-colors focus:bg-white/8"
                autoFocus
              />
            </div>
            <div className="flex items-center justify-end gap-2 px-4 pt-4 pb-4">
              <button
                type="button"
                onClick={() => setNewItemType(null)}
                className="h-7 cursor-pointer rounded-lg bg-white/10 px-4 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-white/15 hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleNewItem}
                disabled={!newItemName.trim()}
                className="h-7 cursor-pointer rounded-lg bg-white px-4 text-[11px] font-medium text-black transition-colors hover:bg-white/90 disabled:cursor-default disabled:bg-white/50"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Left: file tree sidebar */}
      <div 
        className="flex shrink-0 flex-col transition-[width] duration-200" 
        style={{ width: selectedNode && selectedNode.type === "file" ? sidebarWidth : "100%" }}
      >
        {/* File sidebar header */}
        <div className="flex h-7 shrink-0 items-center justify-between border-b border-border/30 px-2">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
            Files
          </span>
          <div className="flex items-center gap-0">
            <IconBtn
              icon={VscNewFile}
              label="New file"
              disabled={!effectiveSessionKey || !capabilities?.canWrite}
              onClick={() => {
                setNewItemType("file")
                setNewItemName("")
              }}
            />
            <IconBtn
              icon={VscNewFolder}
              label="New folder"
              disabled={!effectiveSessionKey || !capabilities?.canCreateDir}
              onClick={() => {
                setNewItemType("folder")
                setNewItemName("")
              }}
            />
            <IconBtn
              icon={VscRefresh}
              label="Refresh"
              disabled={!effectiveSessionKey}
              onClick={() => {
                if (workspaceRoot !== null && effectiveSessionKey) {
                  void loadRoot(workspaceRoot, true)
                }
              }}
            />
            <IconBtn
              icon={VscCollapseAll}
              label="Collapse all"
              onClick={() => setExpandedIds(new Set())}
            />
          </div>
        </div>

        {/* Tree */}
        <div className="flex-1 overflow-y-auto py-0.5">
          {!effectiveSessionKey ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
              <VscFolder className="size-8 text-muted-foreground/20" />
              <p className="text-[12px] font-medium text-muted-foreground/70">
                Workspace is not available yet
              </p>
              <p className="text-[11px] text-muted-foreground/50">
                Start one OpenClaw session once and Workspace will stay available globally.
              </p>
            </div>
          ) : (
            <>
              {treeLoading ? (
            <div className="space-y-1.5 px-3 py-2">
              <div className="flex items-center gap-2">
                <div className="h-3.5 w-3.5 animate-pulse rounded bg-secondary/50" />
                <div className="h-3 w-24 animate-pulse rounded bg-secondary/60" />
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3.5 w-3.5 animate-pulse rounded bg-secondary/50" />
                <div className="h-3 w-20 animate-pulse rounded bg-secondary/50" />
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3.5 w-3.5 animate-pulse rounded bg-secondary/50" />
                <div className="h-3 w-28 animate-pulse rounded bg-secondary/40" />
              </div>
              <div className="flex items-center gap-2 pl-5">
                <div className="h-3.5 w-3.5 animate-pulse rounded bg-secondary/40" />
                <div className="h-3 w-16 animate-pulse rounded bg-secondary/35" />
              </div>
              <div className="flex items-center gap-2 pl-5">
                <div className="h-3.5 w-3.5 animate-pulse rounded bg-secondary/40" />
                <div className="h-3 w-22 animate-pulse rounded bg-secondary/30" />
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3.5 w-3.5 animate-pulse rounded bg-secondary/50" />
                <div className="h-3 w-18 animate-pulse rounded bg-secondary/40" />
              </div>
            </div>
              ) : treeError ? (
            <div className="px-3 py-4 text-center">
              <p className="text-[11px] text-red-400">{treeError}</p>
              <button
                type="button"
                onClick={() => {
                  if (workspaceRoot !== null && effectiveSessionKey) {
                    void loadRoot(workspaceRoot, true)
                  }
                }}
                className="mt-2 text-[11px] text-muted-foreground underline"
              >
                Retry
              </button>
            </div>
              ) : tree.length === 0 ? (
            <div className="px-3 py-4 text-center">
              <p className="text-[11px] text-muted-foreground/50 italic">
                Workspace is empty
              </p>
            </div>
              ) : (
            tree.map((node) => (
              <TreeNode
                key={node.id}
                node={node}
                depth={0}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onExpand={handleExpand}
                expandedIds={expandedIds}
                onToggleExpand={handleToggleExpand}
              />
            ))
              )}
            </>
          )}
        </div>
      </div>

      {/* Resize handle */}
      {selectedNode && selectedNode.type === "file" && (
        <div
          onMouseDown={handleDragStart}
          className="w-[3px] shrink-0 cursor-col-resize bg-transparent"
        />
      )}

      {/* Right: preview pane */}
      {selectedNode && selectedNode.type === "file" && (
        <div ref={previewPaneRef} className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <FilePreviewPane
            capabilities={capabilities}
            sessionKey={effectiveSessionKey}
            filePath={selectedId!}
            fileName={selectedNode.name}
            compact={previewCompact}
            onDelete={handleFileDeleted}
            onPathChange={handlePathChange}
          />
        </div>
      )}
      {isDragging && <div className="fixed inset-0 z-50 cursor-col-resize" />}
    </div>
  )
}

/* ── Tree utilities ── */

function updateNodeChildren(
  nodes: FileNode[],
  targetId: string,
  children: FileNode[],
): FileNode[] {
  return nodes.map((node) => {
    if (node.id === targetId) {
      return { ...node, children, loaded: true }
    }
    if (node.children) {
      return {
        ...node,
        children: updateNodeChildren(node.children, targetId, children),
      }
    }
    return node
  })
}
