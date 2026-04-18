"use client"

import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { invoke } from "@tauri-apps/api/core"
import { Reorder, useDragControls, motion } from "framer-motion"
import { Icons } from "@/components/icons"
import { GlassDialog } from "@/components/ui/GlassDialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export type ActiveTopic = {
  id: string
  name: string
  projectId: string
  projectName: string
}

type Project = { id: string; name: string; archived: boolean }
type FullTopic = {
  id: string
  name: string
  projectId: string
  archived: boolean
  unreadCount: number
  sortOrder: number
  createdAt: string
  updatedAt: string
}

type Props = {
  collapsed: boolean
  activeTopic: ActiveTopic | null
  onTopicSelect: (topic: ActiveTopic) => void
}

function formatCompactTime(dateStr: string): string {
  if (!dateStr) return ""
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "now"
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d`
  const weeks = Math.floor(days / 7)
  if (weeks < 4) return `${weeks}w`
  return `${Math.floor(days / 30)}mo`
}

// Long-press starts drag after 900 ms; moving >4 px cancels it.
function useLongPressDrag(controls: ReturnType<typeof useDragControls>, delay = 500) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const nativeEventRef = useRef<PointerEvent | null>(null)
  const startPosRef = useRef<{ x: number; y: number } | null>(null)

  const cancel = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
    nativeEventRef.current = null
    startPosRef.current = null
  }, [])

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return
    nativeEventRef.current = e.nativeEvent
    startPosRef.current = { x: e.clientX, y: e.clientY }
    timerRef.current = setTimeout(() => {
      if (nativeEventRef.current) {
        const style = document.createElement("style")
        style.id = "__drag-cursor__"
        style.textContent = "*{cursor:grabbing!important}"
        document.head.appendChild(style)
        controls.start(nativeEventRef.current)
        // framer-motion captures the pointer, so onPointerUp never fires on the element.
        // Listen globally to guarantee cleanup.
        const removeCursor = () => {
          document.getElementById("__drag-cursor__")?.remove()
          window.removeEventListener("pointerup", removeCursor)
          window.removeEventListener("pointercancel", removeCursor)
        }
        window.addEventListener("pointerup", removeCursor)
        window.addEventListener("pointercancel", removeCursor)
      }
      nativeEventRef.current = null
      startPosRef.current = null
    }, delay)
  }, [controls, delay])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!startPosRef.current || !timerRef.current) return
    if (Math.hypot(e.clientX - startPosRef.current.x, e.clientY - startPosRef.current.y) > 4) cancel()
  }, [cancel])

  useEffect(() => () => cancel(), [cancel])

  return { onPointerDown, onPointerUp: cancel, onPointerLeave: cancel, onPointerMove }
}

// No inset shadow — it creates uneven top border appearance on glass panels
const GLASS_POPOVER = [
  "bg-[var(--glass-bg)] backdrop-blur-[32px] backdrop-saturate-[180%]",
  "border border-border/15",
  "shadow-[0_8px_32px_var(--glass-shadow)]",
  "rounded-xl",
].join(" ")

function MenuAction({
  label,
  icon,
  onClick,
  danger = false,
}: {
  label: string
  icon: React.ReactNode
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors text-left",
        danger
          ? "text-red-400 hover:bg-red-400/10"
          : "text-foreground/80 hover:bg-foreground/8 hover:text-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  )
}

// ─── Sortable Topic Row ───────────────────────────────────────────────────────
function SortableTopicRow({
  topicId,
  topics,
  isActive,
  isPinned,
  onClick,
  onPin,
  onRename,
  onArchive,
}: {
  topicId: string
  topics: FullTopic[]
  isActive: boolean
  isPinned: boolean
  onClick: () => void
  onPin: () => void
  onRename: () => void
  onArchive: () => void
}) {
  const controls = useDragControls()
  const longPress = useLongPressDrag(controls)
  const [menuOpen, setMenuOpen] = useState(false)
  const topic = topics.find((t) => t.id === topicId)
  if (!topic) return null

  const timeStr = formatCompactTime(topic.updatedAt)

  return (
    <Reorder.Item
      value={topicId}
      dragListener={false}
      dragControls={controls}
      as="div"
      layout="position"
      transition={{ layout: { duration: 0.12, ease: "easeOut" } }}
      className="group/row relative flex items-center rounded-md"
      style={{ position: "relative" }}
      animate={{ opacity: 1 }}
      whileDrag={{ scale: 1.01 }}
      {...longPress}
    >
      <button
        onClick={onClick}
        style={isActive ? { color: "#ffffff" } : undefined}
        className={cn(
          "flex flex-1 min-w-0 cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-left",
          "transition-all duration-150",
          isActive
            ? "bg-foreground/7"
            : "text-foreground/80 hover:bg-foreground/4 hover:text-foreground",
        )}
      >
        {/* Pin icon — left of name */}
        <span
          onClick={(e) => { e.stopPropagation(); onPin() }}
          title={isPinned ? "Unpin" : "Pin"}
          className={cn(
            "flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded transition-all duration-150",
            isPinned
              ? isActive ? "text-foreground" : "text-foreground/70"
              : "opacity-0 group-hover/row:opacity-100 text-muted-foreground/40 hover:text-foreground",
          )}
        >
          <Icons.Pin size={15} strokeWidth={isPinned ? 2 : 1.5} />
        </span>

        <span className="flex-1 truncate text-[13px] font-light">
          {topic.name}
        </span>
      </button>

      {/* Right side: time and 3-dot occupy the same spot — one replaces the other */}
      <div className="absolute right-1 flex h-5 w-5 items-center justify-center">
        <span className={cn(
          "absolute text-[10px] text-muted-foreground/35 tabular-nums pointer-events-none select-none transition-opacity duration-100",
          isActive || menuOpen ? "opacity-0" : "group-hover/row:opacity-0",
        )}>
          {timeStr}
        </span>
        <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          <PopoverTrigger asChild>
            <button
              onClick={(e) => e.stopPropagation()}
              title="Topic options"
              className={cn(
                "absolute flex h-5 w-5 cursor-pointer items-center justify-center rounded transition-all duration-100",
                isActive || menuOpen
                  ? "opacity-100 text-muted-foreground/60 hover:text-foreground"
                  : "opacity-0 group-hover/row:opacity-100 text-muted-foreground/50 hover:text-foreground",
              )}
            >
              <Icons.MoreVertical size={14} strokeWidth={1.5} />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" side="right" sideOffset={4} className={cn("w-36 p-1 gap-0", GLASS_POPOVER)}>
            <MenuAction
              label="Rename"
              icon={<Icons.Edit size={14} strokeWidth={1.5} />}
              onClick={() => { setMenuOpen(false); onRename() }}
            />
            <div className="my-0.5 h-px bg-border/20" />
            <MenuAction
              label="Archive"
              icon={<Icons.Minus size={14} strokeWidth={1.5} />}
              onClick={() => { setMenuOpen(false); onArchive() }}
              danger
            />
          </PopoverContent>
        </Popover>
      </div>
    </Reorder.Item>
  )
}

// ─── Sortable Project Row ─────────────────────────────────────────────────────
function SortableProjectRow({
  projectId,
  projects,
  isExpanded,
  hasActiveTopic,
  isPinned,
  activeTopic,
  topics,
  topicOrderForProject,
  pinnedTopics,
  loadingProject,
  onProjectClick,
  onTogglePinProject,
  onOpenAddTopic,
  onRenameProject,
  onArchiveProject,
  onTopicSelect,
  onPinTopic,
  onRenameTopic,
  onArchiveTopic,
  onTopicReorder,
}: {
  projectId: string
  projects: Project[]
  isExpanded: boolean
  hasActiveTopic: boolean
  isPinned: boolean
  activeTopic: ActiveTopic | null
  topics: FullTopic[]
  topicOrderForProject: string[]
  pinnedTopics: Set<string>
  loadingProject: string | null
  onProjectClick: () => void
  onTogglePinProject: () => void
  onOpenAddTopic: () => void
  onRenameProject: () => void
  onArchiveProject: () => void
  onTopicSelect: (topic: FullTopic) => void
  onPinTopic: (topicId: string) => void
  onRenameTopic: (topic: FullTopic) => void
  onArchiveTopic: (topic: FullTopic) => void
  onTopicReorder: (newOrder: string[]) => void
}) {
  const controls = useDragControls()
  const longPress = useLongPressDrag(controls)
  const [menuOpen, setMenuOpen] = useState(false)
  const project = projects.find((p) => p.id === projectId)
  if (!project) return null

  const isLoading = loadingProject === projectId

  return (
    <Reorder.Item
      value={projectId}
      dragListener={false}
      dragControls={controls}
      as="div"
      layout="position"
      transition={{ layout: { duration: 0.12, ease: "easeOut" } }}
      className="flex flex-col"
      style={{ position: "relative" }}
      animate={{ opacity: 1 }}
      whileDrag={{ scale: 1.01 }}
      {...longPress}
    >
      {/* Project row */}
      <div className="group/row group/project relative flex items-center">
        <button
          onClick={onProjectClick}
          className={cn(
            "flex flex-1 min-w-0 cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left",
            "transition-all duration-150 text-foreground/90 hover:bg-foreground/4 hover:text-foreground",
          )}
        >
          {isPinned && (
            <span
              onClick={(e) => { e.stopPropagation(); onTogglePinProject() }}
              title="Unpin"
              className="flex shrink-0 cursor-pointer items-center justify-center"
            >
              <Icons.Pin size={13} strokeWidth={2} className="text-foreground/70" />
            </span>
          )}
          <span className="flex h-4 w-4 shrink-0 items-center justify-center">
            <Icons.Files
              size={14}
              strokeWidth={1.5}
              className="transition-colors text-foreground/90 group-hover/project:text-foreground"
            />
          </span>
          <span className="flex-1 truncate text-[13px] font-normal leading-tight">
            {project.name}
          </span>
        </button>

        {/* Project 3-dot — always visible when expanded/active */}
        <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          <PopoverTrigger asChild>
            <button
              onClick={(e) => e.stopPropagation()}
              title="Project options"
              className={cn(
                "absolute right-1 flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded",
                "transition-colors",
                isExpanded || hasActiveTopic
                  ? "opacity-100 text-muted-foreground/60 hover:text-foreground"
                  : "opacity-0 group-hover/row:opacity-100 text-muted-foreground/50 hover:text-foreground",
              )}
            >
              <Icons.MoreVertical size={15} strokeWidth={1.5} />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" side="right" sideOffset={4} className={cn("w-40 p-1 gap-0", GLASS_POPOVER)}>
            <MenuAction label="Add Topic" icon={<Icons.Plus size={14} strokeWidth={1.5} />} onClick={() => { setMenuOpen(false); onOpenAddTopic() }} />
            <MenuAction label="Rename" icon={<Icons.Edit size={14} strokeWidth={1.5} />} onClick={() => { setMenuOpen(false); onRenameProject() }} />
            <MenuAction
              label={isPinned ? "Unpin" : "Pin"}
              icon={<Icons.Pin size={14} strokeWidth={1.5} />}
              onClick={() => { setMenuOpen(false); onTogglePinProject() }}
            />
            <div className="my-0.5 h-px bg-border/20" />
            <MenuAction label="Archive" icon={<Icons.Minus size={14} strokeWidth={1.5} />} onClick={() => { setMenuOpen(false); onArchiveProject() }} danger />
          </PopoverContent>
        </Popover>
      </div>

      {/* Expanded topics — CSS grid trick: no JS measurement, zero layout shift */}
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-200",
          isExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
        style={{ transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)" }}
      >
        <div
          className={cn(
            "overflow-hidden transition-opacity duration-150",
            isExpanded ? "opacity-100" : "opacity-0",
          )}
        >
          <div className="mb-0.5 ml-3 border-l border-border/20 pl-2 pt-0.5">
            {isLoading && (
              <div className="flex items-center gap-2 px-1.5 py-1.5">
                <span className="h-1 w-1 animate-pulse rounded-full bg-muted-foreground/40" />
                <span className="animate-pulse text-[11px] text-muted-foreground/40">Loading…</span>
              </div>
            )}

            {!isLoading && topics.length === 0 && (
              <p className="px-2 py-1 text-[11px] italic text-muted-foreground/35">No topics yet</p>
            )}

            {!isLoading && topicOrderForProject.length > 0 && (
              <Reorder.Group
                axis="y"
                values={topicOrderForProject}
                onReorder={onTopicReorder}
                as="div"
                className="flex flex-col gap-px"
              >
                {topicOrderForProject.map((topicId) => (
                  <SortableTopicRow
                    key={topicId}
                    topicId={topicId}
                    topics={topics}
                    isActive={activeTopic?.id === topicId}
                    isPinned={pinnedTopics.has(topicId)}
                    onClick={() => {
                      const t = topics.find((x) => x.id === topicId)
                      if (t) onTopicSelect(t)
                    }}
                    onPin={() => onPinTopic(topicId)}
                    onRename={() => {
                      const t = topics.find((x) => x.id === topicId)
                      if (t) onRenameTopic(t)
                    }}
                    onArchive={() => {
                      const t = topics.find((x) => x.id === topicId)
                      if (t) onArchiveTopic(t)
                    }}
                  />
                ))}
              </Reorder.Group>
            )}
          </div>
        </div>
      </div>
    </Reorder.Item>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────
export function ProjectsSection({ collapsed, activeTopic, onTopicSelect }: Props) {
  const [projects, setProjects] = useState<Project[]>([])
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set())
  const [projectTopics, setProjectTopics] = useState<Record<string, FullTopic[]>>({})
  const [loadingProject, setLoadingProject] = useState<string | null>(null)

  // Ordered IDs for DnD + smooth animations
  const [projectOrder, setProjectOrder] = useState<string[]>([])
  const [topicOrder, setTopicOrder] = useState<Record<string, string[]>>({})

  // Pin state (local — DB has no pinned column)
  const [pinnedProjects, setPinnedProjects] = useState<Set<string>>(new Set())
  const [pinnedTopics, setPinnedTopics] = useState<Set<string>>(new Set())

  // Dialogs
  const [createProjectOpen, setCreateProjectOpen] = useState(false)
  const [newProjectName, setNewProjectName] = useState("")
  const [newProjectPath, setNewProjectPath] = useState("")
  const [creatingProject, setCreatingProject] = useState(false)
  const [projectError, setProjectError] = useState("")
  const projectNameRef = useRef<HTMLInputElement>(null)

  const [createTopicOpen, setCreateTopicOpen] = useState(false)
  const [createTopicForProject, setCreateTopicForProject] = useState<Project | null>(null)
  const [newTopicName, setNewTopicName] = useState("")
  const [creatingTopic, setCreatingTopic] = useState(false)
  const [topicError, setTopicError] = useState("")
  const topicNameRef = useRef<HTMLInputElement>(null)

  const [renameProjectOpen, setRenameProjectOpen] = useState(false)
  const [renameProjectTarget, setRenameProjectTarget] = useState<Project | null>(null)
  const [renameProjectName, setRenameProjectName] = useState("")
  const renameProjectRef = useRef<HTMLInputElement>(null)

  const [renameTopicOpen, setRenameTopicOpen] = useState(false)
  const [renameTopicTarget, setRenameTopicTarget] = useState<FullTopic | null>(null)
  const [renameTopicName, setRenameTopicName] = useState("")
  const renameTopicRef = useRef<HTMLInputElement>(null)

  // Load projects
  const loadProjects = useCallback(async () => {
    try {
      const result = await invoke<{ projects: Project[] }>("middleware_projects_list")
      const active = (result.projects || []).filter((p) => !p.archived)
      setProjects(active)
    } catch (e) {
      console.error("[ProjectsSection] load projects failed", e)
    }
  }, [])

  useEffect(() => { loadProjects() }, [loadProjects])

  // Sync project order when projects change
  useEffect(() => {
    setProjectOrder((prev) => {
      const existing = prev.filter((id) => projects.some((p) => p.id === id))
      const newOnes = projects.filter((p) => !prev.includes(p.id)).map((p) => p.id)
      return [...existing, ...newOnes]
    })
  }, [projects])

  // Auto-focus dialogs
  useEffect(() => { if (createProjectOpen) setTimeout(() => projectNameRef.current?.focus(), 50) }, [createProjectOpen])
  useEffect(() => { if (createTopicOpen) setTimeout(() => topicNameRef.current?.focus(), 50) }, [createTopicOpen])
  useEffect(() => { if (renameProjectOpen) setTimeout(() => renameProjectRef.current?.focus(), 50) }, [renameProjectOpen])
  useEffect(() => { if (renameTopicOpen) setTimeout(() => renameTopicRef.current?.focus(), 50) }, [renameTopicOpen])

  const loadProjectTopics = useCallback(async (projectId: string, force = false) => {
    if (projectTopics[projectId] && !force) return
    setLoadingProject(projectId)
    try {
      const result = await invoke<{ topics: FullTopic[] }>("middleware_topics_list", { input: { projectId } })
      const active = (result.topics || []).filter((t) => !t.archived)
      setProjectTopics((prev) => ({ ...prev, [projectId]: active }))
      setTopicOrder((prev) => {
        const existing = (prev[projectId] || []).filter((id) => active.some((t) => t.id === id))
        const newOnes = active.filter((t) => !existing.includes(t.id)).map((t) => t.id)
        return { ...prev, [projectId]: [...existing, ...newOnes] }
      })
    } catch (e) {
      console.error("[ProjectsSection] load topics failed", e)
    } finally {
      setLoadingProject(null)
    }
  }, [projectTopics])

  const handleProjectClick = useCallback((project: Project) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev)
      if (next.has(project.id)) next.delete(project.id)
      else next.add(project.id)
      return next
    })
    if (!projectTopics[project.id]) loadProjectTopics(project.id)
  }, [projectTopics, loadProjectTopics])

  // Pin handlers — move to front on pin, stay in place on unpin
  const togglePinProject = useCallback((projectId: string) => {
    setPinnedProjects((prev) => {
      const next = new Set(prev)
      if (next.has(projectId)) {
        next.delete(projectId)
      } else {
        next.add(projectId)
        setProjectOrder((o) => [projectId, ...o.filter((id) => id !== projectId)])
      }
      return next
    })
  }, [])

  const togglePinTopic = useCallback((topicId: string, projectId: string) => {
    setPinnedTopics((prev) => {
      const next = new Set(prev)
      if (next.has(topicId)) {
        next.delete(topicId)
      } else {
        next.add(topicId)
        setTopicOrder((o) => ({
          ...o,
          [projectId]: [topicId, ...(o[projectId] || []).filter((id) => id !== topicId)],
        }))
      }
      return next
    })
  }, [])

  // Create / rename / archive
  const handleCreateProject = useCallback(async () => {
    if (!newProjectName.trim() || !newProjectPath.trim()) return
    setCreatingProject(true)
    setProjectError("")
    try {
      let profileId = "prof_local_main"
      try {
        const r = await invoke<{ profiles: Array<{ id: string }> }>("middleware_profiles_list")
        if (r?.profiles?.length > 0) profileId = r.profiles[0].id
      } catch {}

      const result = await invoke<{ project: { id: string; name: string } }>("middleware_projects_create", {
        input: { name: newProjectName.trim(), profileId, workspaceRoot: newProjectPath.trim(), repoRoot: newProjectPath.trim() },
      })
      const projectId = result.project.id
      const projectName = result.project.name

      const topicResult = await invoke<{ topic: { id: string; name: string } }>("middleware_topics_create", {
        input: { projectId, name: "General" },
      })

      setNewProjectName("")
      setNewProjectPath("")
      setCreateProjectOpen(false)
      await loadProjects()

      setExpandedProjects((prev) => new Set([...prev, projectId]))
      setProjectTopics((prev) => ({
        ...prev,
        [projectId]: [{
          id: topicResult.topic.id, name: topicResult.topic.name, projectId,
          archived: false, unreadCount: 0, sortOrder: 0,
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        }],
      }))
      setTopicOrder((prev) => ({ ...prev, [projectId]: [topicResult.topic.id] }))
      onTopicSelect({ id: topicResult.topic.id, name: topicResult.topic.name, projectId, projectName })
    } catch (e) {
      setProjectError(String(e))
    } finally {
      setCreatingProject(false)
    }
  }, [newProjectName, newProjectPath, loadProjects, onTopicSelect])

  const handleCreateTopic = useCallback(async () => {
    if (!newTopicName.trim() || !createTopicForProject) return
    setCreatingTopic(true)
    setTopicError("")
    try {
      const result = await invoke<{ topic: { id: string; name: string } }>("middleware_topics_create", {
        input: { projectId: createTopicForProject.id, name: newTopicName.trim() },
      })
      setNewTopicName("")
      setCreateTopicOpen(false)
      await loadProjectTopics(createTopicForProject.id, true)
      onTopicSelect({ id: result.topic.id, name: result.topic.name, projectId: createTopicForProject.id, projectName: createTopicForProject.name })
    } catch (e) {
      setTopicError(String(e))
    } finally {
      setCreatingTopic(false)
    }
  }, [newTopicName, createTopicForProject, loadProjectTopics, onTopicSelect])

  const handleRenameProject = useCallback(async () => {
    if (!renameProjectTarget || !renameProjectName.trim()) return
    try {
      await invoke("middleware_projects_update", { input: { projectId: renameProjectTarget.id, name: renameProjectName.trim() } })
      setRenameProjectOpen(false)
      await loadProjects()
    } catch (e) { console.error("rename project failed", e) }
  }, [renameProjectTarget, renameProjectName, loadProjects])

  const handleRenameTopicSave = useCallback(async () => {
    if (!renameTopicTarget || !renameTopicName.trim()) return
    try {
      await invoke("middleware_topics_update", { input: { topicId: renameTopicTarget.id, name: renameTopicName.trim() } })
      setRenameTopicOpen(false)
      await loadProjectTopics(renameTopicTarget.projectId, true)
    } catch (e) { console.error("rename topic failed", e) }
  }, [renameTopicTarget, renameTopicName, loadProjectTopics])

  const handleArchiveProject = useCallback(async (projectId: string) => {
    try {
      await invoke("middleware_projects_archive", { input: { projectId } })
      setExpandedProjects((prev) => { const next = new Set(prev); next.delete(projectId); return next })
      await loadProjects()
    } catch (e) { console.error("archive project failed", e) }
  }, [loadProjects])

  const handleArchiveTopic = useCallback(async (topic: FullTopic) => {
    try {
      await invoke("middleware_topics_archive", { input: { topicId: topic.id } })
      await loadProjectTopics(topic.projectId, true)
    } catch (e) { console.error("archive topic failed", e) }
  }, [loadProjectTopics])

  // Final sorted project IDs for rendering
  const sortedProjectIds = useMemo(() => {
    const pinned = projectOrder.filter((id) => pinnedProjects.has(id))
    const unpinned = projectOrder.filter((id) => !pinnedProjects.has(id))
    return [...pinned, ...unpinned].filter((id) => projects.some((p) => p.id === id))
  }, [projectOrder, pinnedProjects, projects])

  if (collapsed) {
    return (
      <div className="mt-3 flex justify-center border-t border-border/10 pt-2">
        <button
          title="Projects"
          onClick={() => setCreateProjectOpen(true)}
          className="cursor-pointer rounded-md py-2 text-muted-foreground transition-colors hover:text-foreground"
        >
          <Icons.Files size={16} strokeWidth={1.5} />
        </button>
      </div>
    )
  }

  return (
    <>
      <div className="mt-3 border-t border-border/10 pt-2">
        {/* Header */}
        <div className="mb-1.5 flex items-center justify-between px-2.5">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-foreground">Projects</span>
          <button
            onClick={() => { setNewProjectName(""); setNewProjectPath(""); setProjectError(""); setCreateProjectOpen(true) }}
            title="New project"
            className="flex h-5 w-5 cursor-pointer items-center justify-center rounded text-muted-foreground/50 transition-colors hover:text-foreground"
          >
            <Icons.Plus size={13} strokeWidth={2} />
          </button>
        </div>

        {/* Project list */}
        <div className="flex flex-col gap-0.5 px-1">
          {projects.length === 0 && (
            <button
              onClick={() => { setNewProjectName(""); setNewProjectPath(""); setProjectError(""); setCreateProjectOpen(true) }}
              className="flex w-full cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border/30 px-2.5 py-2 text-left text-[12px] text-muted-foreground/40 transition-colors hover:border-border/50 hover:text-muted-foreground"
            >
              <Icons.Plus size={12} strokeWidth={1.5} />
              <span>Create your first project</span>
            </button>
          )}

          <Reorder.Group
            axis="y"
            values={sortedProjectIds}
            onReorder={setProjectOrder}
            as="div"
            className="flex flex-col gap-0.5"
          >
            {sortedProjectIds.map((projectId) => {
              const project = projects.find((p) => p.id === projectId)
              if (!project) return null
              const isExpanded = expandedProjects.has(projectId)
              const hasActiveTopic = activeTopic?.projectId === projectId
              const topicList = projectTopics[projectId] || []
              const topicIds = topicOrder[projectId] || topicList.map((t) => t.id)

              return (
                <SortableProjectRow
                  key={projectId}
                  projectId={projectId}
                  projects={projects}
                  isExpanded={isExpanded}
                  hasActiveTopic={hasActiveTopic}
                  isPinned={pinnedProjects.has(projectId)}
                  activeTopic={activeTopic}
                  topics={topicList}
                  topicOrderForProject={topicIds}
                  pinnedTopics={pinnedTopics}
                  loadingProject={loadingProject}
                  onProjectClick={() => handleProjectClick(project)}
                  onTogglePinProject={() => togglePinProject(projectId)}
                  onOpenAddTopic={() => { setCreateTopicForProject(project); setNewTopicName(""); setTopicError(""); setCreateTopicOpen(true) }}
                  onRenameProject={() => { setRenameProjectTarget(project); setRenameProjectName(project.name); setRenameProjectOpen(true) }}
                  onArchiveProject={() => handleArchiveProject(projectId)}
                  onTopicSelect={(t) => onTopicSelect({ id: t.id, name: t.name, projectId, projectName: project.name })}
                  onPinTopic={(topicId) => togglePinTopic(topicId, projectId)}
                  onRenameTopic={(t) => { setRenameTopicTarget(t); setRenameTopicName(t.name); setRenameTopicOpen(true) }}
                  onArchiveTopic={handleArchiveTopic}
                  onTopicReorder={(newOrder) => setTopicOrder((prev) => ({ ...prev, [projectId]: newOrder }))}
                />
              )
            })}
          </Reorder.Group>
        </div>
      </div>

      {/* Create Project Dialog */}
      <GlassDialog open={createProjectOpen} onClose={() => setCreateProjectOpen(false)} title="New Project" description="Set up a workspace to organize your conversations.">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-medium text-muted-foreground">Project name</label>
            <input ref={projectNameRef} className="glass-input" placeholder="My Project" value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleCreateProject()} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-medium text-muted-foreground">Workspace path</label>
            <input className="glass-input" placeholder="/Users/you/projects/my-project" value={newProjectPath} onChange={(e) => setNewProjectPath(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleCreateProject()} />
            <p className="text-[11px] text-muted-foreground/50">A "General" topic will be created automatically.</p>
          </div>
          {projectError && <p className="rounded-lg border border-red-400/20 bg-red-400/8 px-3 py-2 text-[12px] text-red-400">{projectError}</p>}
          <div className="mt-1 flex gap-2.5">
            <button onClick={handleCreateProject} disabled={creatingProject || !newProjectName.trim() || !newProjectPath.trim()} className="glass-btn-primary flex-1">{creatingProject ? "Creating…" : "Create Project"}</button>
            <button onClick={() => setCreateProjectOpen(false)} className="glass-btn-secondary">Cancel</button>
          </div>
        </div>
      </GlassDialog>

      {/* Create Topic Dialog */}
      <GlassDialog open={createTopicOpen} onClose={() => setCreateTopicOpen(false)} title="New Topic" description={createTopicForProject ? `Add a topic to "${createTopicForProject.name}"` : undefined}>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-medium text-muted-foreground">Topic name</label>
            <input ref={topicNameRef} className="glass-input" placeholder="e.g. Deploy flow, Bug fixes…" value={newTopicName} onChange={(e) => setNewTopicName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleCreateTopic()} />
          </div>
          {topicError && <p className="rounded-lg border border-red-400/20 bg-red-400/8 px-3 py-2 text-[12px] text-red-400">{topicError}</p>}
          <div className="mt-1 flex gap-2.5">
            <button onClick={handleCreateTopic} disabled={creatingTopic || !newTopicName.trim()} className="glass-btn-primary flex-1">{creatingTopic ? "Creating…" : "Create Topic"}</button>
            <button onClick={() => setCreateTopicOpen(false)} className="glass-btn-secondary">Cancel</button>
          </div>
        </div>
      </GlassDialog>

      {/* Rename Project Dialog */}
      <GlassDialog open={renameProjectOpen} onClose={() => setRenameProjectOpen(false)} title="Rename Project">
        <div className="flex flex-col gap-3">
          <input ref={renameProjectRef} className="glass-input" value={renameProjectName} onChange={(e) => setRenameProjectName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleRenameProject()} />
          <div className="flex gap-2.5">
            <button onClick={handleRenameProject} disabled={!renameProjectName.trim()} className="glass-btn-primary flex-1">Save</button>
            <button onClick={() => setRenameProjectOpen(false)} className="glass-btn-secondary">Cancel</button>
          </div>
        </div>
      </GlassDialog>

      {/* Rename Topic Dialog */}
      <GlassDialog open={renameTopicOpen} onClose={() => setRenameTopicOpen(false)} title="Rename Topic">
        <div className="flex flex-col gap-3">
          <input ref={renameTopicRef} className="glass-input" value={renameTopicName} onChange={(e) => setRenameTopicName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleRenameTopicSave()} />
          <div className="flex gap-2.5">
            <button onClick={handleRenameTopicSave} disabled={!renameTopicName.trim()} className="glass-btn-primary flex-1">Save</button>
            <button onClick={() => setRenameTopicOpen(false)} className="glass-btn-secondary">Cancel</button>
          </div>
        </div>
      </GlassDialog>
    </>
  )
}
