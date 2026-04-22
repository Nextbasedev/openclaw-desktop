"use client"

import { GlassDialog } from "@/components/ui/GlassDialog"
import { RepoPickerDialog } from "@/components/sidebar/RepoPickerDialog"
import type { DialogState, DialogActions } from "@/hooks/useProjectsData"

type Props = {
  dialog: DialogState
  actions: DialogActions
}

export function ProjectDialogs({ dialog, actions }: Props) {
  const {
    createProjectOpen, newProjectName, creatingProject, projectError, projectNameRef,
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
    setRepoPickerOpen, handleRepoSelect,
  } = actions

  return (
    <>
      <GlassDialog open={createProjectOpen} onClose={() => setCreateProjectOpen(false)} title="New Project" description="Set up a workspace to organize your conversations.">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-medium text-muted-foreground">Project name</label>
            <input ref={projectNameRef} className="glass-input" placeholder="My Project" value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleCreateProject()} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-medium text-muted-foreground">Repository</label>
            <button type="button" onClick={() => setRepoPickerOpen(true)} className="glass-input text-left truncate">
              {dialog.newProjectPath ? (
                <span className="text-foreground">{dialog.newProjectPath}</span>
              ) : (
                <span className="text-muted-foreground/50">Pick a repository...</span>
              )}
            </button>
          </div>
          {projectError && <p className="rounded-lg border border-red-400/20 bg-red-400/8 px-3 py-2 text-[12px] text-red-400">{projectError}</p>}
          <div className="mt-1 flex gap-2.5">
            <button onClick={() => setCreateProjectOpen(false)} className="glass-btn-secondary flex-1">Cancel</button>
            <button onClick={handleCreateProject} disabled={creatingProject || !newProjectName.trim()} className="glass-btn-primary flex-1">{creatingProject ? "Creating…" : "Create Project"}</button>
          </div>
        </div>
      </GlassDialog>

      <RepoPickerDialog open={dialog.repoPickerOpen} onClose={() => setRepoPickerOpen(false)} onSelect={handleRepoSelect} />

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
