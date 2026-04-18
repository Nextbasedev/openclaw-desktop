import { Icons } from "@/components/icons"
import { useState } from "react"
import { cn } from "@/lib/utils"
import type { Project, Topic } from "@/lib/jarvis-middleware"

type SidebarProps = {
  className?: string
  width?: number
  onResizeStart?: () => void
  projects: Project[]
  selectedProjectId: string | null
  topics: Topic[]
  selectedTopicId: string | null
  projectSessions: Array<{ key: string; title: string | null; status: string | null }>
  loadingProjects: boolean
  loadingTopics: boolean
  creatingProject: boolean
  creatingTopic: boolean
  onSelectProject: (projectId: string) => void
  onSelectTopic: (topicId: string) => void
  onSelectSession: (sessionKey: string) => void
  onCreateProject: (name: string) => Promise<void> | void
  onCreateTopic: (name: string) => Promise<void> | void
}

export function Sidebar({
  className,
  width = 240,
  onResizeStart,
  projects,
  selectedProjectId,
  topics,
  selectedTopicId,
  projectSessions,
  loadingProjects,
  loadingTopics,
  creatingProject,
  creatingTopic,
  onSelectProject,
  onSelectTopic,
  onSelectSession,
  onCreateProject,
  onCreateTopic,
}: SidebarProps) {
  const [showProjectInput, setShowProjectInput] = useState(false)
  const [showTopicInput, setShowTopicInput] = useState(false)
  const [newProjectName, setNewProjectName] = useState("")
  const [newTopicName, setNewTopicName] = useState("")

  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null

  return (
    <aside
      style={{ width: `${width}px` }}
      className={cn(
        "relative flex h-full shrink-0 flex-col overflow-hidden border-r border-border/50 bg-card/70 backdrop-blur-xl",
        className,
      )}
    >
      <div className="relative z-10 flex-1 overflow-y-auto px-2 py-3">
        {/* Project selector */}
        <div className="mb-4 px-1">
          <div className="mb-2 flex items-center justify-between px-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              Project
            </span>
            <button
              type="button"
              onClick={() => setShowProjectInput((v) => !v)}
              className="flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
            >
              <Icons.Plus size={12} />
              {showProjectInput ? "Cancel" : "New"}
            </button>
          </div>

          {showProjectInput && (
            <CreateRow
              value={newProjectName}
              placeholder="Create project"
              onChange={setNewProjectName}
              onConfirm={async () => {
                if (!newProjectName.trim()) return
                await onCreateProject(newProjectName.trim())
                setNewProjectName("")
                setShowProjectInput(false)
              }}
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
            <div className="rounded-lg border border-border/40 bg-background/30 p-1">
              {projects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => onSelectProject(project.id)}
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors",
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
        </div>

        {/* Topics for selected project */}
        <div className="px-1">
          <div className="mb-2 flex items-center justify-between px-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              {selectedProject ? `${selectedProject.name} topics` : "Topics"}
            </span>
            <button
              type="button"
              onClick={() => setShowTopicInput((v) => !v)}
              disabled={!selectedProjectId}
              className="flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground disabled:cursor-default disabled:opacity-40"
            >
              <Icons.Plus size={12} />
              {showTopicInput ? "Cancel" : "New"}
            </button>
          </div>

          {showTopicInput && selectedProjectId && (
            <CreateRow
              value={newTopicName}
              placeholder="Create topic"
              onChange={setNewTopicName}
              onConfirm={async () => {
                if (!newTopicName.trim()) return
                await onCreateTopic(newTopicName.trim())
                setNewTopicName("")
                setShowTopicInput(false)
              }}
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
            <div className="space-y-1">
              {topics.map((topic) => (
                <button
                  key={topic.id}
                  type="button"
                  onClick={() => onSelectTopic(topic.id)}
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors",
                    selectedTopicId === topic.id
                      ? "bg-foreground/5 text-foreground"
                      : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                  )}
                >
                  <Icons.BubbleChat size={14} className="shrink-0" />
                  <span className="truncate">{topic.name}</span>
                  {topic.unreadCount > 0 ? (
                    <span className="ml-auto rounded-full bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {topic.unreadCount}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Sessions / chats */}
        <div className="mt-4 px-1">
          <div className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            Chats
          </div>
          <div className="space-y-1">
            {projectSessions.length === 0 ? (
              <p className="px-2 text-[11px] text-muted-foreground/60">No chats yet</p>
            ) : (
              projectSessions.map((session) => (
                <button
                  key={session.key}
                  type="button"
                  onClick={() => onSelectSession(session.key)}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
                >
                  <Icons.Chat size={14} className="shrink-0" />
                  <span className="truncate">{session.title ?? session.key}</span>
                  <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground/60">
                    {session.status ?? "idle"}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      </div>

      <button
        type="button"
        aria-label="Resize sidebar"
        onMouseDown={onResizeStart}
        className="absolute right-0 top-0 z-20 h-full w-1 -translate-x-1/2 cursor-col-resize bg-transparent"
      />

    </aside>
  )
}

function CreateRow({
  value,
  placeholder,
  onChange,
  onConfirm,
  onCancel,
  loading,
}: {
  value: string
  placeholder: string
  onChange: (value: string) => void
  onConfirm: () => void
  onCancel: () => void
  loading?: boolean
}) {
  return (
    <div className="mx-1 mb-2 flex items-center gap-1 rounded-md border border-border/40 bg-background/40 px-2 py-1.5">
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
      <button
        type="button"
        onClick={onConfirm}
        disabled={loading || !value.trim()}
        className="flex size-5 cursor-pointer items-center justify-center rounded text-muted-foreground/70 transition-colors hover:bg-secondary hover:text-foreground disabled:cursor-default disabled:opacity-40"
      >
        <Icons.Check size={12} />
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="flex size-5 cursor-pointer items-center justify-center rounded text-muted-foreground/70 transition-colors hover:bg-secondary hover:text-foreground"
      >
        <Icons.Close size={12} />
      </button>
    </div>
  )
}

