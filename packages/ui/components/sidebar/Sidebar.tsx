import { Icons } from "@/components/icons"
import { useState, useCallback, useMemo, useEffect, useId } from "react"
import { VersionUpdateModal } from "./VersionUpdateModal"
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { cn } from "@/lib/utils"
import { SidebarItem, type SidebarNavItem } from "./SidebarItem"
import {
  listProjects,
  createProject,
  updateProject,
  archiveProject,
  getProjectSidebar,
  listTopics,
  createTopic,
  updateTopic,
  archiveTopic,
  listSessions,
  createSessionMapping,
  updateSessionMapping,
  deleteSessionMapping,
  type Project,
  type Topic,
} from "@/lib/jarvis-middleware"

const DEFAULT_DRAGGABLE_ITEMS: SidebarNavItem[] = [
  { id: "chat", label: "Chat", icon: "chat" },
  { id: "skill", label: "Skill", icon: "skill" },
  { id: "workspace", label: "Workspace", icon: "workspace" },
  { id: "settings", label: "Settings", icon: "settings" },
]

type SidebarProps = {
  className?: string
  width?: number
  onResizeStart?: () => void
  activeTab: string
  onTabChange: (tab: string) => void
  items: SidebarNavItem[]
  onItemsChange: (items: SidebarNavItem[]) => void
  isSettingsMode: boolean
  onToggleSettingsMode: (val: boolean) => void
  onBackToMain: () => void
  onProjectSelect?: (projectId: string | null) => void
  onProjectNameSelect?: (projectName: string | null) => void
  onTopicSelect?: (topicId: string | null) => void
  onTopicNameSelect?: (topicName: string | null) => void
  onSessionSelect?: (sessionKey: string | null) => void
}

export function Sidebar({
  className,
  width = 220,
  onResizeStart,
  activeTab,
  onTabChange,
  items,
  onItemsChange,
  isSettingsMode,
  onToggleSettingsMode,
  onBackToMain,
  onProjectSelect,
  onProjectNameSelect,
  onTopicSelect,
  onTopicNameSelect,
  onSessionSelect,
}: SidebarProps) {
  const [mounted, setMounted] = useState(false)
  const [versionModalOpen, setVersionModalOpen] = useState(false)
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [topics, setTopics] = useState<Topic[]>([])
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null)
  const [projectSessions, setProjectSessions] = useState<Array<{ key: string; title: string | null; status: string | null }>>([])
  const [loadingProjects, setLoadingProjects] = useState(false)
  const [loadingTopics, setLoadingTopics] = useState(false)
  const [creatingProject, setCreatingProject] = useState(false)
  const [creatingTopic, setCreatingTopic] = useState(false)
  const [newProjectName, setNewProjectName] = useState("")
  const [newTopicName, setNewTopicName] = useState("")
  const [showProjectInput, setShowProjectInput] = useState(false)
  const [showTopicInput, setShowTopicInput] = useState(false)
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null)
  const [editingProjectName, setEditingProjectName] = useState("")
  const [editingTopicId, setEditingTopicId] = useState<string | null>(null)
  const [editingTopicName, setEditingTopicName] = useState("")
  const id = useId()

  useEffect(() => setMounted(true), [])

  const loadProjects = useCallback(async () => {
    try {
      setLoadingProjects(true)
      const result = await listProjects()
      const activeProjects = result.projects.filter((p) => !p.archived)
      setProjects(activeProjects)
      if (!selectedProjectId && activeProjects.length > 0) {
        const first = activeProjects[0]
        setSelectedProjectId(first.id)
        onProjectSelect?.(first.id)
        onProjectNameSelect?.(first.name)
      }
    } catch (error) {
      console.error("Failed to load projects", error)
    } finally {
      setLoadingProjects(false)
    }
  }, [selectedProjectId, onProjectSelect, onProjectNameSelect])

  const loadTopics = useCallback(async (projectId: string) => {
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
      if (selectedProject) onProjectNameSelect?.(selectedProject.name)
      if (!selectedTopicId && activeTopics.length > 0) {
        const first = activeTopics[0]
        setSelectedTopicId(first.id)
        onTopicSelect?.(first.id)
        onTopicNameSelect?.(first.name)
      }
    } catch (error) {
      console.error("Failed to load topics/sidebar", error)
    } finally {
      setLoadingTopics(false)
    }
  }, [selectedTopicId, projects, onProjectNameSelect, onTopicSelect, onTopicNameSelect])

  useEffect(() => {
    void loadProjects()
  }, [loadProjects])

  useEffect(() => {
    if (selectedProjectId) {
      void loadTopics(selectedProjectId)
    } else {
      setTopics([])
      setProjectSessions([])
      setSelectedTopicId(null)
      onTopicSelect?.(null)
      onTopicNameSelect?.(null)
      onSessionSelect?.(null)
    }
  }, [selectedProjectId, loadTopics, onTopicSelect, onTopicNameSelect, onSessionSelect])

  useEffect(() => {
    async function syncTopicSession() {
      if (!selectedProjectId || !selectedTopicId) {
        onSessionSelect?.(null)
        return
      }
      try {
        const topic = topics.find((item) => item.id === selectedTopicId)
        if (topic) onTopicNameSelect?.(topic.name)
        const result = await listSessions({
          projectId: selectedProjectId,
          topicId: selectedTopicId,
          includeExisting: false,
        })
        onSessionSelect?.(result.sessions[0]?.sessionKey ?? null)
      } catch (error) {
        console.error("Failed to load topic sessions", error)
        onSessionSelect?.(null)
      }
    }

    void syncTopicSession()
  }, [selectedProjectId, selectedTopicId, topics, onSessionSelect, onTopicNameSelect])

  const handleCreateProject = useCallback(async () => {
    const name = newProjectName.trim()
    if (!name) return
    try {
      setCreatingProject(true)
      const result = await createProject({
        name,
        profileId: "prof_local_main",
        workspaceRoot: "/root/.openclaw/workspace",
        repoRoot: "/root/.openclaw/workspace",
      })
      setNewProjectName("")
      setShowProjectInput(false)
      await loadProjects()
      setSelectedProjectId(result.project.id)
      setSelectedTopicId(null)
      onProjectSelect?.(result.project.id)
      onProjectNameSelect?.(result.project.name)
      onTopicSelect?.(null)
      onTopicNameSelect?.(null)
      onSessionSelect?.(null)
    } catch (error) {
      console.error("Failed to create project", error)
    } finally {
      setCreatingProject(false)
    }
  }, [newProjectName, loadProjects, onProjectSelect, onProjectNameSelect, onTopicSelect, onTopicNameSelect, onSessionSelect])

  const handleCreateTopic = useCallback(async () => {
    if (!selectedProjectId) return
    const name = newTopicName.trim()
    if (!name) return
    try {
      setCreatingTopic(true)
      const result = await createTopic({ projectId: selectedProjectId, name })
      setNewTopicName("")
      setShowTopicInput(false)
      await loadTopics(selectedProjectId)
      setSelectedTopicId(result.topic.id)
      onTopicSelect?.(result.topic.id)
      onTopicNameSelect?.(result.topic.name)
      const createdSession = await createSessionMapping({
        projectId: selectedProjectId,
        topicId: result.topic.id,
        agentId: "main",
        label: result.topic.name,
      })
      onSessionSelect?.(createdSession.session.sessionKey)
    } catch (error) {
      console.error("Failed to create topic/session", error)
    } finally {
      setCreatingTopic(false)
    }
  }, [selectedProjectId, newTopicName, loadTopics, onTopicSelect, onTopicNameSelect, onSessionSelect])

  const handleRenameProject = useCallback(async (projectId: string) => {
    const name = editingProjectName.trim()
    if (!name) return
    await updateProject({ projectId, name })
    setEditingProjectId(null)
    setEditingProjectName("")
    await loadProjects()
    if (selectedProjectId === projectId) onProjectNameSelect?.(name)
  }, [editingProjectName, loadProjects, selectedProjectId, onProjectNameSelect])

  const handleRenameTopic = useCallback(async (topicId: string) => {
    const name = editingTopicName.trim()
    if (!name) return
    await updateTopic({ topicId, name })
    setEditingTopicId(null)
    setEditingTopicName("")
    if (selectedProjectId) await loadTopics(selectedProjectId)
    if (selectedTopicId === topicId) onTopicNameSelect?.(name)
  }, [editingTopicName, selectedProjectId, selectedTopicId, loadTopics, onTopicNameSelect])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      const oldIndex = items.findIndex((i) => i.id === active.id)
      const newIndex = items.findIndex((i) => i.id === over.id)
      onItemsChange(arrayMove(items, oldIndex, newIndex))
    }
  }, [items, onItemsChange])

  const sidebarStyle = useMemo(() => ({ width: `${width}px` }), [width])

  return (
    <aside
      style={sidebarStyle}
      className={cn(
        "group/sidebar relative flex h-full shrink-0 flex-col overflow-hidden",
        "border-r border-border/50 bg-card/70 backdrop-blur-xl",
        "shadow-[0_10px_40px_rgba(0,0,0,0.08)] transition-[box-shadow,background-color] duration-200 ease-out",
        className,
      )}
    >
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.14)_0%,rgba(255,255,255,0.04)_100%)] opacity-60 dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.06)_0%,rgba(255,255,255,0.02)_100%)]" />

      <nav className="relative z-10 flex-1 overflow-y-auto px-2 py-3 scroll-smooth overscroll-contain">
        {isSettingsMode ? (
          <div className="flex h-full flex-col gap-1">/* settings unchanged */</div>
        ) : (
          <>
            {mounted ? (
              <DndContext id={id} sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
                  <div className="flex flex-col gap-1">
                    {items.map((item) => (
                      <SidebarItem key={item.id} item={item} isActive={activeTab === item.id} onClick={() => onTabChange(item.id)} />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            ) : null}

            <div className="mt-3 border-t border-border/10 pt-3">
              <SectionHeader title="Projects" actionLabel={showProjectInput ? "Cancel" : "New"} onAction={() => setShowProjectInput((v) => !v)} />
              {showProjectInput && (
                <CreateRow
                  value={newProjectName}
                  placeholder="New project name"
                  onChange={setNewProjectName}
                  onConfirm={handleCreateProject}
                  onCancel={() => {
                    setShowProjectInput(false)
                    setNewProjectName("")
                  }}
                  loading={creatingProject}
                />
              )}

              {loadingProjects ? (
                <p className="px-2 text-[11px] text-muted-foreground/60">Loading projects…</p>
              ) : projects.length === 0 ? (
                <p className="px-2 text-[11px] text-muted-foreground/60">No projects yet</p>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {projects.map((project) => (
                    <div key={project.id} className="group/project mx-1 rounded-md">
                      <div className={cn(
                        "flex items-center gap-2 rounded-md px-2 py-1 text-[12px] transition-colors",
                        selectedProjectId === project.id ? "bg-foreground/5 text-foreground" : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                      )}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedProjectId(project.id)
                            setSelectedTopicId(null)
                            onProjectSelect?.(project.id)
                            onProjectNameSelect?.(project.name)
                            onTopicSelect?.(null)
                            onTopicNameSelect?.(null)
                            onSessionSelect?.(null)
                          }}
                          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
                        >
                          <Icons.Project size={14} className="shrink-0" />
                          {editingProjectId === project.id ? (
                            <input
                              value={editingProjectName}
                              onChange={(e) => setEditingProjectName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") void handleRenameProject(project.id)
                                if (e.key === "Escape") {
                                  setEditingProjectId(null)
                                  setEditingProjectName("")
                                }
                              }}
                              autoFocus
                              className="min-w-0 flex-1 bg-transparent outline-none"
                            />
                          ) : (
                            <span className="truncate">{project.name}</span>
                          )}
                        </button>
                        <div className="flex items-center opacity-0 transition-opacity group-hover/project:opacity-100">
                          <MiniIcon onClick={() => {
                            setEditingProjectId(project.id)
                            setEditingProjectName(project.name)
                          }}><Icons.Edit size={12} /></MiniIcon>
                          <MiniIcon onClick={async () => {
                            await archiveProject(project.id)
                            if (selectedProjectId === project.id) {
                              onProjectSelect?.(null)
                              onProjectNameSelect?.(null)
                              onTopicSelect?.(null)
                              onTopicNameSelect?.(null)
                              onSessionSelect?.(null)
                              setSelectedProjectId(null)
                            }
                            await loadProjects()
                          }}><Icons.Close size={12} /></MiniIcon>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <SectionHeader title="Topics" actionLabel={showTopicInput ? "Cancel" : "New"} onAction={() => setShowTopicInput((v) => !v)} className="mt-4" />
              {showTopicInput && selectedProjectId && (
                <CreateRow
                  value={newTopicName}
                  placeholder="New topic name"
                  onChange={setNewTopicName}
                  onConfirm={handleCreateTopic}
                  onCancel={() => {
                    setShowTopicInput(false)
                    setNewTopicName("")
                  }}
                  loading={creatingTopic}
                />
              )}

              {!selectedProjectId ? (
                <p className="px-2 text-[11px] text-muted-foreground/60">Select a project first</p>
              ) : loadingTopics ? (
                <p className="px-2 text-[11px] text-muted-foreground/60">Loading topics…</p>
              ) : (
                <>
                  <div className="flex flex-col gap-0.5">
                    {topics.map((topic) => (
                      <div key={topic.id} className="group/topic mx-1 rounded-md">
                        <div className={cn(
                          "flex items-center gap-2 rounded-md px-2 py-1 text-[12px] transition-colors",
                          selectedTopicId === topic.id ? "bg-foreground/5 text-foreground" : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                        )}>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedTopicId(topic.id)
                              onTopicSelect?.(topic.id)
                              onTopicNameSelect?.(topic.name)
                            }}
                            className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
                          >
                            <Icons.BubbleChat size={14} className="shrink-0" />
                            {editingTopicId === topic.id ? (
                              <input
                                value={editingTopicName}
                                onChange={(e) => setEditingTopicName(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") void handleRenameTopic(topic.id)
                                  if (e.key === "Escape") {
                                    setEditingTopicId(null)
                                    setEditingTopicName("")
                                  }
                                }}
                                autoFocus
                                className="min-w-0 flex-1 bg-transparent outline-none"
                              />
                            ) : (
                              <span className="truncate">{topic.name}</span>
                            )}
                          </button>
                          <span className="text-[10px] text-muted-foreground/60">{topic.unreadCount}</span>
                          <div className="flex items-center opacity-0 transition-opacity group-hover/topic:opacity-100">
                            <MiniIcon onClick={() => {
                              setEditingTopicId(topic.id)
                              setEditingTopicName(topic.name)
                            }}><Icons.Edit size={12} /></MiniIcon>
                            <MiniIcon onClick={async () => {
                              await archiveTopic(topic.id)
                              if (selectedTopicId === topic.id) {
                                onTopicSelect?.(null)
                                onTopicNameSelect?.(null)
                                onSessionSelect?.(null)
                                setSelectedTopicId(null)
                              }
                              if (selectedProjectId) await loadTopics(selectedProjectId)
                            }}><Icons.Close size={12} /></MiniIcon>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <SectionHeader title="Chats" className="mt-4" />
                  <div className="flex flex-col gap-0.5">
                    {projectSessions.length === 0 ? (
                      <p className="px-2 text-[11px] text-muted-foreground/60">No mapped chats yet</p>
                    ) : projectSessions.map((session) => (
                      <div key={session.key} className="group/session mx-1 rounded-md">
                        <div className="flex items-center gap-2 rounded-md px-2 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground">
                          <button
                            type="button"
                            onClick={() => onSessionSelect?.(session.key)}
                            className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
                          >
                            <Icons.Chat size={14} className="shrink-0" />
                            <span className="truncate">{session.title ?? session.key}</span>
                          </button>
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground/60">{session.status ?? "idle"}</span>
                          <div className="flex items-center opacity-0 transition-opacity group-hover/session:opacity-100">
                            <MiniIcon onClick={async () => {
                              await updateSessionMapping({ sessionKey: session.key, pinned: true })
                              if (selectedProjectId) await loadTopics(selectedProjectId)
                            }}><Icons.Check size={12} /></MiniIcon>
                            <MiniIcon onClick={async () => {
                              await deleteSessionMapping(session.key)
                              if (selectedProjectId) await loadTopics(selectedProjectId)
                              if (selectedTopicId) {
                                const result = await listSessions({ projectId: selectedProjectId!, topicId: selectedTopicId, includeExisting: false })
                                onSessionSelect?.(result.sessions[0]?.sessionKey ?? null)
                              }
                            }}><Icons.Close size={12} /></MiniIcon>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </nav>

      <button
        type="button"
        aria-label="Resize sidebar"
        onMouseDown={onResizeStart}
        className={cn(
          "absolute right-0 top-0 z-20 h-full w-1 -translate-x-1/2 cursor-col-resize",
          "bg-transparent transition-colors duration-150",
        )}
      />

      <VersionUpdateModal open={versionModalOpen} onOpenChange={setVersionModalOpen} />
    </aside>
  )
}

function SectionHeader({ title, actionLabel, onAction, className }: { title: string; actionLabel?: string; onAction?: () => void; className?: string }) {
  return (
    <div className={cn("mb-2 flex items-center justify-between px-2", className)}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">{title}</p>
      {actionLabel && onAction ? (
        <button type="button" onClick={onAction} className="flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground">
          <Icons.Plus size={12} />
          {actionLabel}
        </button>
      ) : null}
    </div>
  )
}

function CreateRow({ value, placeholder, onChange, onConfirm, onCancel, loading }: { value: string; placeholder: string; onChange: (value: string) => void; onConfirm: () => void; onCancel: () => void; loading?: boolean }) {
  return (
    <div className="mx-2 mb-2 flex items-center gap-1 rounded-md border border-border/40 bg-background/40 px-2 py-1.5">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onConfirm()
          if (e.key === "Escape") onCancel()
        }}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent text-[11px] text-foreground outline-none placeholder:text-muted-foreground/50"
        autoFocus
      />
      <MiniIcon onClick={onConfirm} disabled={loading || !value.trim()}><Icons.Check size={12} /></MiniIcon>
      <MiniIcon onClick={onCancel}><Icons.Close size={12} /></MiniIcon>
    </div>
  )
}

function MiniIcon({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex size-5 cursor-pointer items-center justify-center rounded text-muted-foreground/70 transition-colors hover:bg-secondary hover:text-foreground disabled:cursor-default disabled:opacity-40"
    >
      {children}
    </button>
  )
}

function SettingsItem({ id, label, icon, active, onClick }: { id: string; label: string; icon: string; active: boolean; onClick: () => void }) {
  const iconMap: Record<string, any> = {
    usage: Icons.Automations,
    memory: Icons.Memory,
    user: Icons.UserAccount,
    settings: Icons.Settings,
    grid: Icons.Grid,
    wrench: Icons.Wrench,
    help: Icons.Help,
  }
  const Icon = iconMap[icon] || Icons.Settings
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] font-normal transition-colors",
        active ? "bg-foreground/5 text-foreground shadow-sm backdrop-blur-md" : "text-foreground/85 hover:bg-secondary/60 hover:text-foreground",
      )}
    >
      <Icon size={16} strokeWidth={active ? 2 : 1.5} className="shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  )
}

export { DEFAULT_DRAGGABLE_ITEMS }
export type { SidebarNavItem }
