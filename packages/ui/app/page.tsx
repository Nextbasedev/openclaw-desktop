"use client"

import { useState, useCallback } from "react"
import { Header } from "@/common/Header"
import { Sidebar } from "@/components/sidebar"
import { Footer } from "@/components/Footer"
import { ChatBox } from "@/components/ChatBox"
import { AnimatedGreeting } from "@/components/AnimatedGreeting"
import { InspectorPanel } from "@/components/inspector/InspectorPanel"
import { TerminalPanel } from "@/components/TerminalPanel"
import { useTerminalShortcut } from "@/hooks/useTerminalShortcut"

export default function Page() {
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [terminalHeight, setTerminalHeight] = useState<number | null>(null)

  const toggleInspector = useCallback(() => setInspectorOpen((prev) => !prev), [])
  const toggleTerminal = useCallback(() => setTerminalOpen((prev) => !prev), [])
  const openTerminal = useCallback(() => setTerminalOpen(true), [])

  useTerminalShortcut(toggleTerminal)

  return (
    <div className="flex h-svh flex-col bg-background">
      <Header
        inspectorOpen={inspectorOpen}
        onToggleInspector={toggleInspector}
        terminalOpen={terminalOpen}
        onToggleTerminal={toggleTerminal}
      />

      {/* Content area: sidebar + main + inspector */}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />

        {/* Main + terminal column */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Main content area — vertically centered */}
          <main className="flex flex-1 items-center justify-center transition-all duration-300 ease-in-out">
            <div className="flex w-full flex-col items-center gap-8">
              <AnimatedGreeting />
              <ChatBox />
            </div>
          </main>

          {/* Terminal panel — slides up from bottom */}
          <TerminalPanel
            open={terminalOpen}
            onToggle={toggleTerminal}
            externalHeight={terminalHeight}
            onExternalHeightUsed={() => setTerminalHeight(null)}
          />
        </div>

        {/* Right inspector panel */}
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
