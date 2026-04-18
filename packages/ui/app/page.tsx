"use client"

import { useState, useCallback, useRef, useEffect, useMemo } from "react"
import { cn } from "@/lib/utils"
import { Header } from "@/common/Header"
import { Sidebar } from "@/components/sidebar"
import { Footer } from "@/components/Footer"
import { ChatBox } from "@/components/ChatBox"
import { AnimatedGreeting } from "@/components/AnimatedGreeting"
import { InspectorPanel } from "@/components/inspector/InspectorPanel"
import { TerminalPanel } from "@/components/TerminalPanel"
import { UsagePage } from "@/components/UsagePage"
import { AccountTab } from "@/components/settings/tabs/AccountTab"
import { AppearanceTab } from "@/components/settings/tabs/AppearanceTab"
import { DataControlTab } from "@/components/settings/tabs/DataControlTab"
import { MaintenanceTab } from "@/components/settings/tabs/MaintenanceTab"
import { HelpTab } from "@/components/settings/tabs/HelpTab"
import { useTerminalShortcut } from "@/hooks/useTerminalShortcut"
import { useAppShortcuts } from "@/hooks/useAppShortcuts"
import {
  listProjects,
  createProject,
  getProjectSidebar,
  listTopics,
  createTopic,
  listSessions,
  createSessionMapping,
  type Project,
  type Topic,
} from "@/lib/jarvis-middleware"
import {
  chatHistory,
  chatSend,
  chatStreamStart,
  chatStreamStop,
  listenChatEvents,
  type ChatHistoryMessage,
  type ChatStreamEnvelope,
} from "@/lib/jarvis-chat"

const SIDEBAR_MIN = 160
const SIDEBAR_MAX = 480
const SIDEBAR_DEFAULT = 220
const CHAT_BINDING_STORAGE_KEY = "jarvis.desktop.chat-binding"

type ChatBinding = {
  projectId: string | null
  projectName?: string | null
  topicId: string | null
  topicName?: string | null
  sessionKey: string | null
}

export default function Page() {
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT)
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [activeTab, setActiveTab] = useState("chat")
  const [isSettingsMode, setIsSettingsMode] = useState(false)
  const [lastStandardTab, setLastStandardTab] = useState("chat")
  const [chatKey, setChatKey] = useState(0)
  const [terminalHeight, setTerminalHeight] = useState<number | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [topics, setTopics] = useState<Topic[]>([])
  const [projectSessions, setProjectSessions] = useState<Array<{ key: string; title: string | null; status: string | null }>>([])
  const [loadingProjects, setLoadingProjects] = useState(false)
  const [loadingTopics, setLoadingTopics] = useState(false)
  const [creatingProject, setCreatingProject] = useState(false)
  const [creatingTopic, setCreatingTopic] = useState(false)
  const [chatBinding, setChatBinding] = useState<ChatBinding>({ projectId: null, topicId: null, sessionKey: null })
  const isResizing = useRef(false)

  const toggleInspector = useCallback(() => setInspectorOpen((prev) => !prev), [])
  const toggleTerminal = useCallback(() => setTerminalOpen((prev) => !prev), [])
  const openTerminal = useCallback(() => setTerminalOpen(true), [])

  useTerminalShortcut(toggleTerminal)
  useAppShortcuts()

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(CHAT_BINDING_STORAGE_KEY)
      if (raw) setChatBinding(JSON.parse(raw) as ChatBinding)
    } catch (error) {
      console.error("Failed to restore chat binding", error)
    }
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem(CHAT_BINDING_STORAGE_KEY, JSON.stringify(chatBinding))
    } catch (error) {
      console.error("Failed to persist chat binding", error)
    }
  }, [chatBinding])

  const loadProjectsData = useCallback(async () => {
    try {
      setLoadingProjects(true)
      const result = await listProjects()
      const activeProjects = result.projects.filter((p) => !p.archived)
      setProjects(activeProjects)
      if (!chatBinding.projectId && activeProjects.length > 0) {
        const first = activeProjects[0]
        setChatBinding((prev) => ({ ...prev, projectId: first.id, projectName: first.name }))
      }
    } catch (error) {
      console.error("Failed to load projects", error)
    } finally {
      setLoadingProjects(false)
    }
  }, [chatBinding.projectId])

  const loadProjectScopedData = useCallback(async (projectId: string, preferredTopicId?: string | null) => {
    try {
      setLoadingTopics(true)
      const [topicsResult, sidebarPayload] = await Promise.all([
        listTopics(projectId),
        getProjectSidebar(projectId),
      ])
      const activeTopics = topicsResult.topics.filter((t) => !t.archived)
      setTopics(activeTopics)
      setProjectSessions(sidebarPayload.sessions)
      const selectedProject = projects.find((p) => p.id === projectId)
      const nextProjectName = selectedProject?.name ?? sidebarPayload.project.name

      let nextTopicId = preferredTopicId ?? chatBinding.topicId ?? null
      let nextTopicName = chatBinding.topicName ?? null
      if (!nextTopicId && activeTopics.length > 0) {
        nextTopicId = activeTopics[0].id
        nextTopicName = activeTopics[0].name
      } else if (nextTopicId) {
        const match = activeTopics.find((topic) => topic.id === nextTopicId)
        nextTopicName = match?.name ?? null
      }

      let nextSessionKey: string | null = null
      if (nextTopicId) {
        const sessionResult = await listSessions({ projectId, topicId: nextTopicId, includeExisting: false })
        nextSessionKey = sessionResult.sessions[0]?.sessionKey ?? null
      }

      setChatBinding({
        projectId,
        projectName: nextProjectName,
        topicId: nextTopicId,
        topicName: nextTopicName,
        sessionKey: nextSessionKey,
      })
    } catch (error) {
      console.error("Failed to load project scoped data", error)
    } finally {
      setLoadingTopics(false)
    }
  }, [projects, chatBinding.topicId, chatBinding.topicName])

  useEffect(() => {
    void loadProjectsData()
  }, [loadProjectsData])

  useEffect(() => {
    if (chatBinding.projectId) {
      void loadProjectScopedData(chatBinding.projectId, chatBinding.topicId)
    } else {
      setTopics([])
      setProjectSessions([])
    }
  }, [chatBinding.projectId])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
        e.preventDefault()
        setActiveTab("chat")
        setLastStandardTab("chat")
        setIsSettingsMode(false)
        setChatKey((k) => k + 1)
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

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

  const handleTabChange = useCallback((tab: string) => {
    if (tab === "settings") {
      setIsSettingsMode(true)
      setActiveTab("usage")
    } else {
      setActiveTab(tab)
      if (!isSettingsMode) setLastStandardTab(tab)
    }
  }, [isSettingsMode])

  const handleBackToMain = useCallback(() => {
    setIsSettingsMode(false)
    setActiveTab(lastStandardTab || "chat")
  }, [lastStandardTab])

  const centerTitle = useMemo(() => chatBinding.projectName ?? undefined, [chatBinding.projectName])

  return (
    <div className="flex h-svh flex-col bg-background">
      <Header
        inspectorOpen={inspectorOpen}
        onToggleInspector={toggleInspector}
        terminalOpen={terminalOpen}
        onToggleTerminal={toggleTerminal}
        centerTitle={centerTitle}
      />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          width={sidebarWidth}
          onResizeStart={handleResizeStart}
          projects={projects}
          selectedProjectId={chatBinding.projectId}
          topics={topics}
          selectedTopicId={chatBinding.topicId}
          projectSessions={projectSessions}
          loadingProjects={loadingProjects}
          loadingTopics={loadingTopics}
          creatingProject={creatingProject}
          creatingTopic={creatingTopic}
          onSelectProject={(projectId) => void loadProjectScopedData(projectId, null)}
          onSelectTopic={async (topicId) => {
            const topic = topics.find((item) => item.id === topicId)
            const sessions = await listSessions({ projectId: chatBinding.projectId!, topicId, includeExisting: false })
            setChatBinding((prev) => ({
              ...prev,
              topicId,
              topicName: topic?.name ?? null,
              sessionKey: sessions.sessions[0]?.sessionKey ?? null,
            }))
          }}
          onSelectSession={(sessionKey) => setChatBinding((prev) => ({ ...prev, sessionKey }))}
          onCreateProject={async (name) => {
            try {
              setCreatingProject(true)
              const created = await createProject({
                name,
                profileId: "prof_local_main",
                workspaceRoot: "/root/.openclaw/workspace",
                repoRoot: "/root/.openclaw/workspace",
              })
              const defaultTopic = await createTopic({ projectId: created.project.id, name: "General" })
              await createSessionMapping({
                projectId: created.project.id,
                topicId: defaultTopic.topic.id,
                agentId: "main",
                label: defaultTopic.topic.name,
              })
              await loadProjectsData()
              await loadProjectScopedData(created.project.id, defaultTopic.topic.id)
            } finally {
              setCreatingProject(false)
            }
          }}
          onCreateTopic={async (name) => {
            if (!chatBinding.projectId) return
            try {
              setCreatingTopic(true)
              const created = await createTopic({ projectId: chatBinding.projectId, name })
              await createSessionMapping({
                projectId: chatBinding.projectId,
                topicId: created.topic.id,
                agentId: "main",
                label: created.topic.name,
              })
              await loadProjectScopedData(chatBinding.projectId, created.topic.id)
            } finally {
              setCreatingTopic(false)
            }
          }}
        />

        <div className="flex flex-1 flex-col overflow-hidden">
          <main className="flex flex-1 overflow-hidden transition-all duration-300 ease-in-out">
            <MainContent
              activeTab={activeTab}
              chatKey={chatKey}
              lastStandardTab={lastStandardTab}
              onTabChange={handleTabChange}
              onToggleSettingsMode={setIsSettingsMode}
              chatBinding={chatBinding}
            />
          </main>

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
        terminalOpen={terminalOpen}
        onToggleTerminal={toggleTerminal}
        onDragOpenTerminal={(height) => {
          openTerminal()
          setTerminalHeight(height)
        }}
      />
    </div>
  )
}

function MainContent({
  activeTab,
  chatKey,
  lastStandardTab,
  onTabChange,
  onToggleSettingsMode,
  chatBinding,
}: {
  activeTab: string
  chatKey: number
  lastStandardTab: string
  onTabChange: (tab: string) => void
  onToggleSettingsMode: (val: boolean) => void
  chatBinding: ChatBinding
}) {
  const settingsBack = () => {
    onToggleSettingsMode(false)
    onTabChange(lastStandardTab)
  }

  if (activeTab === "usage") return <UsagePage onBack={settingsBack} />
  if (activeTab === "memory") return <div className="text-muted-foreground italic">Memory system is loading...</div>
  if (activeTab === "account") return <div className="w-full max-w-2xl px-6 py-10"><AccountTab /></div>
  if (activeTab === "personalization") return <div className="w-full max-w-2xl px-6 py-10"><AppearanceTab /></div>
  if (activeTab === "data-control") return <div className="w-full max-w-2xl px-6 py-10"><DataControlTab /></div>
  if (activeTab === "maintenance") return <div className="w-full max-w-2xl px-6 py-10"><MaintenanceTab /></div>
  if (activeTab === "help") return <div className="w-full max-w-2xl px-6 py-10"><HelpTab /></div>
  if (activeTab === "project") return <div className="text-muted-foreground italic">Project files...</div>

  return <ChatWorkspaceView key={`${activeTab}-${chatKey}`} chatBinding={chatBinding} />
}

function ChatWorkspaceView({ chatBinding }: { chatBinding: ChatBinding }) {
  const [messages, setMessages] = useState<ChatHistoryMessage[]>([])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => {
    let unlisten: (() => void) | undefined
    let currentStreamId: string | null = null

    async function setup() {
      if (!chatBinding.sessionKey) {
        setMessages([])
        setStatus(null)
        return
      }

      try {
        setLoading(true)
        const history = await chatHistory(chatBinding.sessionKey)
        setMessages(history.messages)

        unlisten = await listenChatEvents((payload: ChatStreamEnvelope) => {
          if (payload.streamId !== currentStreamId) return
          const event = payload.event
          if (!event) return

          if (event.type === "chat.status") setStatus(String(event.state ?? "connected"))
          if (event.type === "chat.message") {
            setMessages((prev) => {
              const message = event as unknown as ChatHistoryMessage
              if (prev.some((item) => item.id === message.id)) return prev
              return [...prev, message]
            })
          }
        })

        const stream = await chatStreamStart(chatBinding.sessionKey)
        currentStreamId = stream.streamId
      } catch (error) {
        console.error("Failed to setup chat stream", error)
        setMessages([])
      } finally {
        setLoading(false)
      }
    }

    void setup()
    return () => {
      if (unlisten) unlisten()
      if (currentStreamId) void chatStreamStop(currentStreamId)
    }
  }, [chatBinding.sessionKey])

  async function handleSubmit(value: string) {
    if (!chatBinding.sessionKey || !value.trim()) return
    try {
      setSending(true)
      await chatSend({ sessionKey: chatBinding.sessionKey, text: value.trim() })
      setInput("")
      setStatus("thinking")
    } catch (error) {
      console.error("Failed to send chat message", error)
    } finally {
      setSending(false)
    }
  }

  const hasMessages = messages.length > 0

  if (!chatBinding.projectId) {
    return (
      <div className="flex min-h-full w-full flex-col items-center justify-center gap-8 py-10">
        <AnimatedGreeting />
        <ChatBox disabled />
      </div>
    )
  }

  if (!hasMessages) {
    return (
      <div className="flex min-h-full w-full flex-col items-center justify-center gap-8 px-6 py-10">
        <AnimatedGreeting />
        <div className="w-full max-w-3xl text-center text-sm text-muted-foreground">
          {chatBinding.topicName ? `Start a new conversation in ${chatBinding.topicName}` : "Select a topic to begin"}
        </div>
        <ChatBox value={input} onChange={setInput} onSubmit={handleSubmit} disabled={!chatBinding.sessionKey || sending} />
      </div>
    )
  }

  return (
    <div className="flex min-h-full w-full flex-col">
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-6 pt-8">
        <div className="mb-4 flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground/60">Chat</span>
          <h2 className="text-lg font-semibold text-foreground">{chatBinding.topicName ?? "Conversation"}</h2>
          <p className="text-xs text-muted-foreground">
            {chatBinding.projectName ? `${chatBinding.projectName}` : "No project selected"}
            {status ? ` · ${status}` : ""}
          </p>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto pb-32">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading messages…</p>
          ) : (
            messages.map((message) => {
              const isUser = message.role === "user"
              return (
                <div key={message.id} className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}>
                  <div className={cn(
                    "max-w-[78%] rounded-2xl px-4 py-3 text-sm shadow-sm",
                    isUser ? "bg-foreground text-background" : "bg-card border border-border/40 text-foreground",
                  )}>
                    <p className="whitespace-pre-wrap">{message.text}</p>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      <div className="sticky bottom-0 border-t border-border/20 bg-background/80 pb-6 pt-4 backdrop-blur-md">
        <ChatBox value={input} onChange={setInput} onSubmit={handleSubmit} disabled={!chatBinding.sessionKey || sending} />
      </div>
    </div>
  )
}
