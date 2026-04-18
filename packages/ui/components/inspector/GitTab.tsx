"use client"

import { cn } from "@/lib/utils"
import { VscGitCommit, VscSourceControl } from "react-icons/vsc"

/* ── Types ── */

type FileState = "modified" | "added" | "deleted" | "renamed"

interface GitFile {
  path: string
  state: FileState
  additions?: number
  deletions?: number
}

interface GitCommitEntry {
  hash: string
  message: string
  author: string
  date: string
  additions: number
  deletions: number
}

/* ── Mock data ── */

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

const MOCK_COMMITS: GitCommitEntry[] = [
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

const STATE_CONFIG: Record<FileState, { letter: string; color: string }> = {
  modified: { letter: "M", color: "text-amber-400 bg-amber-400/10" },
  added: { letter: "A", color: "text-emerald-400 bg-emerald-400/10" },
  deleted: { letter: "D", color: "text-red-400 bg-red-400/10" },
  renamed: { letter: "R", color: "text-blue-400 bg-blue-400/10" },
}

function StateBadge({ state }: { state: FileState }) {
  const config = STATE_CONFIG[state]
  return (
    <span
      className={cn(
        "inline-flex size-[18px] shrink-0 items-center justify-center rounded text-[10px] font-semibold",
        config.color,
      )}
    >
      {config.letter}
    </span>
  )
}

/* ── Git tab ── */

export function GitTab() {
  const totalAdded = MOCK_FILES.reduce((sum, f) => sum + (f.additions ?? 0), 0)
  const totalDeleted = MOCK_FILES.reduce((sum, f) => sum + (f.deletions ?? 0), 0)

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Branch status */}
      <div className="px-4 py-3">
        <div className="flex items-center gap-2.5">
          <VscSourceControl className="size-4 text-muted-foreground/70" />
          <span className="text-[13px] font-medium text-foreground">{MOCK_BRANCH}</span>
          <div className="flex items-center gap-1.5 ml-auto">
            {MOCK_AHEAD > 0 && (
              <span className="rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] font-medium tabular-nums text-emerald-400">
                ↑ {MOCK_AHEAD}
              </span>
            )}
            {MOCK_BEHIND > 0 && (
              <span className="rounded-full bg-amber-400/10 px-2 py-0.5 text-[10px] font-medium tabular-nums text-amber-400">
                ↓ {MOCK_BEHIND}
              </span>
            )}
          </div>
        </div>

        {/* Summary stats */}
        <div className="mt-3 flex gap-4">
          <div className="flex items-baseline gap-1.5">
            <span className="text-[18px] font-semibold tabular-nums text-foreground">
              {MOCK_FILES.length}
            </span>
            <span className="text-[11px] text-muted-foreground">changed</span>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-[18px] font-semibold tabular-nums text-emerald-400">
              +{totalAdded}
            </span>
            <span className="text-[11px] text-muted-foreground">added</span>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-[18px] font-semibold tabular-nums text-red-400">
              −{totalDeleted}
            </span>
            <span className="text-[11px] text-muted-foreground">removed</span>
          </div>
        </div>
      </div>

      <div className="h-px bg-border/30" />

      {/* Changed files */}
      <div className="py-3">
        <p className="mb-2 px-4 text-[11px] font-medium text-muted-foreground">
          Changes
        </p>
        <div className="flex flex-col">
          {MOCK_FILES.map((file) => {
            const fileName = file.path.split("/").pop() ?? file.path
            const dirPath = file.path.split("/").slice(0, -1).join("/")

            return (
              <div
                key={file.path}
                className="flex items-center gap-2.5 px-4 py-[6px] transition-colors hover:bg-secondary/30"
              >
                <StateBadge state={file.state} />
                <div className="flex flex-1 flex-col min-w-0">
                  <span className="truncate text-[12px] text-foreground">{fileName}</span>
                  <span className="truncate text-[10px] text-muted-foreground/60">{dirPath}</span>
                </div>
                <div className="flex items-center gap-1.5 text-[11px] tabular-nums">
                  {file.additions ? <span className="text-emerald-400/80">+{file.additions}</span> : null}
                  {file.deletions ? <span className="text-red-400/80">−{file.deletions}</span> : null}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="h-px bg-border/30" />

      {/* Commit history */}
      <div className="py-3">
        <p className="mb-2 px-4 text-[11px] font-medium text-muted-foreground">
          Recent commits
        </p>
        <div className="flex flex-col">
          {MOCK_COMMITS.map((commit, i) => (
            <div
              key={commit.hash}
              className="flex items-start gap-2.5 px-4 py-2 transition-colors hover:bg-secondary/30"
            >
              {/* Timeline connector */}
              <div className="relative mt-[3px] flex flex-col items-center">
                <VscGitCommit className="size-3.5 shrink-0 text-muted-foreground/50" />
                {i < MOCK_COMMITS.length - 1 && (
                  <div className="absolute top-4 w-px bg-border/30" style={{ height: 20 }} />
                )}
              </div>

              <div className="flex-1 min-w-0">
                <p className="truncate text-[12px] text-foreground leading-snug">
                  {commit.message}
                </p>
                <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground/60">
                  <code className="text-sky-400/60">{commit.hash}</code>
                  <span>·</span>
                  <span>{commit.author}</span>
                  <span>·</span>
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
