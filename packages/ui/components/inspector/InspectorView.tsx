"use client"

import * as React from "react"
import { useState, useRef, useCallback } from "react"
import { cn } from "@/lib/utils"
import { VscClose, VscAdd } from "react-icons/vsc"
import { ActivityTab } from "./ActivityTab"
import { WorkspaceTab } from "./WorkspaceTab"
import { GitTab, type GitTabSelection } from "./GitTab"
import { XTerminal } from "@/components/terminal/XTerminal"
import { Icons } from "@/components/icons"
import type { InspectorScope } from "./inspectorScope"
import { inspectorScopeProjectId, inspectorScopeRenderKey } from "./inspectorScope"

export type InspectorTabId = "activity" | "workspace" | "git" | "terminal"

export const INSPECTOR_TABS: Array<{ id: InspectorTabId; label: string }> = [
  { id: "activity", label: "Subagents" },
  { id: "terminal", label: "Terminal" },
  { id: "workspace", label: "Workspace" },
  { id: "git", label: "Git" },
]

type TerminalTab = {
  id: string
  title: string
}

type InspectorViewProps = {
  activeTab: InspectorTabId
  onTabChange: (tab: InspectorTabId) => void
  onTerminalTabChange?: (active: boolean) => void
  onClose?: () => void
  closeVariant?: "cross" | "collapse"
  onOpenFullWindow?: (tab: InspectorTabId) => void
  sessionKey?: string | null
  focusedToolCallId?: string | null
  onClearFocusedToolCall?: () => void
  projectId?: string | null
  activeAgentId?: string | null
  onAgentSelect?: (id: string) => void
  className?: string
  inspectorScope?: InspectorScope
  onInspectorScopeChange?: (scope: InspectorScope) => void
}

export function InspectorView({
  activeTab,
  onTabChange,
  onTerminalTabChange,
  onClose,
  closeVariant = "cross",
  onOpenFullWindow,
  sessionKey,
  focusedToolCallId,
  onClearFocusedToolCall,
  projectId,
  activeAgentId,
  onAgentSelect,
  className,
  inspectorScope,
  onInspectorScopeChange,
}: InspectorViewProps) {
  const tabCounterRef = useRef(1)
  const [termTabs, setTermTabs] = useState<TerminalTab[]>([
    { id: "term-1", title: "Terminal 1" },
  ])
  const [activeTermId, setActiveTermId] = useState("term-1")
  const [terminalHasMounted, setTerminalHasMounted] = useState(activeTab === "terminal")
  const [gitSelection, setGitSelection] = useState<GitTabSelection | null>(null)
  const termScrollRef = useRef<HTMLDivElement>(null)

  // Derive effective projectId from scope when available
  const effectiveProjectId = inspectorScope
    ? inspectorScopeProjectId(inspectorScope)
    : (projectId ?? null)

  // Scope-aware render key for resetting tabs when scope changes
  const scopeKey = inspectorScope
    ? inspectorScopeRenderKey({ sessionKey, projectId, scope: inspectorScope })
    : `${projectId ?? "global"}:${sessionKey ?? "none"}`

  const addTermTab = useCallback(() => {
    tabCounterRef.current += 1
    const newTab: TerminalTab = {
      id: `term-${tabCounterRef.current}`,
      title: `Terminal ${tabCounterRef.current}`,
    }
    setTermTabs((prev) => [...prev, newTab])
    setActiveTermId(newTab.id)
  }, [])

  const closeTermTab = useCallback(
    (id: string) => {
      setTermTabs((prev) => {
        const next = prev.filter((tab) => tab.id !== id)
        if (next.length === 0) {
          tabCounterRef.current = 1
          return [{ id: "term-1", title: "Terminal 1" }]
        }
        if (activeTermId === id) {
          const closedIndex = prev.findIndex((tab) => tab.id === id)
          const newActive = next[Math.min(closedIndex, next.length - 1)]
          setActiveTermId(newActive.id)
        }
        return next
      })
    },
    [activeTermId],
  )

  const handleTabChange = useCallback((tab: InspectorTabId) => {
    if (tab === "terminal") setTerminalHasMounted(true)
    onTabChange(tab)
    onTerminalTabChange?.(tab === "terminal")
  }, [onTabChange, onTerminalTabChange])

  React.useEffect(() => {
    if (activeTab === "terminal") setTerminalHasMounted(true)
  }, [activeTab])

  // Reset git selection when scope changes
  React.useEffect(() => {
    setGitSelection(null)
  }, [scopeKey])

  return (
    <div className={cn("flex h-full min-w-0 flex-col", className)}>
      <div className="flex h-12 shrink-0 items-center border-b border-border/50 px-1">
        {INSPECTOR_TABS.map((tab) => {
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleTabChange(tab.id)}
              className={cn(
                "relative flex h-full cursor-pointer items-center px-2.5 text-[11px] font-medium transition-colors",
                isActive
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
              {isActive && (
                <span className="absolute inset-x-2.5 bottom-0 h-[2px] rounded-full bg-foreground/70" />
              )}
            </button>
          )
        })}
        {onOpenFullWindow && (
          <button
            type="button"
            onClick={() => onOpenFullWindow(activeTab)}
            aria-label={`Open ${activeTab} in full window`}
            title="Open in full window"
            className="ml-auto flex size-5 cursor-pointer items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
          >
            <Icons.ExpandPanel size={12} strokeWidth={1.8} className="size-[13px]" />
          </button>
        )}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className={cn(
              onOpenFullWindow
                ? "ml-1 flex size-6 cursor-pointer items-center justify-center"
                : "ml-auto flex size-6 cursor-pointer items-center justify-center",
              "text-muted-foreground transition-colors hover:text-foreground",
            )}
          >
            {closeVariant === "collapse" ? (
              <Icons.CollapsePanel size={15} strokeWidth={1.8} className="size-[15px]" />
            ) : (
              <VscClose className="size-4" />
            )}
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-clip">
        {activeTab === "activity" && (
          <ActivityTab
            key={scopeKey}
            sessionKey={sessionKey ?? null}
            activeAgentId={activeAgentId ?? null}
            onAgentSelect={onAgentSelect}
            focusedToolCallId={focusedToolCallId ?? null}
            onClearFocusedToolCall={onClearFocusedToolCall}
          />
        )}
        {activeTab === "workspace" && (
          <WorkspaceTab
            key={scopeKey}
            sessionKey={sessionKey ?? null}
            projectId={effectiveProjectId}
            inspectorScope={inspectorScope}
            onInspectorScopeChange={onInspectorScopeChange}
          />
        )}
        {activeTab === "git" && (
          <GitTab
            key={scopeKey}
            projectId={effectiveProjectId}
            selection={gitSelection}
            onSelectionChange={setGitSelection}
            inspectorScope={inspectorScope}
            onInspectorScopeChange={onInspectorScopeChange}
          />
        )}
        {terminalHasMounted && (
          <div
            className={cn(
              "h-full flex-col overflow-hidden",
              activeTab === "terminal" ? "flex" : "hidden",
            )}
          >
            <div
              ref={termScrollRef}
              onWheel={(event) => {
                if (termScrollRef.current) {
                  event.preventDefault()
                  termScrollRef.current.scrollLeft += event.deltaY
                }
              }}
              className="block h-7 w-full shrink-0 overflow-x-auto overflow-y-hidden border-b border-border/30 bg-card"
              style={{ scrollbarWidth: "none" } as React.CSSProperties}
            >
              <div className="inline-flex h-7 items-center whitespace-nowrap">
                {termTabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTermId(tab.id)}
                    className={cn(
                      "group flex h-7 cursor-pointer items-center gap-1 border-r border-border/20 px-2.5 text-[11px] whitespace-nowrap transition-colors",
                      activeTermId === tab.id
                        ? "bg-background text-foreground"
                        : "text-muted-foreground hover:bg-background/50 hover:text-foreground",
                    )}
                  >
                    <span>{tab.title}</span>
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(event) => {
                        event.stopPropagation()
                        closeTermTab(tab.id)
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.stopPropagation()
                          closeTermTab(tab.id)
                        }
                      }}
                      className={cn(
                        "flex size-3.5 cursor-pointer items-center justify-center rounded transition-colors",
                        "text-muted-foreground/40 hover:bg-secondary hover:text-foreground",
                        activeTermId === tab.id
                          ? "opacity-100"
                          : "opacity-0 group-hover:opacity-100",
                      )}
                    >
                      <VscClose className="size-2.5" />
                    </span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={addTermTab}
                  className="flex size-7 cursor-pointer items-center justify-center text-muted-foreground/50 transition-colors hover:text-foreground"
                  aria-label="New terminal"
                >
                  <VscAdd className="size-3" />
                </button>
              </div>
            </div>

            <div className="relative flex-1 overflow-hidden bg-white dark:bg-black">
              {termTabs.map((tab) => (
                <div
                  key={tab.id}
                  className="absolute inset-0"
                  style={{
                    visibility: activeTermId === tab.id ? "visible" : "hidden",
                    zIndex: activeTermId === tab.id ? 1 : 0,
                  }}
                >
                  <XTerminal
                    key={`${effectiveProjectId ?? "global"}:${tab.id}`}
                    visible={activeTermId === tab.id}
                    projectId={effectiveProjectId}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
