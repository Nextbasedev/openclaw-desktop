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
import { useTerminalShortcut } from "@/hooks/useTerminalShortcut"

const SIDEBAR_MIN = 160
const SIDEBAR_MAX = 480
const SIDEBAR_DEFAULT = 220

export default function Page() {
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT)
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [terminalHeight, setTerminalHeight] = useState<number | null>(null)
  const [activeTab, setActiveTab] = useState("chat")
  const [sidebarItems, setSidebarItems] = useState<SidebarNavItem[]>(DEFAULT_DRAGGABLE_ITEMS)
  const [chatKey, setChatKey] = useState(0)
  const isResizing = useRef(false)

  const toggleInspector = useCallback(() => setInspectorOpen((prev) => !prev), [])
  const toggleTerminal = useCallback(() => setTerminalOpen((prev) => !prev), [])
  const openTerminal = useCallback(() => setTerminalOpen(true), [])

  useTerminalShortcut(toggleTerminal)

  /* ── Ctrl+N: new chat ── */
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
        e.preventDefault()
        setActiveTab("chat")
        setChatKey((k) => k + 1)
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  /* ── Sidebar resize ── */
  const handleResizeStart = useCallback(() => {
    isResizing.current = true
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
  }, [])

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

  return (
    <div className="flex h-svh flex-col bg-background">
      <Header
        inspectorOpen={inspectorOpen}
        onToggleInspector={toggleInspector}
        terminalOpen={terminalOpen}
        onToggleTerminal={toggleTerminal}
      />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          width={sidebarWidth}
          onResizeStart={handleResizeStart}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          items={sidebarItems}
          onItemsChange={setSidebarItems}
        />

        {/* Main + terminal column */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <main className="flex flex-1 items-center justify-center overflow-y-auto transition-all duration-300 ease-in-out">
            <MainContent activeTab={activeTab} chatKey={chatKey} />
          </main>

          {/* Terminal panel — slides up from bottom */}
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

/* ── Conditional main content based on active tab ── */
function MainContent({ activeTab, chatKey }: { activeTab: string; chatKey: number }) {
  if (activeTab === "usage") {
    return <UsagePage />
  }

  // Default: chat view (greeting + chatbox)
  return (
    <div key={chatKey} className="flex w-full flex-col items-center gap-8">
      <AnimatedGreeting />
      <ChatBox />
    </div>
  )
}
