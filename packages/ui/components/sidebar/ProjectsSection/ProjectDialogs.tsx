"use client"

import { GlassDialog } from "@/components/ui/GlassDialog"
import type { DialogState, DialogActions } from "@/hooks/useProjectsData"
import { LuFolder, LuMessagesSquare, LuSparkles } from "react-icons/lu"

type Props = {
  dialog: DialogState
  actions: DialogActions
}

export function ProjectDialogs({ dialog, actions }: Props) {
  const {
    createProjectOpen, newProjectName, creatingProject, projectError, defaultProjectWorkspaceRoot, projectNameRef,
    createTopicOpen, createTopicForProject, newTopicName, creatingTopic, topicError, topicNameRef,
    renameProjectOpen, renameProjectName, renameProjectRef,
    renameTopicOpen, renameTopicName, renameTopicRef,
    deleteProjectOpen, deleteProjectTarget, deletingProject,
    deleteTopicOpen, deleteTopicTarget, deletingTopic,
  } = dialog

  const {
    setCreateProjectOpen, setNewProjectName, handleCreateProject,
    setCreateTopicOpen, setNewTopicName, handleCreateTopic,
    setRenameProjectOpen, setRenameProjectName, handleRenameProject,
    setRenameTopicOpen, setRenameTopicName, handleRenameTopicSave,
    setDeleteProjectOpen, handleDeleteProject,
    setDeleteTopicOpen, handleDeleteTopic,
  } = actions

  const projectPreviewName = newProjectName.trim() || "New Project"
  const projectInitial = projectPreviewName.slice(0, 1).toUpperCase()
  const workspaceLabel = defaultProjectWorkspaceRoot === "~" ? "Default workspace" : defaultProjectWorkspaceRoot

  return (
    <>
      <GlassDialog open={createProjectOpen} onClose={() => setCreateProjectOpen(false)} title="Create project" description="Group chats, files, and a default topic around one workstream." className="max-w-[480px]">
        <div className="flex flex-col gap-4">
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.035] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
            <div className="flex items-center gap-3">
              <div className="relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-cyan-300 via-violet-400 to-rose-400 text-[18px] font-semibold text-white shadow-[0_16px_34px_-20px_rgba(0,0,0,0.85)]">
                <span className="absolute inset-0 bg-[radial-gradient(circle_at_30%_18%,rgba(255,255,255,0.30),transparent_38%)]" />
                <span className="relative">{projectInitial}</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-semibold text-foreground">{projectPreviewName}</p>
                <p className="mt-0.5 text-[11.5px] text-muted-foreground">Creates a project with a General topic.</p>
              </div>
              <div className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-emerald-300">Ready</div>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="create-project-name" className="text-[12px] font-medium text-muted-foreground">Project name</label>
            <input ref={projectNameRef} id="create-project-name" className="glass-input h-10 text-[13.5px]" placeholder="e.g. Desktop task B" value={newProjectName} aria-invalid={projectError ? true : undefined} onChange={(e) => setNewProjectName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleCreateProject()} />
          </div>

          <div className="grid gap-2 rounded-2xl border border-white/[0.07] bg-black/[0.035] p-3">
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-muted-foreground"><LuFolder size={14} /></span>
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-medium text-foreground">Workspace</p>
                <p className="truncate text-[11.5px] text-muted-foreground">{workspaceLabel}</p>
              </div>
            </div>
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-muted-foreground"><LuMessagesSquare size={14} /></span>
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-medium text-foreground">Starter topic</p>
                <p className="text-[11.5px] text-muted-foreground">General is created automatically so the project opens ready to chat.</p>
              </div>
            </div>
          </div>

          {projectError && <p className="rounded-lg border border-red-400/20 bg-red-400/8 px-3 py-2 text-[12px] text-red-400">{projectError}</p>}
          <div className="mt-1 flex gap-2.5">
            <button onClick={() => setCreateProjectOpen(false)} className="glass-btn-secondary flex-1">Cancel</button>
            <button onClick={handleCreateProject} disabled={creatingProject || !newProjectName.trim()} className="glass-btn-primary flex-1">{creatingProject ? "Creating…" : <><LuSparkles size={14} /> Create project</>}</button>
          </div>
        </div>
      </GlassDialog>

      <GlassDialog open={createTopicOpen} onClose={() => setCreateTopicOpen(false)} title="New Topic" description={createTopicForProject ? `Add a topic to ${createTopicForProject.name}` : undefined}>
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

      <GlassDialog open={renameProjectOpen} onClose={() => setRenameProjectOpen(false)} title="Rename Project">
        <div className="flex flex-col gap-3">
          <input ref={renameProjectRef} className="glass-input" value={renameProjectName} onChange={(e) => setRenameProjectName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleRenameProject()} />
          <div className="flex gap-2.5">
            <button onClick={handleRenameProject} disabled={!renameProjectName.trim()} className="glass-btn-primary flex-1">Save</button>
            <button onClick={() => setRenameProjectOpen(false)} className="glass-btn-secondary">Cancel</button>
          </div>
        </div>
      </GlassDialog>

      <GlassDialog open={renameTopicOpen} onClose={() => setRenameTopicOpen(false)} title="Rename Topic">
        <div className="flex flex-col gap-3">
          <input ref={renameTopicRef} className="glass-input" value={renameTopicName} onChange={(e) => setRenameTopicName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleRenameTopicSave()} />
          <div className="flex gap-2.5">
            <button onClick={handleRenameTopicSave} disabled={!renameTopicName.trim()} className="glass-btn-primary flex-1">Save</button>
            <button onClick={() => setRenameTopicOpen(false)} className="glass-btn-secondary">Cancel</button>
          </div>
        </div>
      </GlassDialog>

      <GlassDialog open={deleteProjectOpen} onClose={() => setDeleteProjectOpen(false)} title="Delete Project">
        <div className="flex flex-col gap-3">
          <p className="text-[13px] text-muted-foreground">
            Permanently delete <span className="font-medium text-foreground">{deleteProjectTarget?.name}</span>? All topics, sessions, and data will be removed. This cannot be undone.
          </p>
          <div className="flex gap-2.5">
            <button onClick={() => setDeleteProjectOpen(false)} className="glass-btn-secondary flex-1">Cancel</button>
            <button onClick={handleDeleteProject} disabled={deletingProject} className="glass-btn-danger flex-1">{deletingProject ? "Deleting…" : "Delete"}</button>
          </div>
        </div>
      </GlassDialog>

      <GlassDialog open={deleteTopicOpen} onClose={() => setDeleteTopicOpen(false)} title="Delete Topic">
        <div className="flex flex-col gap-3">
          <p className="text-[13px] text-muted-foreground">
            Permanently delete <span className="font-medium text-foreground">{deleteTopicTarget?.name}</span>? This cannot be undone.
          </p>
          <div className="flex gap-2.5">
            <button onClick={() => setDeleteTopicOpen(false)} className="glass-btn-secondary flex-1">Cancel</button>
            <button onClick={handleDeleteTopic} disabled={deletingTopic} className="glass-btn-danger flex-1">{deletingTopic ? "Deleting…" : "Delete"}</button>
          </div>
        </div>
      </GlassDialog>
    </>
  )
}
