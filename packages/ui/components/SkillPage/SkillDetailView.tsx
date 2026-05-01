"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { invoke } from "@/lib/ipc"
import { LuTrash2 } from "react-icons/lu"
import { useSkillDetail } from "./hooks"
import type { SkillDetailResponse } from "./types"
import {
  BackButton,
  StatItem,
  InfoRow,
  TrustBadge,
  DetailSkeleton,
} from "./SkillDetailParts"

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
  const [installMsg, setInstallMsg] = React.useState<
    string | null
  >(null)

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
      setInstallMsg(
        err instanceof Error ? err.message : "Install failed",
      )
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
      setInstallMsg(
        err instanceof Error
          ? err.message
          : "Uninstall failed",
      )
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
  const stats = (skill as Record<string, unknown>).stats as
    | SkillDetailResponse["skill"] extends infer S
    ? S extends { stats?: infer T }
      ? T
      : never
    : never

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
              {detail.package && (
                <TrustBadge pkg={detail.package} />
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {detail.installed ? (
              <>
                <span className="rounded-full bg-emerald-500/10 px-4 py-2 text-[13px] font-medium text-emerald-400">
                  Installed
                </span>
                <button
                  type="button"
                  disabled={uninstalling}
                  onClick={handleUninstall}
                  className={cn(
                    "flex size-9 cursor-pointer items-center justify-center rounded-full",
                    "text-muted-foreground/50 transition-all duration-200",
                    "hover:bg-red-500/10 hover:text-red-400",
                    "disabled:opacity-50 disabled:cursor-not-allowed",
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
                  "rounded-md bg-foreground px-5 py-2 text-[13px] font-medium cursor-pointer",
                  "text-background transition-opacity hover:opacity-90",
                  "disabled:opacity-50",
                )}
              >
                {installing ? "Installing…" : "Install"}
              </button>
            )}
          </div>
        </div>

        {installMsg && (
          <div
            className={cn(
              "mt-4 rounded-lg border px-4 py-2.5 text-[13px]",
              installMsg.includes("fail") ||
                installMsg.includes("Error")
                ? "border-red-400/20 bg-red-400/5 text-red-400"
                : "border-emerald-400/20 bg-emerald-400/5 text-emerald-400",
            )}
          >
            {installMsg}
          </div>
        )}

        {stats && (
          <div className="mt-6 grid grid-cols-4 gap-3">
            {stats.downloads != null && (
              <StatItem
                label="Downloads"
                value={stats.downloads}
              />
            )}
            {stats.installsAllTime != null && (
              <StatItem
                label="Installs"
                value={stats.installsAllTime}
              />
            )}
            {stats.stars != null && (
              <StatItem label="Stars" value={stats.stars} />
            )}
            {stats.versions != null && (
              <StatItem
                label="Versions"
                value={stats.versions}
              />
            )}
          </div>
        )}

        <div className="mt-6 grid grid-cols-2 gap-4 text-[13px]">
          <InfoRow
            label="Latest Version"
            value={latestVersion?.version ?? "—"}
          />
          <InfoRow
            label="Created"
            value={
              skill.createdAt
                ? formatDate(skill.createdAt)
                : "—"
            }
          />
          <InfoRow
            label="Updated"
            value={
              skill.updatedAt
                ? formatDate(skill.updatedAt)
                : "—"
            }
          />
          {skill.tags?.latest && (
            <InfoRow label="Tag" value={skill.tags.latest} />
          )}
        </div>

        {detail.installed && detail.localContent && (
          <div className="mt-8">
            <h3 className="mb-4 text-[14px] font-medium text-foreground">
              Skill Instructions
            </h3>
            <div className="rounded-lg border border-border/40 bg-muted/10 p-4 text-[13px] leading-relaxed text-foreground/80 whitespace-pre-wrap">
              {detail.localContent}
            </div>
          </div>
        )}

        {latestVersion?.changelog && (
          <div className="mt-8 ml-2">
            <h3 className="mb-4 text-[14px] font-medium text-foreground">
              Changelog
            </h3>
            <div className="rounded-lg border border-border/40 bg-muted/10 p-4 text-[13px] leading-relaxed text-foreground/80 whitespace-pre-wrap">
              {latestVersion.changelog}
            </div>
          </div>
        )}

        {versions && versions.items.length > 1 && (
          <div className="mt-6">
            <h3 className="mb-2 text-[14px] font-medium text-foreground">
              Version History
            </h3>
            <div className="space-y-2">
              {versions.items.map((v) => (
                <div
                  key={v.version}
                  className="flex items-center justify-between rounded-lg border border-border/30 px-4 py-3"
                >
                  <span className="text-[13px] font-medium text-foreground">
                    v{v.version}
                  </span>
                  <span className="text-[12px] text-muted-foreground">
                    {formatDate(v.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
