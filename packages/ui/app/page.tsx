"use client"

import { useState, useCallback } from "react"
import { Header } from "@/common/Header"
import { Sidebar } from "@/components/sidebar"
import { Footer } from "@/components/Footer"
import { ChatBox } from "@/components/ChatBox"
import { AnimatedGreeting } from "@/components/AnimatedGreeting"
import { InspectorPanel } from "@/components/inspector/InspectorPanel"

export default function Page() {
  const [inspectorOpen, setInspectorOpen] = useState(false)

  const toggleInspector = useCallback(() => setInspectorOpen((prev) => !prev), [])

  return (
    <div className="flex h-svh flex-col bg-background">
      <Header
        inspectorOpen={inspectorOpen}
        onToggleInspector={toggleInspector}
      />

      {/* Content area: sidebar + main + inspector */}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />

        {/* Main content area — vertically centered */}
        <main className="flex flex-1 items-center justify-center transition-all duration-300 ease-in-out">
          <div className="flex w-full flex-col items-center gap-8">
            <AnimatedGreeting />
            <ChatBox />
          </div>
        </main>

        {/* Right inspector panel */}
        <InspectorPanel open={inspectorOpen} onClose={toggleInspector} />
      </div>

      <Footer />
    </div>
  )
}
