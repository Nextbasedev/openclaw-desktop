"use client"

import { useState, useEffect, useRef, useMemo, useCallback } from "react"
import { createPortal } from "react-dom"
import { cn } from "@/lib/utils"
import { usePlatform } from "@/hooks/usePlatform"
import { invoke } from "@/lib/ipc"
import {
  LuSearch,
  LuSun,
  LuTerminal,
  LuPlus,
  LuSettings,
  LuClock,
  LuArrowUpRight,
  LuRefreshCw,
  LuPower,
  LuSparkles,
} from "react-icons/lu"

type Session = {
  key: string
  label: string | null
  status: string
  updatedAt: string
  hidden?: boolean
}

type ChatRecord = {
  id: string
  name: string
  sessionKey?: string
  archived: boolean
  updatedAt: string
}

type CommandPaletteProps = {
  open: boolean
  onClose: () => void
  onNavigateChat: (sessionKey?: string) => void | Promise<void>
  onNewChat: () => void
  onSendPrompt: (prompt: string) => void
  onOpenSettings: () => void
  onToggleTerminal: () => void
  onToggleTheme: () => void
}

type QuickAction = {
  id: string
  label: string
  icon: React.ComponentType<{ size?: number }>
  keys: { win: string[]; mac: string[] }
  scope: string
}

const QUICK_ACTIONS: QuickAction[] = [
  { id: "reload", label: "Reload Window", icon: LuRefreshCw, keys: { win: ["Ctrl", "R"], mac: ["⌘", "R"] }, scope: "Global" },
  { id: "new-chat", label: "New Chat", icon: LuPlus, keys: { win: ["Ctrl", "N"], mac: ["⌘", "N"] }, scope: "Global" },
  { id: "toggle-terminal", label: "Toggle Terminal", icon: LuTerminal, keys: { win: ["Ctrl", "`"], mac: ["⌘", "`"] }, scope: "Global" },
  { id: "settings", label: "Open Settings", icon: LuSettings, keys: { win: [], mac: [] }, scope: "Global" },
  { id: "toggle-theme", label: "Toggle Theme", icon: LuSun, keys: { win: ["D"], mac: ["D"] }, scope: "Global" },
  { id: "quit", label: "Quit Application", icon: LuPower, keys: { win: ["Ctrl", "Q"], mac: ["⌘", "Q"] }, scope: "Global" },
]

const PROMPT_SUGGESTIONS: { chip: string; prompt: string }[] = [
  { chip: "Write a function to", prompt: "Write a function that takes input parameters, processes the data, and returns the expected output. Include proper error handling, type safety, and edge case coverage." },
  { chip: "Debug this error", prompt: "Help me debug this error. Analyze the stack trace, identify the root cause, and suggest a fix with an explanation of why the error occurred." },
  { chip: "Explain this code", prompt: "Explain this code in detail. Walk through the logic step by step, describe what each section does, and highlight any important patterns or design decisions." },
  { chip: "Create unit tests", prompt: "Create comprehensive unit tests for this code. Cover the happy path, edge cases, error scenarios, and boundary conditions with clear test descriptions." },
  { chip: "Review my code", prompt: "Review my code for potential issues. Check for bugs, performance problems, security vulnerabilities, and suggest improvements following best practices." },
  { chip: "Refactor this module", prompt: "Refactor this module to improve readability, maintainability, and performance. Preserve existing behavior while applying clean code principles." },
  { chip: "Add documentation", prompt: "Add clear and concise documentation to this code. Include function descriptions, parameter explanations, return values, and usage examples." },
  { chip: "Optimize performance", prompt: "Analyze this code for performance bottlenecks and optimize it. Suggest improvements for speed, memory usage, and efficiency with before/after comparisons." },
  { chip: "Fix this bug", prompt: "Help me fix this bug. Identify what's going wrong, explain the root cause, and provide a corrected implementation with an explanation of the fix." },
  { chip: "Design a component", prompt: "Design a reusable UI component with proper props interface, state management, accessibility support, and responsive styling using our existing design system." },
  { chip: "Setup CI pipeline", prompt: "Help me set up a CI/CD pipeline with build, test, lint, and deployment stages. Include proper caching, environment configuration, and failure notifications." },
  { chip: "Generate types for", prompt: "Generate TypeScript type definitions for this data structure. Include all fields, proper optionality, union types where needed, and export the types for reuse." },
]

type FlatItem =
  | { type: "recent"; id: string; session: Session }
  | { type: "action"; id: string; action: QuickAction }

export function CommandPalette({
  open,
  onClose,
  onNavigateChat,
  onNewChat,
  onSendPrompt,
  onOpenSettings,
  onToggleTerminal,
  onToggleTheme,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [recentSessions, setRecentSessions] = useState<Session[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const platform = usePlatform()
  const isMac = platform === "macos"

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 200)
    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => {
    if (!open) return
    setQuery("")
    setDebouncedQuery("")
    setSelectedIndex(0)
    setTimeout(() => inputRef.current?.focus(), 50)

    invoke<{ sessions: Session[] }>("middleware_sessions_list", {
      input: { includeExisting: true },
    })
      .then(async ({ sessions }) => {
        const seen = new Set<string>()
        let sorted = sessions
          .filter((s) => !s.hidden && !s.label?.startsWith("__"))
          .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
          .filter((s) => {
            if (seen.has(s.key)) return false
            seen.add(s.key)
            return true
          })
          .slice(0, 5)

        if (sorted.length === 0) {
          const chatResult = await invoke<{ chats: ChatRecord[] }>(
            "middleware_chats_list",
            { input: {} },
          )
          sorted = (chatResult.chats || [])
            .filter((chat) => !chat.archived && chat.sessionKey)
            .map((chat) => ({
              key: chat.sessionKey as string,
              label: chat.name,
              status: "idle",
              updatedAt: chat.updatedAt,
            }))
            .slice(0, 5)
        }
        setRecentSessions(sorted)
      })
      .catch(() => setRecentSessions([]))
  }, [open])

  const filteredRecent = debouncedQuery
    ? recentSessions.filter((s) =>
      (s.label || s.key).toLowerCase().includes(debouncedQuery.toLowerCase()),
    )
    : recentSessions

  const filteredActions = debouncedQuery
    ? QUICK_ACTIONS.filter((a) => a.label.toLowerCase().includes(debouncedQuery.toLowerCase()))
    : QUICK_ACTIONS

  const allItems = useMemo<FlatItem[]>(() => [
    ...filteredRecent.map((s) => ({ type: "recent" as const, id: s.key, session: s })),
    ...filteredActions.map((a) => ({ type: "action" as const, id: a.id, action: a })),
  ], [filteredRecent, filteredActions])

  const dispatchItem = useCallback((item: FlatItem) => {
    onClose()
    if (item.type === "recent") {
      onNavigateChat(item.session.key)
      return
    }
    switch (item.action.id) {
      case "reload": window.location.reload(); break
      case "new-chat": onNewChat(); break
      case "toggle-terminal": onToggleTerminal(); break
      case "settings": onOpenSettings(); break
      case "toggle-theme": onToggleTheme(); break
      case "quit": {
        if (window.__TAURI_INTERNALS__) {
          import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
            getCurrentWindow().close()
          })
        }
        break
      }
    }
  }, [onClose, onNavigateChat, onNewChat, onToggleTerminal, onOpenSettings, onToggleTheme])

  const handlePromptClick = useCallback((prompt: string) => {
    onClose()
    onSendPrompt(prompt)
  }, [onClose, onSendPrompt])

  useEffect(() => {
    if (!open) return

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault()
        onClose()
      } else if (e.key === "ArrowDown") {
        e.preventDefault()
        setSelectedIndex((i) => Math.min(i + 1, allItems.length - 1))
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        setSelectedIndex((i) => Math.max(i - 1, 0))
      } else if (e.key === "Enter") {
        e.preventDefault()
        const item = allItems[selectedIndex]
        if (item) dispatchItem(item)
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [open, onClose, allItems, selectedIndex, dispatchItem])

  useEffect(() => {
    setSelectedIndex(0)
  }, [debouncedQuery])

  if (!open) return null

  let itemIndex = -1

  return createPortal(
    <div
      data-testid="command-palette"
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/20 dark:bg-black/50" />
      <div
        className={cn(
          "relative w-full max-w-[650px] overflow-hidden rounded-md",
          "border border-border/60 bg-background shadow-xl shadow-black/10",
          "dark:border-white/[0.12] dark:bg-white/[0.06] dark:shadow-2xl dark:shadow-black/40 dark:backdrop-blur-2xl dark:backdrop-saturate-150",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search bar */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3.5 dark:border-white/[0.08]">
          <LuSearch size={18} className="shrink-0 text-muted-foreground dark:text-white/40" />
          <input
            ref={inputRef}
            data-testid="command-palette-search"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ask AI & Search"
            className="flex-1 bg-transparent text-[14px] text-foreground outline-none placeholder:text-muted-foreground/50 dark:text-white dark:placeholder:text-white/30"
          />
          <kbd className="flex items-center gap-0.5 rounded-md border border-border bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground dark:border-white/[0.1] dark:bg-white/[0.06] dark:text-white/40">
            {isMac ? "⌘" : "Ctrl"}
            <span className="text-[8px] text-muted-foreground/50 dark:text-white/20">+</span>
            K
          </kbd>
        </div>

        {/* I'm looking for — auto-scrolling prompt chips */}
        {!debouncedQuery && (
          <div className="border-b border-border px-4 py-3 dark:border-white/[0.08]">
            <div className="flex items-center gap-1.5 pb-2.5">
              <LuSparkles size={10} className="text-muted-foreground dark:text-white/30" />
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground dark:text-white/30">
                I&apos;m looking for
              </p>
            </div>
            <PromptMarquee suggestions={PROMPT_SUGGESTIONS} onSelect={handlePromptClick} />
          </div>
        )}

        {/* Scrollable results */}
        <div ref={listRef} className="h-[340px] overflow-y-auto scrollbar-hide py-1.5">
          {/* Recent */}
          {filteredRecent.length > 0 && (
            <div className="px-3 py-1.5">
              <p className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground dark:text-white/30">
                Recent
              </p>
              {filteredRecent.map((session) => {
                itemIndex++
                const idx = itemIndex
                return (
                  <PaletteRow
                    key={session.key}
                    icon={<LuClock size={14} />}
                    label={session.label || session.key}
                    trailing={<LuArrowUpRight size={12} className="text-muted-foreground/50 dark:text-white/25" />}
                    selected={selectedIndex === idx}
                    testId={`command-recent-${session.key}`}
                    onClick={() => dispatchItem({ type: "recent", id: session.key, session })}
                  />
                )
              })}
            </div>
          )}

          {/* Quick Actions */}
          {filteredActions.length > 0 && (
            <div className="px-3 py-1.5">
              <p className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground dark:text-white/30">
                Quick Actions
              </p>
              {filteredActions.map((action) => {
                itemIndex++
                const idx = itemIndex
                const ActionIcon = action.icon
                const keys = isMac ? action.keys.mac : action.keys.win
                return (
                  <PaletteRow
                    key={action.id}
                    icon={<ActionIcon size={14} />}
                    label={action.label}
                    trailing={
                      keys.length > 0 ? (
                        <div className="flex items-center gap-0.5">
                          {keys.map((key, i) => (
                            <span key={`${action.id}-${key}-${i}`} className="flex items-center gap-0.5">
                              {i > 0 && <span className="text-[8px] text-muted-foreground/50 dark:text-white/20">+</span>}
                              <kbd className="inline-flex min-w-[22px] items-center justify-center rounded-md border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground dark:border-white/[0.1] dark:bg-white/[0.06] dark:text-white/40">
                                {key}
                              </kbd>
                            </span>
                          ))}
                        </div>
                      ) : undefined
                    }
                    selected={selectedIndex === idx}
                    testId={`command-action-${action.id}`}
                    onClick={() => dispatchItem({ type: "action", id: action.id, action })}
                  />
                )
              })}
            </div>
          )}

          {filteredRecent.length === 0 && filteredActions.length === 0 && (
            <div className="px-5 py-8 text-center text-[13px] text-muted-foreground dark:text-white/35">
              No results found.
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

function PromptMarquee({
  suggestions,
  onSelect,
}: {
  suggestions: { chip: string; prompt: string }[]
  onSelect: (prompt: string) => void
}) {
  const [paused, setPaused] = useState(false)

  return (
    <div
      className="relative overflow-hidden"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div
        className="flex w-max gap-2"
        style={{
          animation: "marquee-scroll 30s linear infinite",
          animationPlayState: paused ? "paused" : "running",
          willChange: "transform",
        }}
      >
        {[...suggestions, ...suggestions].map((s, i) => (
          <button
            key={`${s.chip}-${i}`}
            type="button"
            onClick={() => onSelect(s.prompt)}
            className={cn(
              "shrink-0 cursor-pointer whitespace-nowrap rounded-full border px-3 py-1.5",
              "border-border bg-muted text-[12px] font-medium text-muted-foreground",
              "dark:border-white/[0.12] dark:bg-white/[0.06] dark:text-white/50",
              "transition-colors hover:border-primary/30 hover:bg-primary/10 hover:text-primary",
            )}
          >
            {s.chip}
          </button>
        ))}
      </div>

      <div className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-background/80 to-transparent dark:from-black/40" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-background/80 to-transparent dark:from-black/40" />
    </div>
  )
}

function PaletteRow({
  icon,
  label,
  trailing,
  selected,
  testId,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  trailing?: React.ReactNode
  selected: boolean
  testId?: string
  onClick: () => void
}) {
  const rowRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (selected) rowRef.current?.scrollIntoView({ block: "nearest" })
  }, [selected])

  return (
    <button
      ref={rowRef}
      type="button"
      data-testid={testId}
      onClick={onClick}
      className={cn(
        "flex w-full cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors",
        selected
          ? "bg-muted text-foreground dark:bg-white/[0.1] dark:text-white"
          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground dark:text-white/60 dark:hover:bg-white/[0.06] dark:hover:text-white",
      )}
    >
      <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground dark:text-white/40">
        {icon}
      </span>
      <span className="flex-1 truncate text-[13px]">{label}</span>
      {trailing}
    </button>
  )
}
