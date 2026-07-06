"use client"

import { useEffect, useState } from "react"
import { motion, AnimatePresence, Reorder } from "framer-motion"
import { Icons } from "@/components/icons"
import { useProjectsData } from "@/hooks/useProjectsData"
import { SortableProjectRow } from "./SortableProjectRow"
import { SortableTopicRow } from "./SortableTopicRow"
import { ProjectDialogs } from "./ProjectDialogs"
import type { ActiveTopic } from "@/types/project"

export type { ActiveTopic }

type Props = {
  collapsed: boolean
  collapsible?: boolean
  activeTopic: ActiveTopic | null
  onTopicSelect: (topic: ActiveTopic) => void
  onTopicClear: () => void
  spaceId?: string | null
  autoExpandSingleProject?: boolean
  flattenSingleProject?: boolean
  flatSectionLabel?: string
}

const PROJECT_INITIAL_LIMIT = 5

export function ProjectsSection({
  collapsed,
  collapsible = true,
  activeTopic,
  onTopicSelect,
  onTopicClear,
  spaceId,
  autoExpandSingleProject = false,
  flattenSingleProject = false,
  flatSectionLabel,
}: Props) {
  const [isOpen, setIsOpen] = useState(true)
  const [showAllProjects, setShowAllProjects] = useState(false)
  const showList = !collapsible || isOpen
  const {
    projects, expandedProjects, projectTopics, loadingProject,
    setProjectOrder, topicOrder, setTopicOrder,
    pinnedProjects, pinnedTopics, sortedProjectIds,
    handleProjectClick, togglePinProject, togglePinTopic,
    handleArchiveProject, handleArchiveTopic, handleDeleteTopic,
    dialogState, dialogActions,
  } = useProjectsData(onTopicSelect, activeTopic, onTopicClear, spaceId)

  useEffect(() => {
    if ((!autoExpandSingleProject && !flattenSingleProject) || projects.length !== 1) return
    const [project] = projects
    if (expandedProjects.has(project.id)) return
    handleProjectClick(project)
  }, [autoExpandSingleProject, expandedProjects, flattenSingleProject, handleProjectClick, projects])

  const flatProject = flattenSingleProject && projects.length > 0 ? projects[0] : null
  const flatTopics = flatProject ? projectTopics[flatProject.id] || [] : []
  const flatTopicIds = flatProject ? topicOrder[flatProject.id] || flatTopics.map((topic) => topic.id) : []

  if (flattenSingleProject) {
    return (
      <>
        <div>
          <div className="mb-1.5 flex items-center justify-between px-2.5">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-foreground">
              {flatSectionLabel || flatProject?.name || "Sessions"}
            </span>
            <button
              onClick={() => flatProject && dialogActions.openCreateTopic(flatProject)}
              title="New session"
              disabled={!flatProject}
              className="flex h-5 w-5 cursor-pointer items-center justify-center rounded text-muted-foreground/50 transition-colors hover:text-foreground"
            >
              <Icons.Plus size={13} strokeWidth={2} />
            </button>
          </div>
          <div className="flex flex-col gap-0.5 px-1">
            {!flatProject && (
              <div className="flex items-center gap-2 px-2.5 py-2">
                <span className="h-1 w-1 animate-pulse rounded-full bg-muted-foreground/40" />
                <span className="animate-pulse text-[11px] text-muted-foreground/40">Loading…</span>
              </div>
            )}
            {flatProject && loadingProject === flatProject.id && flatTopics.length === 0 && (
              <div className="flex items-center gap-2 px-2.5 py-2">
                <span className="h-1 w-1 animate-pulse rounded-full bg-muted-foreground/40" />
                <span className="animate-pulse text-[11px] text-muted-foreground/40">Loading…</span>
              </div>
            )}
            {flatProject && loadingProject !== flatProject.id && flatTopics.length === 0 && (
              <button
                onClick={() => dialogActions.openCreateTopic(flatProject)}
                className="flex w-full cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border/30 px-2.5 py-2 text-left text-[12px] text-muted-foreground/40 transition-colors hover:border-border/50 hover:text-muted-foreground"
              >
                <Icons.Plus size={12} strokeWidth={1.5} />
                <span>Start your first session</span>
              </button>
            )}
            {flatProject && flatTopicIds.length > 0 && (
              <Reorder.Group
                axis="y"
                values={flatTopicIds}
                onReorder={(newOrder) => setTopicOrder((prev) => ({ ...prev, [flatProject.id]: newOrder }))}
                as="div"
                className="flex flex-col gap-0.5"
              >
                {flatTopicIds.map((topicId) => (
                  <SortableTopicRow
                    key={topicId}
                    topicId={topicId}
                    topics={flatTopics}
                    isActive={activeTopic?.id === topicId}
                    isPinned={pinnedTopics.has(topicId)}
                    onClick={() => {
                      const topic = flatTopics.find((item) => item.id === topicId)
                      if (topic) onTopicSelect({ id: topic.id, name: topic.name, projectId: flatProject.id, projectName: flatProject.name })
                    }}
                    onPin={() => togglePinTopic(topicId, flatProject.id)}
                    onRename={() => {
                      const topic = flatTopics.find((item) => item.id === topicId)
                      if (topic) dialogActions.openRenameTopic(topic)
                    }}
                    onArchive={() => {
                      const topic = flatTopics.find((item) => item.id === topicId)
                      if (topic) handleArchiveTopic(topic)
                    }}
                    onDelete={() => {
                      const topic = flatTopics.find((item) => item.id === topicId)
                      if (topic) dialogActions.openDeleteTopic(topic)
                    }}
                  />
                ))}
              </Reorder.Group>
            )}
          </div>
        </div>
        <ProjectDialogs dialog={dialogState} actions={dialogActions} />
      </>
    )
  }

  return (
    <>
      <div>
        <div className="mb-1.5 flex items-center justify-between px-2.5">
          {collapsible ? (
            <button
              onClick={() => setIsOpen((prev) => !prev)}
              className="flex cursor-pointer items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-foreground"
            >
              <motion.span
                animate={{ rotate: isOpen ? 0 : -90 }}
                transition={{ duration: 0.2, ease: "easeInOut" }}
                className="inline-flex items-center justify-center"
              >
                <Icons.ChevronDown size={12} />
              </motion.span>
              Projects
            </button>
          ) : (
            <span className="text-[10px] font-semibold uppercase tracking-widest text-foreground">
              Projects
            </span>
          )}
          <button
            onClick={dialogActions.openCreateProject}
            title="New project"
            className="flex h-5 w-5 cursor-pointer items-center justify-center rounded text-muted-foreground/50 transition-colors hover:text-foreground"
          >
            <Icons.Plus size={13} strokeWidth={2} />
          </button>
        </div>

        <AnimatePresence initial={false}>
          {showList && (
            <motion.div
              initial={collapsible ? { height: 0, opacity: 0 } : false}
              animate={{ height: "auto", opacity: 1 }}
              exit={collapsible ? { height: 0, opacity: 0 } : undefined}
              transition={{ duration: 0.2, ease: "easeInOut" }}
              className="overflow-hidden"
            >
              <div className="flex flex-col gap-0.5 px-1">
                {projects.length === 0 && (
                  <button
                    onClick={dialogActions.openCreateProject}
                    className="flex w-full cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border/30 px-2.5 py-2 text-left text-[12px] text-muted-foreground/40 transition-colors hover:border-border/50 hover:text-muted-foreground"
                  >
                    <Icons.Plus size={12} strokeWidth={1.5} />
                    <span>Create Space</span>
                  </button>
                )}

                <Reorder.Group
                  axis="y"
                  values={sortedProjectIds.slice(0, PROJECT_INITIAL_LIMIT)}
                  onReorder={(newVisible) => {
                    const hiddenTail = sortedProjectIds.filter((id) => !newVisible.includes(id))
                    setProjectOrder([...newVisible, ...hiddenTail])
                  }}
                  as="div"
                  className="flex flex-col gap-0.5"
                >
                  {sortedProjectIds.slice(0, PROJECT_INITIAL_LIMIT).map((projectId) => {
                    const project = projects.find((p) => p.id === projectId)
                    if (!project) return null
                    const topicList = projectTopics[projectId] || []
                    const topicIds = topicOrder[projectId] || topicList.map((t) => t.id)

                    return (
                      <SortableProjectRow
                        key={projectId}
                        projectId={projectId}
                        projects={projects}
                        isExpanded={expandedProjects.has(projectId)}
                        hasActiveTopic={activeTopic?.projectId === projectId}
                        isPinned={pinnedProjects.has(projectId)}
                        activeTopic={activeTopic}
                        topics={topicList}
                        topicOrderForProject={topicIds}
                        pinnedTopics={pinnedTopics}
                        loadingProject={loadingProject}
                        onProjectClick={() => handleProjectClick(project)}
                        onTogglePinProject={() => togglePinProject(projectId)}
                        onOpenAddTopic={() => dialogActions.openCreateTopic(project)}
                        onRenameProject={() => dialogActions.openRenameProject(project)}
                        onArchiveProject={() => handleArchiveProject(projectId)}
                        onDeleteProject={() => dialogActions.openDeleteProject(project)}
                        onTopicSelect={(t) => onTopicSelect({ id: t.id, name: t.name, projectId, projectName: project.name })}
                        onPinTopic={(topicId) => togglePinTopic(topicId, projectId)}
                        onRenameTopic={(t) => dialogActions.openRenameTopic(t)}
                        onArchiveTopic={handleArchiveTopic}
                        onDeleteTopic={(t) => dialogActions.openDeleteTopic(t)}
                        onTopicReorder={(newOrder) => setTopicOrder((prev) => ({ ...prev, [projectId]: newOrder }))}
                      />
                    )
                  })}
                </Reorder.Group>
                <AnimatePresence initial={false}>
                  {showAllProjects && sortedProjectIds.length > PROJECT_INITIAL_LIMIT && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: "easeInOut" }}
                      className="overflow-hidden"
                    >
                      <div className="flex flex-col gap-0.5">
                        {sortedProjectIds.slice(PROJECT_INITIAL_LIMIT).map((projectId) => {
                          const project = projects.find((p) => p.id === projectId)
                          if (!project) return null
                          const topicList = projectTopics[projectId] || []
                          const topicIds = topicOrder[projectId] || topicList.map((t) => t.id)

                          return (
                            <SortableProjectRow
                              key={projectId}
                              projectId={projectId}
                              projects={projects}
                              isExpanded={expandedProjects.has(projectId)}
                              hasActiveTopic={activeTopic?.projectId === projectId}
                              isPinned={pinnedProjects.has(projectId)}
                              activeTopic={activeTopic}
                              topics={topicList}
                              topicOrderForProject={topicIds}
                              pinnedTopics={pinnedTopics}
                              loadingProject={loadingProject}
                              disableReorder
                              onProjectClick={() => handleProjectClick(project)}
                              onTogglePinProject={() => togglePinProject(projectId)}
                              onOpenAddTopic={() => dialogActions.openCreateTopic(project)}
                              onRenameProject={() => dialogActions.openRenameProject(project)}
                              onArchiveProject={() => handleArchiveProject(projectId)}
                              onDeleteProject={() => dialogActions.openDeleteProject(project)}
                              onTopicSelect={(t) => onTopicSelect({ id: t.id, name: t.name, projectId, projectName: project.name })}
                              onPinTopic={(topicId) => togglePinTopic(topicId, projectId)}
                              onRenameTopic={(t) => dialogActions.openRenameTopic(t)}
                              onArchiveTopic={handleArchiveTopic}
                              onDeleteTopic={(t) => dialogActions.openDeleteTopic(t)}
                              onTopicReorder={(newOrder) => setTopicOrder((prev) => ({ ...prev, [projectId]: newOrder }))}
                            />
                          )
                        })}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
                {sortedProjectIds.length > PROJECT_INITIAL_LIMIT && (
                  <button
                    onClick={() => setShowAllProjects((prev) => !prev)}
                    className="mt-0.5 flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-left text-[11px] text-muted-foreground/50 transition-colors hover:text-muted-foreground"
                  >
                    <motion.span
                      animate={{ rotate: showAllProjects ? 180 : 0 }}
                      transition={{ duration: 0.2, ease: "easeInOut" }}
                      className="inline-flex items-center justify-center"
                    >
                      <Icons.ChevronDown size={11} />
                    </motion.span>
                    {showAllProjects
                      ? "Show less"
                      : `${sortedProjectIds.length - PROJECT_INITIAL_LIMIT} more`}
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <ProjectDialogs dialog={dialogState} actions={dialogActions} />
    </>
  )
}
