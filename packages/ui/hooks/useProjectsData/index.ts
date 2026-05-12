"use client"

import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { invoke } from "@/lib/ipc"
import { on, emit } from "@/lib/events"
import { checkGatewayOrRedirect } from "@/lib/toast"
import { MIDDLEWARE_CONNECTION_CHANGED_EVENT } from "@/lib/middleware-client"
import { invalidateMiddlewareStartupBootstrap, loadMiddlewareStartupBootstrap } from "@/lib/startupBootstrap"
import { loadSidebarOrder, saveSidebarOrder } from "@/lib/sidebarOrderCache"
import type { Project, FullTopic, ActiveTopic } from "@/types/project"

export type { Project, FullTopic, ActiveTopic }

export type DialogState = {
  createProjectOpen: boolean
  newProjectName: string
  creatingProject: boolean
  projectError: string
  projectNameRef: React.RefObject<HTMLInputElement | null>

  createTopicOpen: boolean
  createTopicForProject: Project | null
  newTopicName: string
  creatingTopic: boolean
  topicError: string
  topicNameRef: React.RefObject<HTMLInputElement | null>

  renameProjectOpen: boolean
  renameProjectTarget: Project | null
  renameProjectName: string
  renameProjectRef: React.RefObject<HTMLInputElement | null>

  renameTopicOpen: boolean
  renameTopicTarget: FullTopic | null
  renameTopicName: string
  renameTopicRef: React.RefObject<HTMLInputElement | null>

  deleteProjectOpen: boolean
  deleteProjectTarget: Project | null
  deletingProject: boolean

  deleteTopicOpen: boolean
  deleteTopicTarget: FullTopic | null
  deletingTopic: boolean
}

export type DialogActions = {
  setCreateProjectOpen: (v: boolean) => void
  setNewProjectName: (v: string) => void
  openCreateProject: () => void
  handleCreateProject: () => Promise<void>

  setCreateTopicOpen: (v: boolean) => void
  setNewTopicName: (v: string) => void
  openCreateTopic: (project: Project) => void
  handleCreateTopic: () => Promise<void>

  setRenameProjectOpen: (v: boolean) => void
  setRenameProjectName: (v: string) => void
  openRenameProject: (project: Project) => void
  handleRenameProject: () => Promise<void>

  setRenameTopicOpen: (v: boolean) => void
  setRenameTopicName: (v: string) => void
  openRenameTopic: (topic: FullTopic) => void
  handleRenameTopicSave: () => Promise<void>

  setDeleteProjectOpen: (v: boolean) => void
  openDeleteProject: (project: Project) => void
  handleDeleteProject: () => Promise<void>

  setDeleteTopicOpen: (v: boolean) => void
  openDeleteTopic: (topic: FullTopic) => void
  handleDeleteTopic: () => Promise<void>
}

type ForkCreateEvent = {
  status?: "pending" | "resolved" | "failed"
  requestId: string
  name?: string
  topicId?: string
  context?: {
    type?: string
    projectId?: string
  }
}

function sameStringArray(a: string[], b: string[]) {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function projectActivityTime(project: Project) {
  const withActivity = project as Project & {
    lastActivityAt?: string | null
    updatedAt?: string | null
    createdAt?: string | null
  }
  return new Date(withActivity.updatedAt || withActivity.lastActivityAt || withActivity.createdAt || 0).getTime() || 0
}

export function useProjectsData(
  onTopicSelect: (topic: ActiveTopic) => void,
  activeTopic: ActiveTopic | null,
  onTopicClear: () => void,
  activeSpaceId?: string | null,
) {
  const [projects, setProjects] = useState<Project[]>([])
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(
    new Set()
  )
  const [projectTopics, setProjectTopics] = useState<
    Record<string, FullTopic[]>
  >({})
  const [loadingProject, setLoadingProject] = useState<string | null>(null)
  const [projectOrder, setProjectOrder] = useState<string[]>([])
  const [projectOrderCacheReady, setProjectOrderCacheReady] = useState(false)
  const [topicOrder, setTopicOrder] = useState<Record<string, string[]>>({})
  const [pinnedProjects, setPinnedProjects] = useState<Set<string>>(new Set())
  const [pinnedTopics, setPinnedTopics] = useState<Set<string>>(new Set())

  const [createProjectOpen, setCreateProjectOpen] = useState(false)
  const [newProjectName, setNewProjectName] = useState("")
  const [creatingProject, setCreatingProject] = useState(false)
  const [projectError, setProjectError] = useState("")
  const projectNameRef = useRef<HTMLInputElement>(null)

  const [createTopicOpen, setCreateTopicOpen] = useState(false)
  const [createTopicForProject, setCreateTopicForProject] =
    useState<Project | null>(null)
  const [newTopicName, setNewTopicName] = useState("")
  const [creatingTopic, setCreatingTopic] = useState(false)
  const [topicError, setTopicError] = useState("")
  const topicNameRef = useRef<HTMLInputElement>(null)

  const [renameProjectOpen, setRenameProjectOpen] = useState(false)
  const [renameProjectTarget, setRenameProjectTarget] =
    useState<Project | null>(null)
  const [renameProjectName, setRenameProjectName] = useState("")
  const renameProjectRef = useRef<HTMLInputElement>(null)

  const [renameTopicOpen, setRenameTopicOpen] = useState(false)
  const [renameTopicTarget, setRenameTopicTarget] = useState<FullTopic | null>(
    null
  )
  const [renameTopicName, setRenameTopicName] = useState("")
  const renameTopicRef = useRef<HTMLInputElement>(null)

  const [deleteProjectOpen, setDeleteProjectOpen] = useState(false)
  const [deleteProjectTarget, setDeleteProjectTarget] =
    useState<Project | null>(null)
  const [deletingProject, setDeletingProject] = useState(false)

  const [deleteTopicOpen, setDeleteTopicOpen] = useState(false)
  const [deleteTopicTarget, setDeleteTopicTarget] = useState<FullTopic | null>(
    null
  )
  const [deletingTopic, setDeletingTopic] = useState(false)


  const loadProjects = useCallback(async () => {
    try {
      const gwActive =
        localStorage.getItem("jarvis.gatewayActive") === "true"
      if (!gwActive) {
        setProjects([])
        return
      }
    } catch {}
    try {
      const bootstrap = await loadMiddlewareStartupBootstrap()
      if (bootstrap?.projects && (!activeSpaceId || bootstrap.activeSpaceId === activeSpaceId)) {
        const active = bootstrap.projects.filter(
          (p) => !p.archived && !(p.name === "Default" && p.profileId === "default"),
        )
        setProjects(active)
        setPinnedProjects(new Set(active.filter((p) => p.pinned).map((p) => p.id)))
        return
      }
      const result = await invoke<{ projects: Project[] }>(
        "middleware_projects_list",
        { input: { spaceId: activeSpaceId ?? undefined } },
      )
      const active = (result.projects || []).filter(
        (p) => !p.archived && !(p.name === "Default" && p.profileId === "default"),
      )
      setProjects(active)
      setPinnedProjects(new Set(active.filter((p) => p.pinned).map((p) => p.id)))
    } catch (e) {
      console.error("[ProjectsSection] load projects failed", e)
    }
  }, [activeSpaceId])

  useEffect(() => {
    let cancelled = false
    setProjectOrderCacheReady(false)
    loadSidebarOrder("projects", activeSpaceId).then((order) => {
      if (cancelled) return
      if (order?.length) setProjectOrder(order)
      setProjectOrderCacheReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [activeSpaceId])

  useEffect(() => {
    if (!projectOrderCacheReady || projectOrder.length === 0) return
    void saveSidebarOrder("projects", activeSpaceId, projectOrder)
  }, [projectOrder, projectOrderCacheReady, activeSpaceId])

  useEffect(() => {
    loadProjects()
  }, [loadProjects])

  const refreshTopicsRef = useRef<() => void>(() => {})

  useEffect(() => {
    setProjectOrder((prev) => {
      const projectIds = new Set(projects.map((project) => project.id))
      const persisted = prev.filter((id) => projectIds.has(id))
      const byActivity = [...projects]
        .sort((a, b) => projectActivityTime(b) - projectActivityTime(a))
        .map((project) => project.id)
      const hasNewOrRemovedProjects = persisted.length !== projects.length
      const next = hasNewOrRemovedProjects
        ? [
            ...byActivity.filter((id) => !persisted.includes(id)),
            ...persisted,
          ]
        : byActivity

      return sameStringArray(prev, next) ? prev : next
    })
  }, [projects])

  useEffect(() => {
    if (createProjectOpen) setTimeout(() => projectNameRef.current?.focus(), 50)
  }, [createProjectOpen])
  useEffect(() => {
    if (createTopicOpen) setTimeout(() => topicNameRef.current?.focus(), 50)
  }, [createTopicOpen])
  useEffect(() => {
    if (renameProjectOpen)
      setTimeout(() => renameProjectRef.current?.focus(), 50)
  }, [renameProjectOpen])
  useEffect(() => {
    if (renameTopicOpen) setTimeout(() => renameTopicRef.current?.focus(), 50)
  }, [renameTopicOpen])

  const loadProjectTopics = useCallback(
    async (projectId: string, force = false) => {
      if (projectTopics[projectId] && !force) return
      setLoadingProject(projectId)
      try {
        const result = await invoke<{ topics: FullTopic[] }>(
          "middleware_topics_list",
          { input: { projectId } }
        )
        const active = (result.topics || []).filter((t) => !t.archived)
        setProjectTopics((prev) => ({ ...prev, [projectId]: active }))
        setPinnedTopics((prev) => {
          const next = new Set(prev)
          for (const topic of active) {
            if (topic.pinned) next.add(topic.id)
            else next.delete(topic.id)
          }
          return next
        })
        setTopicOrder((prev) => {
          const existing = (prev[projectId] || []).filter((id) =>
            active.some((t) => t.id === id)
          )
          const newOnes = active
            .filter((t) => !existing.includes(t.id))
            .map((t) => t.id)
          return { ...prev, [projectId]: [...existing, ...newOnes] }
        })
      } catch (e) {
        console.error("[ProjectsSection] load topics failed", e)
      } finally {
        setLoadingProject(null)
      }
    },
    [projectTopics]
  )

  useEffect(() => on("sidebar:refresh", () => {
    loadProjects()
    for (const id of Object.keys(projectTopics)) loadProjectTopics(id, true)
  }), [loadProjects, loadProjectTopics, projectTopics])

  useEffect(() => {
    function clearMiddlewareScopedProjects() {
      setProjects([])
      setProjectTopics({})
      setProjectOrder([])
      setTopicOrder({})
      setPinnedProjects(new Set())
      setPinnedTopics(new Set())
      setExpandedProjects(new Set())
      setLoadingProject(null)
      void loadProjects()
    }
    window.addEventListener(MIDDLEWARE_CONNECTION_CHANGED_EVENT, clearMiddlewareScopedProjects)
    return () => window.removeEventListener(MIDDLEWARE_CONNECTION_CHANGED_EVENT, clearMiddlewareScopedProjects)
  }, [loadProjects])

  useEffect(() => {
    return on<ForkCreateEvent>("fork:create", (event) => {
      const context = event?.context
      if (!event || context?.type !== "topic" || !context.projectId) return
      const projectId = context.projectId
      if (event.status === "pending") {
        const now = new Date().toISOString()
        const placeholder: FullTopic = {
          id: event.requestId,
          name: event.name || "Creating fork…",
          projectId,
          archived: false,
          pinned: false,
          unreadCount: 0,
          sortOrder: Date.now(),
          createdAt: now,
          updatedAt: now,
          pendingFork: true,
        }
        setExpandedProjects((prev) => new Set([...prev, projectId]))
        setProjectTopics((prev) => ({
          ...prev,
          [projectId]: [placeholder, ...(prev[projectId] || []).filter((topic) => topic.id !== event.requestId)],
        }))
        setTopicOrder((prev) => ({
          ...prev,
          [projectId]: [event.requestId, ...(prev[projectId] || []).filter((id) => id !== event.requestId)],
        }))
        return
      }
      if (event.status === "resolved") {
        setProjectTopics((prev) => ({
          ...prev,
          [projectId]: (prev[projectId] || []).map((topic) => topic.id === event.requestId
            ? { ...topic, id: event.topicId ?? topic.id, name: event.name ?? topic.name, pendingFork: false, updatedAt: new Date().toISOString() }
            : topic,
          ),
        }))
        setTopicOrder((prev) => ({
          ...prev,
          [projectId]: (prev[projectId] || []).map((id) => id === event.requestId ? event.topicId ?? id : id),
        }))
        return
      }
      if (event.status === "failed") {
        setProjectTopics((prev) => ({
          ...prev,
          [projectId]: (prev[projectId] || []).filter((topic) => topic.id !== event.requestId),
        }))
        setTopicOrder((prev) => ({
          ...prev,
          [projectId]: (prev[projectId] || []).filter((id) => id !== event.requestId),
        }))
      }
    })
  }, [])

  useEffect(() => {
    function onArchiveRestored() {
      loadProjects()
      for (const id of Object.keys(projectTopics)) {
        loadProjectTopics(id, true)
      }
    }
    window.addEventListener("archive-restored", onArchiveRestored)
    return () =>
      window.removeEventListener("archive-restored", onArchiveRestored)
  }, [loadProjects, loadProjectTopics, projectTopics])

  useEffect(() => {
    return on("chat:activity", () => {
      if (!activeTopic) return
      setProjectOrder((prev) => [
        activeTopic.projectId,
        ...prev.filter((id) => id !== activeTopic.projectId),
      ])
      setTopicOrder((prev) => ({
        ...prev,
        [activeTopic.projectId]: [
          activeTopic.id,
          ...(prev[activeTopic.projectId] || []).filter(
            (id) => id !== activeTopic.id,
          ),
        ],
      }))
      setProjectTopics((prev) => {
        const topics = prev[activeTopic.projectId]
        if (!topics) return prev
        return {
          ...prev,
          [activeTopic.projectId]: topics.map((topic) =>
            topic.id === activeTopic.id
              ? { ...topic, updatedAt: new Date().toISOString() }
              : topic,
          ),
        }
      })
    })
  }, [activeTopic])

  const handleProjectClick = useCallback(
    (project: Project) => {
      setExpandedProjects((prev) => {
        const next = new Set(prev)
        if (next.has(project.id)) next.delete(project.id)
        else next.add(project.id)
        return next
      })
      if (!projectTopics[project.id]) loadProjectTopics(project.id)
    },
    [projectTopics, loadProjectTopics]
  )

  const togglePinProject = useCallback((projectId: string) => {
    setPinnedProjects((prev) => {
      const next = new Set(prev)
      const pinned = !next.has(projectId)
      if (pinned) {
        next.add(projectId)
        setProjectOrder((o) => [projectId, ...o.filter((id) => id !== projectId)])
      } else {
        next.delete(projectId)
      }
      invalidateMiddlewareStartupBootstrap()
      invoke("middleware_projects_update", { input: { projectId, pinned } })
        .catch((error) => console.error("pin project failed", error))
      return next
    })
  }, [])

  const togglePinTopic = useCallback((topicId: string, projectId: string) => {
    setPinnedTopics((prev) => {
      const next = new Set(prev)
      const pinned = !next.has(topicId)
      if (pinned) {
        next.add(topicId)
        setTopicOrder((o) => ({
          ...o,
          [projectId]: [topicId, ...(o[projectId] || []).filter((id) => id !== topicId)],
        }))
      } else {
        next.delete(topicId)
      }
      invalidateMiddlewareStartupBootstrap()
      invoke("middleware_topics_update", { input: { topicId, pinned } })
        .catch((error) => console.error("pin topic failed", error))
      return next
    })
  }, [])

  const openCreateProject = useCallback(() => {
    setNewProjectName("")
    setProjectError("")
    setCreateProjectOpen(true)
  }, [])

  const handleCreateProject = useCallback(async () => {
    if (!newProjectName.trim()) return
    if (!(await checkGatewayOrRedirect())) return
    setCreatingProject(true)
    setProjectError("")
    try {
      let profileId = "prof_local_main"
      let workspaceRoot = "~"
      try {
        const r = await invoke<{ profiles: Array<{ id: string; workspaceRoot?: string }> }>(
          "middleware_profiles_list"
        )
        if (r?.profiles?.length > 0) {
          profileId = r.profiles[0].id
          workspaceRoot = r.profiles[0].workspaceRoot || workspaceRoot
        }
      } catch {}

      invalidateMiddlewareStartupBootstrap()
      const result = await invoke<{ project: { id: string; name: string } }>(
        "middleware_projects_create",
        {
          input: {
            name: newProjectName.trim(),
            profileId,
            workspaceRoot,
            repoRoot: null,
            spaceId: activeSpaceId ?? undefined,
          },
        }
      )
      const projectId = result.project.id
      const projectName = result.project.name

      invalidateMiddlewareStartupBootstrap()
      const topicResult = await invoke<{ topic: { id: string; name: string } }>(
        "middleware_topics_create",
        {
          input: { projectId, name: "General" },
        }
      )

      setNewProjectName("")
      setCreateProjectOpen(false)
      await loadProjects()

      setExpandedProjects((prev) => new Set([...prev, projectId]))
      setProjectTopics((prev) => ({
        ...prev,
        [projectId]: [
          {
            id: topicResult.topic.id,
            name: topicResult.topic.name,
            projectId,
            archived: false,
            unreadCount: 0,
            sortOrder: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      }))
      setTopicOrder((prev) => ({
        ...prev,
        [projectId]: [topicResult.topic.id],
      }))
      onTopicSelect({
        id: topicResult.topic.id,
        name: topicResult.topic.name,
        projectId,
        projectName,
      })
    } catch (e) {
      setProjectError(String(e))
    } finally {
      setCreatingProject(false)
    }
  }, [activeSpaceId, newProjectName, loadProjects, onTopicSelect])

  const openCreateTopic = useCallback((project: Project) => {
    setCreateTopicForProject(project)
    setNewTopicName("")
    setTopicError("")
    setCreateTopicOpen(true)
  }, [])

  const handleCreateTopic = useCallback(async () => {
    if (!newTopicName.trim() || !createTopicForProject) return
    if (!(await checkGatewayOrRedirect())) return
    setCreatingTopic(true)
    setTopicError("")
    try {
      invalidateMiddlewareStartupBootstrap()
      const result = await invoke<{ topic: { id: string; name: string } }>(
        "middleware_topics_create",
        {
          input: {
            projectId: createTopicForProject.id,
            name: newTopicName.trim(),
          },
        }
      )
      setNewTopicName("")
      setCreateTopicOpen(false)
      await loadProjectTopics(createTopicForProject.id, true)
      onTopicSelect({
        id: result.topic.id,
        name: result.topic.name,
        projectId: createTopicForProject.id,
        projectName: createTopicForProject.name,
      })
    } catch (e) {
      setTopicError(String(e))
    } finally {
      setCreatingTopic(false)
    }
  }, [newTopicName, createTopicForProject, loadProjectTopics, onTopicSelect])

  const openRenameProject = useCallback((project: Project) => {
    setRenameProjectTarget(project)
    setRenameProjectName(project.name)
    setRenameProjectOpen(true)
  }, [])

  const handleRenameProject = useCallback(async () => {
    if (!renameProjectTarget || !renameProjectName.trim()) return
    try {
      invalidateMiddlewareStartupBootstrap()
      await invoke("middleware_projects_update", {
        input: {
          projectId: renameProjectTarget.id,
          name: renameProjectName.trim(),
        },
      })
      setRenameProjectOpen(false)
      await loadProjects()
    } catch (e) {
      console.error("rename project failed", e)
    }
  }, [renameProjectTarget, renameProjectName, loadProjects])

  const openRenameTopic = useCallback((topic: FullTopic) => {
    setRenameTopicTarget(topic)
    setRenameTopicName(topic.name)
    setRenameTopicOpen(true)
  }, [])

  const handleRenameTopicSave = useCallback(async () => {
    if (!renameTopicTarget || !renameTopicName.trim()) return
    try {
      invalidateMiddlewareStartupBootstrap()
      await invoke("middleware_topics_update", {
        input: { topicId: renameTopicTarget.id, name: renameTopicName.trim() },
      })
      setRenameTopicOpen(false)
      await loadProjectTopics(renameTopicTarget.projectId, true)
    } catch (e) {
      console.error("rename topic failed", e)
    }
  }, [renameTopicTarget, renameTopicName, loadProjectTopics])

  const openDeleteProject = useCallback((project: Project) => {
    setDeleteProjectTarget(project)
    setDeleteProjectOpen(true)
  }, [])

  const handleDeleteProject = useCallback(async () => {
    if (!deleteProjectTarget) return
    setDeletingProject(true)
    try {
      invalidateMiddlewareStartupBootstrap()
      await invoke("middleware_projects_delete", {
        input: { projectId: deleteProjectTarget.id },
      })
      setDeleteProjectOpen(false)
      setExpandedProjects((prev) => {
        const next = new Set(prev)
        next.delete(deleteProjectTarget.id)
        return next
      })
      if (activeTopic?.projectId === deleteProjectTarget.id) onTopicClear()
      await loadProjects()
    } catch (e) {
      console.error("delete project failed", e)
    } finally {
      setDeletingProject(false)
    }
  }, [deleteProjectTarget, loadProjects, activeTopic, onTopicClear])

  const openDeleteTopic = useCallback((topic: FullTopic) => {
    setDeleteTopicTarget(topic)
    setDeleteTopicOpen(true)
  }, [])

  const handleDeleteTopic = useCallback(async () => {
    if (!deleteTopicTarget) return
    setDeletingTopic(true)
    try {
      invalidateMiddlewareStartupBootstrap()
      await invoke("middleware_topics_delete", {
        input: { topicId: deleteTopicTarget.id },
      })
      setDeleteTopicOpen(false)
      if (activeTopic?.id === deleteTopicTarget.id) onTopicClear()
      await loadProjectTopics(deleteTopicTarget.projectId, true)
    } catch (e) {
      console.error("delete topic failed", e)
    } finally {
      setDeletingTopic(false)
    }
  }, [deleteTopicTarget, loadProjectTopics, activeTopic, onTopicClear])

  const handleArchiveProject = useCallback(
    async (projectId: string) => {
      try {
        invalidateMiddlewareStartupBootstrap()
        await invoke("middleware_projects_archive", { input: { projectId } })
        setExpandedProjects((prev) => {
          const next = new Set(prev)
          next.delete(projectId)
          return next
        })
        await loadProjects()
        emit("archive:changed")
      } catch (e) {
        console.error("archive project failed", e)
      }
    },
    [loadProjects]
  )

  const handleArchiveTopic = useCallback(
    async (topic: FullTopic) => {
      try {
        invalidateMiddlewareStartupBootstrap()
        await invoke("middleware_topics_archive", {
          input: { topicId: topic.id },
        })
        await loadProjectTopics(topic.projectId, true)
        emit("archive:changed")
      } catch (e) {
        console.error("archive topic failed", e)
      }
    },
    [loadProjectTopics]
  )

  const sortedProjectIds = useMemo(() => {
    const pinned = projectOrder.filter((id) => pinnedProjects.has(id))
    const unpinned = projectOrder.filter((id) => !pinnedProjects.has(id))
    return [...pinned, ...unpinned].filter((id) =>
      projects.some((p) => p.id === id)
    )
  }, [projectOrder, pinnedProjects, projects])

  const dialogState: DialogState = {
    createProjectOpen,
    newProjectName,
    creatingProject,
    projectError,
    projectNameRef,
    createTopicOpen,
    createTopicForProject,
    newTopicName,
    creatingTopic,
    topicError,
    topicNameRef,
    renameProjectOpen,
    renameProjectTarget,
    renameProjectName,
    renameProjectRef,
    renameTopicOpen,
    renameTopicTarget,
    renameTopicName,
    renameTopicRef,
    deleteProjectOpen,
    deleteProjectTarget,
    deletingProject,
    deleteTopicOpen,
    deleteTopicTarget,
    deletingTopic,
  }

  const dialogActions: DialogActions = {
    setCreateProjectOpen,
    setNewProjectName,
    openCreateProject,
    handleCreateProject,
    setCreateTopicOpen,
    setNewTopicName,
    openCreateTopic,
    handleCreateTopic,
    setRenameProjectOpen,
    setRenameProjectName,
    openRenameProject,
    handleRenameProject,
    setRenameTopicOpen,
    setRenameTopicName,
    openRenameTopic,
    handleRenameTopicSave,
    setDeleteProjectOpen,
    openDeleteProject,
    handleDeleteProject,
    setDeleteTopicOpen,
    openDeleteTopic,
    handleDeleteTopic,
  }

  return {
    projects,
    expandedProjects,
    projectTopics,
    loadingProject,
    projectOrder,
    setProjectOrder,
    topicOrder,
    setTopicOrder,
    pinnedProjects,
    pinnedTopics,
    sortedProjectIds,
    handleProjectClick,
    togglePinProject,
    togglePinTopic,
    handleArchiveProject,
    handleArchiveTopic,
    handleDeleteTopic,
    dialogState,
    dialogActions,
  }
}
