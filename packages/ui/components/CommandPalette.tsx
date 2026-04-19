"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { createPortal } from "react-dom"
import { cn } from "@/lib/utils"
import { usePlatform } from "@/hooks/usePlatform"
import { tauriInvoke } from "@/lib/tauri"
import {
  LuSearch,
  LuMessageSquare,
  LuKeyboard,
  LuSun,
  LuTerminal,
  LuPlus,
  LuSettings,
  LuClock,
} from "react-icons/lu"

type Session = {
  sessionKey: string
  label: string | null
  status: string
  updatedAt: string
}

type CommandPaletteProps = {
  open: boolean
  onClose: () => void
  onNavigateChat: (sessionKey?: string) => void
  onNewChat: () => void
  onOpenSettings: () => void
  onToggleTerminal: () => void
  onToggleTheme: () => void
}

const QUICK_ACTIONS = [
  { id: "new-chat", label: "New Chat", icon: LuPlus, keys: { win: ["Ctrl", "N"], mac: ["⌘", "N"] } },
  { id: "toggle-terminal", label: "Toggle Terminal", icon: LuTerminal, keys: { win: ["Ctrl", "`"], mac: ["⌘", "`"] } },
  { id: "settings", label: "Open Settings", icon: LuSettings, keys: { win: [], mac: [] } },
  { id: "toggle-theme", label: "Toggle Theme", icon: LuSun, keys: { win: ["D"], mac: ["D"] } },
]

export function CommandPalette({
  open,
  onClose,
  onNavigateChat,
  onNewChat,
  onOpenSettings,
  onToggleTerminal,
  onToggleTheme,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("")
  const [recentSessions, setRecentSessions] = useState<Session[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const platform = usePlatform()
  const isMac = platform === "macos"

  useEffect(() => {
    if (!open) return
    setQuery("")
    setSelectedIndex(0)
    inputRef.current?.focus()

    tauriInvoke<{ sessions: Session[] }>("middleware_sessions_list", { input: {} })
      .then(({ sessions }) => {
        const sorted = sessions
          .filter((s) => !s.label?.startsWith("__"))
          .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
          .slice(0, 3)
        setRecentSessions(sorted)
      })
      .catch(() => setRecentSessions([]))
  }, [open])

  const filteredRecent = query
    ? recentSessions.filter((s) =>
        (s.label || s.sessionKey).toLowerCase().includes(query.toLowerCase()),
      )
    : recentSessions

  const filteredActions = query
    ? QUICK_ACTIONS.filter((a) => a.label.toLowerCase().includes(query.toLowerCase()))
    : QUICK_ACTIONS

  const allItems = [
    ...filteredRecent.map((s) => ({ type: "recent" as const, id: s.sessionKey, session: s })),
    ...filteredActions.map((a) => ({ type: "action" as const, id: a.id, action: a })),
  ]

  const executeAction = useCallback(
    (actionId: string) => {
      switch (actionId) {
        case "new-chat":
          onNewChat()
          break
        case "toggle-terminal":
          onToggleTerminal()
          break
        case "settings":
          onOpenSettings()
          break
        case "toggle-theme":
          onToggleTheme()
          break
      }
      onClose()
    },
    [onNewChat, onToggleTerminal, onOpenSettings, onToggleTheme, onClose],
  )

  const handleSelect = useCallback(
    (index: number) => {
      const item = allItems[index]
      if (!item) return
      if (item.type === "recent") {
        onNavigateChat(item.session.sessionKey)
        onClose()
      } else {
        executeAction(item.action.id)
      }
    },
    [allItems, onNavigateChat, onClose, executeAction],
  )

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
        handleSelect(selectedIndex)
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [open, onClose, allItems.length, selectedIndex, handleSelect])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  if (!open) return null

  let itemIndex = -1

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-start justify-center pt-[20vh]" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-[520px] overflow-hidden rounded-xl border border-border/50 bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-border/30 px-4 py-3">
          <LuSearch size={16} className="shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="I'm looking for..."
            className="flex-1 bg-transparent text-[14px] text-foreground outline-none placeholder:text-muted-foreground/50"
          />
          <kbd className="rounded border border-border/50 bg-muted/30 px-1.5 py-0.5 text-[10px] text-muted-foreground/60">
            ESC
          </kbd>
        </div>

        <div className="max-h-[320px] overflow-y-auto scrollbar-hide py-2">
          {filteredRecent.length > 0 && (
            <div className="px-3 pb-1">
              <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
                Recent
              </p>
              {filteredRecent.map((session) => {
                itemIndex++
                const idx = itemIndex
                return (
                  <PaletteRow
                    key={session.sessionKey}
                    icon={<LuClock size={14} />}
                    label={session.label || session.sessionKey}
                    selected={selectedIndex === idx}
                    onClick={() => handleSelect(idx)}
                  />
                )
              })}
            </div>
          )}

          {filteredActions.length > 0 && (
            <div className="px-3 pb-1">
              <p className="px-2 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
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
                    keys={keys}
                    selected={selectedIndex === idx}
                    onClick={() => handleSelect(idx)}
                  />
                )
              })}
            </div>
          )}

          {filteredRecent.length === 0 && filteredActions.length === 0 && (
            <div className="px-5 py-6 text-center text-[13px] text-muted-foreground">
              No results found.
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

function PaletteRow({
  icon,
  label,
  keys,
  selected,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  keys?: string[]
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors",
        selected
          ? "bg-foreground/5 text-foreground"
          : "text-muted-foreground hover:bg-foreground/[0.03] hover:text-foreground",
      )}
    >
      <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
        {icon}
      </span>
      <span className="flex-1 truncate text-[13px]">{label}</span>
      {keys && keys.length > 0 && (
        <div className="flex items-center gap-0.5">
          {keys.map((key, i) => (
            <span key={i} className="flex items-center gap-0.5">
              {i > 0 && <span className="text-[9px] text-muted-foreground/30">+</span>}
              <kbd className="inline-flex min-w-[20px] items-center justify-center rounded border border-border/40 bg-muted/20 px-1 py-0.5 text-[10px] text-muted-foreground/60">
                {key}
              </kbd>
            </span>
          ))}
        </div>
      )}
    </button>
  )
}
