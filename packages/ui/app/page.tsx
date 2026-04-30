"use client"

import { randomId } from "@/lib/id"
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
import { LogsDialog } from "@/components/logs/LogsDialog"
import { initClientLogs } from "@/lib/clientLogs"
import { emit } from "@/lib/events"
import { checkGatewayOrRedirect, isGatewayError, showGatewayError } from "@/lib/toast"
import { fallbackChatNameFromText, isWeakChatName } from "@/utils/chatDisplayName"
import {
  ensureChatSession,
  resolveSessionNavigationTarget,
} from "@/lib/sessionNavigation"
import { useTheme } from "next-themes"
import { AppLoadingSkeleton } from "@/components/Skeleton/AppLoadingSkeleton"
import { ChatLoadingSkeleton } from "@/components/Skeleton/ChatLoadingSkeleton"
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
  const {
    flowState,
    loading: onboardingLoading,
    signOut,
    deleteAccount,
  } = useOnboardingFlow()
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
    const timer = window.setTimeout(() => setOnboardingDone(true), 0)
    return () => window.clearTimeout(timer)
  }, [onboardingLoading, hasToken])

  if (onboardingDone === null) {
    return <AppLoadingSkeleton />
  }

  return (
    <AppShell
      onResetOnboarding={() => setOnboardingDone(false)}
      initialConnect={!hasToken}
      flowState={flowState}
      onSignOut={signOut}
      onDeleteAccount={deleteAccount}
    />
  )
}

type AppShellProps = {
  onResetOnboarding: () => void
  initialConnect?: boolean
  flowState: import("@/components/onboarding/useOnboardingFlow").FlowState | null
  onSignOut: () => Promise<unknown>
  onDeleteAccount: () => Promise<unknown>
}

function AppShell({
  onResetOnboarding,
  initialConnect,
  flowState,
  onSignOut,
  onDeleteAccount,
}: AppShellProps) {
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [logsOpen, setLogsOpen] = useState(false)
  const [chatMode, setChatMode] = useState<"simple" | "mission">("simple")
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT)
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth >= 1024 : true
  )
  const [terminalActive, setTerminalActive] = useState(false)
  const [connectAutoOpenEnabled, setConnectAutoOpenEnabled] = useState(() =>
    Boolean(initialConnect),
  )
  const [activeTab, setActiveTab] = useState(() => {
    if (typeof window === "undefined") return "chat"
    const route = parseRoute(window.location.pathname)
    if (route.kind === "tab") return route.tab
    return "chat"
  })

  const prevTabRef = useRef("chat")
  const [sidebarItems, setSidebarItems] = useState<SidebarNavItem[]>(DEFAULT_DRAGGABLE_ITEMS)

  const handleItemsReorder = useCallback((ids: string[]) => {
    setSidebarItems((prev) => {
      const map = new Map(prev.map((item) => [item.id, item]))
      return ids.map((id) => map.get(id)).filter(Boolean) as SidebarNavItem[]
    })
  }, [])

  useEffect(() => {
    initClientLogs()
  }, [])

  useEffect(() => {
    async function initialSync() {
      try {
        await invoke("middleware_connect_bootstrap", { input: {} })
      } catch {}
      try {
        await invoke("middleware_sync_pull_now", { input: {} })
      } catch {}
      emit("sidebar:refresh")
    }
    initialSync()
  }, [])

  const openLogs = useCallback(() => setLogsOpen(true), [])
  const closeLogs = useCallback(() => setLogsOpen(false), [])

  const [activeTopic, setActiveTopic] = useState<ActiveTopic | null>(null)
  const [activeSessionKey, setActiveSessionKey] = useState<string | null>(null)
  const [activeSessionTitle, setActiveSessionTitle] = useState<string | null>(null)

  // Keep the previous session alive (hidden) so its SSE connection
  // and notification logic survive when the user switches away.
  const [backgroundSessionKey, setBackgroundSessionKey] = useState<string | null>(null)
  const [backgroundSessionTitle, setBackgroundSessionTitle] = useState<string | null>(null)
  const prevActiveSessionKeyRef = useRef<string | null>(null)
  const prevActiveSessionTitleRef = useRef<string | null>(null)
  const initialRouteAppliedRef = useRef(false)
  const initialConnectRedirectAppliedRef = useRef(false)

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
  const resolvedChatCacheRef = useRef(new Map<
    string,
    { chat: ActiveChat; sessionKey: string; title: string }
  >())
  activeChatRef.current = activeChat

  type OptimisticMsg = { messageId: string; role: "user"; text: string; createdAt: string; isOptimistic: true }
  const [initialMessages, setInitialMessages] = useState<OptimisticMsg[] | undefined>()

  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null)
  const [composerError, setComposerError] = useState<string | null>(null)
  const [focusedToolCallId, setFocusedToolCallId] = useState<string | null>(null)
  const [activeAgentId, setActiveAgentId] = useState<string | null>("root")
  const isResizing = useRef(false)
  const routeRequestRef = useRef(0)
  const previousContentPathRef = useRef("/")

  const { resolvedTheme, setTheme } = useTheme()

  const clearConversationState = useCallback(() => {
    setActiveTopic(null)
    setActiveChat(null)
    setActiveSessionKey(null)
    setActiveSessionTitle(null)
    setInitialMessages(undefined)
  }, [])

  const activateRoute = useCallback(async (route: ParsedRoute) => {
    routeRequestRef.current += 1

    if (route.kind === "tab") {
      setPendingPrompt(null)
      setComposerError(null)
      setActiveTab(route.tab)
      clearConversationState()
      return
    }

    if (route.kind === "home") {
      setPendingPrompt(null)
      setComposerError(null)
      setActiveTab("chat")
      clearConversationState()
      return
    }

    if (route.kind === "chat") {
      const expectedPath = `/${route.chatId}`
      const isCurrentPath = () => window.location.pathname === expectedPath
      const cached = resolvedChatCacheRef.current.get(route.chatId)
      setPendingPrompt(null)
      setComposerError(null)
      setActiveTab("chat")
      setActiveTopic(null)
      setActiveChat(cached?.chat ?? { id: route.chatId, name: "Opening chat..." })
      setActiveSessionKey(cached?.sessionKey ?? null)
      setActiveSessionTitle(cached?.title ?? null)
      setInitialMessages(undefined)

      try {
        const chatResult = await invoke<{
          chats: { id: string; name: string; sessionKey?: string; archived: boolean }[]
        }>("middleware_chats_list", { input: {} })
        if (!isCurrentPath()) return

        const found = (chatResult.chats || []).find(
          (chat) => chat.id === route.chatId,
        )
        if (!found || found.archived) {
          clearConversationState()
          window.history.replaceState(null, "", "/")
          return
        }

        const resolved = await ensureChatSession({
          id: found.id,
          name: found.name,
          sessionKey: found.sessionKey,
        })
        if (!isCurrentPath()) return

        resolvedChatCacheRef.current.set(found.id, resolved)
        setActiveChat(resolved.chat)
        setActiveSessionKey(resolved.sessionKey)
        setActiveSessionTitle(resolved.title)
      } catch {
        if (isCurrentPath()) {
          clearConversationState()
          window.history.replaceState(null, "", "/")
        }
      }
      return
    }

    if (route.kind === "topic") {
      const expectedPath = `/${route.projectId}/${route.topicId}`
      const isCurrentPath = () => window.location.pathname === expectedPath
      setPendingPrompt(null)
      setComposerError(null)
      setActiveTab("chat")
      setActiveChat(null)
      setActiveSessionKey(null)
      setActiveSessionTitle(null)
      setInitialMessages(undefined)

      try {
        const projectResult = await invoke<{
          projects: { id: string; name: string; archived: boolean }[]
        }>("middleware_projects_list", { input: {} })
        if (!isCurrentPath()) return

        const project = (projectResult.projects || []).find(
          (p) => p.id === route.projectId && !p.archived,
        )
        if (!project) {
          clearConversationState()
          window.history.replaceState(null, "", "/")
          return
        }

        const topicResult = await invoke<{
          topics: { id: string; name: string; projectId: string; archived: boolean }[]
        }>("middleware_topics_list", {
          input: { projectId: route.projectId },
        })
        if (!isCurrentPath()) return

        const topic = (topicResult.topics || []).find(
          (t) => t.id === route.topicId && !t.archived,
        )
        if (!topic) {
          clearConversationState()
          window.history.replaceState(null, "", "/")
          return
        }

        setActiveTopic({
          id: topic.id,
          name: topic.name,
          projectId: project.id,
          projectName: project.name,
        })
      } catch {
        if (isCurrentPath()) {
          clearConversationState()
          window.history.replaceState(null, "", "/")
        }
      }
    }
  }, [clearConversationState])

  // Restore state from URL on mount
  useEffect(() => {
    if (initialRouteAppliedRef.current) return
    initialRouteAppliedRef.current = true
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

  const handleSelectTool = useCallback((toolCallId: string) => {
    if (!inspectorOpen) setInspectorOpen(true)
    setFocusedToolCallId(toolCallId)
  }, [inspectorOpen])

  const toggleInspector = useCallback(() => setInspectorOpen((prev) => !prev), [])
  const setChatModePersisted = useCallback((mode: "simple" | "mission") => {
    setChatMode(mode)
    setInspectorOpen(mode === "mission")
    try {
      window.localStorage.setItem("jarvis.chatMode", mode)
    } catch {}
  }, [])
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
    setConnectAutoOpenEnabled(false)
    routeRequestRef.current += 1
    previousContentPathRef.current = window.location.pathname
    prevTabRef.current = activeTab === "settings" ? "chat" : activeTab
    setComposerError(null)
    setActiveTab("settings")
    clearConversationState()
    window.history.pushState(null, "", "/settings")
  }, [activeTab, clearConversationState])

  const openNotifications = useCallback(() => {
    setConnectAutoOpenEnabled(false)
    routeRequestRef.current += 1
    previousContentPathRef.current = window.location.pathname
    prevTabRef.current = activeTab === "notifications" ? "chat" : activeTab
    setComposerError(null)
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
    try {
      const saved = window.localStorage.getItem("jarvis.chatMode")
      if (saved === "mission") {
        setChatMode("mission")
        setInspectorOpen(true)
      }
    } catch {}
  }, [])

  useEffect(() => {
    if (
      initialConnectRedirectAppliedRef.current ||
      !connectAutoOpenEnabled ||
      typeof window === "undefined" ||
      window.location.pathname !== "/"
    ) {
      return
    }
    initialConnectRedirectAppliedRef.current = true
    window.history.replaceState(null, "", "/connect")
    void activateRoute({ kind: "tab", tab: "connect" })
  }, [activateRoute, connectAutoOpenEnabled])

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
    setConnectAutoOpenEnabled(false)
    routeRequestRef.current += 1
    setPendingPrompt(null)
    setComposerError(null)
    setActiveTab("chat")
    setActiveTopic(topic)
    setActiveChat(null)
    setActiveSessionKey(null)
    setActiveSessionTitle(null)
    setInitialMessages(undefined)
    window.history.pushState(null, "", `/${topic.projectId}/${topic.id}`)
  }, [])

  const handleChatSelect = useCallback(async (chat: ActiveChat) => {
    setConnectAutoOpenEnabled(false)
    routeRequestRef.current += 1
    setPendingPrompt(null)
    setComposerError(null)
    setActiveTab("chat")
    setActiveTopic(null)
    setInitialMessages(undefined)

    try {
      const resolved = await ensureChatSession(chat)
      resolvedChatCacheRef.current.set(resolved.chat.id, resolved)
      setActiveChat(resolved.chat)
      setActiveSessionKey(resolved.sessionKey)
      setActiveSessionTitle(resolved.title)
      window.history.pushState(null, "", `/${resolved.chat.id}`)
    } catch (err) {
      console.error("Failed to open chat session", err)
      setActiveChat(chat)
      setActiveSessionKey(null)
      setActiveSessionTitle(null)
      window.history.pushState(null, "", `/${chat.id}`)
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
      resolvedChatCacheRef.current.set(result.chat.id, {
        chat: { id: result.chat.id, name: cronJob.name, sessionKey },
        sessionKey,
        title: cronJob.name,
      })
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
    setComposerError(null)
    clearConversationState()
    window.history.pushState(null, "", "/")
  }, [clearConversationState])

  const handleTopicClear = useCallback(() => {
    routeRequestRef.current += 1
    setPendingPrompt(null)
    setComposerError(null)
    clearConversationState()
    window.history.pushState(null, "", "/")
  }, [clearConversationState])

  const handleNewChat = useCallback(() => {
    setConnectAutoOpenEnabled(false)
    routeRequestRef.current += 1
    setPendingPrompt(null)
    setComposerError(null)
    setActiveTab("chat")
    clearConversationState()
    window.history.pushState(null, "", "/")
  }, [clearConversationState])

  const handleSessionNavigate = useCallback(async (sessionKey?: string) => {
    setConnectAutoOpenEnabled(false)
    if (!sessionKey) {
      handleNewChat()
      return
    }

    routeRequestRef.current += 1
    setPendingPrompt(null)
    setComposerError(null)
    setInitialMessages(undefined)
    setActiveTab("chat")

    try {
      const target = await resolveSessionNavigationTarget(sessionKey)
      if (!target) {
        handleNewChat()
        return
      }

      if (target.kind === "topic") {
        setActiveChat(null)
        setActiveTopic(target.topic)
        setActiveSessionKey(target.sessionKey)
        setActiveSessionTitle(target.title)
        window.history.pushState(
          null,
          "",
          `/${target.topic.projectId}/${target.topic.id}`,
        )
        return
      }

      setActiveTopic(null)
      setActiveChat(target.chat)
      setActiveSessionKey(target.sessionKey)
      setActiveSessionTitle(target.title)
      resolvedChatCacheRef.current.set(target.chat.id, {
        chat: target.chat,
        sessionKey: target.sessionKey,
        title: target.title,
      })
      window.history.pushState(null, "", `/${target.chat.id}`)
    } catch (err) {
      console.error("Failed to navigate to session", err)
      handleNewChat()
    }
  }, [handleNewChat])

  const handlePromptDraft = useCallback((prompt: string) => {
    setConnectAutoOpenEnabled(false)
    routeRequestRef.current += 1
    setPendingPrompt(prompt)
    setComposerError(null)
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
      if (chat.sessionKey) {
        resolvedChatCacheRef.current.set(chat.id, {
          chat: { ...chat, name: finalName },
          sessionKey: chat.sessionKey,
          title: finalName,
        })
      }
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
    if (!(await checkGatewayOrRedirect())) return
    routeRequestRef.current += 1
    setComposerError(null)
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
        messageId: randomId(),
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
      if (isGatewayError(err)) {
        showGatewayError()
        clearConversationState()
        window.history.pushState(null, "", "/connect")
        window.dispatchEvent(new PopStateEvent("popstate"))
      } else {
        setPendingPrompt(text)
        setInitialMessages(undefined)
        setActiveTab("chat")
        clearConversationState()
        setComposerError("Message failed to send. Try again.")
        window.history.replaceState(null, "", "/")
      }
    } finally {
      setQuickSending(false)
    }
  }, [clearConversationState, quickSending])

  const handleTopicQuickSend = useCallback(async (payload: ChatComposerSubmit) => {
    const text = payload.text.trim()
    if (quickSending || !text || !activeTopic) return
    if (!(await checkGatewayOrRedirect())) return
    routeRequestRef.current += 1
    setComposerError(null)
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
        messageId: randomId(),
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
      if (isGatewayError(err)) {
        showGatewayError()
        window.history.pushState(null, "", "/connect")
        window.dispatchEvent(new PopStateEvent("popstate"))
      } else {
        setPendingPrompt(text)
        setInitialMessages(undefined)
        setActiveSessionKey(null)
        setActiveSessionTitle(null)
        setComposerError("Message failed to send. Try again.")
      }
    } finally {
      setQuickSending(false)
    }
  }, [activeTopic, quickSending])

  const handleTabChange = useCallback((tab: string) => {
    if (tab !== "connect") {
      setConnectAutoOpenEnabled(false)
    }
    if (tab === "chat") {
      handleNewChat()
      return
    }
    routeRequestRef.current += 1
    setActiveTab(tab)
    setComposerError(null)
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

  const effectiveActiveTab =
    activeTab === "connect" &&
    !connectAutoOpenEnabled &&
    typeof window !== "undefined" &&
    window.location.pathname === "/"
      ? "chat"
      : activeTab

  const centerLabel = effectiveActiveTab === "chat"
    ? activeTopic
      ? { project: activeTopic.projectName, topic: activeTopic.name }
      : activeChat
        ? { project: "Chat", topic: activeChat.name }
        : null
    : null

  const handleSignOut = useCallback(async () => {
    await onSignOut()
    onResetOnboarding()
  }, [onResetOnboarding, onSignOut])

  const handleDeleteAccount = useCallback(async () => {
    await onDeleteAccount()
    onResetOnboarding()
  }, [onDeleteAccount, onResetOnboarding])

  return (
    <div className="flex h-svh flex-col bg-background">
      <Header
        inspectorOpen={inspectorOpen}
        onToggleInspector={toggleInspector}
        terminalOpen={terminalActive}
        onToggleTerminal={toggleTerminal}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={toggleSidebar}
        chatMode={chatMode}
        onChatModeChange={setChatModePersisted}
        centerLabel={centerLabel}
        onOpenSettings={openSettings}
        onOpenNotifications={openNotifications}
        onOpenLogs={openLogs}
        onNavigateToChat={handleCronJobNavigate}
      />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          width={sidebarOpen ? sidebarWidth : SIDEBAR_COLLAPSED}
          collapsed={!sidebarOpen}
          onClose={closeSidebar}
          onResizeStart={handleResizeStart}
          activeTab={effectiveActiveTab}
          onTabChange={handleTabChange}
          items={sidebarItems}
          onItemsReorder={handleItemsReorder}
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
              activeTab={effectiveActiveTab}
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
              composerError={composerError}
              onTopicQuickSend={handleTopicQuickSend}
              onDraftPrompt={handlePromptDraft}
              onNavigateToChat={handleCronJobNavigate}
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
          focusedToolCallId={focusedToolCallId}
          onClearFocusedToolCall={() => setFocusedToolCallId(null)}
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
        onNavigateChat={handleSessionNavigate}
        onNewChat={() => { setPendingPrompt(null); handleNewChat() }}
        onSendPrompt={handlePromptDraft}
        onOpenSettings={openSettings}
        onToggleTerminal={toggleTerminal}
        onToggleTheme={toggleTheme}
      />

      <LogsDialog open={logsOpen} onClose={closeLogs} />
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
  composerError,
  onTopicQuickSend,
  onDraftPrompt,
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
  onQuickSend: (payload: ChatComposerSubmit) => void | Promise<void>
  quickSending: boolean
  initialMessages?: import("@/components/ChatView/types").ChatMessage[]
  onSelectTool?: (toolCallId: string) => void
  pendingPrompt?: string | null
  composerError?: string | null
  onTopicQuickSend?: (payload: ChatComposerSubmit) => void | Promise<void>
  onDraftPrompt?: (prompt: string) => void
  onNavigateToChat?: (chat: ActiveChat) => void | boolean | Promise<void | boolean>
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
          onNavigateToChat={onNavigateToChat}
        />
      </div>
    )
  }

  if (activeSessionKey && (activeTopic || activeChat)) {
    return (
      <div className="flex h-full w-full">
        <ChatView
          key={activeChat
            ? `${activeChat.id}:${activeSessionKey ?? "pending"}`
            : activeTopic
              ? `${activeTopic.projectId}:${activeTopic.id}:${activeSessionKey ?? "draft"}`
              : activeSessionKey}
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
    return <ChatLoadingSkeleton />
  }

  if (activeTopic && sessionResolving) {
    return <ChatLoadingSkeleton />
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
          errorMessage={composerError}
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
        errorMessage={composerError}
        onSend={onQuickSend}
        disabled={quickSending}
      />
    </div>
  )
}
