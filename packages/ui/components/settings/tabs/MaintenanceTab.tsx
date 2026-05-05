"use client"

import { useState } from "react"
import type { DownloadEvent } from "@tauri-apps/plugin-updater"

type MaintenanceTabProps = {
  onSignOut?: () => void
  onDeleteAccount?: () => void
}

function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__)
  )
}

export function MaintenanceTab({ onSignOut, onDeleteAccount }: MaintenanceTabProps) {
  const [confirmingSignOut, setConfirmingSignOut] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [updateStatus, setUpdateStatus] = useState<string | null>(null)

  async function handleCheckForUpdates() {
    if (!isTauriRuntime()) {
      setUpdateStatus("Updates are only available in the desktop app.")
      return
    }

    setCheckingUpdate(true)
    setUpdateStatus("Checking for updates...")
    try {
      const [{ check }, { relaunch }] = await Promise.all([
        import("@tauri-apps/plugin-updater"),
        import("@tauri-apps/plugin-process"),
      ])
      const update = await check()
      if (!update) {
        setUpdateStatus("You're already on the latest version.")
        return
      }

      let downloaded = 0
      setUpdateStatus(`Downloading OpenClaw ${update.version}...`)
      await update.downloadAndInstall((event: DownloadEvent) => {
        if (event.event === "Started") {
          downloaded = 0
          setUpdateStatus(`Downloading OpenClaw ${update.version}...`)
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength
          setUpdateStatus(`Downloading OpenClaw ${update.version} (${Math.round(downloaded / 1024 / 1024)} MB)...`)
        } else if (event.event === "Finished") {
          setUpdateStatus("Installing update...")
        }
      })
      setUpdateStatus("Update installed. Restarting OpenClaw...")
      await relaunch()
    } catch (error) {
      setUpdateStatus(error instanceof Error ? error.message : "Update check failed")
    } finally {
      setCheckingUpdate(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Maintenance</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your session and account.
        </p>
      </div>

      <div className="overflow-hidden rounded-md border border-border/50 bg-card">
        <div className="px-5 py-4">
          <h3 className="text-[13px] font-medium text-foreground">App Updates</h3>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
            Check for a signed OpenClaw Desktop update and install it when a release is available.
          </p>
          <button
            type="button"
            onClick={handleCheckForUpdates}
            disabled={checkingUpdate}
            className="mt-4 cursor-pointer rounded-md border border-border/50 bg-foreground/5 px-4 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:bg-foreground/10 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {checkingUpdate ? "Checking..." : "Check for Updates"}
          </button>
          {updateStatus && (
            <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
              {updateStatus}
            </p>
          )}
        </div>

        <div className="border-t border-border/30 px-5 py-4">
          <h3 className="text-[13px] font-medium text-foreground">Sign Out</h3>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
            Disconnect from the current Gateway session. You can reconnect anytime.
          </p>

          {confirmingSignOut ? (
            <div className="mt-4 flex items-center justify-between rounded-lg border border-border/50 bg-muted/20 px-4 py-3">
              <span className="text-[13px] text-muted-foreground">Are you sure you want to sign out?</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmingSignOut(false)}
                  className="cursor-pointer rounded-md px-3 py-1.5 text-[12px] text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => { onSignOut?.(); setConfirmingSignOut(false) }}
                  className="cursor-pointer rounded-md border border-border/50 bg-foreground/5 px-3 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:bg-foreground/10"
                >
                  Confirm
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingSignOut(true)}
              className="mt-4 cursor-pointer rounded-md border border-border/50 bg-foreground/5 px-4 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:bg-foreground/10"
            >
              Sign Out
            </button>
          )}
        </div>

        <div className="border-t border-border/30 px-5 py-4">
          <h3 className="text-[13px] font-medium text-destructive">Delete Account</h3>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
            Permanently delete all local data, cached sessions, and preferences. This action is irreversible.
          </p>

          {confirmingDelete ? (
            <div className="mt-4 flex items-center justify-between rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
              <span className="text-[13px] text-destructive">This cannot be undone.</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  className="cursor-pointer rounded-md px-3 py-1.5 text-[12px] text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => { onDeleteAccount?.(); setConfirmingDelete(false) }}
                  className="cursor-pointer rounded-md bg-destructive px-3 py-1.5 text-[12px] font-medium text-destructive-foreground transition-colors hover:bg-destructive/90"
                >
                  Delete Everything
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className="mt-4 cursor-pointer rounded-md bg-destructive px-4 py-1.5 text-[12px] font-medium text-destructive-foreground transition-colors hover:bg-destructive/90"
            >
              Delete Account
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
