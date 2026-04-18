"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { Header } from "@/common/Header"
import { Sidebar, DEFAULT_DRAGGABLE_ITEMS } from "@/components/sidebar"
import type { SidebarNavItem } from "@/components/sidebar"
import { Footer } from "@/components/Footer"
import { ChatBox } from "@/components/ChatBox"
import { AnimatedGreeting } from "@/components/AnimatedGreeting"
import { InspectorPanel } from "@/components/inspector/InspectorPanel"
import { TerminalPanel } from "@/components/TerminalPanel"
import { UsagePage } from "@/components/UsagePage"
import { SkillPage } from "@/components/SkillPage"
import { AccountTab } from "@/components/settings/tabs/AccountTab"
import { AppearanceTab } from "@/components/settings/tabs/AppearanceTab"
import { DataControlTab } from "@/components/settings/tabs/DataControlTab"
import { MaintenanceTab } from "@/components/settings/tabs/MaintenanceTab"
import { HelpTab } from "@/components/settings/tabs/HelpTab"
import { useTerminalShortcut } from "@/hooks/useTerminalShortcut"
import { useAppShortcuts } from "@/hooks/useAppShortcuts"
import ConnectPage from "@/app/connect/page"

const SIDEBAR_MIN = 160
const SIDEBAR_MAX = 480
const SIDEBAR_DEFAULT = 220
const SIDEBAR_COLLAPSED = 56

export default function Page() {
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [activeTab, setActiveTab] = useState("chat")
  const [isSettingsMode, setIsSettingsMode] = useState(false)
  const [lastStandardTab, setLastStandardTab] = useState("chat")
  const [sidebarItems, setSidebarItems] = useState<SidebarNavItem[]>(DEFAULT_DRAGGABLE_ITEMS)
  const [chatKey, setChatKey] = useState(0)
  const isResizing = useRef(false)
  const [terminalHeight, setTerminalHeight] = useState<number | null>(null)

  const toggleInspector = useCallback(() => setInspectorOpen((prev) => !prev), [])
  const toggleTerminal = useCallback(() => setTerminalOpen((prev) => !prev), [])
  const toggleSidebar = useCallback(() => setSidebarOpen((prev) => !prev), [])
  const openTerminal = useCallback(() => setTerminalOpen(true), [])

  useTerminalShortcut(toggleTerminal)
  useAppShortcuts()

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
        e.preventDefault()
        setActiveTab("chat")
        setLastStandardTab("chat")
        setIsSettingsMode(false)
        setChatKey((k) => k + 1)
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  const handleResizeStart = useCallback(() => {
    if (!sidebarOpen) return
    isResizing.current = true
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
  }, [sidebarOpen])

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!isResizing.current) return
      const newWidth = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, e.clientX))
      setSidebarWidth(newWidth)
    }

    function onMouseUp() {
      if (!isResizing.current) return
      isResizing.current = false
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
    }

    window.addEventListener("mousemove", onMouseMove)
    window.addEventListener("mouseup", onMouseUp)

    return () => {
      window.removeEventListener("mousemove", onMouseMove)
      window.removeEventListener("mouseup", onMouseUp)
    }
  }, [])

  const handleTabChange = useCallback((tab: string) => {
    if (tab === "settings") {
      setIsSettingsMode(true)
      setActiveTab("usage")
    } else {
      setActiveTab(tab)
      if (!isSettingsMode) {
        setLastStandardTab(tab)
      }
    }
  }, [isSettingsMode])

  const handleBackToMain = useCallback(() => {
    setIsSettingsMode(false)
    setActiveTab(lastStandardTab || "chat")
  }, [lastStandardTab])

  return (
    <div className="flex h-svh flex-col bg-background">
      <Header
        inspectorOpen={inspectorOpen}
        onToggleInspector={toggleInspector}
        terminalOpen={terminalOpen}
        onToggleTerminal={toggleTerminal}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={toggleSidebar}
      />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          width={sidebarOpen ? sidebarWidth : SIDEBAR_COLLAPSED}
          collapsed={!sidebarOpen}
          onResizeStart={handleResizeStart}
          activeTab={activeTab}
          onTabChange={handleTabChange}
          items={sidebarItems}
          onItemsChange={setSidebarItems}
          isSettingsMode={isSettingsMode}
          onToggleSettingsMode={setIsSettingsMode}
          onBackToMain={handleBackToMain}
        />

        <div className="flex flex-1 flex-col overflow-hidden">
          <main className="flex flex-1 items-start justify-center overflow-y-auto transition-all duration-300 ease-in-out">
            <MainContent
              activeTab={activeTab}
              chatKey={chatKey}
              lastStandardTab={lastStandardTab}
              onTabChange={handleTabChange}
              onToggleSettingsMode={setIsSettingsMode}
            />
          </main>

          <TerminalPanel
            open={terminalOpen}
            onToggle={toggleTerminal}
            externalHeight={terminalHeight}
            onExternalHeightUsed={() => setTerminalHeight(null)}
          />
        </div>

        <InspectorPanel open={inspectorOpen} onClose={toggleInspector} />
      </div>

      <Footer
        onToggleTerminal={toggleTerminal}
        onDragOpenTerminal={(height) => {
          openTerminal()
          setTerminalHeight(height)
        }}
      />
    </div>
  )
}

function MainContent({
  activeTab,
  chatKey,
  lastStandardTab,
  onTabChange,
  onToggleSettingsMode,
}: {
  activeTab: string
  chatKey: number
  lastStandardTab: string
  onTabChange: (tab: string) => void
  onToggleSettingsMode: (val: boolean) => void
}) {
  const settingsBack = () => {
    onToggleSettingsMode(false)
    onTabChange(lastStandardTab)
  }

  if (activeTab === "usage") return <UsagePage onBack={settingsBack} />
  if (activeTab === "skill") return <SkillPage />
  if (activeTab === "memory") return <div className="text-muted-foreground italic">Memory system is loading...</div>
  if (activeTab === "account") return <div className="w-full max-w-2xl px-6 py-10"><AccountTab /></div>
  if (activeTab === "personalization") return <div className="w-full max-w-2xl px-6 py-10"><AppearanceTab /></div>
  if (activeTab === "data-control") return <div className="w-full max-w-2xl px-6 py-10"><DataControlTab /></div>
  if (activeTab === "maintenance") return <div className="w-full max-w-2xl px-6 py-10"><MaintenanceTab /></div>
  if (activeTab === "help") return <div className="w-full max-w-2xl px-6 py-10"><HelpTab /></div>
  if (activeTab === "connect") return <ConnectPage />
  if (activeTab === "project") return <div className="text-muted-foreground italic">Project files...</div>

  return (
    <div key={`${activeTab}-${chatKey}`} className="flex min-h-full w-full flex-col items-center justify-center gap-8 py-10">
      <AnimatedGreeting />
      <ChatBox />
    </div>
  )
}
