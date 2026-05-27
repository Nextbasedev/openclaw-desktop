"use client"

import { useCallback, useEffect, useState } from "react"
import { invoke } from "@/lib/ipc"
import { cn } from "@/lib/utils"
import { VscFolderLibrary, VscGlobe, VscRefresh } from "react-icons/vsc"
import type { InspectorScope } from "./inspectorScope"

type ProjectItem = {
  id: string
  name: string
  archived?: boolean
}

type InspectorScopePickerProps = {
  title?: string
  description?: string
  onSelectScope: (scope: InspectorScope) => void
}

export function InspectorScopePicker({
  title = "Choose workspace for this chat",
  description = "This applies to both Workspace and Git for the current chat.",
  onSelectScope,
}: InspectorScopePickerProps) {
  const [projects, setProjects] = useState<ProjectItem[]>([])
  const [loadingProjects, setLoadingProjects] = useState(false)
  const [projectOpen, setProjectOpen] = useState(false)

  const loadProjects = useCallback(async () => {
    setLoadingProjects(true)
    try {
      const result = await invoke<{ projects?: ProjectItem[] }>("middleware_projects_list", { input: {} })
      setProjects((result.projects ?? []).filter((project) => !project.archived))
    } catch {
      setProjects([])
    } finally {
      setLoadingProjects(false)
    }
  }, [])

  useEffect(() => {
    if (projectOpen) void loadProjects()
  }, [loadProjects, projectOpen])

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-5 text-center">
      <div className="flex size-10 items-center justify-center rounded-2xl border border-border/40 bg-secondary/30">
        <VscFolderLibrary className="size-5 text-muted-foreground/70" />
      </div>
      <div>
        <p className="text-[13px] font-medium text-foreground/85">{title}</p>
        <p className="mt-1 max-w-[320px] text-[11px] leading-relaxed text-muted-foreground/60">
          {description}
        </p>
      </div>
      <div className="flex w-full max-w-[320px] flex-col gap-2">
        <button
          type="button"
          onClick={() => onSelectScope({ kind: "global" })}
          className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-border/50 bg-secondary/30 px-3 py-2 text-[12px] font-medium text-foreground/85 transition-colors hover:bg-secondary/55"
        >
          <VscGlobe className="size-4 text-muted-foreground/70" />
          Use Global Workspace
        </button>
        <button
          type="button"
          onClick={() => setProjectOpen((open) => !open)}
          className="glass-btn-primary px-3 py-2 text-[12px]"
        >
          Connect Existing Project
        </button>
      </div>
      {projectOpen && (
        <div className="w-full max-w-[360px] rounded-xl border border-border/45 bg-card/70 p-2 text-left shadow-xl">
          <div className="mb-1 flex items-center justify-between px-2 py-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/55">Projects</span>
            <button
              type="button"
              onClick={loadProjects}
              className="flex size-6 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground"
              title="Refresh projects"
            >
              <VscRefresh className={cn("size-3.5", loadingProjects && "animate-spin")} />
            </button>
          </div>
          <div className="max-h-52 overflow-y-auto">
            {loadingProjects ? (
              <p className="px-2 py-4 text-center text-[11px] text-muted-foreground/55">Loading projects…</p>
            ) : projects.length > 0 ? (
              projects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => onSelectScope({ kind: "project", projectId: project.id })}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-left text-[12px] text-foreground/85 transition-colors hover:bg-secondary/45"
                >
                  <VscFolderLibrary className="size-3.5 shrink-0 text-muted-foreground/65" />
                  <span className="truncate">{project.name}</span>
                </button>
              ))
            ) : (
              <p className="px-2 py-4 text-center text-[11px] text-muted-foreground/55">No projects found.</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
