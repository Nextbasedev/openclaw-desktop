"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { Header } from "@/common/Header"
import { Sidebar, DEFAULT_DRAGGABLE_ITEMS } from "@/components/sidebar"
import type { SidebarNavItem } from "@/components/sidebar"
import { Footer } from "@/components/Footer"
import { ChatBox } from "@/components/ChatBox"
import { AnimatedGreeting } from "@/components/AnimatedGreeting"
import { InspectorPanel } from "@/components/inspector/InspectorPanel"
import { SkillPage } from "@/components/SkillPage"
import { SettingsDashboard } from "@/components/settings/SettingsDashboard"
import { useTerminalShortcut } from "@/hooks/useTerminalShortcut"
import { useAppShortcuts } from "@/hooks/useAppShortcuts"
import ConnectPage from "@/app/connect/page"
import { OnboardingWizard, useOnboardingFlow } from "@/components/onboarding"
import { CommandPalette } from "@/components/CommandPalette"
import { useTheme } from "next-themes"

const SIDEBAR_MIN = 160
const SIDEBAR_MAX = 480
const SIDEBAR_DEFAULT = 220
const SIDEBAR_COLLAPSED = 56

export default function Page() {
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null)
  const { flowState, loading: onboardingLoading, error: onboardingError } = useOnboardingFlow()

  useEffect(() => {
    if (onboardingLoading) return
    if (flowState) {
      setOnboardingDone(flowState.flow.completed)
    } else if (onboardingError) {
      setOnboardingDone(false)
    }
  }, [onboardingLoading, flowState, onboardingError])

  if (onboardingDone === null) {
    return (
      <div className="flex h-svh items-center justify-center bg-background">
        <span className="text-sm text-muted-foreground">Loading...</span>
      </div>
    )
  }

  if (!onboardingDone) {
    return <OnboardingWizard onComplete={() => setOnboardingDone(true)} />
  }

  return <AppShell onResetOnboarding={() => setOnboardingDone(false)} />
}

function AppShell({ onResetOnboarding }: { onResetOnboarding: () => void }) {
  const [inspectorOpen, setInspectorOpen] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth >= 1280 : false
  )
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT)
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth >= 1024 : true
  )
  const [terminalActive, setTerminalActive] = useState(false)
  const [activeTab, setActiveTab] = useState("chat")
  const [sidebarItems, setSidebarItems] = useState<SidebarNavItem[]>(DEFAULT_DRAGGABLE_ITEMS)
  const [chatKey, setChatKey] = useState(0)
  const [pendingPrompt, setPendingPrompt] = useState<string | undefined>()
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const isResizing = useRef(false)

  const { flowState, signOut, deleteAccount } = useOnboardingFlow()
  const { resolvedTheme, setTheme } = useTheme()

  const toggleInspector = useCallback(() => setInspectorOpen((prev) => !prev), [])
  const toggleTerminal = useCallback(() => {
    if (inspectorOpen && terminalActive) {
      setInspectorOpen(false)
      setTerminalActive(false)
    } else {
      setInspectorOpen(true)
      setTerminalActive(true)
    }
  }, [inspectorOpen, terminalActive])
  const toggleSidebar = useCallback(() => setSidebarOpen((prev) => !prev), [])

  const openSettings = useCallback(() => setActiveTab("settings"), [])
  const toggleTheme = useCallback(() => {
    setTheme(resolvedTheme === "dark" ? "light" : "dark")
  }, [resolvedTheme, setTheme])

  useEffect(() => {
    function onResize() {
      const w = window.innerWidth
      if (w < 1024) {
        setSidebarOpen(false)
        setInspectorOpen(false)
      }
    }
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  useTerminalShortcut(toggleTerminal)
  useAppShortcuts()

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
        e.preventDefault()
        setActiveTab("chat")
        setChatKey((k) => k + 1)
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setCommandPaletteOpen((prev) => !prev)
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
    setActiveTab(tab)
    if (!sidebarOpen) setSidebarOpen(true)
  }, [sidebarOpen])

  const handleSignOut = useCallback(async () => {
    await signOut()
    onResetOnboarding()
  }, [signOut, onResetOnboarding])

  const handleDeleteAccount = useCallback(async () => {
    await deleteAccount()
    onResetOnboarding()
  }, [deleteAccount, onResetOnboarding])

  return (
    <div className="flex h-svh flex-col bg-background">
      <Header
        inspectorOpen={inspectorOpen}
        onToggleInspector={toggleInspector}
        terminalOpen={terminalActive}
        onToggleTerminal={toggleTerminal}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={toggleSidebar}
        onOpenSettings={openSettings}
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
        />

        <div className="flex flex-1 flex-col overflow-hidden">
          <main className="flex flex-1 items-start justify-center overflow-y-auto transition-all duration-300 ease-in-out">
            <MainContent
              activeTab={activeTab}
              chatKey={chatKey}
              pendingPrompt={pendingPrompt}
              onTabChange={handleTabChange}
              onSignOut={handleSignOut}
              onDeleteAccount={handleDeleteAccount}
              flowState={flowState}
            />
          </main>
        </div>

        <InspectorPanel
          open={inspectorOpen}
          onClose={toggleInspector}
          terminalActive={terminalActive}
          onTerminalActiveChange={setTerminalActive}
        />
      </div>

      <Footer
        onToggleTerminal={toggleTerminal}
      />

      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        onNavigateChat={() => { setActiveTab("chat") }}
        onNewChat={() => { setActiveTab("chat"); setPendingPrompt(undefined); setChatKey((k) => k + 1) }}
        onSendPrompt={(prompt) => { setActiveTab("chat"); setPendingPrompt(prompt); setChatKey((k) => k + 1) }}
        onOpenSettings={openSettings}
        onToggleTerminal={toggleTerminal}
        onToggleTheme={toggleTheme}
      />
    </div>
  )
}

function MainContent({
  activeTab,
  chatKey,
  pendingPrompt,
  onTabChange,
  onSignOut,
  onDeleteAccount,
  flowState,
}: {
  activeTab: string
  chatKey: number
  pendingPrompt?: string
  onTabChange: (tab: string) => void
  onSignOut: () => void
  onDeleteAccount: () => void
  flowState: import("@/components/onboarding/useOnboardingFlow").FlowState | null
}) {
  if (activeTab === "skill") return <SkillPage />
  if (activeTab === "connect") return <ConnectPage />
  if (activeTab === "project") return <div className="text-muted-foreground italic">Project files...</div>

  if (activeTab === "settings") {
    return (
      <SettingsDashboard
        onBack={() => onTabChange("chat")}
        onSignOut={onSignOut}
        onDeleteAccount={onDeleteAccount}
        accountData={{
          botName: flowState?.state.bot.botName || "Not configured",
          provider: flowState?.state.provider.selection
            ? `${flowState.state.provider.selection.providerId} (${flowState.state.provider.selection.authMethod || "default"})`
            : "No provider selected",
          model: flowState?.state.model.selectedModelRef || "No model selected",
        }}
      />
    )
  }

  return (
    <div key={`${activeTab}-${chatKey}`} className="flex min-h-full w-full flex-col items-center justify-center gap-8 py-10">
      <AnimatedGreeting />
      <ChatBox initialPrompt={pendingPrompt} />
    </div>
  )
}
