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
import { fallbackChatNameFromText, isWeakChatName } from "@/utils/chatDisplayName"
import { useTheme } from "next-themes"
import { AppLoadingSkeleton } from "@/components/Skeleton/AppLoadingSkeleton"
import type { ChatComposerSubmit } from "@/lib/chatAttachments"
import { VscLayoutSidebarRightOff } from "react-icons/vsc"

const TABS = new Set(["skill", "connect", "settings", "notifications"])
const CRON_SESSION_TARGETS = new Set(["isolated", "main", "current"])

type ParsedRoute =
  | { kind: "chat"; chatId: string }
  | { kind: "topic"; projectId: string; topicId: string }
  | { kind: "tab"; tab: string }
  | { kind: "home" }

function parseRoute(pathname: string): ParsedRoute {
  const segments = pathname.split("/").filter(Boolean)
  if (segments.length === 1 && segments[0]) {
    if (TABS.has(segments[0])) return { kind: "tab", tab: segments[0] }
    return { kind: "chat", chatId: segments[0] }
  }
  if (segments.length === 2 && segments[0] && segments[1]) {
    return { kind: "topic", projectId: segments[0], topicId: segments[1] }
  }
  return { kind: "home" }
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
    setOnboardingDone(true)
  }, [onboardingLoading, hasToken])

  if (onboardingDone === null) {
    return <AppLoadingSkeleton />
  }

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
    const route = parseRoute(window.location.pathname)
    if (route.kind === "tab") return route.tab
    if (initialConnect && route.kind === "home") return "connect"
    return "chat"
  })

  const prevTabRef = useRef("chat")
  const [sidebarItems, setSidebarItems] = useState<SidebarNavItem[]>(DEFAULT_DRAGGABLE_ITEMS)

  const [activeTopic, setActiveTopic] = useState<ActiveTopic | null>(null)
  const [activeSessionKey, setActiveSessionKey] = useState<string | null>(null)
  const [activeSessionTitle, setActiveSessionTitle] = useState<string | null>(null)

  // Keep the previous session alive (hidden) so its SSE connection
  // and notification logic survive when the user switches away.
  const [backgroundSessionKey, setBackgroundSessionKey] = useState<string | null>(null)
  const [backgroundSessionTitle, setBackgroundSessionTitle] = useState<string | null>(null)
  const prevActiveSessionKeyRef = useRef<string | null>(null)
  const prevActiveSessionTitleRef = useRef<string | null>(null)

  useEffect(() => {
    const prevKey = prevActiveSessionKeyRef.current
    const prevTitle = prevActiveSessionTitleRef.current
    if (prevKey && prevKey !== activeSessionKey) {
      setBackgroundSessionKey(prevKey)
      setBackgroundSessionTitle(prevTitle)
    }
    prevActiveSessionKeyRef.current = activeSessionKey
    prevActiveSessionTitleRef.current = activeSessionTitle
  }, [activeSessionKey, activeSessionTitle])

  const [activeChat, setActiveChat] = useState<ActiveChat | null>(null)
  const [chatRefreshTrigger, setChatRefreshTrigger] = useState(0)
  const activeChatRef = useRef<ActiveChat | null>(null)
  activeChatRef.current = activeChat

  type OptimisticMsg = { messageId: string; role: "user"; text: string; createdAt: string; isOptimistic: true }
  const [initialMessages, setInitialMessages] = useState<OptimisticMsg[] | undefined>()

  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null)
  const [focusActivityTrigger, setFocusActivityTrigger] = useState(0)
  const [activeAgentId, setActiveAgentId] = useState<string | null>("root")
  const isResizing = useRef(false)
  const routeRequestRef = useRef(0)
  const previousContentPathRef = useRef("/")

  const { flowState, signOut, deleteAccount } = useOnboardingFlow()
  const { resolvedTheme, setTheme } = useTheme()

  const clearConversationState = useCallback(() => {
    setActiveTopic(null)
    setActiveChat(null)
    setActiveSessionKey(null)
    setActiveSessionTitle(null)
    setInitialMessages(undefined)
  }, [])

  const activateRoute = useCallback(async (route: ParsedRoute) => {
    const requestId = ++routeRequestRef.current

    if (route.kind === "tab") {
      setPendingPrompt(null)
      setActiveTab(route.tab)
      clearConversationState()
      return
    }

    if (route.kind === "home") {
      setPendingPrompt(null)
      setActiveTab("chat")
      clearConversationState()
      return
    }

    if (route.kind === "chat") {
      setPendingPrompt(null)
      setActiveTab("chat")
      setActiveTopic(null)
      setActiveChat({ id: route.chatId, name: "Opening chat..." })
      setActiveSessionKey(null)
      setActiveSessionTitle(null)
      setInitialMessages(undefined)

      try {
        const listResult = await invoke<{
          chats: { id: string; name: string; sessionKey?: string; archived: boolean }[]
        }>("middleware_chats_list", { input: {} })
        if (requestId !== routeRequestRef.current) return

        const found = (listResult.chats || []).find(
          (c) => c.id === route.chatId && !c.archived,
        )
        if (!found) {
          clearConversationState()
          return
        }

        setActiveChat({ id: found.id, name: found.name, sessionKey: found.sessionKey })
        setActiveSessionKey(found.sessionKey ?? null)
        setActiveSessionTitle(found.name)
      } catch {
        if (requestId === routeRequestRef.current) clearConversationState()
      }
      return
    }

    if (route.kind === "topic") {
      setPendingPrompt(null)
      setActiveTab("chat")
      setActiveChat(null)
      setActiveSessionKey(null)
      setActiveSessionTitle(null)
      setInitialMessages(undefined)

      try {
        const projectResult = await invoke<{
          projects: { id: string; name: string; archived: boolean }[]
        }>("middleware_projects_list", { input: {} })
        if (requestId !== routeRequestRef.current) return

        const project = (projectResult.projects || []).find(
          (p) => p.id === route.projectId && !p.archived,
        )
        if (!project) {
          clearConversationState()
          return
        }

        const topicResult = await invoke<{
          topics: { id: string; name: string; projectId: string; archived: boolean }[]
        }>("middleware_topics_list", {
          input: { projectId: route.projectId },
        })
        if (requestId !== routeRequestRef.current) return

        const topic = (topicResult.topics || []).find(
          (t) => t.id === route.topicId && !t.archived,
        )
        if (!topic) {
          clearConversationState()
          return
        }

        setActiveTopic({
          id: topic.id,
          name: topic.name,
          projectId: project.id,
          projectName: project.name,
        })
      } catch {
        if (requestId === routeRequestRef.current) clearConversationState()
      }
    }
  }, [clearConversationState])

  // Restore state from URL on mount
  useEffect(() => {
    void activateRoute(parseRoute(window.location.pathname))
  }, [activateRoute])

  // Handle browser back/forward
  useEffect(() => {
    function onPopState() {
      void activateRoute(parseRoute(window.location.pathname))
    }
    window.addEventListener("popstate", onPopState)
    return () => window.removeEventListener("popstate", onPopState)
  }, [activateRoute])

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
  const closeSidebar = useCallback(() => setSidebarOpen(false), [])

  const openSettings = useCallback(() => {
    routeRequestRef.current += 1
    previousContentPathRef.current = window.location.pathname
    prevTabRef.current = activeTab === "settings" ? "chat" : activeTab
    setActiveTab("settings")
    clearConversationState()
    window.history.pushState(null, "", "/settings")
  }, [activeTab, clearConversationState])

  const openNotifications = useCallback(() => {
    routeRequestRef.current += 1
    previousContentPathRef.current = window.location.pathname
    prevTabRef.current = activeTab === "notifications" ? "chat" : activeTab
    setActiveTab("notifications")
    clearConversationState()
    window.history.pushState(null, "", "/notifications")
  }, [activeTab, clearConversationState])

  const handleSettingsBack = useCallback(() => {
    const url = previousContentPathRef.current || "/"
    window.history.pushState(null, "", url)
    void activateRoute(parseRoute(url))
  }, [activateRoute])
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

  const handleTopicSelect = useCallback((topic: ActiveTopic) => {
    routeRequestRef.current += 1
    setPendingPrompt(null)
    setActiveTab("chat")
    setActiveTopic(topic)
    setActiveChat(null)
    setActiveSessionKey(null)
    setActiveSessionTitle(null)
    setInitialMessages(undefined)
    window.history.pushState(null, "", `/${topic.projectId}/${topic.id}`)
  }, [])

  const handleChatSelect = useCallback(async (chat: ActiveChat) => {
    routeRequestRef.current += 1
    setPendingPrompt(null)
    setActiveTab("chat")
    setActiveChat(chat)
    setActiveTopic(null)
    setActiveSessionKey(null)
    setActiveSessionTitle(null)
    setInitialMessages(undefined)
    window.history.pushState(null, "", `/${chat.id}`)

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

  const handleCronJobNavigate = useCallback(async (cronJob: ActiveChat) => {
    try {
      const cronJobId = cronJob.cronJobId ?? cronJob.id
      const conversation = await invoke<{
        sessionKey: string | null
        messages?: unknown[]
      }>("middleware_cron_job_conversation", { input: { jobId: cronJobId } })
      const fallbackSessionKey =
        cronJob.sessionKey && !CRON_SESSION_TARGETS.has(cronJob.sessionKey)
          ? cronJob.sessionKey
          : null
      const sessionKey = conversation.sessionKey ?? fallbackSessionKey

      if (!sessionKey) {
        console.error("Cron job has no conversation session yet", cronJob)
        return false
      }

      if ((conversation.messages ?? []).length === 0) {
        return false
      }

      const listResult = await invoke<{ chats: { id: string; name: string; sessionKey?: string; archived: boolean }[] }>(
        "middleware_chats_list",
        { input: {} },
      )
      const existing = (listResult.chats || []).find(
        (c) => !c.archived && (c.sessionKey === sessionKey || c.name === cronJob.name),
      )

      if (existing) {
        if (existing.sessionKey !== sessionKey) {
          await invoke("middleware_chats_attach_session", {
            input: { chatId: existing.id, sessionKey },
          })
        }
        handleChatSelect({ ...existing, sessionKey })
        return true
      }

      const result = await invoke<{ chat: { id: string; name: string; sessionKey?: string } }>(
        "middleware_chats_create",
        { input: { name: cronJob.name, sessionKey } },
      )
      setInitialMessages(undefined)
      setActiveTab("chat")
      setActiveTopic(null)
      setActiveChat({ id: result.chat.id, name: cronJob.name, sessionKey })
      setActiveSessionKey(sessionKey)
      setActiveSessionTitle(cronJob.name)
      setChatRefreshTrigger((n) => n + 1)
      window.history.pushState(null, "", `/${result.chat.id}`)
      return true
    } catch (err) {
      console.error("Failed to navigate to cron job chat", err)
      return false
    }
  }, [handleChatSelect])

  const handleChatClear = useCallback(() => {
    routeRequestRef.current += 1
    setPendingPrompt(null)
    clearConversationState()
    window.history.pushState(null, "", "/")
  }, [clearConversationState])

  const handleTopicClear = useCallback(() => {
    routeRequestRef.current += 1
    setPendingPrompt(null)
    clearConversationState()
    window.history.pushState(null, "", "/")
  }, [clearConversationState])

  const handleNewChat = useCallback(() => {
    routeRequestRef.current += 1
    setPendingPrompt(null)
    setActiveTab("chat")
    clearConversationState()
    window.history.pushState(null, "", "/")
  }, [clearConversationState])

  const handlePromptDraft = useCallback((prompt: string) => {
    routeRequestRef.current += 1
    setPendingPrompt(prompt)
    setActiveTab("chat")
    clearConversationState()
    window.history.pushState(null, "", "/")
  }, [clearConversationState])

  const handleFirstMessageSent = useCallback(async (text: string) => {
    const chat = activeChatRef.current
    if (!chat) return
    try {
      const fallbackName = fallbackChatNameFromText(text)
      const { name } = await invoke<{ name: string }>(
        "middleware_autonaming_quick",
        { input: { text } },
      )
      const finalName = isWeakChatName(name) ? fallbackName : name
      await invoke("middleware_chats_rename", {
        input: { chatId: chat.id, name: finalName },
      })
      setActiveChat((prev) => prev ? { ...prev, name: finalName } : prev)
      setActiveSessionTitle(finalName)
      setChatRefreshTrigger((n) => n + 1)
      window.history.replaceState(null, "", `/${chat.id}`)
    } catch (err) {
      const fallbackName = fallbackChatNameFromText(text)
      try {
        await invoke("middleware_chats_rename", {
          input: { chatId: chat.id, name: fallbackName },
        })
        setActiveChat((prev) => prev ? { ...prev, name: fallbackName } : prev)
        setActiveSessionTitle(fallbackName)
        setChatRefreshTrigger((n) => n + 1)
      } catch {}
      console.error("Auto-naming chat failed", err)
    }
  }, [])

  const handleSessionResolved = useCallback((key: string, title: string) => {
    setActiveSessionKey(key)
    setActiveSessionTitle(title)
  }, [])

  const { resolving: sessionResolving, error: sessionError } = useTopicSession(
    activeTopic, activeSessionKey, handleSessionResolved,
  )

  const [quickSending, setQuickSending] = useState(false)

  const handleQuickSend = useCallback(async (payload: ChatComposerSubmit) => {
    const text = payload.text.trim()
    if (quickSending || !text) return
    routeRequestRef.current += 1
    setQuickSending(true)
    try {
      const fallbackName = fallbackChatNameFromText(text)
      const result = await invoke<{ chat: { id: string; name: string } }>(
        "middleware_chats_create",
        { input: { name: fallbackName } },
      )
      const sessionResult = await invoke<{ session: { key: string } }>(
        "middleware_sessions_create",
        { input: { agentId: "main", label: fallbackName } },
      )
      await invoke("middleware_chats_attach_session", {
        input: { chatId: result.chat.id, sessionKey: sessionResult.session.key },
      })

      const optimisticMessages: OptimisticMsg[] = [{
        messageId: crypto.randomUUID(),
        role: "user",
        text,
        createdAt: new Date().toISOString(),
        isOptimistic: true,
      }]
      setPendingPrompt(null)
      setInitialMessages(optimisticMessages)
      setActiveTab("chat")
      setActiveTopic(null)
      setActiveChat({ id: result.chat.id, name: fallbackName, sessionKey: sessionResult.session.key })
      setActiveSessionKey(sessionResult.session.key)
      setActiveSessionTitle(fallbackName)
      setChatRefreshTrigger((n) => n + 1)
      window.history.pushState(null, "", `/${result.chat.id}`)

      await invoke("middleware_chat_send", {
        input: {
          sessionKey: sessionResult.session.key,
          text,
          attachments: payload.attachments,
        },
      })

      try {
        const { name } = await invoke<{ name: string }>(
          "middleware_autonaming_quick",
          { input: { text } },
        )
        const finalName = isWeakChatName(name) ? fallbackName : name
        await invoke("middleware_chats_rename", {
          input: { chatId: result.chat.id, name: finalName },
        })
        setActiveChat((prev) =>
          prev?.id === result.chat.id ? { ...prev, name: finalName } : prev,
        )
        setActiveSessionTitle(finalName)
        setChatRefreshTrigger((n) => n + 1)
      } catch (err) {
        console.error("Auto-naming chat failed", err)
      }
    } catch (err) {
      console.error("Quick send failed", err)
    } finally {
      setQuickSending(false)
    }
  }, [quickSending])

  const handleTopicQuickSend = useCallback(async (payload: ChatComposerSubmit) => {
    const text = payload.text.trim()
    if (quickSending || !text || !activeTopic) return
    routeRequestRef.current += 1
    setQuickSending(true)
    try {
      const sessionResult = await invoke<{ session: { key: string } }>(
        "middleware_sessions_create",
        {
          input: {
            projectId: activeTopic.projectId,
            topicId: activeTopic.id,
            agentId: "main",
            label: activeTopic.name,
          },
        },
      )
      const optimisticMessages: OptimisticMsg[] = [{
        messageId: crypto.randomUUID(),
        role: "user",
        text,
        createdAt: new Date().toISOString(),
        isOptimistic: true,
      }]
      setPendingPrompt(null)
      setInitialMessages(optimisticMessages)
      setActiveSessionKey(sessionResult.session.key)
      setActiveSessionTitle(activeTopic.name)

      await invoke("middleware_chat_send", {
        input: {
          sessionKey: sessionResult.session.key,
          text,
          attachments: payload.attachments,
        },
      })
    } catch (err) {
      console.error("Topic quick send failed", err)
    } finally {
      setQuickSending(false)
    }
  }, [activeTopic, quickSending])

  const handleTabChange = useCallback((tab: string) => {
    if (tab === "chat") {
      handleNewChat()
      return
    }
    routeRequestRef.current += 1
    setActiveTab(tab)
    const tabUrls: Record<string, string> = {
      skill: "/skill",
      connect: "/connect",
      settings: "/settings",
      notifications: "/notifications",
    }
    const url = tabUrls[tab] ?? "/"
    window.history.pushState(null, "", url)
    setPendingPrompt(null)
    clearConversationState()
  }, [handleNewChat, clearConversationState])

  const centerLabel = activeTab === "chat"
    ? activeTopic
      ? { project: activeTopic.projectName, topic: activeTopic.name }
      : activeChat
        ? { project: "Chat", topic: activeChat.name }
        : null
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
        onNavigateToChat={handleCronJobNavigate}
      />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          width={sidebarOpen ? sidebarWidth : SIDEBAR_COLLAPSED}
          collapsed={!sidebarOpen}
          onClose={closeSidebar}
          onResizeStart={handleResizeStart}
          activeTab={activeTab}
          onTabChange={handleTabChange}
          items={sidebarItems}
          onItemsChange={setSidebarItems}
          activeTopic={activeTopic}
          onTopicSelect={handleTopicSelect}
          onTopicClear={handleTopicClear}
          activeChat={activeChat}
          onChatSelect={handleChatSelect}
          onChatClear={handleChatClear}
          onNewChat={handleNewChat}
          chatRefreshTrigger={chatRefreshTrigger}
        />

        <div className="flex flex-1 flex-col overflow-hidden">
          <main className="relative flex flex-1 items-start justify-center overflow-hidden transition-all duration-300 ease-in-out">
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
              onTopicQuickSend={handleTopicQuickSend}
              onDraftPrompt={handlePromptDraft}
            />
            {/* Keep the previous session alive in the background so it can
                finish generating and trigger a notification after the user
                switches to another session or page. */}
            {backgroundSessionKey && backgroundSessionKey !== activeSessionKey && (
              <div className="hidden">
                <ChatView
                  sessionKey={backgroundSessionKey}
                  sessionTitle={backgroundSessionTitle ?? undefined}
                  isBackgroundSession
                />
              </div>
            )}
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
          activeAgentId={activeAgentId}
          onAgentSelect={setActiveAgentId}
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
        onSendPrompt={handlePromptDraft}
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
  onTopicQuickSend,
  onDraftPrompt,
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
  onQuickSend: (payload: ChatComposerSubmit) => void | Promise<void>
  quickSending: boolean
  initialMessages?: import("@/components/ChatView/types").ChatMessage[]
  onSelectTool?: (toolCallId: string) => void
  pendingPrompt?: string | null
  onTopicQuickSend?: (payload: ChatComposerSubmit) => void | Promise<void>
  onDraftPrompt?: (prompt: string) => void
}) {
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
          onDraftPrompt={onDraftPrompt}
        />
      </div>
    )
  }

  if (activeSessionKey && (activeTopic || activeChat)) {
    return (
      <div className="flex h-full w-full">
        <ChatView
          key={activeChat ? activeChat.id : activeTopic ? `${activeTopic.projectId}:${activeTopic.id}` : activeSessionKey}
          sessionKey={activeSessionKey}
          sessionTitle={activeSessionTitle ?? undefined}
          onFirstMessageSent={activeChat ? onFirstMessageSent : undefined}
          initialMessages={initialMessages}
          onSelectTool={onSelectTool}
          initialPrompt={pendingPrompt ?? undefined}
        />
      </div>
    )
  }

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

  if (activeTopic && !activeSessionKey) {
    return (
      <div className="flex min-h-full w-full flex-col items-center justify-center gap-8 py-10">
        <AnimatedGreeting />
        <ChatBox
          key={pendingPrompt ?? `${activeTopic.projectId}:${activeTopic.id}:draft`}
          initialPrompt={pendingPrompt ?? undefined}
          onSend={onTopicQuickSend}
          disabled={quickSending}
        />
      </div>
    )
  }

  if (activeTab === "skill") return <SkillPage />
  if (activeTab === "connect") return <ConnectPage />

  return (
    <div className="flex min-h-full w-full flex-col items-center justify-center gap-8 py-10">
      <AnimatedGreeting />
      <ChatBox
        key={pendingPrompt ?? "chat-draft"}
        initialPrompt={pendingPrompt ?? undefined}
        onSend={onQuickSend}
        disabled={quickSending}
      />
    </div>
  )
}
