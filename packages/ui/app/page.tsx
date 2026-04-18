"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { Header } from "@/common/Header"
import { Sidebar } from "@/components/sidebar"
import { Footer } from "@/components/Footer"
import { ChatBox } from "@/components/ChatBox"
import { AnimatedGreeting } from "@/components/AnimatedGreeting"
import { InspectorPanel } from "@/components/inspector/InspectorPanel"

const SIDEBAR_MIN = 160
const SIDEBAR_MAX = 480
const SIDEBAR_DEFAULT = 220

export default function Page() {
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT)
  const isResizing = useRef(false)

  const toggleInspector = useCallback(() => setInspectorOpen((prev) => !prev), [])

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
      />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          width={sidebarWidth}
          onResizeStart={handleResizeStart}
        />

        <main className="flex flex-1 items-center justify-center">
          <div className="flex w-full flex-col items-center gap-8">
            <AnimatedGreeting />
            <ChatBox />
          </div>
        </main>

        <InspectorPanel open={inspectorOpen} onClose={toggleInspector} />
      </div>

      <Footer />
    </div>
  )
}
