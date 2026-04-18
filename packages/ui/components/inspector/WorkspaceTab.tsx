"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { FilePreview } from "./FilePreview"
import {
  VscFolder,
  VscFolderOpened,
  VscFile,
  VscJson,
  VscMarkdown,
  VscCode,
  VscChevronRight,
  VscChevronDown,
} from "react-icons/vsc"

/* ── Mock file tree ── */

interface FileNode {
  id: string
  name: string
  type: "file" | "dir"
  children?: FileNode[]
}

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

/* ── File icon by extension ── */

function FileIcon({ name }: { name: string }) {
  const ext = name.split(".").pop()?.toLowerCase()
  if (ext === "md") return <VscMarkdown className="size-4 shrink-0 text-blue-400/80" />
  if (ext === "json") return <VscJson className="size-4 shrink-0 text-amber-400/80" />
  if (["ts", "tsx", "js", "jsx"].includes(ext ?? ""))
    return <VscCode className="size-4 shrink-0 text-sky-400/80" />
  return <VscFile className="size-4 shrink-0 text-muted-foreground/60" />
}

/* ── Tree node ── */

function TreeNode({
  node,
  depth,
  selectedId,
  onSelect,
}: {
  node: FileNode
  depth: number
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const [open, setOpen] = useState(depth === 0)
  const isDir = node.type === "dir"
  const isSelected = selectedId === node.id

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          if (isDir) setOpen((p) => !p)
          else onSelect(node.id)
        }}
        style={{ paddingLeft: `${16 + depth * 16}px` }}
        className={cn(
          "flex w-full items-center gap-2 py-[5px] pr-4 text-left transition-colors",
          isSelected && !isDir
            ? "bg-secondary/60 text-foreground"
            : "text-foreground/80 hover:bg-secondary/30",
        )}
      >
        {isDir ? (
          <>
            <span className="flex size-4 items-center justify-center text-muted-foreground/60">
              {open ? <VscChevronDown className="size-3" /> : <VscChevronRight className="size-3" />}
            </span>
            {open ? (
              <VscFolderOpened className="size-4 shrink-0 text-amber-400/70" />
            ) : (
              <VscFolder className="size-4 shrink-0 text-amber-400/70" />
            )}
          </>
        ) : (
          <>
            <span className="size-4 shrink-0" />
            <FileIcon name={node.name} />
          </>
        )}
        <span className="truncate text-[12px]">{node.name}</span>
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
            />
          ))}
        </div>
      )}
    </div>
  )
}

/* ── Find node by id ── */

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

/* ── Workspace tab ── */

export function WorkspaceTab() {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [previewFileId, setPreviewFileId] = useState<string | null>(null)

  const previewNode = previewFileId ? findNode(MOCK_TREE, previewFileId) : null

  function handleSelect(id: string) {
    setSelectedId(id)
    setPreviewFileId(id)
  }

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5">
        <span className="text-[11px] font-medium text-muted-foreground">Files</span>
        <span className="rounded-md bg-secondary/40 px-2 py-0.5 text-[10px] tabular-nums text-muted-foreground">
          8 files
        </span>
      </div>

      <div className="h-px bg-border/30" />

      <div className="flex-1 overflow-y-auto py-1">
        {MOCK_TREE.map((node) => (
          <TreeNode
            key={node.id}
            node={node}
            depth={0}
            selectedId={selectedId}
            onSelect={handleSelect}
          />
        ))}
      </div>

      {/* File preview overlay */}
      {previewFileId && previewNode && (
        <FilePreview
          fileId={previewFileId}
          fileName={previewNode.name}
          onBack={() => setPreviewFileId(null)}
        />
      )}
    </div>
  )
}
