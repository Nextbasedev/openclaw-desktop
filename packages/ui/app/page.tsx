"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { invoke } from "@/lib/ipc"
import { Header } from "@/common/Header"
import { Sidebar, DEFAULT_DRAGGABLE_ITEMS } from "@/components/sidebar"
import type { SidebarNavItem, ActiveTopic, ActiveChat } from "@/components/sidebar"
import { Footer } from "@/components/Footer"
import { ChatBox } from "@/components/ChatBox"
import { AnimatedGreeting } from "@/components/AnimatedGreeting"
import { InspectorPanel } from "@/components/inspector/InspectorPanel"
import { SkillPage } from "@/components/SkillPage"
import { SettingsDashboard } from "@/components/settings/SettingsDashboard"
import { NotificationDashboard } from "@/components/notifications/NotificationDashboard"
import { useTerminalShortcut } from "@/hooks/useTerminalShortcut"
import { useAppShortcuts } from "@/hooks/useAppShortcuts"
import { useTopicSession } from "@/hooks/useTopicSession"
import ConnectPage from "@/components/ConnectPage"
import { ChatView } from "@/components/ChatView"
import { useOnboardingFlow } from "@/components/onboarding"
import { CommandPalette } from "@/components/CommandPalette"
import { useTheme } from "next-themes"
import { AppLoadingSkeleton } from "@/components/Skeleton/AppLoadingSkeleton"
import { VscLayoutSidebarRightOff } from "react-icons/vsc"

type SlugSegments = { primary: string; secondary?: string }

function toSlug(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}

const SIDEBAR_MIN = 160
const SIDEBAR_MAX = 480
const SIDEBAR_DEFAULT = 220
const SIDEBAR_COLLAPSED = 56

export default function Page() {
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null)
  const { flowState, loading: onboardingLoading, error: onboardingError } = useOnboardingFlow()
  const [hasToken, setHasToken] = useState<boolean | null>(null)

  useEffect(() => {
    async function checkToken() {
      try {
        const s = await invoke<{ gatewayToken?: string }>("middleware_connect_status", { input: {} })
        setHasToken(!!s.gatewayToken)
      } catch {
        setHasToken(false)
      }
    }
    checkToken()
  }, [])

  useEffect(() => {
    if (onboardingLoading || hasToken === null) return
    // Skip onboarding wizard entirely and move to AppShell
    setOnboardingDone(true)
  }, [onboardingLoading, hasToken])

  if (onboardingDone === null) {
    return <AppLoadingSkeleton />
  }

  // Redirect to connect if token is missing
  return <AppShell onResetOnboarding={() => setOnboardingDone(false)} initialConnect={!hasToken} />
}

function AppShell({ onResetOnboarding, initialConnect }: { onResetOnboarding: () => void; initialConnect?: boolean }) {
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT)
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth >= 1024 : true
  )
  const [terminalActive, setTerminalActive] = useState(false)
  const [activeTab, setActiveTab] = useState(() => {
    if (typeof window === "undefined") return "chat"
    const p = window.location.pathname
    if (p.startsWith("/skill")) return "skill"
    if (p.startsWith("/connect")) return "connect"
    if (p.startsWith("/settings")) return "settings"
    if (p.startsWith("/notifications")) return "notifications"
    // If it's the first time and we're at root, default to connect
    if (initialConnect && p === "/") return "connect"
    return "chat"
  })

  const [projectSlug, setProjectSlug] = useState<SlugSegments | null>(() => {
    if (typeof window === "undefined") return null
    const p = window.location.pathname
    const segments = p.split("/").filter(Boolean)
    if (segments.length === 2) {
      return {
        primary: decodeURIComponent(segments[0]),
        secondary: decodeURIComponent(segments[1]),
      }
    }
    return null
  })

  const prevTabRef = useRef("chat")
  const [sidebarItems, setSidebarItems] = useState<SidebarNavItem[]>(DEFAULT_DRAGGABLE_ITEMS)

  // Project / topic / session navigation state
  const [activeTopic, setActiveTopic] = useState<ActiveTopic | null>(null)
  const [activeSessionKey, setActiveSessionKey] = useState<string | null>(null)
  const [activeSessionTitle, setActiveSessionTitle] = useState<string | null>(null)

  // Standalone chat navigation state
  const [activeChat, setActiveChat] = useState<ActiveChat | null>(null)
  const [chatRefreshTrigger, setChatRefreshTrigger] = useState(0)
  const activeChatRef = useRef<ActiveChat | null>(null)
  activeChatRef.current = activeChat

  type OptimisticMsg = { messageId: string; role: "user"; text: string; createdAt: string; isOptimistic: true }
  const [initialMessages, setInitialMessages] = useState<OptimisticMsg[] | undefined>()

  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null)
  const [focusActivityTrigger, setFocusActivityTrigger] = useState(0)
  const isResizing = useRef(false)

  const { flowState, signOut, deleteAccount } = useOnboardingFlow()
  const { resolvedTheme, setTheme } = useTheme()

  const handleSelectTool = useCallback((_toolCallId: string) => {
    if (!inspectorOpen) setInspectorOpen(true)
    setFocusActivityTrigger((n) => n + 1)
  }, [inspectorOpen])

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
    window.history.pushState(null, "", "/settings")
  }, [activeTab])

  const openNotifications = useCallback(() => {
    prevTabRef.current = activeTab === "notifications" ? "chat" : activeTab
    setActiveTab("notifications")
    window.history.pushState(null, "", "/notifications")
  }, [activeTab])

  const handleSettingsBack = useCallback(() => {
    setActiveTab(prevTabRef.current)
    const url = prevTabRef.current === "skill"
      ? "/skill"
      : prevTabRef.current === "connect"
        ? "/connect"
        : "/"
    window.history.pushState(null, "", url)
  }, [])
  const toggleTheme = useCallback(() => {
    setTheme(resolvedTheme === "dark" ? "light" : "dark")
  }, [resolvedTheme, setTheme])

  useEffect(() => {
    if (initialConnect && activeTab === "connect" && typeof window !== "undefined" && window.location.pathname === "/") {
      window.history.replaceState(null, "", "/connect")
    }
  }, [initialConnect, activeTab])

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
        handleNewChat()
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

  const pushSlugUrl = useCallback(
    (prefix: string, primary: string, secondary?: string) => {
      const path = secondary
        ? `/${prefix}/${toSlug(primary)}/${toSlug(secondary)}`
        : `/${prefix}/${toSlug(primary)}`
      window.history.pushState(null, "", path)
    },
    [],
  )

  // Topic selected from sidebar → auto-resolve its session
  const handleTopicSelect = useCallback((topic: ActiveTopic) => {
    setActiveTab("chat")
    setActiveTopic(topic)
    setActiveChat(null)
    setActiveSessionKey(null)
    setActiveSessionTitle(null)
    pushSlugUrl(toSlug(topic.projectName), topic.name)
    setProjectSlug({ primary: topic.projectName, secondary: topic.name })
  }, [pushSlugUrl])

  // Standalone chat selected from sidebar
  const handleChatSelect = useCallback(async (chat: ActiveChat) => {
    setActiveTab("chat")
    setActiveChat(chat)
    setActiveTopic(null)
    setActiveSessionKey(null)
    setActiveSessionTitle(null)
    setInitialMessages(undefined)
    setProjectSlug(null)
    window.history.pushState(null, "", `/${toSlug(chat.name)}`)

    if (chat.sessionKey) {
      setActiveSessionKey(chat.sessionKey)
      setActiveSessionTitle(chat.name)
    } else {
      try {
        const sessionResult = await invoke<{ session: { key: string } }>(
          "middleware_sessions_create",
          { input: { agentId: "main", label: chat.name } },
        )
        await invoke("middleware_chats_attach_session", {
          input: { chatId: chat.id, sessionKey: sessionResult.session.key },
        })
        setActiveSessionKey(sessionResult.session.key)
        setActiveSessionTitle(chat.name)
      } catch (err) {
        console.error("Failed to create session for chat", err)
      }
    }
  }, [])

  const handleChatClear = useCallback(() => {
    setActiveChat(null)
    setActiveSessionKey(null)
    setActiveSessionTitle(null)
    setInitialMessages(undefined)
    window.history.pushState(null, "", "/")
  }, [])

  const handleNewChat = useCallback(async () => {
    try {
      const listResult = await invoke<{ chats: { id: string; name: string; sessionKey?: string; archived: boolean }[] }>(
        "middleware_chats_list",
        { input: {} },
      )
      const blankChat = (listResult.chats || []).find(
        (c) => !c.archived && c.name === "New Chat",
      )

      if (blankChat) {
        if (activeChatRef.current?.id === blankChat.id) return
        setInitialMessages(undefined)
        setActiveTab("chat")
        setActiveTopic(null)
        setProjectSlug(null)

        if (blankChat.sessionKey) {
          setActiveChat({ id: blankChat.id, name: blankChat.name, sessionKey: blankChat.sessionKey })
          setActiveSessionKey(blankChat.sessionKey)
          setActiveSessionTitle(blankChat.name)
        } else {
          const sessionResult = await invoke<{ session: { key: string } }>(
            "middleware_sessions_create",
            { input: { agentId: "main", label: blankChat.name } },
          )
          await invoke("middleware_chats_attach_session", {
            input: { chatId: blankChat.id, sessionKey: sessionResult.session.key },
          })
          setActiveChat({ id: blankChat.id, name: blankChat.name, sessionKey: sessionResult.session.key })
          setActiveSessionKey(sessionResult.session.key)
          setActiveSessionTitle(blankChat.name)
        }
        window.history.pushState(null, "", "/")
        return
      }

      const result = await invoke<{ chat: { id: string; name: string; sessionKey?: string } }>(
        "middleware_chats_create",
        { input: {} },
      )
      const sessionResult = await invoke<{ session: { key: string } }>(
        "middleware_sessions_create",
        { input: { agentId: "main", label: result.chat.name } },
      )
      await invoke("middleware_chats_attach_session", {
        input: { chatId: result.chat.id, sessionKey: sessionResult.session.key },
      })
      setInitialMessages(undefined)
      setActiveTab("chat")
      setActiveTopic(null)
      setProjectSlug(null)
      setActiveChat({ id: result.chat.id, name: result.chat.name, sessionKey: sessionResult.session.key })
      setActiveSessionKey(sessionResult.session.key)
      setActiveSessionTitle(result.chat.name)
      setChatRefreshTrigger((n) => n + 1)
      window.history.pushState(null, "", "/")
    } catch (err) {
      console.error("Failed to create new chat", err)
    }
  }, [])

  // Auto-name standalone chat after first message
  const handleFirstMessageSent = useCallback(async (text: string) => {
    const chat = activeChatRef.current
    if (!chat) return
    try {
      const { name } = await invoke<{ name: string }>(
        "middleware_autonaming_quick",
        { input: { text } },
      )
      await invoke("middleware_chats_rename", {
        input: { chatId: chat.id, name },
      })
      setActiveChat((prev) => prev ? { ...prev, name } : prev)
      setActiveSessionTitle(name)
      setChatRefreshTrigger((n) => n + 1)
      window.history.pushState(null, "", `/${toSlug(name)}`)
    } catch (err) {
      console.error("Auto-naming chat failed", err)
    }
  }, [])

  // Called by useTopicSession when session is found/created
  const handleSessionResolved = useCallback((key: string, title: string) => {
    setActiveSessionKey(key)
    setActiveSessionTitle(title)
  }, [])

  const { resolving: sessionResolving, error: sessionError } = useTopicSession(
    activeTopic, activeSessionKey, handleSessionResolved,
  )

  const [quickSending, setQuickSending] = useState(false)

  const handleQuickSend = useCallback(async (text: string) => {
    if (quickSending || !text.trim()) return
    setQuickSending(true)
    try {
      const result = await invoke<{ chat: { id: string; name: string } }>(
        "middleware_chats_create",
        { input: {} },
      )
      const sessionResult = await invoke<{ session: { key: string } }>(
        "middleware_sessions_create",
        { input: { agentId: "main", label: result.chat.name } },
      )
      await invoke("middleware_chats_attach_session", {
        input: { chatId: result.chat.id, sessionKey: sessionResult.session.key },
      })
      await invoke("middleware_chat_send", {
        input: { sessionKey: sessionResult.session.key, text: text.trim() },
      })

      const { name } = await invoke<{ name: string }>(
        "middleware_autonaming_quick",
        { input: { text: text.trim() } },
      )
      await invoke("middleware_chats_rename", {
        input: { chatId: result.chat.id, name },
      })

      setInitialMessages([{
        messageId: crypto.randomUUID(),
        role: "user",
        text: text.trim(),
        createdAt: new Date().toISOString(),
        isOptimistic: true,
      }])
      setActiveTopic(null)
      setProjectSlug(null)
      setActiveChat({ id: result.chat.id, name, sessionKey: sessionResult.session.key })
      setActiveSessionKey(sessionResult.session.key)
      setActiveSessionTitle(name)
      setChatRefreshTrigger((n) => n + 1)
      window.history.pushState(null, "", `/${toSlug(name)}`)
    } catch (err) {
      console.error("Quick send failed", err)
    } finally {
      setQuickSending(false)
    }
  }, [quickSending])

  // Nav tab change → clear project context + sync URL
  const handleTabChange = useCallback((tab: string) => {
    if (tab === "chat") {
      handleNewChat()
      if (!sidebarOpen) setSidebarOpen(true)
      return
    }
    setActiveTab(tab)
    const tabUrls: Record<string, string> = {
      skill: "/skill",
      connect: "/connect",
      settings: "/settings",
      notifications: "/notifications",
    }
    const url = tabUrls[tab] ?? "/"
    window.history.pushState(null, "", url)
    setActiveTopic(null)
    setActiveChat(null)
    setActiveSessionKey(null)
    setActiveSessionTitle(null)
    setProjectSlug(null)
    if (!sidebarOpen) setSidebarOpen(true)
  }, [sidebarOpen, handleNewChat])

  // Compute the center label for the header
  const centerLabel = activeTopic
    ? { project: activeTopic.projectName, topic: activeTopic.name }
    : activeChat
      ? { project: "Chat", topic: activeChat.name }
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
        onOpenNotifications={openNotifications}
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
          onTopicClear={() => { setActiveTopic(null); setActiveSessionKey(null); setActiveSessionTitle(null); setProjectSlug(null); window.history.pushState(null, "", "/") }}
          activeChat={activeChat}
          onChatSelect={handleChatSelect}
          onChatClear={handleChatClear}
          onNewChat={handleNewChat}
          chatRefreshTrigger={chatRefreshTrigger}
        />

        <div className="flex flex-1 flex-col overflow-hidden">
          <main className="flex flex-1 items-start justify-center overflow-hidden transition-all duration-300 ease-in-out">
            <MainContent
              activeTab={activeTab}
              activeTopic={activeTopic}
              activeChat={activeChat}
              activeSessionKey={activeSessionKey}
              activeSessionTitle={activeSessionTitle}
              onSignOut={handleSignOut}
              onDeleteAccount={handleDeleteAccount}
              flowState={flowState}
              sessionResolving={sessionResolving}
              sessionError={sessionError}
              onSettingsBack={handleSettingsBack}
              onFirstMessageSent={handleFirstMessageSent}
              onQuickSend={handleQuickSend}
              quickSending={quickSending}
              initialMessages={initialMessages}
              onSelectTool={handleSelectTool}
              pendingPrompt={pendingPrompt}
              onNavigateToChat={handleChatSelect}
            />
          </main>
        </div>

        <InspectorPanel
          open={inspectorOpen}
          onClose={toggleInspector}
          terminalActive={terminalActive}
          onTerminalActiveChange={setTerminalActive}
          sessionKey={activeSessionKey}
          focusActivityTrigger={focusActivityTrigger}
          projectId={activeTopic?.projectId ?? null}
        />
      </div>

      <Footer
        terminalOpen={terminalActive}
        onToggleTerminal={toggleTerminal}
      />

      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        onNavigateChat={() => { setPendingPrompt(null); handleNewChat() }}
        onNewChat={() => { setPendingPrompt(null); handleNewChat() }}
        onSendPrompt={(prompt) => { setPendingPrompt(prompt); handleNewChat() }}
        onOpenSettings={openSettings}
        onToggleTerminal={toggleTerminal}
        onToggleTheme={toggleTheme}
      />
    </div>
  )
}

function MainContent({
  activeTab,
  activeTopic,
  activeChat,
  activeSessionKey,
  activeSessionTitle,
  onSignOut,
  onDeleteAccount,
  flowState,
  sessionResolving,
  sessionError,
  onSettingsBack,
  onFirstMessageSent,
  onQuickSend,
  quickSending,
  initialMessages,
  onSelectTool,
  pendingPrompt,
  onNavigateToChat,
}: {
  activeTab: string
  activeTopic: ActiveTopic | null
  activeChat: ActiveChat | null
  activeSessionKey: string | null
  activeSessionTitle: string | null
  onSignOut: () => void
  onDeleteAccount: () => void
  flowState: import("@/components/onboarding/useOnboardingFlow").FlowState | null
  sessionResolving: boolean
  sessionError: string | null
  onSettingsBack: () => void
  onFirstMessageSent: (text: string) => void
  onQuickSend: (text: string) => void
  quickSending: boolean
  initialMessages?: import("@/components/ChatView/types").ChatMessage[]
  onSelectTool?: (toolCallId: string) => void
  pendingPrompt?: string | null
  onNavigateToChat?: (chat: ActiveChat) => void
}) {
  // 0. Settings and notifications always take priority
  if (activeTab === "settings") {
    return (
      <div className="flex h-full w-full">
        <SettingsDashboard onBack={onSettingsBack} />
      </div>
    )
  }

  if (activeTab === "notifications") {
    return (
      <div className="flex h-full w-full">
        <NotificationDashboard
          onBack={onSettingsBack}
          onNavigateToChat={onNavigateToChat}
        />
      </div>
    )
  }

  // 1. Session history view (deepest level — topic or standalone chat)
  if (activeSessionKey && (activeTopic || activeChat)) {
    return (
      <div className="flex h-full w-full">
        <ChatView
          sessionKey={activeSessionKey}
          sessionTitle={activeSessionTitle ?? undefined}
          onFirstMessageSent={activeChat ? onFirstMessageSent : undefined}
          initialMessages={activeChat ? initialMessages : undefined}
          onSelectTool={onSelectTool}
          initialPrompt={pendingPrompt ?? undefined}
        />
      </div>
    )
  }

  // 1b. Standalone chat selected, session resolving
  if (activeChat && !activeSessionKey) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-foreground/50" />
          <span className="text-[13px] text-muted-foreground">Opening chat...</span>
        </div>
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

  // Default: chat / greeting
  return (
    <div className="flex min-h-full w-full flex-col items-center justify-center gap-8 py-10">
      <AnimatedGreeting />
      <ChatBox onSend={onQuickSend} disabled={quickSending} />
    </div>
  )
}


