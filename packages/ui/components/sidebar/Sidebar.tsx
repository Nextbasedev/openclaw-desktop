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
  listTopics,
  createTopic,
  listSessions,
  createSessionMapping,
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

export function Sidebar({ className,
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
  const [loadingProjects, setLoadingProjects] = useState(false)
  const [loadingTopics, setLoadingTopics] = useState(false)
  const [creatingProject, setCreatingProject] = useState(false)
  const [creatingTopic, setCreatingTopic] = useState(false)
  const id = useId()

  useEffect(() => {
    setMounted(true)
  }, [])

  const loadProjects = useCallback(async () => {
    try {
      setLoadingProjects(true)
      const result = await listProjects()
      const activeProjects = result.projects.filter((p) => !p.archived)
      setProjects(activeProjects)

      if (!selectedProjectId && activeProjects.length > 0) {
        setSelectedProjectId(activeProjects[0].id)
        onProjectSelect?.(activeProjects[0].id)
        onProjectNameSelect?.(activeProjects[0].name)
      }
    } catch (error) {
      console.error("Failed to load projects", error)
    } finally {
      setLoadingProjects(false)
    }
  }, [selectedProjectId])

  const loadTopics = useCallback(async (projectId: string) => {
    try {
      setLoadingTopics(true)
      const result = await listTopics(projectId)
      const activeTopics = result.topics.filter((t) => !t.archived)
      setTopics(activeTopics)

      if (!selectedTopicId && activeTopics.length > 0) {
        setSelectedTopicId(activeTopics[0].id)
        onTopicSelect?.(activeTopics[0].id)
        onTopicNameSelect?.(activeTopics[0].name)
      }
    } catch (error) {
      console.error("Failed to load topics", error)
    } finally {
      setLoadingTopics(false)
    }
  }, [selectedTopicId])

  useEffect(() => {
    void loadProjects()
  }, [loadProjects])

  useEffect(() => {
    if (selectedProjectId) {
      void loadTopics(selectedProjectId)
    } else {
      setTopics([])
      setSelectedTopicId(null)
      onTopicSelect?.(null)
      onTopicNameSelect?.(null)
      onSessionSelect?.(null)
    }
  }, [selectedProjectId, loadTopics, onTopicSelect, onSessionSelect])

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
    try {
      setCreatingProject(true)
      const name = `Project ${projects.length + 1}`
      const result = await createProject({
        name,
        profileId: "prof_local_main",
        workspaceRoot: "/root/.openclaw/workspace",
        repoRoot: "/root/.openclaw/workspace",
      })
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
  }, [projects.length, loadProjects])

  const handleCreateTopic = useCallback(async () => {
    if (!selectedProjectId) return

    try {
      setCreatingTopic(true)
      const name = `Topic ${topics.length + 1}`
      const result = await createTopic({
        projectId: selectedProjectId,
        name,
      })

      await loadTopics(selectedProjectId)
      setSelectedTopicId(result.topic.id)
      onTopicSelect?.(result.topic.id)
      onTopicNameSelect?.(result.topic.name)

      // First working story: create a session mapping immediately for new topic
      const createdSession = await createSessionMapping({
        projectId: selectedProjectId,
        topicId: result.topic.id,
        agentId: "main",
        label: result.topic.name,
      })

      onSessionSelect?.(createdSession.session.sessionKey)

      // Warm the mapping list to ensure backend path is exercised
      await listSessions({
        projectId: selectedProjectId,
        topicId: result.topic.id,
        includeExisting: false,
      })
    } catch (error) {
      console.error("Failed to create topic/session", error)
    } finally {
      setCreatingTopic(false)
    }
  }, [selectedProjectId, topics.length, loadTopics])

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (over && active.id !== over.id) {
        const oldIndex = items.findIndex((i) => i.id === active.id)
        const newIndex = items.findIndex((i) => i.id === over.id)
        onItemsChange(arrayMove(items, oldIndex, newIndex))
      }
    },
    [items, onItemsChange],
  )

  const sidebarStyle = useMemo(
    () => ({ width: `${width}px` }),
    [width],
  )

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

      <nav
        className={cn(
          "relative z-10 flex-1 overflow-y-auto px-2 py-3",
          "scroll-smooth overscroll-contain",
        )}
      >
        {isSettingsMode ? (
          <div className="flex h-full flex-col gap-1">
            <button
              onClick={onBackToMain}
              className="flex w-full cursor-pointer items-center gap-1 rounded-md px-2.5 py-1 text-left text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <Icons.Back size={16} strokeWidth={1.5} />
              <span>Back to App</span>
            </button>

            <div className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
              Personal
            </div>
            <SettingsItem id="usage" label="Usage" icon="usage" active={activeTab === "usage"} onClick={() => onTabChange("usage")} />
            <SettingsItem id="memory" label="Memory" icon="memory" active={activeTab === "memory"} onClick={() => onTabChange("memory")} />

            <div className="mb-2 mt-4 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
              System
            </div>
            <SettingsItem id="account" label="Account" icon="user" active={activeTab === "account"} onClick={() => onTabChange("account")} />
            <SettingsItem id="personalization" label="Appearance" icon="settings" active={activeTab === "personalization"} onClick={() => onTabChange("personalization")} />
            <SettingsItem id="data-control" label="Data Control" icon="grid" active={activeTab === "data-control"} onClick={() => onTabChange("data-control")} />
            <SettingsItem id="maintenance" label="Maintenance" icon="wrench" active={activeTab === "maintenance"} onClick={() => onTabChange("maintenance")} />

            <div className="mt-auto pt-4">
              <SettingsItem id="help" label="Help" icon="help" active={activeTab === "help"} onClick={() => onTabChange("help")} />
            </div>
          </div>
        ) : (
          <>
            {mounted ? (
              <DndContext
                id={id}
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={items.map((i) => i.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="flex flex-col gap-1">
                    {items.map((item) => (
                      <SidebarItem
                        key={item.id}
                        item={item}
                        isActive={activeTab === item.id}
                        onClick={() => onTabChange(item.id)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            ) : (
              <div className="flex flex-col gap-1">
                {items.map((item) => (
                  <SidebarItem
                    key={item.id}
                    item={item}
                    isActive={activeTab === item.id}
                    onClick={() => onTabChange(item.id)}
                  />
                ))}
              </div>
            )}

            <div className="mt-3 border-t border-border/10 pt-3">
              <div className="mb-2 flex items-center justify-between px-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                  Projects
                </p>
                <button
                  type="button"
                  onClick={handleCreateProject}
                  disabled={creatingProject}
                  className="flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground disabled:cursor-default disabled:opacity-50"
                >
                  <Icons.Plus size={12} />
                  New
                </button>
              </div>

              {loadingProjects ? (
                <p className="px-2 text-[11px] text-muted-foreground/60">Loading projects…</p>
              ) : projects.length === 0 ? (
                <button
                  type="button"
                  onClick={handleCreateProject}
                  disabled={creatingProject}
                  className="mx-2 flex w-[calc(100%-16px)] cursor-pointer items-center justify-center rounded-md border border-dashed border-border/40 px-2 py-2 text-[11px] text-muted-foreground transition-colors hover:border-border/70 hover:text-foreground disabled:cursor-default disabled:opacity-50"
                >
                  Create first project
                </button>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {projects.map((project) => (
                    <button
                      key={project.id}
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
                      className={cn(
                        "mx-1 flex w-[calc(100%-8px)] cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left text-[12px] transition-colors",
                        selectedProjectId === project.id
                          ? "bg-foreground/5 text-foreground"
                          : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                      )}
                    >
                      <Icons.Project size={14} className="shrink-0" />
                      <span className="truncate">{project.name}</span>
                    </button>
                  ))}
                </div>
              )}

              <div className="mb-2 mt-4 flex items-center justify-between px-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                  Topics
                </p>
                <button
                  type="button"
                  onClick={handleCreateTopic}
                  disabled={!selectedProjectId || creatingTopic}
                  className="flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground disabled:cursor-default disabled:opacity-50"
                >
                  <Icons.Plus size={12} />
                  New
                </button>
              </div>

              {!selectedProjectId ? (
                <p className="px-2 text-[11px] text-muted-foreground/60">Select a project first</p>
              ) : loadingTopics ? (
                <p className="px-2 text-[11px] text-muted-foreground/60">Loading topics…</p>
              ) : topics.length === 0 ? (
                <button
                  type="button"
                  onClick={handleCreateTopic}
                  disabled={creatingTopic}
                  className="mx-2 flex w-[calc(100%-16px)] cursor-pointer items-center justify-center rounded-md border border-dashed border-border/40 px-2 py-2 text-[11px] text-muted-foreground transition-colors hover:border-border/70 hover:text-foreground disabled:cursor-default disabled:opacity-50"
                >
                  Create first topic
                </button>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {topics.map((topic) => (
                    <button
                      key={topic.id}
                      type="button"
                      onClick={() => {
                        setSelectedTopicId(topic.id)
                        onTopicSelect?.(topic.id)
                        onTopicNameSelect?.(topic.name)
                      }}
                      className={cn(
                        "mx-1 flex w-[calc(100%-8px)] cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left text-[12px] transition-colors",
                        selectedTopicId === topic.id
                          ? "bg-foreground/5 text-foreground"
                          : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                      )}
                    >
                      <Icons.BubbleChat size={14} className="shrink-0" />
                      <span className="truncate">{topic.name}</span>
                    </button>
                  ))}
                </div>
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

      <VersionUpdateModal
        open={versionModalOpen}
        onOpenChange={setVersionModalOpen}
      />
    </aside>
  )
}

function SettingsItem({ id, label, icon, active, onClick }: {
  id: string
  label: string
  icon: string
  active: boolean
  onClick: () => void
}) {
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
        active
          ? "bg-foreground/5 text-foreground shadow-sm backdrop-blur-md"
          : "text-foreground/85 hover:bg-secondary/60 hover:text-foreground"
      )}
    >
      <Icon size={16} strokeWidth={active ? 2 : 1.5} className="shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  )
}

export { DEFAULT_DRAGGABLE_ITEMS }
export type { SidebarNavItem }
