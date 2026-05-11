"use client"

import { useState } from "react"
import { Reorder, useDragControls } from "framer-motion"
import { Icons } from "@/components/icons"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { useLongPressDrag } from "@/hooks/useLongPressDrag"
import { MenuAction } from "./MenuAction"
import { GLASS_POPOVER } from "@/constants/glassPopover"
import { SortableTopicRow } from "./SortableTopicRow"
import type { Project, FullTopic, ActiveTopic } from "@/types/project"
import { SidebarLabelTooltip } from "../SidebarLabelTooltip"

type Props = {
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
  onDeleteProject: () => void
  onTopicSelect: (topic: FullTopic) => void
  onPinTopic: (topicId: string) => void
  onRenameTopic: (topic: FullTopic) => void
  onArchiveTopic: (topic: FullTopic) => void
  onDeleteTopic: (topic: FullTopic) => void
  onTopicReorder: (newOrder: string[]) => void
  disableReorder?: boolean
}

export function SortableProjectRow({
  projectId, projects, isExpanded, hasActiveTopic, isPinned,
  activeTopic, topics, topicOrderForProject, pinnedTopics, loadingProject,
  onProjectClick, onTogglePinProject, onOpenAddTopic, onRenameProject,
  onArchiveProject, onDeleteProject, onTopicSelect, onPinTopic, onRenameTopic, onArchiveTopic, onDeleteTopic, onTopicReorder,
  disableReorder,
}: Props) {
  const controls = useDragControls()
  const longPress = useLongPressDrag(controls)
  const [menuOpen, setMenuOpen] = useState(false)
  const project = projects.find((p) => p.id === projectId)
  if (!project) return null

  const isLoading = loadingProject === projectId

  const rowContent = (
    <>
      <div className="group/row group/project relative flex items-center">
        <SidebarLabelTooltip label={project.name} disabled={menuOpen}>
          <button
            onClick={onProjectClick}
            className="flex flex-1 min-w-0 cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors duration-150 text-foreground/90 hover:bg-foreground/4 hover:text-foreground"
          >
            {isPinned && (
              <span onClick={(e) => { e.stopPropagation(); onTogglePinProject() }} title="Unpin" className="flex shrink-0 cursor-pointer items-center justify-center">
                <Icons.Pin size={13} strokeWidth={2} className="text-foreground/70" />
              </span>
            )}
            <span className="flex h-4 w-4 shrink-0 items-center justify-center">
              <Icons.Files size={14} strokeWidth={1.5} className="transition-colors text-foreground/90 group-hover/project:text-foreground" />
            </span>
            <span className="flex-1 truncate text-[13px] font-normal leading-tight">{project.name}</span>
          </button>
        </SidebarLabelTooltip>

        <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          <PopoverTrigger asChild>
            <button
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              title="Project options"
              className={cn(
                "absolute right-1 flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded transition-colors",
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
            <MenuAction label={isPinned ? "Unpin" : "Pin"} icon={<Icons.Pin size={14} strokeWidth={1.5} />} onClick={() => { setMenuOpen(false); onTogglePinProject() }} />
            <div className="my-0.5 h-px bg-border/20" />
            <MenuAction label="Archive" icon={<Icons.Archive size={14} strokeWidth={1.5} />} onClick={() => { setMenuOpen(false); onArchiveProject() }} />
            <MenuAction label="Delete" icon={<Icons.Trash size={14} strokeWidth={1.5} />} onClick={() => { setMenuOpen(false); onDeleteProject() }} danger />
          </PopoverContent>
        </Popover>
      </div>

      <div
        className={cn("grid transition-[grid-template-rows] duration-200", isExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}
        style={{ transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)" }}
      >
        <div className={cn("overflow-hidden transition-opacity duration-150", isExpanded ? "opacity-100" : "opacity-0")}>
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
              <Reorder.Group axis="y" values={topicOrderForProject} onReorder={onTopicReorder} as="div" className="flex flex-col gap-px">
                {topicOrderForProject.map((topicId) => (
                  <SortableTopicRow
                    key={topicId}
                    topicId={topicId}
                    topics={topics}
                    isActive={activeTopic?.id === topicId}
                    isPinned={pinnedTopics.has(topicId)}
                    onClick={() => { const t = topics.find((x) => x.id === topicId); if (t) onTopicSelect(t) }}
                    onPin={() => onPinTopic(topicId)}
                    onRename={() => { const t = topics.find((x) => x.id === topicId); if (t) onRenameTopic(t) }}
                    onArchive={() => { const t = topics.find((x) => x.id === topicId); if (t) onArchiveTopic(t) }}
                    onDelete={() => { const t = topics.find((x) => x.id === topicId); if (t) onDeleteTopic(t) }}
                  />
                ))}
              </Reorder.Group>
            )}
          </div>
        </div>
      </div>
    </>
  )

  if (disableReorder) {
    return (
      <div className="flex flex-col" style={{ position: "relative" }}>
        {rowContent}
      </div>
    )
  }

  return (
    <Reorder.Item
      value={projectId}
      dragListener={false}
      dragControls={controls}
      as="div"
      layout="position"
      transition={{ layout: { type: "tween", duration: 0.15, ease: [0.2, 0, 0, 1] } }}
      className="flex flex-col"
      style={{ position: "relative", boxShadow: "none" }}
      whileDrag={{ boxShadow: "none" }}
      {...longPress}
    >
      {rowContent}
    </Reorder.Item>
  )
}
