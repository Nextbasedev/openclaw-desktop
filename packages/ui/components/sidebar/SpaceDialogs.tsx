"use client"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { RefObject } from "react"
import type { Space } from "@/types/space"

type Props = {
  busy: boolean
  name: string
  inputRef: RefObject<HTMLInputElement | null>
  renameOpen: boolean
  deleteOpen: boolean
  deleteTarget: Space | null
  onNameChange: (value: string) => void
  onRenameOpenChange: (open: boolean) => void
  onDeleteOpenChange: (open: boolean) => void
  onRenameSubmit: () => void | Promise<void>
  onDeleteConfirm: () => void | Promise<void>
}

export function SpaceDialogs({
  busy,
  name,
  inputRef,
  renameOpen,
  deleteOpen,
  deleteTarget,
  onNameChange,
  onRenameOpenChange,
  onDeleteOpenChange,
  onRenameSubmit,
  onDeleteConfirm,
}: Props) {
  return (
    <>
      <Dialog open={renameOpen} onOpenChange={onRenameOpenChange}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Rename Project</DialogTitle>
            <DialogDescription>
              Update the project name shown in your spaces bar.
            </DialogDescription>
          </DialogHeader>
          <input
            ref={inputRef}
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void onRenameSubmit()}
            className="h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => onRenameOpenChange(false)} disabled={busy}>Cancel</Button>
            <Button onClick={() => void onRenameSubmit()} disabled={busy || !name.trim()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={onDeleteOpenChange}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Delete Project</DialogTitle>
            <DialogDescription>
              Remove {deleteTarget?.name ?? "this project"} from your spaces list.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => onDeleteOpenChange(false)} disabled={busy}>Cancel</Button>
            <Button variant="destructive" onClick={() => void onDeleteConfirm()} disabled={busy}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
