"use client"

import { Reorder } from "framer-motion"
import { Icons } from "@/components/icons"
import { useProjectsData } from "@/hooks/useProjectsData"
import { SortableProjectRow } from "./SortableProjectRow"
import { ProjectDialogs } from "./ProjectDialogs"
import type { ActiveTopic } from "@/types/project"

export type { ActiveTopic }

type Props = {
  collapsed: boolean
  activeTopic: ActiveTopic | null
  onTopicSelect: (topic: ActiveTopic) => void
}

export function ProjectsSection({ collapsed, activeTopic, onTopicSelect }: Props) {
  const {
    projects, expandedProjects, projectTopics, loadingProject,
    projectOrder, setProjectOrder, topicOrder, setTopicOrder,
    pinnedProjects, pinnedTopics, sortedProjectIds,
    handleProjectClick, togglePinProject, togglePinTopic,
    handleArchiveProject, handleArchiveTopic,
    dialogState, dialogActions,
  } = useProjectsData(onTopicSelect)

  if (collapsed) {
    return (
      <div className="mt-3 flex justify-center border-t border-border/10 pt-2">
        <button
          title="Projects"
          onClick={dialogActions.openCreateProject}
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
        <div className="mb-1.5 flex items-center justify-between px-2.5">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-foreground">Projects</span>
          <button
            onClick={dialogActions.openCreateProject}
            title="New project"
            className="flex h-5 w-5 cursor-pointer items-center justify-center rounded text-muted-foreground/50 transition-colors hover:text-foreground"
          >
            <Icons.Plus size={13} strokeWidth={2} />
          </button>
        </div>

        <div className="flex flex-col gap-0.5 px-1">
          {projects.length === 0 && (
            <button
              onClick={dialogActions.openCreateProject}
              className="flex w-full cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border/30 px-2.5 py-2 text-left text-[12px] text-muted-foreground/40 transition-colors hover:border-border/50 hover:text-muted-foreground"
            >
              <Icons.Plus size={12} strokeWidth={1.5} />
              <span>Create your first project</span>
            </button>
          )}

          <Reorder.Group axis="y" values={sortedProjectIds} onReorder={setProjectOrder} as="div" className="flex flex-col gap-0.5">
            {sortedProjectIds.map((projectId) => {
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
                  onTopicSelect={(t) => onTopicSelect({ id: t.id, name: t.name, projectId, projectName: project.name })}
                  onPinTopic={(topicId) => togglePinTopic(topicId, projectId)}
                  onRenameTopic={(t) => dialogActions.openRenameTopic(t)}
                  onArchiveTopic={handleArchiveTopic}
                  onTopicReorder={(newOrder) => setTopicOrder((prev) => ({ ...prev, [projectId]: newOrder }))}
                />
              )
            })}
          </Reorder.Group>
        </div>
      </div>

      <ProjectDialogs dialog={dialogState} actions={dialogActions} />
    </>
  )
}
