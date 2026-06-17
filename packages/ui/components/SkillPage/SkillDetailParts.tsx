"use client"

import { cn } from "@/lib/utils"
import type { SkillDetailResponse } from "./types"

export function BackButton({
  onClick,
}: {
  onClick: () => void
}) {
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

export function StatItem({
  label,
  value,
}: {
  label: string
  value: string | number
}) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-border/60 bg-card px-4 py-5 backdrop-blur-xl shadow-sm transition-all hover:bg-foreground/[0.04]">
      <span className="text-[18px] font-bold tracking-tight text-foreground/90">
        {typeof value === "number"
          ? value.toLocaleString()
          : value}
      </span>
      <span className="mt-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
        {label}
      </span>
    </div>
  )
}

export function InfoRow({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-border/60 bg-card px-5 py-4 shadow-sm transition-all hover:bg-foreground/[0.04]">
      <span className="text-[13px] font-medium text-muted-foreground">
        {label}
      </span>
      <span className="text-[13px] font-bold text-foreground/90 tabular-nums">
        {value}
      </span>
    </div>
  )
}

export function TrustBadge({
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
      {!pkg.verification &&
        !pkg.verificationTier &&
        !pkg.isOfficial && (
          <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-medium text-amber-400">
            Unverified
          </span>
        )}
    </>
  )
}

export function DetailSkeleton({
  onBack,
}: {
  onBack: () => void
}) {
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
            <div
              key={i}
              className="h-16 animate-pulse rounded-lg bg-muted/20"
            />
          ))}
        </div>
      </div>
    </div>
  )
}
