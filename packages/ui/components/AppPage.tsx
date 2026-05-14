"use client"

import { randomId } from "@/lib/id"
import { useState, useCallback, useRef, useEffect, useReducer } from "react"
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
import { useSpaces } from "@/hooks/useSpaces"
import { useTopicSession } from "@/hooks/useTopicSession"
import ConnectPage from "@/components/ConnectPage"
import { ChatView } from "@/components/ChatView"
import { useOnboardingFlow } from "@/components/onboarding"
import { CommandPalette } from "@/components/CommandPalette"
import { LogsDialog } from "@/components/logs/LogsDialog"
import { initFrontendCacheRealtimeInvalidation } from "@/lib/cacheRealtime"
import { frontendLog, initClientLogs } from "@/lib/clientLogs"
import { getRoutePath, installDesktopRouteShim, routeUrl } from "@/lib/app-router"
import { openRouteInNewWindow } from "@/lib/openRouteWindow"
import { emit } from "@/lib/events"
import { sendChatV2 } from "@/lib/chat-engine-v2/client"
import { chatSendIdempotencyKey } from "@/lib/chat-engine-v2/idempotency"
import { MIDDLEWARE_CONNECTION_CHANGED_EVENT, MIDDLEWARE_DISCONNECTED_EVENT } from "@/lib/middleware-client"
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
import { InspectorView, type InspectorTabId } from "@/components/inspector/InspectorView"
import { cn } from "@/lib/utils"
import {
  editorGroupsReducer,
  createInitialState,
  getFocusedGroup,
  findTabInGroups,
  type EditorTab,
  type SessionData,
} from "@/lib/editorGroups"
import { EditorGroupsContainer } from "@/components/EditorGroupsContainer"

type SettingsSection = "usage" | "config" | "archive" | "appearance" | "voice" | "help" | "shortcuts"
type EditorGroupId = "group-1" | "group-2"

const TABS = new Set(["skill", "connect", "settings", "notifications"])
const INSPECTOR_ROUTE_TABS = new Set<InspectorTabId>([
  "git",
  "workspace",
  "activity",
  "terminal",
])
const CRON_SESSION_TARGETS = new Set(["isolated", "main", "current"])

function isRealChatSessionKey(sessionKey: string | null | undefined): sessionKey is string {
  return Boolean(sessionKey && !CRON_SESSION_TARGETS.has(sessionKey) && !sessionKey.includes(":cron:"))
}

function sessionKeyFromResponse(response: unknown): string | null {
  const data = response as { session?: { key?: string; sessionKey?: string }; chat?: { sessionKey?: string }; sessionKey?: string } | null
  return data?.session?.key ?? data?.session?.sessionKey ?? data?.chat?.sessionKey ?? data?.sessionKey ?? null
}

function sameName(a: string | null | undefined, b: string | null | undefined): boolean {
  return Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase())
}

function isUndecidedChatTitle(value: string | null | undefined): boolean {
  if (!value) return true
  const normalized = value.trim().toLowerCase()
  return normalized === "" || normalized === "opening chat..." || normalized === "opening chat…"
}

function createDraftTab(groupId: EditorGroupId): EditorTab {
  return {
    id: `draft:${groupId}`,
    title: "New Chat",
    subtitle: "Chat",
    kind: "draft",
  }
}

function isDraftTabId(tabId: string): boolean {
  return tabId === "draft" || tabId.startsWith("draft:")
}

type CronConversationTarget = {
  jobId: string
  name: string
  session: string
  schedule: string
  prompt: string
}

type ParsedRoute =
  | { kind: "chat"; chatId: string }
  | { kind: "topic"; projectId: string; topicId: string }
  | { kind: "inspector"; tab: InspectorTabId }
  | { kind: "tab"; tab: string }
  | { kind: "home" }

function parseRoute(pathname: string): ParsedRoute {
  const segments = pathname.split("/").filter(Boolean)
  if (segments.length === 1 && segments[0]) {
    if (TABS.has(segments[0])) return { kind: "tab", tab: segments[0] }
    return { kind: "chat", chatId: segments[0] }
  }
  if (
    segments.length === 2 &&
    segments[0] === "inspector" &&
    INSPECTOR_ROUTE_TABS.has(segments[1] as InspectorTabId)
  ) {
    return { kind: "inspector", tab: segments[1] as InspectorTabId }
  }
  if (segments.length === 2 && segments[0] && segments[1]) {
    return { kind: "topic", projectId: segments[0], topicId: segments[1] }
  }
  return { kind: "home" }
}

function isSettingsRoute(pathname: string): boolean {
  const route = parseRoute(pathname)
  return route.kind === "tab" && route.tab === "settings"
}

function isNotificationsRoute(pathname: string): boolean {
  const route = parseRoute(pathname)
  return route.kind === "tab" && route.tab === "notifications"
}

function isInspectorRoute(pathname: string): boolean {
  return parseRoute(pathname).kind === "inspector"
}

function fallbackPathForTab(tab: string): string {
  if (tab === "skill") return "/skill"
  if (tab === "connect") return "/connect"
  if (tab === "notifications") return "/notifications"
  return "/"
}

const SIDEBAR_MIN = 160
const SIDEBAR_MAX = 480
const SIDEBAR_DEFAULT = 220
const SIDEBAR_COLLAPSED = 56
const INSPECTOR_DEFAULT_WIDTH = 460

export default function Page() {
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null)
  const {
    flowState,
    loading: onboardingLoading,
    signOut,
    deleteAccount,
  } = useOnboardingFlow({ autoLoad: false })
  const [hasToken, setHasToken] = useState<boolean | null>(null)

  useEffect(() => {
    async function checkToken() {
      const route = parseRoute(getRoutePath())
      if (route.kind === "chat" || route.kind === "topic" || route.kind === "inspector") {
        setHasToken(true)
        return
      }
      try {
        const s = await invoke<{ hasConnection?: boolean }>("middleware_connect_status", { input: {} })
        setHasToken(!!s.hasConnection)
      } catch {
        setHasToken(false)
      }
    }
    function onMiddlewareConnected() {
      setHasToken(true)
    }
    function onMiddlewareDisconnected() {
      setHasToken(false)
    }
    window.addEventListener("openclaw:middleware-connected", onMiddlewareConnected)
    window.addEventListener(MIDDLEWARE_DISCONNECTED_EVENT, onMiddlewareDisconnected)
    checkToken()
    return () => {
      window.removeEventListener("openclaw:middleware-connected", onMiddlewareConnected)
      window.removeEventListener(MIDDLEWARE_DISCONNECTED_EVENT, onMiddlewareDisconnected)
    }
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
  const [inspectorWidth, setInspectorWidth] = useState(INSPECTOR_DEFAULT_WIDTH)
  const [splitRatio, setSplitRatio] = useState(0.5)
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth >= 1024 : true
  )
  const [terminalActive, setTerminalActive] = useState(false)
  const [connectAutoOpenEnabled, setConnectAutoOpenEnabled] = useState(() =>
    Boolean(initialConnect),
  )
  const [fullWindowInspectorTab, setFullWindowInspectorTab] =
    useState<InspectorTabId>("activity")
  const [fullScreenInspectorMounted, setFullScreenInspectorMounted] = useState(() => {
    if (typeof window === "undefined") return false
    return parseRoute(getRoutePath()).kind === "inspector"
  })
  const [fullScreenInspectorVisible, setFullScreenInspectorVisible] = useState(() => {
    if (typeof window === "undefined") return false
    return parseRoute(getRoutePath()).kind === "inspector"
  })
  const [activeTab, setActiveTab] = useState(() => {
    if (typeof window === "undefined") return initialConnect ? "connect" : "chat"
    const route = parseRoute(getRoutePath())
    if (route.kind === "inspector") return "inspector"
    if (route.kind === "tab") return route.tab
    return initialConnect ? "connect" : "chat"
  })
  const effectiveActiveTab =
    activeTab === "connect" &&
    !connectAutoOpenEnabled &&
    typeof window !== "undefined" &&
    getRoutePath() === "/"
      ? "chat"
      : activeTab
  const fullScreenInspectorOpen = activeTab === "inspector"

  const prevTabRef = useRef("chat")
  const [sidebarItems, setSidebarItems] = useState<SidebarNavItem[]>(DEFAULT_DRAGGABLE_ITEMS)
  const {
    spaces,
    activeSpaceId,
    activeSpace,
    createSpace,
    updateSpace,
    archiveSpace,
    switchSpace,
    deleteSpace,
  } = useSpaces()

  useEffect(() => {
    try {
      if (activeSpace?.projectId) localStorage.setItem("openclaw.activeProjectId", activeSpace.projectId)
      else localStorage.removeItem("openclaw.activeProjectId")
      if (activeSpace?.repoRoot) localStorage.setItem("openclaw.activeSpaceRepoRoot", activeSpace.repoRoot)
      else localStorage.removeItem("openclaw.activeSpaceRepoRoot")
    } catch {}
  }, [activeSpace])

  const handleItemsReorder = useCallback((ids: string[]) => {
    setSidebarItems((prev) => {
      const map = new Map(prev.map((item) => [item.id, item]))
      return ids.map((id) => map.get(id)).filter(Boolean) as SidebarNavItem[]
    })
  }, [])

  useEffect(() => {
    installDesktopRouteShim()
    initClientLogs()
    initFrontendCacheRealtimeInvalidation()
    frontendLog("ui", "app.bootstrap", { route: getRoutePath() })
    return () => frontendLog("ui", "app.unmount", { route: getRoutePath() })
  }, [])

  useEffect(() => {
    async function initialSync() {
      let autoDetect = false
      try {
        autoDetect =
          localStorage.getItem("jarvis.autoDetect") === "true"
      } catch {}
      if (!autoDetect) return
      const route = parseRoute(getRoutePath())
      if (route.kind === "chat" || route.kind === "topic" || route.kind === "inspector") return

      try {
        const s = await invoke<{
          gatewayConfigured: boolean
          hasConnection: boolean
        }>("middleware_connect_status", { input: {} })
        if (!s.gatewayConfigured || !s.hasConnection) return
      } catch {
        return
      }
      try {
        await invoke("middleware_connect_bootstrap", { input: {} })
      } catch {}
      try {
        await invoke("middleware_sync_pull_now", { input: {} })
      } catch {}
      try {
        localStorage.setItem("jarvis.gatewayActive", "true")
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
  const [cronConversationTarget, setCronConversationTarget] =
    useState<CronConversationTarget | null>(null)

  const lastActiveSessionKeyRef = useRef<string | null>(null)

  const initialRouteAppliedRef = useRef(false)
  const initialConnectRedirectAppliedRef = useRef(false)

  useEffect(() => {
    if (activeSessionKey) {
      lastActiveSessionKeyRef.current = activeSessionKey
    }
    frontendLog("session", "active-session.change", { sessionKey: activeSessionKey, title: activeSessionTitle })
  }, [activeSessionKey, activeSessionTitle])

  const [activeChat, setActiveChat] = useState<ActiveChat | null>(null)
  const [editorGroups, dispatchGroups] = useReducer(
    editorGroupsReducer,
    undefined,
    () => createInitialState(),
  )
  const [chatRefreshTrigger, setChatRefreshTrigger] = useState(0)
  const activeChatRef = useRef<ActiveChat | null>(null)
  const resolvedChatCacheRef = useRef(new Map<
    string,
    { chat: ActiveChat; sessionKey: string; title: string }
  >())
  activeChatRef.current = activeChat

  useEffect(() => {
    frontendLog("chat", "active-chat.change", {
      chatId: activeChat?.id ?? null,
      chatName: activeChat?.name ?? null,
      sessionKey: activeChat?.sessionKey ?? activeSessionKey,
      activeTopicId: activeTopic?.id ?? null,
      activeTopicName: activeTopic?.name ?? null,
    })
  }, [activeChat, activeSessionKey, activeTopic])

  const focusedGroup = getFocusedGroup(editorGroups)
  const allTabs = editorGroups.groups.flatMap((g) => g.tabs)
  const totalNonDraftTabs = allTabs.filter((t) => t.kind !== "draft").length

  useEffect(() => {
    if (effectiveActiveTab !== "chat") return

    if (activeTopic) {
      const tabId = `topic:${activeTopic.projectId}:${activeTopic.id}`
      dispatchGroups({
        type: "ADD_TAB",
        tab: {
          id: tabId,
          title: activeTopic.name,
          subtitle: activeTopic.projectName,
          kind: "topic",
        },
      })
      return
    }

    if (activeChat) {
      const tabId = `chat:${activeChat.id}`
      const title = isUndecidedChatTitle(activeChat.name) ? "New Chat" : activeChat.name
      dispatchGroups({
        type: "ADD_TAB",
        tab: {
          id: tabId,
          title,
          subtitle: "Chat",
          kind: "chat",
        },
      })
      return
    }

    const targetGroup = getFocusedGroup(editorGroups)
    const hasDraft = targetGroup.tabs.some((t) => t.kind === "draft")
    if (!hasDraft) {
      dispatchGroups({
        type: "ADD_TAB",
        groupId: targetGroup.id,
        tab: createDraftTab(targetGroup.id),
      })
    } else if (targetGroup.activeTabId && !isDraftTabId(targetGroup.activeTabId)) {
      dispatchGroups({
        type: "SET_ACTIVE_TAB",
        groupId: targetGroup.id,
        tabId: targetGroup.tabs.find((t) => t.kind === "draft")?.id ?? `draft:${targetGroup.id}`,
      })
    }
  }, [activeChat, activeTopic, effectiveActiveTab])

  useEffect(() => {
    if (!activeSessionKey || !activeChat) return
    dispatchGroups({
      type: "SET_SESSION_DATA",
      groupId: editorGroups.focusedGroupId,
      sessionData: {
        chat: activeChat,
        sessionKey: activeSessionKey,
        title: activeSessionTitle ?? activeChat.name,
      },
    })
  }, [activeSessionKey, activeChat, activeSessionTitle, editorGroups.focusedGroupId])

  type ChatMessage = import("@/components/ChatView/types").ChatMessage
  type OptimisticMsg = { messageId: string; role: "user"; text: string; createdAt: string; isOptimistic: true; attachments?: Array<{ name: string; mimeType: string; content?: string; size?: number }> }
  const [initialMessages, setInitialMessages] = useState<ChatMessage[] | undefined>()

  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null)
  const [composerError, setComposerError] = useState<string | null>(null)
  const [focusedToolCallId, setFocusedToolCallId] = useState<string | null>(null)
  const [activeAgentId, setActiveAgentId] = useState<string | null>("root")
  const isResizing = useRef(false)
  const isSplitResizing = useRef(false)
  const mainContentRef = useRef<HTMLElement | null>(null)
  const routeRequestRef = useRef(0)
  const previousContentPathRef = useRef("/")
  const settingsPushedRef = useRef(false)

  const { resolvedTheme, setTheme } = useTheme()

  const clearConversationState = useCallback(() => {
    setActiveTopic(null)
    setActiveChat(null)
    setActiveSessionKey(null)
    setActiveSessionTitle(null)
    setInitialMessages(undefined)
  }, [])

  const recoverToDraftRoute = useCallback(() => {
    clearConversationState()
    setActiveTab("chat")
    dispatchGroups({
      type: "ADD_TAB",
      groupId: editorGroups.focusedGroupId,
      tab: createDraftTab(editorGroups.focusedGroupId),
    })
    if (getRoutePath() !== "/") window.history.replaceState(null, "", routeUrl("/"))
  }, [clearConversationState, editorGroups.focusedGroupId])

  useEffect(() => {
    if (!activeChat || activeSessionKey || !isUndecidedChatTitle(activeChat.name)) return
    const timer = window.setTimeout(() => {
      const route = parseRoute(getRoutePath())
      if (route.kind === "chat" && route.chatId === activeChat.id && !resolvedChatCacheRef.current.has(activeChat.id)) {
        recoverToDraftRoute()
      }
    }, 2500)
    return () => window.clearTimeout(timer)
  }, [activeChat, activeSessionKey, recoverToDraftRoute])

  useEffect(() => {
    function resetMiddlewareScopedUi() {
      routeRequestRef.current += 1
      resolvedChatCacheRef.current.clear()
      clearConversationState()
      lastActiveSessionKeyRef.current = null
      setCronConversationTarget(null)
      setPendingPrompt(null)
      setComposerError(null)
      setFocusedToolCallId(null)
      setActiveTab("chat")
      setChatRefreshTrigger((n) => n + 1)
      try { localStorage.removeItem("openclaw.activeProjectId") } catch {}
      if (getRoutePath() !== "/") window.history.replaceState(null, "", routeUrl("/"))
      emit("sidebar:refresh")
    }
    window.addEventListener(MIDDLEWARE_CONNECTION_CHANGED_EVENT, resetMiddlewareScopedUi)
    return () => window.removeEventListener(MIDDLEWARE_CONNECTION_CHANGED_EVENT, resetMiddlewareScopedUi)
  }, [clearConversationState])

  const activateRoute = useCallback(async (route: ParsedRoute) => {
    routeRequestRef.current += 1
    frontendLog("ui", "route.activate.start", { route, requestId: routeRequestRef.current })

    if (route.kind === "inspector") {
      setPendingPrompt(null)
      setComposerError(null)
      setFullWindowInspectorTab(route.tab)
      setActiveTab("inspector")
      return
    }

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
      dispatchGroups({
        type: "ADD_TAB",
        groupId: editorGroups.focusedGroupId,
        tab: createDraftTab(editorGroups.focusedGroupId),
      })
      return
    }

    if (route.kind === "chat") {
      const expectedPath = `/${route.chatId}`
      const isCurrentPath = () => getRoutePath() === expectedPath
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
          recoverToDraftRoute()
          return
        }

        const resolved = await ensureChatSession({
          id: found.id,
          name: found.name,
          sessionKey: found.sessionKey,
        })
        if (!isCurrentPath()) return

        resolvedChatCacheRef.current.set(found.id, resolved)
        frontendLog("ui", "route.chat.resolved", { chatId: found.id, sessionKey: resolved.sessionKey, title: resolved.title })
        setActiveChat(resolved.chat)
        setActiveSessionKey(resolved.sessionKey)
        setActiveSessionTitle(resolved.title)
      } catch (error) {
        frontendLog("ui", "route.chat.fail", { chatId: route.chatId, error: error instanceof Error ? { kind: error.name, message: error.message } : { kind: "Error", message: String(error) } }, "error")
        if (isCurrentPath()) {
          recoverToDraftRoute()
        }
      }
      return
    }

    if (route.kind === "topic") {
      const expectedPath = `/${route.projectId}/${route.topicId}`
      const isCurrentPath = () => getRoutePath() === expectedPath
      setPendingPrompt(null)
      setComposerError(null)
      setActiveTab("chat")
      try { localStorage.setItem("openclaw.activeProjectId", route.projectId) } catch {}
      setActiveTopic((prev) =>
        prev?.projectId === route.projectId && prev.id === route.topicId ? prev : null,
      )
      setActiveChat(null)
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
          recoverToDraftRoute()
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
          recoverToDraftRoute()
          return
        }

        const nextTopic = {
          id: topic.id,
          name: topic.name,
          projectId: project.id,
          projectName: project.name,
        }
        setActiveTopic(nextTopic)

        const sessionResult = await invoke<{
          sessions: { key: string; label: string; hidden: boolean }[]
        }>("middleware_sessions_list", {
          input: { projectId: route.projectId, topicId: route.topicId },
        })
        if (!isCurrentPath()) return

        const session = (sessionResult.sessions || []).find((s) => !s.hidden)
        if (session) {
          frontendLog("ui", "route.topic.resolved", { projectId: route.projectId, topicId: route.topicId, sessionKey: session.key })
          setActiveSessionKey(session.key)
          setActiveSessionTitle(session.label?.trim() || nextTopic.name)
        } else {
          frontendLog("ui", "route.topic.resolved", { projectId: route.projectId, topicId: route.topicId, sessionKey: null })
          setActiveSessionKey(null)
          setActiveSessionTitle(null)
        }
      } catch (error) {
        frontendLog("ui", "route.topic.fail", { projectId: route.projectId, topicId: route.topicId, error: error instanceof Error ? { kind: error.name, message: error.message } : { kind: "Error", message: String(error) } }, "error")
        if (isCurrentPath()) {
          recoverToDraftRoute()
        }
      }
    }
  }, [clearConversationState, editorGroups.focusedGroupId, recoverToDraftRoute])

  // Restore state from URL on mount
  useEffect(() => {
    if (initialRouteAppliedRef.current) return
    initialRouteAppliedRef.current = true
    void activateRoute(parseRoute(getRoutePath()))
  }, [activateRoute])

  // Handle browser back/forward
  useEffect(() => {
    function onPopState() {
      frontendLog("ui", "route.popstate", { route: getRoutePath() })
      void activateRoute(parseRoute(getRoutePath()))
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

  const [settingsInitialSection, setSettingsInitialSection] = useState<SettingsSection>("usage")

  const openSettings = useCallback((section: SettingsSection = "usage") => {
    setConnectAutoOpenEnabled(false)
    routeRequestRef.current += 1
    const currentPath = getRoutePath()
    if (!isSettingsRoute(currentPath)) {
      previousContentPathRef.current = currentPath
    }
    prevTabRef.current = activeTab === "settings" ? "chat" : activeTab
    setComposerError(null)
    setSettingsInitialSection(section)
    setActiveTab("settings")
    clearConversationState()
    settingsPushedRef.current = true
    window.history.pushState(null, "", routeUrl("/settings"))
  }, [activeTab, clearConversationState])

  useEffect(() => {
    function handleOpenSettings(event: Event) {
      const detail = (event as CustomEvent<{ section?: SettingsSection }>).detail
      openSettings(detail?.section ?? "usage")
    }
    window.addEventListener("openclaw:open-settings", handleOpenSettings)
    return () => window.removeEventListener("openclaw:open-settings", handleOpenSettings)
  }, [openSettings])

  const openNotifications = useCallback(() => {
    setConnectAutoOpenEnabled(false)
    routeRequestRef.current += 1
    const currentPath = getRoutePath()
    if (!isNotificationsRoute(currentPath)) {
      previousContentPathRef.current = currentPath
    }
    prevTabRef.current = activeTab === "notifications" ? "chat" : activeTab
    setComposerError(null)
    setActiveTab("notifications")
    clearConversationState()
    window.history.pushState(null, "", routeUrl("/notifications"))
  }, [activeTab, clearConversationState])

  const openInspectorFullWindow = useCallback((tab: InspectorTabId) => {
    setConnectAutoOpenEnabled(false)
    routeRequestRef.current += 1
    const currentPath = getRoutePath()
    if (!isInspectorRoute(currentPath)) {
      previousContentPathRef.current = currentPath
    }
    prevTabRef.current = activeTab === "inspector" ? "chat" : activeTab
    setComposerError(null)
    setFullWindowInspectorTab(tab)
    setActiveTab("inspector")
    window.history.pushState(null, "", routeUrl(`/inspector/${tab}`))
  }, [activeTab])

  const handleInspectorTabChange = useCallback((tab: InspectorTabId) => {
    setFullWindowInspectorTab(tab)
    window.history.replaceState(null, "", routeUrl(`/inspector/${tab}`))
  }, [])

  const handleSettingsBack = useCallback(() => {
    if (settingsPushedRef.current) {
      settingsPushedRef.current = false
      window.history.back()
      return
    }
    const previousPath = previousContentPathRef.current
    const url =
      previousPath &&
      !isSettingsRoute(previousPath) &&
      !isNotificationsRoute(previousPath)
        ? previousPath
        : fallbackPathForTab(prevTabRef.current)

    window.history.replaceState(null, "", routeUrl(url))
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
      getRoutePath() !== "/"
    ) {
      return
    }
    initialConnectRedirectAppliedRef.current = true
    window.history.replaceState(null, "", routeUrl("/connect"))
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

  const handleSplitResizeStart = useCallback(() => {
    if (editorGroups.groups.length <= 1) return
    isSplitResizing.current = true
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
  }, [editorGroups.groups.length])

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (isResizing.current) {
        const newWidth = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, e.clientX))
        setSidebarWidth(newWidth)
      }
      if (isSplitResizing.current) {
        const bounds = mainContentRef.current?.getBoundingClientRect()
        if (!bounds) return
        const nextRatio = (e.clientX - bounds.left) / bounds.width
        setSplitRatio(Math.max(0.3, Math.min(0.7, nextRatio)))
      }
    }
    function onMouseUp() {
      if (!isResizing.current && !isSplitResizing.current) return
      isResizing.current = false
      isSplitResizing.current = false
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
    try { localStorage.setItem("openclaw.activeProjectId", topic.projectId) } catch {}
    setActiveTopic(topic)
    setActiveChat(null)
    setActiveSessionKey(null)
    setActiveSessionTitle(null)
    setInitialMessages(undefined)
    window.history.pushState(null, "", routeUrl(`/${topic.projectId}/${topic.id}`))
  }, [])

  const handleChatSelect = useCallback(async (chat: ActiveChat) => {
    setConnectAutoOpenEnabled(false)
    const requestId = ++routeRequestRef.current
    setPendingPrompt(null)
    setComposerError(null)
    setActiveTab("chat")
    setActiveTopic(null)
    setInitialMessages(undefined)

    const cached = resolvedChatCacheRef.current.get(chat.id)
    if (cached) {
      setActiveChat(cached.chat)
      setActiveSessionKey(cached.sessionKey)
      setActiveSessionTitle(cached.title)
      window.history.pushState(null, "", routeUrl(`/${cached.chat.id}`))
    } else if (isRealChatSessionKey(chat.sessionKey)) {
      const title = isUndecidedChatTitle(chat.name) ? "New Chat" : chat.name
      setActiveChat(chat)
      setActiveSessionKey(chat.sessionKey)
      setActiveSessionTitle(title)
      resolvedChatCacheRef.current.set(chat.id, { chat, sessionKey: chat.sessionKey, title })
      window.history.pushState(null, "", routeUrl(`/${chat.id}`))
    }

    try {
      const resolved = await ensureChatSession(chat)
      if (routeRequestRef.current !== requestId) return
      resolvedChatCacheRef.current.set(resolved.chat.id, resolved)
      setActiveChat(resolved.chat)
      setActiveSessionKey(resolved.sessionKey)
      setActiveSessionTitle(resolved.title)
      window.history.pushState(null, "", routeUrl(`/${resolved.chat.id}`))
    } catch (err) {
      if (routeRequestRef.current !== requestId) return
      console.error("Failed to open chat session", err)
      if (!cached && !isRealChatSessionKey(chat.sessionKey)) {
        setActiveChat(chat)
        setActiveSessionKey(null)
        setActiveSessionTitle(null)
        window.history.pushState(null, "", routeUrl(`/${chat.id}`))
      }
    }
  }, [])

  const handleCronJobNavigate = useCallback(async (cronJob: ActiveChat) => {
    try {
      const cronJobId = cronJob.cronJobId ?? cronJob.id
      const listResult = await invoke<{
        chats: { id: string; name: string; sessionKey?: string; archived: boolean }[]
      }>("middleware_chats_list", { input: {} }).catch(() => ({ chats: [] }))
      const chats = listResult.chats.filter((chat) => !chat.archived)
      const directSessionKey = isRealChatSessionKey(cronJob.sessionKey)
        ? cronJob.sessionKey
        : null
      const directChat = directSessionKey
        ? chats.find((chat) => chat.sessionKey === directSessionKey)
        : null
      const exactNameChat = chats.find(
        (chat) => sameName(chat.name, cronJob.name) && !chat.name.trim().toLowerCase().startsWith("cron:"),
      )

      if (directChat) {
        setCronConversationTarget(null)
        handleChatSelect({ ...directChat, sessionKey: directSessionKey ?? directChat.sessionKey })
        return true
      }

      if (
        activeChat &&
        activeSessionKey &&
        sameName(activeChat.name, cronJob.name)
      ) {
        setCronConversationTarget(null)
        setInitialMessages(undefined)
        setActiveTab("chat")
        setActiveTopic(null)
        setActiveChat(activeChat)
        setActiveSessionKey(activeSessionKey)
        setActiveSessionTitle(activeSessionTitle ?? activeChat.name)
        window.history.pushState(null, "", routeUrl(`/${activeChat.id}`))
        return true
      }

      if (exactNameChat?.sessionKey) {
        setCronConversationTarget(null)
        handleChatSelect({ ...exactNameChat, sessionKey: exactNameChat.sessionKey })
        return true
      }

      let target: CronConversationTarget = {
        jobId: cronJobId,
        name: cronJob.name,
        session: cronJob.sessionKey ?? "isolated",
        schedule: "",
        prompt: "",
      }
      try {
        const result = await invoke<{
          job: {
            jobId: string
            name: string
            session: string
            schedule: string
            task?: string | null
            message?: string | null
          }
        }>("middleware_cron_get_job", { input: { jobId: cronJobId } })
        target = {
          jobId: result.job.jobId,
          name: result.job.name || cronJob.name,
          session: result.job.session || cronJob.sessionKey || "isolated",
          schedule: result.job.schedule || "",
          prompt: result.job.message ?? result.job.task ?? "",
        }
      } catch {}

      if (isRealChatSessionKey(target.session)) {
        const targetChat = chats.find((chat) => chat.sessionKey === target.session)
        if (targetChat) {
          setCronConversationTarget(null)
          handleChatSelect({ ...targetChat, sessionKey: target.session })
          return true
        }
      }

      setCronConversationTarget(target)
      setInitialMessages(undefined)
      setActiveTab("notifications")
      setActiveTopic(null)
      setActiveChat(null)
      setActiveSessionKey(null)
      setActiveSessionTitle(null)
      window.history.pushState(null, "", routeUrl("/notifications"))
      return true
    } catch (err) {
      console.error("Failed to navigate to cron job chat", err)
      return false
    }
  }, [activeChat, activeSessionKey, activeSessionTitle, handleChatSelect])

  const handleForkNavigate = useCallback(
    (chat: { id?: string | null; name: string; sessionKey: string; projectId?: string | null; topicId?: string | null }) => {
      setChatRefreshTrigger((n) => n + 1)
      if (chat.projectId && chat.topicId && activeTopic?.projectId === chat.projectId) {
        const forkTopic = {
          ...activeTopic,
          id: chat.topicId,
          name: chat.name,
        }
        setActiveChat(null)
        setActiveTopic(forkTopic)
        setActiveSessionKey(chat.sessionKey)
        setActiveSessionTitle(chat.name)
        setInitialMessages(undefined)
        window.history.pushState(null, "", routeUrl(`/${chat.projectId}/${chat.topicId}`))
        return
      }
      if (chat.id) {
        handleChatSelect({ id: chat.id, name: chat.name, sessionKey: chat.sessionKey })
      }
    },
    [activeTopic, handleChatSelect],
  )

  const handleChatClear = useCallback(() => {
    routeRequestRef.current += 1
    setPendingPrompt(null)
    setComposerError(null)
    clearConversationState()
    window.history.pushState(null, "", routeUrl("/"))
  }, [clearConversationState])

  const handleTopicClear = useCallback(() => {
    routeRequestRef.current += 1
    setPendingPrompt(null)
    setComposerError(null)
    clearConversationState()
    window.history.pushState(null, "", routeUrl("/"))
  }, [clearConversationState])

  const handleNewChat = useCallback((groupId?: EditorGroupId) => {
    const targetGroupId = groupId ?? editorGroups.focusedGroupId
    setConnectAutoOpenEnabled(false)
    routeRequestRef.current += 1
    setPendingPrompt(null)
    setComposerError(null)
    setActiveTab("chat")
    dispatchGroups({ type: "SET_FOCUS", groupId: targetGroupId })
    dispatchGroups({
      type: "ADD_TAB",
      groupId: targetGroupId,
      tab: createDraftTab(targetGroupId),
    })
    clearConversationState()
    window.history.pushState(null, "", routeUrl("/"))
  }, [clearConversationState, editorGroups.focusedGroupId])

  const handleSpaceSwitch = useCallback(async (spaceId: string) => {
    if (spaceId === activeSpaceId) return
    await switchSpace(spaceId)
    resolvedChatCacheRef.current.clear()
    routeRequestRef.current += 1
    setPendingPrompt(null)
    setComposerError(null)
    clearConversationState()
    setChatRefreshTrigger((n) => n + 1)
    window.history.pushState(null, "", routeUrl("/"))
    emit("sidebar:refresh")
  }, [activeSpaceId, clearConversationState, switchSpace])

  const handleSpaceCreate = useCallback(async (name?: string) => {
    const space = await createSpace(name)
    await handleSpaceSwitch(space.id)
  }, [createSpace, handleSpaceSwitch])

  const handleSpaceDelete = useCallback(async (spaceId: string) => {
    const nextSpaceId = await deleteSpace(spaceId)
    await handleSpaceSwitch(nextSpaceId)
  }, [deleteSpace, handleSpaceSwitch])

  const handleSpaceArchive = useCallback(async (spaceId: string) => {
    const nextSpaceId = await archiveSpace(spaceId)
    await handleSpaceSwitch(nextSpaceId)
  }, [archiveSpace, handleSpaceSwitch])

  const tabDataRef = useRef(new Map<string, { chat?: ActiveChat; topic?: ActiveTopic }>())

  useEffect(() => {
    if (activeTopic) {
      const tabId = `topic:${activeTopic.projectId}:${activeTopic.id}`
      tabDataRef.current.set(tabId, { topic: activeTopic })
    }
    if (activeChat) {
      const tabId = `chat:${activeChat.id}`
      tabDataRef.current.set(tabId, { chat: activeChat })
    }
  }, [activeChat, activeTopic])

  const switchToGroupSession = useCallback((groupId: "group-1" | "group-2") => {
    if (activeSessionKey && activeChat) {
      dispatchGroups({
        type: "SET_SESSION_DATA",
        groupId: editorGroups.focusedGroupId,
        sessionData: {
          chat: activeChat,
          sessionKey: activeSessionKey,
          title: activeSessionTitle ?? activeChat.name,
        },
      })
    }
    dispatchGroups({ type: "SET_FOCUS", groupId })

    const targetGroup = editorGroups.groups.find((g) => g.id === groupId)
    if (targetGroup?.sessionData) {
      setActiveTopic(null)
      setActiveChat(targetGroup.sessionData.chat)
      setActiveSessionKey(targetGroup.sessionData.sessionKey)
      setActiveSessionTitle(targetGroup.sessionData.title)
      setInitialMessages(undefined)
      setPendingPrompt(null)
      setComposerError(null)
      window.history.replaceState(
        null,
        "",
        routeUrl(`/${targetGroup.sessionData.chat.id}`),
      )
      return
    }

    if (targetGroup?.activeTabId && isDraftTabId(targetGroup.activeTabId)) {
      setActiveTopic(null)
      setActiveChat(null)
      setActiveSessionKey(null)
      setActiveSessionTitle(null)
      setInitialMessages(undefined)
      setPendingPrompt(null)
      setComposerError(null)
      window.history.replaceState(null, "", routeUrl("/"))
    }
  }, [activeChat, activeSessionKey, activeSessionTitle, editorGroups])

  const handleEditorTabSelect = useCallback((groupId: "group-1" | "group-2", tabId: string) => {
    dispatchGroups({ type: "SET_ACTIVE_TAB", groupId, tabId })

    if (groupId !== editorGroups.focusedGroupId) {
      switchToGroupSession(groupId)
      return
    }

    if (tabId === focusedGroup.activeTabId) return

    const data = tabDataRef.current.get(tabId)
    if (isDraftTabId(tabId)) {
      handleNewChat(groupId)
      return
    }
    if (data?.topic) {
      handleTopicSelect(data.topic)
      return
    }
    if (data?.chat) {
      const cached = resolvedChatCacheRef.current.get(data.chat.id)
      if (cached) {
        setActiveTopic(null)
        setActiveChat(cached.chat)
        setActiveSessionKey(cached.sessionKey)
        setActiveSessionTitle(cached.title)
        setInitialMessages(undefined)
        setPendingPrompt(null)
        setComposerError(null)
        window.history.replaceState(null, "", routeUrl(`/${cached.chat.id}`))
      } else {
        void handleChatSelect(data.chat)
      }
    }
  }, [editorGroups, focusedGroup.activeTabId, switchToGroupSession, handleChatSelect, handleNewChat, handleTopicSelect])

  const handleEditorTabClose = useCallback((tabId: string) => {
    const location = findTabInGroups(editorGroups, tabId)
    if (!location) return

    const isSplit = editorGroups.groups.length > 1
    const isLastInGroup = location.group.tabs.filter((t) => t.id !== tabId).length === 0
    const isFocusedActive =
      location.group.id === editorGroups.focusedGroupId &&
      location.group.activeTabId === tabId

    dispatchGroups({ type: "REMOVE_TAB", tabId })

    if (isSplit && isLastInGroup) {
      const otherGroup = editorGroups.groups.find((g) => g.id !== location.group.id)
      if (otherGroup?.sessionData) {
        setActiveTopic(null)
        setActiveChat(otherGroup.sessionData.chat)
        setActiveSessionKey(otherGroup.sessionData.sessionKey)
        setActiveSessionTitle(otherGroup.sessionData.title)
        setInitialMessages(undefined)
        setPendingPrompt(null)
        setComposerError(null)
        window.history.replaceState(
          null,
          "",
          routeUrl(`/${otherGroup.sessionData.chat.id}`),
        )
      }
      return
    }

    if (!isFocusedActive) return

    const remaining = location.group.tabs.filter((t) => t.id !== tabId)
    const fallback = remaining[remaining.length - 1]
    if (!fallback || fallback.kind === "draft") {
      handleNewChat(location.group.id)
      return
    }
    const data = tabDataRef.current.get(fallback.id)
    if (data?.topic) {
      handleTopicSelect(data.topic)
      return
    }
    if (data?.chat) {
      const cached = resolvedChatCacheRef.current.get(data.chat.id)
      if (cached) {
        setActiveTopic(null)
        setActiveChat(cached.chat)
        setActiveSessionKey(cached.sessionKey)
        setActiveSessionTitle(cached.title)
        setInitialMessages(undefined)
        setPendingPrompt(null)
        setComposerError(null)
        window.history.replaceState(null, "", routeUrl(`/${cached.chat.id}`))
      } else {
        void handleChatSelect(data.chat)
      }
    }
  }, [editorGroups, handleChatSelect, handleNewChat, handleTopicSelect])

  const handleOpenChatTabWindow = useCallback((tab: EditorTab) => {
    if (tab.kind !== "chat") return
    const chatId = tab.chat?.id ?? tab.id.replace(/^chat:/, "")
    if (!chatId || chatId === tab.id) return
    void openRouteInNewWindow(`/${chatId}`, tab.title)
  }, [])

  const handleEditorTabMove = useCallback((
    tabId: string,
    sourceGroupId: EditorGroupId,
    targetGroupId: EditorGroupId,
  ) => {
    if (sourceGroupId === targetGroupId) return

    const data = tabDataRef.current.get(tabId)
    const cached = data?.chat ? resolvedChatCacheRef.current.get(data.chat.id) : null
    const movedSessionData: SessionData | null = cached
      ? {
          chat: cached.chat,
          sessionKey: cached.sessionKey,
          title: cached.title,
        }
      : data?.chat?.sessionKey
        ? {
            chat: data.chat,
            sessionKey: data.chat.sessionKey,
            title: data.chat.name,
          }
        : null

    dispatchGroups({
      type: "MOVE_TAB",
      tabId,
      sourceGroupId,
      targetGroupId,
    })

    dispatchGroups({
      type: "SET_SESSION_DATA",
      groupId: targetGroupId,
      sessionData: isDraftTabId(tabId) ? null : movedSessionData,
    })

    if (movedSessionData) {
      setActiveTopic(null)
      setActiveChat(movedSessionData.chat)
      setActiveSessionKey(movedSessionData.sessionKey)
      setActiveSessionTitle(movedSessionData.title)
      setInitialMessages(undefined)
      setPendingPrompt(null)
      setComposerError(null)
      window.history.replaceState(null, "", routeUrl(`/${movedSessionData.chat.id}`))
      return
    }

    if (isDraftTabId(tabId)) {
      setActiveTopic(null)
      setActiveChat(null)
      setActiveSessionKey(null)
      setActiveSessionTitle(null)
      setInitialMessages(undefined)
      setPendingPrompt(null)
      setComposerError(null)
      window.history.replaceState(null, "", routeUrl("/"))
    }
  }, [])

  const handleFocusGroup = useCallback((groupId: "group-1" | "group-2") => {
    if (groupId === editorGroups.focusedGroupId) return
    switchToGroupSession(groupId)
  }, [editorGroups.focusedGroupId, switchToGroupSession])

  const handleToggleSplit = useCallback(() => {
    if (editorGroups.groups.length > 1) {
      const keepGroup = editorGroups.groups.find((g) => g.id === "group-1")
      const keepSession = keepGroup?.sessionData
      dispatchGroups({ type: "CLOSE_GROUP", groupId: "group-2" })
      if (keepSession) {
        setActiveTopic(null)
        setActiveChat(keepSession.chat)
        setActiveSessionKey(keepSession.sessionKey)
        setActiveSessionTitle(keepSession.title)
        setInitialMessages(undefined)
        setPendingPrompt(null)
        setComposerError(null)
        window.history.replaceState(
          null,
          "",
          routeUrl(`/${keepSession.chat.id}`),
        )
      }
      return
    }

    const focused = getFocusedGroup(editorGroups)
    if (activeSessionKey && activeChat) {
      dispatchGroups({
        type: "SET_SESSION_DATA",
        groupId: focused.id,
        sessionData: {
          chat: activeChat,
          sessionKey: activeSessionKey,
          title: activeSessionTitle ?? activeChat.name,
        },
      })
    }

    const otherTab = focused.tabs.find(
      (tab) => tab.id !== focused.activeTabId && tab.kind !== "draft",
    )
    if (!otherTab) return

    const data = tabDataRef.current.get(otherTab.id)
    if (data?.chat) {
      const cached = resolvedChatCacheRef.current.get(data.chat.id)
      if (cached) {
        dispatchGroups({
          type: "SPLIT_TAB",
          tabId: otherTab.id,
          sessionData: cached,
        })
        setActiveTopic(null)
        setActiveChat(cached.chat)
        setActiveSessionKey(cached.sessionKey)
        setActiveSessionTitle(cached.title)
        setInitialMessages(undefined)
        setPendingPrompt(null)
        setComposerError(null)
      } else {
        dispatchGroups({ type: "SPLIT_TAB", tabId: otherTab.id, sessionData: null })
        ensureChatSession(data.chat)
          .then((resolved) => {
            resolvedChatCacheRef.current.set(resolved.chat.id, resolved)
            dispatchGroups({
              type: "SET_SESSION_DATA",
              groupId: "group-2",
              sessionData: resolved,
            })
            setActiveTopic(null)
            setActiveChat(resolved.chat)
            setActiveSessionKey(resolved.sessionKey)
            setActiveSessionTitle(resolved.title)
            setInitialMessages(undefined)
            setPendingPrompt(null)
            setComposerError(null)
          })
          .catch(() => {})
      }
    } else {
      dispatchGroups({ type: "SPLIT_TAB", tabId: otherTab.id, sessionData: null })
    }
  }, [activeChat, activeSessionKey, activeSessionTitle, editorGroups])

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
      window.history.pushState(null, "", routeUrl(`/${target.chat.id}`))
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
    window.history.pushState(null, "", routeUrl("/"))
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
    frontendLog("composer", "quick-send.attempt", {
      hasText: Boolean(text),
      textLength: text.length,
      attachmentCount: payload.attachments?.length ?? 0,
      quickSending,
      activeSpaceId,
    })
    if (quickSending || !text) return
    if (!(await checkGatewayOrRedirect())) return
    routeRequestRef.current += 1
    setComposerError(null)
    setQuickSending(true)
    try {
      const targetGroupId = editorGroups.focusedGroupId
      const fallbackName = fallbackChatNameFromText(text)
      const result = await invoke<{ chat: { id: string; name: string; sessionKey?: string | null }; session?: { key?: string; sessionKey?: string } }>(
        "middleware_chats_create",
        { input: { name: fallbackName, spaceId: activeSpaceId, agentId: "main" } },
      )
      let sessionKey = sessionKeyFromResponse(result)
      if (!sessionKey) {
        const sessionResult = await invoke<{ session: { key?: string; sessionKey?: string } }>(
          "middleware_sessions_create",
          { input: { agentId: "main", label: fallbackName } },
        )
        sessionKey = sessionKeyFromResponse(sessionResult)
        if (sessionKey) {
          await invoke("middleware_chats_attach_session", {
            input: { chatId: result.chat.id, sessionKey },
          })
        }
      }
      if (!sessionKey) throw new Error("New chat did not return a sessionKey")

      const optimisticId = randomId()
      const optimisticMessages: OptimisticMsg[] = [{
        messageId: optimisticId,
        role: "user",
        text,
        createdAt: new Date().toISOString(),
        isOptimistic: true,
        attachments: payload.attachments?.map((a) => ({
          name: a.name,
          mimeType: a.mimeType,
          content: a.content,
          size: a.size,
        })),
      }]
      setPendingPrompt(null)
      setInitialMessages(optimisticMessages)
      setActiveTab("chat")
      setActiveTopic(null)
      const createdChat = { id: result.chat.id, name: fallbackName, sessionKey }
      const sessionData = { chat: createdChat, sessionKey, title: fallbackName }
      resolvedChatCacheRef.current.set(result.chat.id, sessionData)
      setActiveChat(createdChat)
      setActiveSessionKey(sessionKey)
      setActiveSessionTitle(fallbackName)
      dispatchGroups({
        type: "ADD_TAB",
        groupId: targetGroupId,
        tab: { id: `chat:${result.chat.id}`, title: fallbackName, subtitle: "Chat", kind: "chat", chat: createdChat },
      })
      dispatchGroups({
        type: "SET_SESSION_DATA",
        groupId: targetGroupId,
        sessionData,
      })
      setChatRefreshTrigger((n) => n + 1)
      window.history.pushState(null, "", routeUrl(`/${result.chat.id}`))
      frontendLog("composer", "quick-send.dispatch", {
        chatId: result.chat.id,
        sessionKey,
        optimisticId,
        attachmentCount: payload.attachments?.length ?? 0,
      })
      await sendChatV2({
        sessionKey,
        text,
        attachments: payload.attachments,
        idempotencyKey: chatSendIdempotencyKey(sessionKey, optimisticId),
        clientMessageId: optimisticId,
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
        const renamedChat = { ...createdChat, name: finalName }
        resolvedChatCacheRef.current.set(result.chat.id, { chat: renamedChat, sessionKey, title: finalName })
        setActiveChat((prev) =>
          prev?.id === result.chat.id ? { ...prev, name: finalName } : prev,
        )
        setActiveSessionTitle(finalName)
        dispatchGroups({
          type: "UPDATE_TAB",
          tabId: `chat:${result.chat.id}`,
          updates: { title: finalName, chat: renamedChat },
        })
        dispatchGroups({
          type: "SET_SESSION_DATA",
          groupId: targetGroupId,
          sessionData: { chat: renamedChat, sessionKey, title: finalName },
        })
        setChatRefreshTrigger((n) => n + 1)
      } catch (err) {
        console.error("Auto-naming chat failed", err)
      }
    } catch (err) {
      frontendLog("composer", "quick-send.fail", { error: err instanceof Error ? { kind: err.name, message: err.message } : { kind: "Error", message: String(err) } }, "error")
      console.error("Quick send failed", err)
      if (isGatewayError(err)) {
        showGatewayError(err instanceof Error ? err.message : undefined)
        clearConversationState()
        window.history.pushState(null, "", routeUrl("/connect"))
        window.dispatchEvent(new PopStateEvent("popstate"))
      } else {
        setPendingPrompt(text)
        setInitialMessages(undefined)
        setActiveTab("chat")
        clearConversationState()
        setComposerError("Message failed to send. Try again.")
        window.history.replaceState(null, "", routeUrl("/"))
      }
    } finally {
      setQuickSending(false)
    }
  }, [activeSpaceId, clearConversationState, editorGroups.focusedGroupId, quickSending])

  const handleTopicQuickSend = useCallback(async (payload: ChatComposerSubmit) => {
    const text = payload.text.trim()
    frontendLog("composer", "topic-quick-send.attempt", {
      hasText: Boolean(text),
      textLength: text.length,
      attachmentCount: payload.attachments?.length ?? 0,
      quickSending,
      topicId: activeTopic?.id ?? null,
    })
    if (quickSending || !text || !activeTopic) return
    if (!(await checkGatewayOrRedirect())) return
    routeRequestRef.current += 1
    setComposerError(null)
    setQuickSending(true)
    try {
      const sessionResult = await invoke<{ session: { key?: string; sessionKey?: string } }>(
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
      const sessionKey = sessionKeyFromResponse(sessionResult)
      if (!sessionKey) throw new Error("New topic session did not return a sessionKey")
      const optimisticId = randomId()
      const optimisticMessages: OptimisticMsg[] = [{
        messageId: optimisticId,
        role: "user",
        text,
        createdAt: new Date().toISOString(),
        isOptimistic: true,
        attachments: payload.attachments?.map((a) => ({
          name: a.name,
          mimeType: a.mimeType,
          content: a.content,
          size: a.size,
        })),
      }]
      setPendingPrompt(null)
      setInitialMessages(optimisticMessages)
      setActiveSessionKey(sessionKey)
      setActiveSessionTitle(activeTopic.name)

      frontendLog("composer", "topic-quick-send.dispatch", {
        topicId: activeTopic.id,
        sessionKey,
        optimisticId,
        attachmentCount: payload.attachments?.length ?? 0,
      })
      await sendChatV2({
        sessionKey,
        text,
        attachments: payload.attachments,
        idempotencyKey: chatSendIdempotencyKey(sessionKey, optimisticId),
        clientMessageId: optimisticId,
      })
    } catch (err) {
      frontendLog("composer", "topic-quick-send.fail", { error: err instanceof Error ? { kind: err.name, message: err.message } : { kind: "Error", message: String(err) } }, "error")
      console.error("Topic quick send failed", err)
      if (isGatewayError(err)) {
        showGatewayError(err instanceof Error ? err.message : undefined)
        window.history.pushState(null, "", routeUrl("/connect"))
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
    if (tab === "connect") {
      setConnectAutoOpenEnabled(true)
    } else {
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
    window.history.pushState(null, "", routeUrl(url))
    setPendingPrompt(null)
    clearConversationState()
  }, [handleNewChat, clearConversationState])

  useEffect(() => {
    if (fullScreenInspectorOpen) {
      setFullScreenInspectorMounted(true)
      const frame = window.requestAnimationFrame(() => {
        setFullScreenInspectorVisible(true)
      })
      return () => window.cancelAnimationFrame(frame)
    }

    setFullScreenInspectorVisible(false)
    const timeout = window.setTimeout(() => {
      setFullScreenInspectorMounted(false)
    }, 300)

    return () => window.clearTimeout(timeout)
  }, [fullScreenInspectorOpen])

  useEffect(() => {
    if (!fullScreenInspectorMounted) {
      setFullScreenInspectorVisible(false)
      return
    }
  }, [fullScreenInspectorMounted])

  const handleSignOut = useCallback(async () => {
    await onSignOut()
    onResetOnboarding()
  }, [onResetOnboarding, onSignOut])

  const handleDeleteAccount = useCallback(async () => {
    await onDeleteAccount()
    onResetOnboarding()
  }, [onDeleteAccount, onResetOnboarding])

  return (
    <div className="relative flex h-dvh min-h-dvh flex-col overflow-hidden bg-background">
      <Header
        inspectorOpen={inspectorOpen}
        onToggleInspector={toggleInspector}
        terminalOpen={terminalActive}
        onToggleTerminal={toggleTerminal}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={toggleSidebar}
        sidebarReservedWidth={sidebarOpen ? sidebarWidth : SIDEBAR_COLLAPSED}
        editorGroups={effectiveActiveTab === "chat" ? editorGroups : null}
        onSelectChatTab={effectiveActiveTab === "chat" ? handleEditorTabSelect : undefined}
        onCloseChatTab={effectiveActiveTab === "chat" ? handleEditorTabClose : undefined}
        onOpenChatTabWindow={effectiveActiveTab === "chat" ? handleOpenChatTabWindow : undefined}
        onMoveChatTab={effectiveActiveTab === "chat" ? handleEditorTabMove : undefined}
        onNewChat={effectiveActiveTab === "chat" ? handleNewChat : undefined}
        showSplitButton={effectiveActiveTab === "chat" && totalNonDraftTabs >= 2}
        splitActive={editorGroups.groups.length > 1}
        splitRatio={splitRatio}
        onToggleSplit={handleToggleSplit}
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
          spaces={spaces}
          activeSpaceId={activeSpaceId}
          onSpaceSwitch={handleSpaceSwitch}
          onSpaceCreate={handleSpaceCreate}
          onSpaceUpdate={updateSpace}
          onSpaceArchive={handleSpaceArchive}
          onSpaceDelete={handleSpaceDelete}
        />

        <div className="flex flex-1 flex-col overflow-hidden">
          <main
            ref={mainContentRef}
            className="relative flex flex-1 items-start justify-center overflow-hidden transition-all duration-300 ease-in-out"
          >
{effectiveActiveTab === "chat" ? (
              editorGroups.groups.length === 1 ? (
                <MainContent
                  activeTab={effectiveActiveTab}
                  activeTopic={activeTopic}
                  activeChat={activeChat}
                  activeSessionKey={activeSessionKey}
                  lastActiveSessionKey={lastActiveSessionKeyRef.current}
                  cronConversationTarget={cronConversationTarget}
                  activeSessionTitle={activeSessionTitle}
                  onSignOut={handleSignOut}
                  onDeleteAccount={handleDeleteAccount}
                  flowState={flowState}
                  sessionResolving={sessionResolving}
                  sessionError={sessionError}
                  onSettingsBack={handleSettingsBack}
                  settingsInitialSection={settingsInitialSection}
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
                  onForkNavigate={handleForkNavigate}
                />
              ) : (
                <EditorGroupsContainer
                  state={editorGroups}
                  splitRatio={splitRatio}
                  onFocusGroup={handleFocusGroup}
                  onResizeStart={handleSplitResizeStart}
                  renderContent={(groupId) => {
                    const group = editorGroups.groups.find((g) => g.id === groupId)
                    const groupSessionData = group?.sessionData
                    if (groupSessionData) {
                      const isFocusedActiveSession = group.id === editorGroups.focusedGroupId && groupSessionData.sessionKey === activeSessionKey
                      return (
                        <ChatView
                          key={`pane:${groupSessionData.chat.id}:${groupSessionData.sessionKey}`}
                          sessionKey={groupSessionData.sessionKey}
                          sessionTitle={groupSessionData.title}
                          initialMessages={isFocusedActiveSession ? initialMessages : undefined}
                          onFirstMessageSent={isFocusedActiveSession ? handleFirstMessageSent : undefined}
                          forkContext={{ type: "chat" }}
                        />
                      )
                    }
                    if (group?.activeTabId && isDraftTabId(group.activeTabId)) {
                      return (
                        <MainContent
                          activeTab="chat"
                          activeTopic={null}
                          activeChat={null}
                          activeSessionKey={null}
                          lastActiveSessionKey={lastActiveSessionKeyRef.current}
                          cronConversationTarget={null}
                          activeSessionTitle={null}
                          onSignOut={handleSignOut}
                          onDeleteAccount={handleDeleteAccount}
                          flowState={flowState}
                          sessionResolving={false}
                          sessionError={null}
                          onSettingsBack={handleSettingsBack}
                          settingsInitialSection={settingsInitialSection}
                          onFirstMessageSent={handleFirstMessageSent}
                          onQuickSend={handleQuickSend}
                          quickSending={quickSending}
                          initialMessages={undefined}
                          onSelectTool={handleSelectTool}
                          pendingPrompt={group.id === editorGroups.focusedGroupId ? pendingPrompt : null}
                          composerError={group.id === editorGroups.focusedGroupId ? composerError : null}
                          onTopicQuickSend={handleTopicQuickSend}
                          onDraftPrompt={handlePromptDraft}
                          onNavigateToChat={handleCronJobNavigate}
                          onForkNavigate={handleForkNavigate}
                        />
                      )
                    }
                    return <ChatLoadingSkeleton />
                  }}
                />
              )
            ) : (
              <MainContent
                activeTab={effectiveActiveTab}
                activeTopic={activeTopic}
                activeChat={activeChat}
                activeSessionKey={activeSessionKey}
                lastActiveSessionKey={lastActiveSessionKeyRef.current}
                cronConversationTarget={cronConversationTarget}
                activeSessionTitle={activeSessionTitle}
                onSignOut={handleSignOut}
                onDeleteAccount={handleDeleteAccount}
                flowState={flowState}
                sessionResolving={sessionResolving}
                sessionError={sessionError}
                onSettingsBack={handleSettingsBack}
                settingsInitialSection={settingsInitialSection}
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
                onForkNavigate={handleForkNavigate}
              />
            )}
          </main>
        </div>

        <InspectorPanel
          open={inspectorOpen}
          onClose={toggleInspector}
          onOpenFullWindow={openInspectorFullWindow}
          onWidthChange={setInspectorWidth}
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

      {fullScreenInspectorMounted && (
        <FullScreenInspectorOverlay
          open={fullScreenInspectorVisible}
          activeTab={fullWindowInspectorTab}
          onTabChange={handleInspectorTabChange}
          onClose={handleSettingsBack}
          leftOffset={sidebarOpen ? sidebarWidth : SIDEBAR_COLLAPSED}
          collapsedWidth={inspectorWidth}
          sessionKey={activeSessionKey}
          projectId={activeTopic?.projectId ?? null}
          activeAgentId={activeAgentId}
          onAgentSelect={setActiveAgentId}
        />
      )}

      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        onNavigateChat={handleSessionNavigate}
        onNewChat={() => { setPendingPrompt(null); handleNewChat() }}
        onSendPrompt={handlePromptDraft}
        onOpenSettings={openSettings}
        onToggleTerminal={toggleTerminal}
        onToggleTheme={toggleTheme}
        onNavigateProject={() => {}}
        onNavigateTopic={() => {}}
        onNavigateDirectChat={() => {}}
        onNavigateSearchMessage={() => {}}
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
  lastActiveSessionKey,
  cronConversationTarget,
  activeSessionTitle,
  onSignOut,
  onDeleteAccount,
  flowState,
  sessionResolving,
  sessionError,
  onSettingsBack,
  settingsInitialSection,
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
  onForkNavigate,
}: {
  activeTab: string
  activeTopic: ActiveTopic | null
  activeChat: ActiveChat | null
  activeSessionKey: string | null
  lastActiveSessionKey: string | null
  cronConversationTarget: CronConversationTarget | null
  activeSessionTitle: string | null
  onSignOut: () => void
  onDeleteAccount: () => void
  flowState: import("@/components/onboarding/useOnboardingFlow").FlowState | null
  sessionResolving: boolean
  sessionError: string | null
  onSettingsBack: () => void
  settingsInitialSection: SettingsSection
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
  onForkNavigate?: (chat: { id?: string | null; name: string; sessionKey: string; projectId?: string | null; topicId?: string | null }) => void
}) {
  if (activeTab === "settings") {
    return (
      <div className="flex h-full w-full">
        <SettingsDashboard onBack={onSettingsBack} initialSection={settingsInitialSection} />
      </div>
    )
  }

  if (activeTab === "notifications") {
    return (
      <div className="flex h-full w-full">
        <NotificationDashboard
          activeSessionKey={activeSessionKey ?? lastActiveSessionKey}
          initialSelectedJob={cronConversationTarget}
          onBack={onSettingsBack}
          onDraftPrompt={onDraftPrompt}
          onNavigateToChat={onNavigateToChat}
        />
      </div>
    )
  }

  if (activeTab === "inspector") return null

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
          forkContext={activeTopic ? { type: "topic", projectId: activeTopic.projectId, projectName: activeTopic.projectName, topicId: activeTopic.id, topicName: activeTopic.name } : { type: "chat" }}
          onForkNavigate={onForkNavigate}
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
          glowOnMount
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
        glowOnMount
      />
    </div>
  )
}

function FullScreenInspectorOverlay({
  open,
  activeTab,
  onTabChange,
  onClose,
  leftOffset,
  collapsedWidth,
  sessionKey,
  projectId,
  activeAgentId,
  onAgentSelect,
}: {
  open: boolean
  activeTab: InspectorTabId
  onTabChange: (tab: InspectorTabId) => void
  onClose: () => void
  leftOffset: number
  collapsedWidth: number
  sessionKey: string | null
  projectId: string | null
  activeAgentId: string | null
  onAgentSelect: (id: string) => void
}) {
  const [collapsedScale, setCollapsedScale] = useState(0.35)

  useEffect(() => {
    function updateScale() {
      const availableWidth = Math.max(1, window.innerWidth - leftOffset)
      const nextScale = Math.min(1, Math.max(0.2, collapsedWidth / availableWidth))
      setCollapsedScale(nextScale)
    }

    updateScale()
    window.addEventListener("resize", updateScale)
    return () => window.removeEventListener("resize", updateScale)
  }, [collapsedWidth, leftOffset])

  return (
    <div
      style={{
        left: `${leftOffset}px`,
        transformOrigin: "right center",
        transform: open ? "scaleX(1)" : `scaleX(${collapsedScale})`,
      }}
      className={cn(
        "absolute right-0 top-9 bottom-[26px] z-40 overflow-hidden border-l border-border/50 bg-card shadow-2xl",
        "transition-[opacity,transform] duration-300 ease-in-out will-change-transform",
        open
          ? "opacity-100"
          : "pointer-events-none opacity-100",
      )}
    >
      <InspectorView
        activeTab={activeTab}
        onTabChange={onTabChange}
        onClose={onClose}
        closeVariant="collapse"
        sessionKey={sessionKey}
        projectId={projectId}
        activeAgentId={activeAgentId}
        onAgentSelect={onAgentSelect}
        className="h-full"
      />
    </div>
  )
}
