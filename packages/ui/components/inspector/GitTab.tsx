"use client"

import { cn } from "@/lib/utils"
import {
  VscGitCommit,
  VscSourceControl,
  VscCircleFilled,
} from "react-icons/vsc"

/* ── Mock data ── */

type FileState = "modified" | "added" | "deleted" | "renamed"

interface GitFile {
  path: string
  state: FileState
  additions?: number
  deletions?: number
}

interface GitCommit {
  hash: string
  message: string
  author: string
  date: string
  additions: number
  deletions: number
}

const MOCK_BRANCH = "krish-work"
const MOCK_AHEAD = 3
const MOCK_BEHIND = 0

const MOCK_FILES: GitFile[] = [
  { path: "packages/ui/components/inspector/InspectorPanel.tsx", state: "added", additions: 120 },
  { path: "packages/ui/components/inspector/ActivityTab.tsx", state: "added", additions: 180 },
  { path: "packages/ui/components/inspector/WorkspaceTab.tsx", state: "added", additions: 130 },
  { path: "packages/ui/components/inspector/GitTab.tsx", state: "added", additions: 160 },
  { path: "packages/ui/app/page.tsx", state: "modified", additions: 8, deletions: 2 },
  { path: "packages/ui/common/Header/index.tsx", state: "modified", additions: 12, deletions: 4 },
]

const MOCK_COMMITS: GitCommit[] = [
  {
    hash: "a3f9c12",
    message: "feat: add inspector panel with activity, workspace, git tabs",
    author: "Krish",
    date: "just now",
    additions: 610,
    deletions: 6,
  },
  {
    hash: "b82e741",
    message: "feat: add draggable sidebar items with dnd-kit",
    author: "Krish",
    date: "2h ago",
    additions: 240,
    deletions: 30,
  },
  {
    hash: "c1d4509",
    message: "feat: add settings dialog with tabs",
    author: "Krish",
    date: "5h ago",
    additions: 380,
    deletions: 12,
  },
  {
    hash: "d7a3022",
    message: "chore: initial project scaffold",
    author: "Krish",
    date: "yesterday",
    additions: 1200,
    deletions: 0,
  },
  {
    hash: "e0b1f34",
    message: "init: monorepo setup with pnpm workspaces",
    author: "Krish",
    date: "2d ago",
    additions: 80,
    deletions: 0,
  },
]

/* ── State badge ── */

const STATE_STYLE: Record<FileState, { label: string; className: string }> = {
  modified: { label: "M", className: "bg-yellow-500/20 text-yellow-400" },
  added: { label: "A", className: "bg-emerald-500/20 text-emerald-400" },
  deleted: { label: "D", className: "bg-red-500/20 text-red-400" },
  renamed: { label: "R", className: "bg-blue-500/20 text-blue-400" },
}

function StateBadge({ state }: { state: FileState }) {
  const { label, className } = STATE_STYLE[state]
  return (
    <span
      className={cn(
        "inline-flex size-4 shrink-0 items-center justify-center rounded text-[9px] font-bold",
        className,
      )}
    >
      {label}
    </span>
  )
}

/* ── Section heading ── */

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1.5 px-3 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </p>
  )
}

/* ── Git tab ── */

export function GitTab() {
  const totalAdded = MOCK_FILES.reduce((s, f) => s + (f.additions ?? 0), 0)
  const totalDeleted = MOCK_FILES.reduce((s, f) => s + (f.deletions ?? 0), 0)
  const changedCount = MOCK_FILES.length

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Branch status */}
      <div className="border-b border-border/20 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <VscSourceControl className="size-3.5 text-muted-foreground" />
          <span className="font-mono text-[12px] font-semibold text-foreground">
            {MOCK_BRANCH}
          </span>
          {MOCK_AHEAD > 0 && (
            <span className="rounded-full bg-emerald-500/20 px-1.5 py-px font-mono text-[9px] text-emerald-400">
              ↑{MOCK_AHEAD}
            </span>
          )}
          {MOCK_BEHIND > 0 && (
            <span className="rounded-full bg-yellow-500/20 px-1.5 py-px font-mono text-[9px] text-yellow-400">
              ↓{MOCK_BEHIND}
            </span>
          )}
        </div>
        {/* Diff summary */}
        <div className="mt-1.5 flex items-center gap-3 font-mono text-[10px] text-muted-foreground">
          <span>{changedCount} file{changedCount !== 1 ? "s" : ""} changed</span>
          <span className="text-emerald-400">+{totalAdded}</span>
          <span className="text-red-400">−{totalDeleted}</span>
        </div>
      </div>

      {/* Changed files */}
      <div className="border-b border-border/20 py-2.5">
        <SectionHeading>Changes</SectionHeading>
        <div className="flex flex-col gap-px">
          {MOCK_FILES.map((file) => {
            const shortPath = file.path.split("/").slice(-2).join("/")
            return (
              <div
                key={file.path}
                className="flex items-center gap-2 px-3 py-1 hover:bg-white/[0.03] transition-colors"
              >
                <StateBadge state={file.state} />
                <span className="flex-1 truncate font-mono text-[11px] text-foreground">
                  {shortPath}
                </span>
                {(file.additions || file.deletions) && (
                  <div className="flex items-center gap-1 font-mono text-[10px]">
                    {file.additions ? (
                      <span className="text-emerald-400">+{file.additions}</span>
                    ) : null}
                    {file.deletions ? (
                      <span className="text-red-400">−{file.deletions}</span>
                    ) : null}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Commit history */}
      <div className="py-2.5">
        <SectionHeading>Recent commits</SectionHeading>
        <div className="flex flex-col gap-px">
          {MOCK_COMMITS.map((commit, i) => (
            <div
              key={commit.hash}
              className="flex items-start gap-2 px-3 py-1.5 hover:bg-white/[0.03] transition-colors"
            >
              <div className="relative mt-0.5 flex flex-col items-center">
                <VscGitCommit className="size-3.5 shrink-0 text-muted-foreground" />
                {i < MOCK_COMMITS.length - 1 && (
                  <div className="mt-0.5 h-full w-px flex-1 bg-border/30" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="truncate font-mono text-[11px] text-foreground leading-tight">
                  {commit.message}
                </p>
                <div className="mt-0.5 flex items-center gap-2 font-mono text-[9px] text-muted-foreground">
                  <span className="text-[#7dd3fc]">{commit.hash}</span>
                  <span>{commit.author}</span>
                  <span>{commit.date}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
