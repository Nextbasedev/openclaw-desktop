"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { Header } from "@/common/Header"
import { Sidebar, DEFAULT_DRAGGABLE_ITEMS } from "@/components/sidebar"
import type { SidebarNavItem } from "@/components/sidebar"
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
  const [sidebarItems, setSidebarItems] = useState<SidebarNavItem[]>(DEFAULT_DRAGGABLE_ITEMS)
  const [chatKey, setChatKey] = useState(0)
  const [terminalHeight, setTerminalHeight] = useState<number | null>(null)
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
      if (raw) {
        const parsed = JSON.parse(raw) as ChatBinding
        setChatBinding(parsed)
      }
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

  return (
    <div className="flex h-svh flex-col bg-background">
      <Header
        inspectorOpen={inspectorOpen}
        onToggleInspector={toggleInspector}
        terminalOpen={terminalOpen}
        onToggleTerminal={toggleTerminal}
      />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          width={sidebarWidth}
          onResizeStart={handleResizeStart}
          activeTab={activeTab}
          onTabChange={handleTabChange}
          items={sidebarItems}
          onItemsChange={setSidebarItems}
          isSettingsMode={isSettingsMode}
          onToggleSettingsMode={setIsSettingsMode}
          onBackToMain={handleBackToMain}
          onProjectSelect={(projectId) => setChatBinding((prev) => ({ ...prev, projectId }))}
          onTopicSelect={(topicId) => setChatBinding((prev) => ({ ...prev, topicId }))}
          onSessionSelect={(sessionKey) => setChatBinding((prev) => ({ ...prev, sessionKey }))}
          onProjectNameSelect={(projectName) => setChatBinding((prev) => ({ ...prev, projectName }))}
          onTopicNameSelect={(topicName) => setChatBinding((prev) => ({ ...prev, topicName }))}
        />

        <div className="flex flex-1 flex-col overflow-hidden">
          <main className="flex flex-1 items-start justify-center overflow-y-auto transition-all duration-300 ease-in-out">
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
  const [streamId, setStreamId] = useState<string | null>(null)

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

          if (event.type === "chat.status") {
            setStatus(String(event.state ?? "connected"))
          }

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
        setStreamId(stream.streamId)
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
      if (currentStreamId) {
        void chatStreamStop(currentStreamId)
      }
      setStreamId(null)
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

  if (!chatBinding.projectId) {
    return (
      <div className="flex min-h-full w-full flex-col items-center justify-center gap-8 py-10">
        <AnimatedGreeting />
        <ChatBox disabled />
      </div>
    )
  }

  return (
    <div className="flex min-h-full w-full max-w-4xl flex-col gap-6 px-6 py-10">
      <div className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground/60">Chat</span>
        <h2 className="text-lg font-semibold text-foreground">
          {chatBinding.topicName ?? "Select a topic"}
        </h2>
        <p className="text-xs text-muted-foreground">
          {chatBinding.projectName ? `${chatBinding.projectName}` : "No project selected"}
          {chatBinding.sessionKey ? ` · ${chatBinding.sessionKey}` : ""}
          {status ? ` · ${status}` : ""}
        </p>
      </div>

      <div className="flex min-h-[260px] flex-1 flex-col rounded-2xl border border-border/50 bg-card">
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading messages…</p>
          ) : messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">No messages yet. Start the conversation.</p>
          ) : (
            messages.map((message) => (
              <div key={message.id} className="rounded-xl border border-border/40 bg-background/40 p-3">
                <div className="mb-1 flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
                  <span className="font-medium uppercase tracking-wide">{message.role}</span>
                  <span>{message.createdAt}</span>
                </div>
                <p className="whitespace-pre-wrap text-sm text-foreground/90">{message.text}</p>
              </div>
            ))
          )}
        </div>
      </div>

      <ChatBox
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        disabled={!chatBinding.sessionKey || sending}
      />
    </div>
  )
}
