"use client"

import { useState } from "react"
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
          { id: "s1", name: "camoufox-browser", type: "dir", children: [
            { id: "s1a", name: "SKILL.md", type: "file" },
          ]},
          { id: "s2", name: "agent-brain", type: "dir", children: [
            { id: "s2a", name: "SKILL.md", type: "file" },
          ]},
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

/* ── File icon ── */

function FileIcon({ name }: { name: string }) {
  const ext = name.split(".").pop()?.toLowerCase()
  if (ext === "md") return <VscMarkdown className="size-3.5 shrink-0 text-blue-400" />
  if (ext === "json") return <VscJson className="size-3.5 shrink-0 text-yellow-400" />
  if (["ts", "tsx", "js", "jsx"].includes(ext ?? ""))
    return <VscCode className="size-3.5 shrink-0 text-sky-400" />
  return <VscFile className="size-3.5 shrink-0 text-muted-foreground" />
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
        style={{ paddingLeft: `${8 + depth * 12}px` }}
        className={cn(
          "flex w-full items-center gap-1.5 py-0.5 pr-3 text-left text-[12px] transition-colors",
          isSelected && !isDir
            ? "bg-accent text-accent-foreground"
            : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground",
        )}
      >
        {isDir ? (
          <>
            <span className="size-3 shrink-0 text-muted-foreground">
              {open ? <VscChevronDown /> : <VscChevronRight />}
            </span>
            {open ? (
              <VscFolderOpened className="size-3.5 shrink-0 text-yellow-400" />
            ) : (
              <VscFolder className="size-3.5 shrink-0 text-yellow-500" />
            )}
          </>
        ) : (
          <>
            <span className="size-3 shrink-0" />
            <FileIcon name={node.name} />
          </>
        )}
        <span className="truncate">{node.name}</span>
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

/* ── Workspace tab ── */

export function WorkspaceTab() {
  const [selectedId, setSelectedId] = useState<string | null>(null)

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-border/20 px-3 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Workspace files
        </span>
      </div>
      <div className="flex-1 overflow-y-auto py-1 font-mono">
        {MOCK_TREE.map((node) => (
          <TreeNode
            key={node.id}
            node={node}
            depth={0}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        ))}
      </div>
    </div>
  )
}
