"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { Header } from "@/common/Header"
import { Sidebar, DEFAULT_DRAGGABLE_ITEMS } from "@/components/sidebar"
import type { SidebarNavItem, ActiveTopic } from "@/components/sidebar"
import { Footer } from "@/components/Footer"
import { ChatBox } from "@/components/ChatBox"
import { AnimatedGreeting } from "@/components/AnimatedGreeting"
import { InspectorPanel } from "@/components/inspector/InspectorPanel"
import { SkillPage } from "@/components/SkillPage"
import { SettingsDashboard } from "@/components/settings/SettingsDashboard"
import { useTerminalShortcut } from "@/hooks/useTerminalShortcut"
import { useAppShortcuts } from "@/hooks/useAppShortcuts"
import { useQuickChat } from "@/hooks/useQuickChat"
import { useTopicSession } from "@/hooks/useTopicSession"
import ConnectPage from "@/app/connect/page"
import { ChatView } from "@/components/ChatView"
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
      const steps = flowState.flow.steps
      const essentialsDone = steps
        .filter((s) => s.id !== "core")
        .every((s) => s.complete)
      setOnboardingDone(flowState.flow.completed || essentialsDone)
    } else if (onboardingError) {
      setOnboardingDone(false)
    }
  }, [onboardingLoading, flowState, onboardingError])

  if (onboardingDone === null) {
    return <AppLoadingSkeleton />
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
  const prevTabRef = useRef("chat")
  const [sidebarItems, setSidebarItems] = useState<SidebarNavItem[]>(DEFAULT_DRAGGABLE_ITEMS)
  const [chatKey, setChatKey] = useState(0)
  const [pendingPrompt, setPendingPrompt] = useState<string | undefined>()

  // Project / topic / session navigation state
  const [activeTopic, setActiveTopic] = useState<ActiveTopic | null>(null)
  const [activeSessionKey, setActiveSessionKey] = useState<string | null>(null)
  const [activeSessionTitle, setActiveSessionTitle] = useState<string | null>(null)

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

  const openSettings = useCallback(() => {
    prevTabRef.current = activeTab === "settings" ? "chat" : activeTab
    setActiveTab("settings")
  }, [activeTab])

  const handleSettingsBack = useCallback(() => {
    setActiveTab(prevTabRef.current)
  }, [])
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

  // Ctrl/Cmd+N → new chat, clear project context
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
        e.preventDefault()
        setActiveTab("chat")
        setActiveTopic(null)
        setActiveSessionKey(null)
        setActiveSessionTitle(null)
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

  // Topic selected from sidebar → auto-resolve its session
  const handleTopicSelect = useCallback((topic: ActiveTopic) => {
    setActiveTopic(topic)
    setActiveSessionKey(null)
    setActiveSessionTitle(null)
  }, [])

  // Called by useTopicSession when session is found/created
  const handleSessionResolved = useCallback((key: string, title: string) => {
    setActiveSessionKey(key)
    setActiveSessionTitle(title)
  }, [])

  // Navigate directly to a chat (topic + session set atomically)
  const navigateToChat = useCallback((topic: ActiveTopic, sessionKey: string, title: string) => {
    setActiveTopic(topic)
    setActiveSessionKey(sessionKey)
    setActiveSessionTitle(title)
  }, [])

  // Auto-resolve session when topic is selected without a session
  const { resolving: sessionResolving, error: sessionError } = useTopicSession(
    activeTopic, activeSessionKey, handleSessionResolved,
  )

  const { handleQuickChat, sending: quickChatSending, error: quickChatError } = useQuickChat({
    navigateToChat,
  })

  // Nav tab change → clear project context
  const handleTabChange = useCallback((tab: string) => {
    setActiveTab(tab)
    setActiveTopic(null)
    setActiveSessionKey(null)
    setActiveSessionTitle(null)
    if (!sidebarOpen) setSidebarOpen(true)
  }, [sidebarOpen])

  // Compute the center label for the header
  const centerLabel = activeSessionKey && activeSessionTitle && activeTopic
    ? `${activeTopic.projectName} › ${activeTopic.name} › ${activeSessionTitle}`
    : activeTopic
      ? `${activeTopic.projectName} › ${activeTopic.name}`
      : null

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
        centerLabel={centerLabel}
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
          activeTopic={activeTopic}
          onTopicSelect={handleTopicSelect}
        />

        <div className="flex flex-1 flex-col overflow-hidden">
          <main className="flex flex-1 items-start justify-center overflow-hidden transition-all duration-300 ease-in-out">
            <MainContent
              activeTab={activeTab}
              chatKey={chatKey}
              pendingPrompt={pendingPrompt}
              activeTopic={activeTopic}
              activeSessionKey={activeSessionKey}
              activeSessionTitle={activeSessionTitle}
              onSignOut={handleSignOut}
              onDeleteAccount={handleDeleteAccount}
              flowState={flowState}
              onQuickChat={handleQuickChat}
              quickChatSending={quickChatSending}
              quickChatError={quickChatError}
              sessionResolving={sessionResolving}
              sessionError={sessionError}
              onSettingsBack={handleSettingsBack}
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
        terminalOpen={terminalActive}
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
  activeTopic,
  activeSessionKey,
  activeSessionTitle,
  onSignOut,
  onDeleteAccount,
  flowState,
  onQuickChat,
  quickChatSending,
  quickChatError,
  sessionResolving,
  sessionError,
  onSettingsBack,
}: {
  activeTab: string
  chatKey: number
  pendingPrompt?: string
  activeTopic: ActiveTopic | null
  activeSessionKey: string | null
  activeSessionTitle: string | null
  onSignOut: () => void
  onDeleteAccount: () => void
  flowState: import("@/components/onboarding/useOnboardingFlow").FlowState | null
  onQuickChat: (text: string) => void
  quickChatSending: boolean
  quickChatError: string | null
  sessionResolving: boolean
  sessionError: string | null
  onSettingsBack: () => void
}) {
  // 1. Session history view (deepest level)
  if (activeSessionKey && activeTopic) {
    return (
      <div className="flex h-full w-full">
        <ChatView sessionKey={activeSessionKey} sessionTitle={activeSessionTitle ?? undefined} />
      </div>
    )
  }

  // 2. Topic selected, session resolving → loading
  if (activeTopic && sessionResolving) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-foreground/50" />
          <span className="text-[13px] text-muted-foreground">Opening conversation...</span>
        </div>
      </div>
    )
  }

  // 3. Topic selected, session failed → error
  if (activeTopic && sessionError) {
    return (
      <div className="flex h-full w-full items-center justify-center px-8">
        <div className="rounded-xl border border-red-400/20 bg-red-400/5 px-5 py-4 text-center">
          <p className="text-sm font-medium text-red-400">Failed to open conversation</p>
          <p className="mt-1 text-xs text-muted-foreground">{sessionError}</p>
        </div>
      </div>
    )
  }

  // 4. Topic selected, waiting for effect to start → show loading
  if (activeTopic && !activeSessionKey) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-foreground/50" />
          <span className="text-[13px] text-muted-foreground">Opening conversation...</span>
        </div>
      </div>
    )
  }

  // 5. Normal tab views
  if (activeTab === "skill") return <SkillPage />
  if (activeTab === "connect") return <ConnectPage />
  if (activeTab === "settings") {
    return (
      <div className="flex h-full w-full">
        <SettingsDashboard
          onBack={onSettingsBack}
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
      </div>
    )
  }

  // 4. Default: chat / greeting
  return (
    <div
      key={`${activeTab}-${chatKey}`}
      className="flex min-h-full w-full flex-col items-center justify-center gap-8 py-10"
    >
      <AnimatedGreeting />
      <ChatBox initialPrompt={pendingPrompt} onSend={onQuickChat} disabled={quickChatSending} />
      {quickChatError && (
        <div className="mx-auto w-full max-w-3xl px-4">
          <div className="rounded-xl border border-red-400/20 bg-red-400/5 px-4 py-3 text-center">
            <p className="text-sm text-red-400">{quickChatError}</p>
          </div>
        </div>
      )}
    </div>
  )
}

function AppLoadingSkeleton() {
  return (
    <div className="flex h-svh flex-col bg-background">
      {/* Header skeleton */}
      <div className="flex h-12 items-center border-b border-border/40 px-4">
        <div className="h-4 w-20 animate-pulse rounded bg-muted/25" />
        <div className="flex-1" />
        <div className="flex items-center gap-3">
          <div className="size-5 animate-pulse rounded bg-muted/20" />
          <div className="size-5 animate-pulse rounded bg-muted/20" />
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar skeleton */}
        <div className="flex w-[220px] shrink-0 flex-col border-r border-border/40 px-3 py-4">
          <div className="space-y-3">
            <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
              <div className="size-4 animate-pulse rounded bg-muted/30" />
              <div className="h-3.5 w-12 animate-pulse rounded bg-muted/30" />
            </div>
            <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
              <div className="size-4 animate-pulse rounded bg-muted/20" />
              <div className="h-3.5 w-10 animate-pulse rounded bg-muted/20" />
            </div>
            <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
              <div className="size-4 animate-pulse rounded bg-muted/20" />
              <div className="h-3.5 w-16 animate-pulse rounded bg-muted/20" />
            </div>
          </div>
          <div className="mt-8 px-2">
            <div className="mb-3 h-3 w-16 animate-pulse rounded bg-muted/20" />
            <div className="flex items-center gap-2.5 py-2">
              <div className="size-4 animate-pulse rounded bg-muted/20" />
              <div className="h-3.5 w-14 animate-pulse rounded bg-muted/20" />
            </div>
          </div>
        </div>

        {/* Main content skeleton */}
        <div className="flex flex-1 flex-col items-center justify-center gap-8">
          <div className="h-9 w-80 animate-pulse rounded-lg bg-muted/20" />
          <div className="w-full max-w-2xl px-8">
            <div className="h-28 w-full animate-pulse rounded-2xl border border-border/30 bg-muted/10" />
          </div>
        </div>
      </div>
    </div>
  )
}
