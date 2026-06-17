import type { DownloadEvent, Update } from "@tauri-apps/plugin-updater"

export type AppUpdateState =
  | { status: "idle"; message: string | null }
  | { status: "checking"; message: string }
  | { status: "available"; message: string; version: string; update: Update }
  | { status: "downloading"; message: string; version: string }
  | { status: "installing"; message: string; version: string }
  | { status: "restarting"; message: string; version: string }
  | { status: "unavailable"; message: string }
  | { status: "error"; message: string }

export function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__)
  )
}

export async function checkForAppUpdate(): Promise<Update | null> {
  if (!isTauriRuntime()) return null
  const { check } = await import("@tauri-apps/plugin-updater")
  return check()
}

export async function installAppUpdate(
  update: Update,
  onState?: (state: AppUpdateState) => void,
) {
  const { relaunch } = await import("@tauri-apps/plugin-process")
  let downloadedBytes = 0
  const version = update.version

  onState?.({ status: "downloading", version, message: `Downloading OpenClaw ${version}...` })
  await update.downloadAndInstall((event: DownloadEvent) => {
    if (event.event === "Started") {
      downloadedBytes = 0
      onState?.({ status: "downloading", version, message: `Downloading OpenClaw ${version}...` })
      return
    }

    if (event.event === "Progress") {
      downloadedBytes += event.data.chunkLength
      const downloadedMb = Math.max(1, Math.round(downloadedBytes / 1024 / 1024))
      onState?.({
        status: "downloading",
        version,
        message: `Downloading OpenClaw ${version} (${downloadedMb} MB)...`,
      })
      return
    }

    if (event.event === "Finished") {
      onState?.({ status: "installing", version, message: "Installing update..." })
    }
  })

  onState?.({ status: "restarting", version, message: "Update installed. Restarting OpenClaw..." })
  await relaunch()
}

export function updateErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Update check failed"
}
