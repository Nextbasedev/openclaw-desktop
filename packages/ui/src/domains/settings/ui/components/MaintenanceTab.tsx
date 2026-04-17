"use client"

import { useState } from "react"
import { Separator } from "@/components/ui/separator"
import { Button } from "@/components/ui/button"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Logout03Icon,
  Delete02Icon,
  Alert02Icon,
} from "@hugeicons/core-free-icons"

export function MaintenanceTab() {
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Maintenance</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your session and account. These actions cannot be undone.
        </p>
      </div>

      {/* Sign Out */}
      <div className="rounded-xl border border-border/50 bg-muted/20 p-5">
        <div className="flex items-start gap-4">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted/50 text-muted-foreground">
            <HugeiconsIcon icon={Logout03Icon} size={20} strokeWidth={1.5} />
          </div>
          <div className="flex flex-1 flex-col gap-1">
            <h3 className="text-sm font-medium text-foreground">Sign Out</h3>
            <p className="text-sm text-muted-foreground">
              Disconnect from the current OpenClaw Gateway session. You can
              reconnect anytime with your credentials.
            </p>
            {showSignOutConfirm ? (
              <div className="mt-3 flex items-center gap-3 rounded-lg border border-orange-500/20 bg-orange-500/5 p-3">
                <HugeiconsIcon
                  icon={Alert02Icon}
                  size={16}
                  strokeWidth={1.5}
                  className="text-orange-500 shrink-0"
                />
                <p className="text-sm text-orange-500">
                  Are you sure? You will need to reconnect.
                </p>
                <div className="ml-auto flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowSignOutConfirm(false)}
                  >
                    Cancel
                  </Button>
                  <Button variant="outline" size="sm">
                    Confirm Sign Out
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="mt-3 w-fit"
                onClick={() => setShowSignOutConfirm(true)}
              >
                <HugeiconsIcon icon={Logout03Icon} size={14} strokeWidth={1.5} />
                Sign Out
              </Button>
            )}
          </div>
        </div>
      </div>

      <Separator className="bg-border/50" />

      {/* Delete Account */}
      <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-5">
        <div className="flex items-start gap-4">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
            <HugeiconsIcon icon={Delete02Icon} size={20} strokeWidth={1.5} />
          </div>
          <div className="flex flex-1 flex-col gap-1">
            <h3 className="text-sm font-medium text-destructive">
              Delete Account
            </h3>
            <p className="text-sm text-muted-foreground">
              Permanently delete your local profile data, cached sessions, and
              saved preferences. This action is{" "}
              <span className="font-medium text-destructive">irreversible</span>.
            </p>
            {showDeleteConfirm ? (
              <div className="mt-3 flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3">
                <HugeiconsIcon
                  icon={Alert02Icon}
                  size={16}
                  strokeWidth={1.5}
                  className="text-destructive shrink-0"
                />
                <p className="text-sm text-destructive">
                  This will delete all local data permanently.
                </p>
                <div className="ml-auto flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowDeleteConfirm(false)}
                  >
                    Cancel
                  </Button>
                  <Button variant="destructive" size="sm">
                    Delete Everything
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="destructive"
                size="sm"
                className="mt-3 w-fit"
                onClick={() => setShowDeleteConfirm(true)}
              >
                <HugeiconsIcon icon={Delete02Icon} size={14} strokeWidth={1.5} />
                Delete Account
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
