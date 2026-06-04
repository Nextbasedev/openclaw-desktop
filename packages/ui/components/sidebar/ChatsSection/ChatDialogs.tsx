"use client"

import { GlassDialog } from "@/components/ui/GlassDialog"
import type {
  ChatDialogState,
  ChatDialogActions,
} from "@/hooks/useChatsData"

type Props = {
  dialog: ChatDialogState
  actions: ChatDialogActions
}

export function ChatDialogs({ dialog, actions }: Props) {
  const {
    renameOpen,
    renameName,
    renameRef,
    deleteOpen,
    deleteTarget,
    deleting,
  } = dialog

  const {
    setRenameOpen,
    setRenameName,
    handleRename,
    setDeleteOpen,
    handleDelete,
  } = actions

  return (
    <>
      <GlassDialog
        open={renameOpen}
        onClose={() => setRenameOpen(false)}
        title="Rename Chat"
      >
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-muted-foreground">Chat name</span>
            <input
              ref={renameRef}
              className="glass-input h-10"
              value={renameName}
              onChange={(e) => setRenameName(e.target.value)}
              onKeyDown={(e) =>
                e.key === "Enter" && handleRename()
              }
            />
          </label>
          <div className="grid grid-cols-2 gap-2.5">
            <button
              onClick={handleRename}
              disabled={!renameName.trim()}
              className="glass-btn-primary"
            >
              Save
            </button>
            <button
              onClick={() => setRenameOpen(false)}
              className="glass-btn-secondary"
            >
              Cancel
            </button>
          </div>
        </div>
      </GlassDialog>

      <GlassDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete Chat"
      >
        <div className="flex flex-col gap-3">
          <p className="text-[13px] text-muted-foreground">
            Permanently delete{" "}
            <span className="font-medium text-foreground">
              {deleteTarget?.name}
            </span>
            ? This cannot be undone.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2.5">
            <button
              onClick={() => setDeleteOpen(false)}
              className="glass-btn-secondary"
            >
              Cancel
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="glass-btn-danger"
            >
              {deleting ? "Deleting\u2026" : "Delete"}
            </button>
          </div>
        </div>
      </GlassDialog>
    </>
  )
}
