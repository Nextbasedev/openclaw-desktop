"use client"

import { useState } from "react"
import { Separator } from "@/components/ui/separator"
import { Button } from "@/components/ui/button"

type MaintenanceTabProps = {
  onSignOut?: () => void
  onDeleteAccount?: () => void
}

export function MaintenanceTab({ onSignOut, onDeleteAccount }: MaintenanceTabProps) {
  const [confirmingSignOut, setConfirmingSignOut] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Maintenance</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your session and account.
        </p>
      </div>

      {/* Sign Out */}
      <div className="rounded-xl border border-border/50 bg-card p-5">
        <h3 className="text-sm font-medium text-foreground">Sign Out</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Disconnect from the current Gateway session. You can reconnect anytime.
        </p>
        {confirmingSignOut ? (
          <div className="mt-3 flex items-center gap-3">
            <span className="text-sm text-muted-foreground">Are you sure?</span>
            <Button size="sm" variant="outline" onClick={() => { onSignOut?.(); setConfirmingSignOut(false) }}>
              Confirm
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmingSignOut(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => setConfirmingSignOut(true)}
          >
            Sign Out
          </Button>
        )}
      </div>

      <Separator className="bg-border/50" />

      {/* Delete Account */}
      <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-5">
        <h3 className="text-sm font-medium text-destructive">Delete Account</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Permanently delete all local data, cached sessions, and preferences.
          This action is <span className="text-destructive font-medium">irreversible</span>.
        </p>
        {confirmingDelete ? (
          <div className="mt-3 flex items-center gap-3">
            <span className="text-sm text-destructive">This cannot be undone.</span>
            <Button size="sm" variant="destructive" onClick={() => { onDeleteAccount?.(); setConfirmingDelete(false) }}>
              Delete Everything
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmingDelete(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            variant="destructive"
            size="sm"
            className="mt-3"
            onClick={() => setConfirmingDelete(true)}
          >
            Delete Account
          </Button>
        )}
      </div>
    </div>
  )
}
