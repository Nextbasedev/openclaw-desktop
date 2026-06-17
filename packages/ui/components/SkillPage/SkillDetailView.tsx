"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { invoke } from "@/lib/ipc"
import { LuTrash2 } from "react-icons/lu"
import { useSkillDetail } from "./hooks"
import type { SkillDetailResponse } from "./types"
import { BackButton, TrustBadge, DetailSkeleton } from "./SkillDetailParts"

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

export function SkillDetailView({
  slug,
  onBack,
  onInstallDone,
  onUninstallDone,
}: {
  slug: string
  onBack: () => void
  onInstallDone: (slug: string) => void
  onUninstallDone: (slug: string) => void
}) {
  const { detail, versions, loading } = useSkillDetail(slug)
  const [installing, setInstalling] = React.useState(false)
  const [uninstalling, setUninstalling] = React.useState(false)
  const [installMsg, setInstallMsg] = React.useState<string | null>(null)

  const handleInstall = React.useCallback(async () => {
    if (installing) return
    setInstalling(true)
    setInstallMsg(null)
    try {
      await invoke("middleware_skills_install", {
        input: { source: "clawhub", slug, scope: "user" },
      })
      setInstallMsg("Installed successfully!")
      onInstallDone(slug)
    } catch (err) {
      setInstallMsg(err instanceof Error ? err.message : "Install failed")
    } finally {
      setInstalling(false)
    }
  }, [slug, installing, onInstallDone])

  const handleUninstall = React.useCallback(async () => {
    if (uninstalling) return
    setUninstalling(true)
    setInstallMsg(null)
    try {
      await invoke("middleware_skills_uninstall", {
        input: { slug },
      })
      onUninstallDone(slug)
      onBack()
    } catch (err) {
      setInstallMsg(err instanceof Error ? err.message : "Uninstall failed")
    } finally {
      setUninstalling(false)
    }
  }, [slug, uninstalling, onUninstallDone, onBack])

  if (loading) return <DetailSkeleton onBack={onBack} />

  if (!detail?.skill) {
    return (
      <div className="h-full w-full overflow-y-auto">
        <div className="mx-auto max-w-3xl px-7 py-10">
          <BackButton onClick={onBack} />
          <div className="mt-10 text-center text-muted-foreground">
            Skill not found.
          </div>
        </div>
      </div>
    )
  }

  const { skill, latestVersion, owner } = detail
  const stats = (skill as Record<string, unknown>)
    .stats as SkillDetailResponse["skill"] extends infer S
    ? S extends { stats?: infer T }
      ? T
      : never
    : never

  const statItems = [
    stats?.downloads != null
      ? { label: "Downloads", value: stats.downloads.toLocaleString() }
      : null,
    stats?.installsAllTime != null
      ? { label: "Installs", value: stats.installsAllTime.toLocaleString() }
      : null,
    stats?.stars != null
      ? { label: "Stars", value: stats.stars.toLocaleString() }
      : null,
    stats?.versions != null
      ? { label: "Versions", value: stats.versions.toLocaleString() }
      : null,
  ].filter(Boolean) as Array<{ label: string; value: string }>

  const infoItems = [
    { label: "Latest Version", value: latestVersion?.version ?? "—" },
    {
      label: "Created",
      value: skill.createdAt ? formatDate(skill.createdAt) : "—",
    },
    {
      label: "Updated",
      value: skill.updatedAt ? formatDate(skill.updatedAt) : "—",
    },
    skill.tags?.latest ? { label: "Tag", value: skill.tags.latest } : null,
  ].filter(Boolean) as Array<{ label: string; value: string }>

  return (
    <div className="h-full w-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-7 py-10">
        <BackButton onClick={onBack} />

        <div className="mt-6 flex items-start gap-5">
          <div className="min-w-0 flex-1">
            <h1 className="text-[22px] font-semibold text-foreground">
              {skill.displayName}
            </h1>
            {owner?.handle && (
              <p className="mt-0.5 flex items-center gap-2 text-[13px] text-muted-foreground">
                {owner.image && (
                  <img
                    src={owner.image}
                    alt=""
                    className="size-5 rounded-full"
                  />
                )}
                {owner.displayName ?? owner.handle}
              </p>
            )}
            <p className="mt-4 text-[14px] leading-relaxed text-foreground/80">
              {skill.summary ?? "No description."}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {detail.package && <TrustBadge pkg={detail.package} />}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {detail.installed ? (
              <>
                <span className="rounded-md bg-emerald-500/10 px-4 py-2 text-[13px] font-medium text-emerald-400">
                  Installed
                </span>
                <button
                  type="button"
                  disabled={uninstalling}
                  onClick={handleUninstall}
                  className={cn(
                    "flex size-9 cursor-pointer items-center justify-center rounded-md",
                    "text-muted-foreground/50 transition-all duration-200",
                    "hover:bg-red-500/10 hover:text-red-400",
                    "disabled:cursor-not-allowed disabled:opacity-50"
                  )}
                  aria-label="Uninstall skill"
                >
                  {uninstalling ? (
                    <div className="size-4 animate-spin rounded-full border-2 border-red-400/20 border-t-red-400" />
                  ) : (
                    <LuTrash2 size={16} />
                  )}
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={installing}
                onClick={handleInstall}
                className={cn(
                  "cursor-pointer rounded-md bg-foreground px-5 py-2 text-[13px] font-medium",
                  "text-background transition-opacity hover:opacity-90",
                  "disabled:opacity-50"
                )}
              >
                {installing ? "Installing..." : "Install"}
              </button>
            )}
          </div>
        </div>

        {installMsg && (
          <div
            className={cn(
              "mt-4 rounded-lg border px-4 py-2.5 text-[13px]",
              installMsg.includes("fail") || installMsg.includes("Error")
                ? "border-red-400/20 bg-red-400/5 text-red-400"
                : "border-emerald-400/20 bg-emerald-400/5 text-emerald-400"
            )}
          >
            {installMsg}
          </div>
        )}

        {(statItems.length > 0 || infoItems.length > 0) && (
          <div className="mt-6 rounded-sm shadow-[0_10px_40px_-24px_rgba(0,0,0,0.18)] backdrop-blur-2xl dark:shadow-[0_10px_40px_-24px_rgba(0,0,0,0.75)]">
            {statItems.length > 0 && (
              <div className="grid grid-cols-2 rounded-sm border border-border/60 bg-card md:grid-cols-4">
                {statItems.map((item, index) => (
                  <div
                    key={item.label}
                    className={cn(
                      "px-4 py-5 text-center",
                      index !== statItems.length - 1 &&
                        "border-r border-border/60"
                    )}
                  >
                    <div className="text-[18px] font-bold tracking-tight text-foreground/90">
                      {item.value}
                    </div>
                    <div className="mt-1 text-[10px] font-bold tracking-[0.22em] text-muted-foreground/60 uppercase">
                      {item.label}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {infoItems.length > 0 && (
              <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                {infoItems.map((item) => (
                  <div
                    key={item.label}
                    className="flex items-center justify-between rounded-sm border border-border/60 bg-card px-5 py-4"
                  >
                    <span className="text-[13px] font-medium text-muted-foreground">
                      {item.label}
                    </span>
                    <span className="text-[13px] font-bold text-foreground/90 tabular-nums">
                      {item.value}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {detail.installed && detail.localContent && (
          <div className="mt-8">
            <h3 className="mb-4 text-[14px] font-medium text-foreground">
              Skill Instructions
            </h3>
            <div className="rounded-lg border border-border/60 bg-card p-4 text-[13px] leading-relaxed whitespace-pre-wrap text-foreground/80">
              {detail.localContent}
            </div>
          </div>
        )}

        {latestVersion?.changelog && (
          <div className="mt-8">
            <div className="rounded-sm border border-border/60 bg-card p-3 shadow-[0_10px_40px_-24px_rgba(0,0,0,0.18)] backdrop-blur-2xl dark:shadow-[0_10px_40px_-24px_rgba(0,0,0,0.75)]">
              <div className="mb-1 px-2 py-3">
                <h3 className="text-[14px] font-medium text-foreground">
                  Changelog
                </h3>
              </div>
              <div className="rounded-sm p-4 text-[13px] leading-relaxed whitespace-pre-wrap text-foreground/80">
                {latestVersion.changelog}
              </div>
            </div>
          </div>
        )}

        {versions && versions.items.length > 1 && (
          <div className="mt-6">
            <div className=" p-1">
              <div className="mb-3 px-2 py-3">
                <h3 className="text-[14px] font-medium text-foreground">
                  Version History
                </h3>
              </div>
              <div className="overflow-hidden rounded-sm border border-border/60 bg-card">
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr className="border-b border-border/60 bg-foreground/[0.04]">
                      <th className="border-r border-border/60 px-4 py-3 text-[11px] font-semibold tracking-[0.18em] text-foreground uppercase">
                        Version
                      </th>
                      <th className="px-4 py-3 text-right text-[11px] font-semibold tracking-[0.18em] text-foreground uppercase">
                        Date
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {versions.items.map((version, index) => (
                      <tr
                        key={version.version}
                        className={cn(
                          index !== versions.items.length - 1 &&
                            "border-b border-border/40"
                        )}
                      >
                        <td className="border-r border-border/60 px-4 py-3 text-[13px] font-medium text-foreground">
                          v{version.version}
                        </td>
                        <td className="px-4 py-3 text-right text-[12px] text-muted-foreground">
                          {formatDate(version.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
