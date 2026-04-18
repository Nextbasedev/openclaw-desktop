"use client"

import { GlassDialog } from "@/components/ui/GlassDialog"
import type { DialogState, DialogActions } from "@/hooks/useProjectsData"

type Props = {
  dialog: DialogState
  actions: DialogActions
}

export function ProjectDialogs({ dialog, actions }: Props) {
  const {
    createProjectOpen, newProjectName, newProjectPath, creatingProject, projectError, projectNameRef,
    createTopicOpen, createTopicForProject, newTopicName, creatingTopic, topicError, topicNameRef,
    renameProjectOpen, renameProjectName, renameProjectRef,
    renameTopicOpen, renameTopicName, renameTopicRef,
  } = dialog

  const {
    setCreateProjectOpen, setNewProjectName, setNewProjectPath, handleCreateProject,
    setCreateTopicOpen, setNewTopicName, handleCreateTopic,
    setRenameProjectOpen, setRenameProjectName, handleRenameProject,
    setRenameTopicOpen, setRenameTopicName, handleRenameTopicSave,
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
    </>
  )
}
