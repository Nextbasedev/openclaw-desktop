"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { invoke } from "@/lib/ipc"
import { useSkillDetail } from "./hooks"
import type { SkillDetailResponse } from "./types"

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

function StatItem({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-white/5 bg-white/[0.03] px-4 py-5 backdrop-blur-xl shadow-sm transition-all hover:bg-white/[0.06]">
      <span className="text-[18px] font-bold tracking-tight text-foreground/90">
        {typeof value === "number" ? value.toLocaleString() : value}
      </span>
      <span className="mt-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/40">{label}</span>
    </div>
  )
}

export function SkillDetailView({
  slug,
  onBack,
  onInstallDone,
}: {
  slug: string
  onBack: () => void
  onInstallDone: (slug: string) => void
}) {
  const { detail, versions, loading } = useSkillDetail(slug)
  const [installing, setInstalling] = React.useState(false)
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
      setInstallMsg(
        err instanceof Error ? err.message : "Install failed",
      )
    } finally {
      setInstalling(false)
    }
  }, [slug, installing, onInstallDone])

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

          <div className="shrink-0">
            {detail.installed ? (
              <span className="rounded-full bg-emerald-500/10 px-4 py-2 text-[13px] font-medium text-emerald-400">
                Installed
              </span>
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
              installMsg.includes("fail") || installMsg.includes("Error")
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
              <StatItem label="Downloads" value={stats.downloads} />
            )}
            {stats.installsAllTime != null && (
              <StatItem label="Installs" value={stats.installsAllTime} />
            )}
            {stats.stars != null && (
              <StatItem label="Stars" value={stats.stars} />
            )}
            {stats.versions != null && (
              <StatItem label="Versions" value={stats.versions} />
            )}
          </div>
        )}

        <div className="mt-6 grid grid-cols-2 gap-4 text-[13px]">
          <InfoRow label="Latest Version" value={latestVersion?.version ?? "—"} />
          <InfoRow label="Created" value={skill.createdAt ? formatDate(skill.createdAt) : "—"} />
          <InfoRow label="Updated" value={skill.updatedAt ? formatDate(skill.updatedAt) : "—"} />
          {skill.tags?.latest && (
            <InfoRow label="Tag" value={skill.tags.latest} />
          )}
        </div>

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

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 text-[13px] text-muted-foreground cursor-pointer",
        "transition-colors hover:text-foreground",
      )}
    >
      <svg viewBox="0 0 20 20" fill="none" className="size-4">
        <path
          d="M12.5 15 7.5 10l5-5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      Back to Skills
    </button>
  )
}


function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-white/5 bg-white/[0.03] px-5 py-4 shadow-sm transition-all hover:bg-white/[0.06]">
      <span className="text-[13px] font-medium text-muted-foreground/60">{label}</span>
      <span className="text-[13px] font-bold text-foreground/90 tabular-nums">{value}</span>
    </div>
  )
}

function TrustBadge({
  pkg,
}: {
  pkg: NonNullable<SkillDetailResponse["package"]>
}) {
  const channelColor = pkg.isOfficial
    ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
    : "bg-zinc-500/10 text-zinc-400 border-zinc-500/20"
  const verificationColor =
    pkg.verification?.scanStatus === "passed"
      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
      : pkg.verification?.scanStatus === "failed"
        ? "bg-red-500/10 text-red-400 border-red-500/20"
        : "bg-amber-500/10 text-amber-400 border-amber-500/20"

  return (
    <>
      <span
        className={cn(
          "rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
          channelColor,
        )}
      >
        {pkg.isOfficial ? "Official" : pkg.channel}
      </span>
      {pkg.verificationTier && (
        <span
          className={cn(
            "rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
            verificationColor,
          )}
        >
          {pkg.verificationTier}
        </span>
      )}
      {pkg.verification?.scanStatus && (
        <span
          className={cn(
            "rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
            verificationColor,
          )}
        >
          Scan: {pkg.verification.scanStatus}
        </span>
      )}
      {pkg.verification?.hasProvenance && (
        <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-400">
          Provenance verified
        </span>
      )}
      {!pkg.verification && !pkg.verificationTier && !pkg.isOfficial && (
        <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-medium text-amber-400">
          Unverified
        </span>
      )}
    </>
  )
}

function DetailSkeleton({ onBack }: { onBack: () => void }) {
  return (
    <div className="h-full w-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-7 py-10">
        <BackButton onClick={onBack} />
        <div className="mt-6 flex items-start gap-5">
          <div className="size-14 animate-pulse rounded-xl bg-muted/30" />
          <div className="flex-1 space-y-3">
            <div className="h-6 w-48 animate-pulse rounded bg-muted/30" />
            <div className="h-4 w-32 animate-pulse rounded bg-muted/20" />
            <div className="h-12 w-full animate-pulse rounded bg-muted/20" />
          </div>
        </div>
        <div className="mt-6 grid grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg bg-muted/20" />
          ))}
        </div>
      </div>
    </div>
  )
}
