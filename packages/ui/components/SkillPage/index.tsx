"use client"

import * as React from "react"
import { invoke } from "@/lib/ipc"
import { cn } from "@/lib/utils"
import { Icons } from "@/components/icons"
import { LuPackageOpen, LuSearchX, LuWifiOff } from "react-icons/lu"
import { useSkillsDiscovery } from "./hooks"
import { SortDropdown } from "./SortDropdown"
import { SkillCard } from "./SkillCard"
import { SkillDetailView } from "./SkillDetailView"
import {
  TabButton,
  EmptyState,
  GridSkeleton,
} from "./SkillPageParts"

type TabId = "all" | "installed"

export function SkillPage() {
  const [activeTab, setActiveTab] = React.useState<TabId>("all")

  const {
    skills,
    loading,
    error,
    sort,
    query,
    sources,
    nextCursor,
    installedCount,
    onSortChange,
    onQueryChange,
    loadMore,
    updateSkill,
    refetch,
  } = useSkillsDiscovery(activeTab === "installed")

  const [selectedSlug, setSelectedSlug] = React.useState<
    string | null
  >(null)
  const [installingSlug, setInstallingSlug] = React.useState<
    string | null
  >(null)
  const [uninstallingSlug, setUninstallingSlug] =
    React.useState<string | null>(null)
  const [actionError, setActionError] = React.useState<
    string | null
  >(null)
  const togglingRef = React.useRef<Set<string>>(new Set())

  const handleInstall = React.useCallback(
    async (slug: string) => {
      if (installingSlug) return
      setInstallingSlug(slug)
      setActionError(null)
      try {
        const skill = skills.find((s) => s.slug === slug)
        await invoke("middleware_skills_install", {
          input: {
            source: skill?.source ?? "clawhub",
            slug,
            scope: "user",
          },
        })
        updateSkill(slug, { installed: true, enabled: true })
      } catch (err) {
        setActionError(
          err instanceof Error
            ? err.message
            : "Install failed",
        )
        setTimeout(() => setActionError(null), 4000)
      } finally {
        setInstallingSlug(null)
      }
    },
    [installingSlug, skills, updateSkill],
  )

  const handleUninstall = React.useCallback(
    async (slug: string) => {
      if (uninstallingSlug) return
      setUninstallingSlug(slug)
      setActionError(null)
      try {
        await invoke("middleware_skills_uninstall", {
          input: { slug },
        })
        if (activeTab === "installed") {
          refetch()
        } else {
          updateSkill(slug, {
            installed: false,
            enabled: false,
          })
        }
      } catch (err) {
        setActionError(
          err instanceof Error
            ? err.message
            : "Uninstall failed",
        )
        setTimeout(() => setActionError(null), 4000)
      } finally {
        setUninstallingSlug(null)
      }
    },
    [uninstallingSlug, activeTab, updateSkill, refetch],
  )

  const handleToggle = React.useCallback(
    async (slug: string) => {
      if (togglingRef.current.has(slug)) return
      togglingRef.current.add(slug)
      const skill = skills.find((s) => s.slug === slug)
      const newEnabled = !skill?.enabled
      updateSkill(slug, { enabled: newEnabled })
      try {
        await invoke("middleware_skills_toggle", {
          input: { slug, enabled: newEnabled },
        })
      } catch {
        updateSkill(slug, { enabled: !newEnabled })
      } finally {
        togglingRef.current.delete(slug)
      }
    },
    [skills, updateSkill],
  )

  if (selectedSlug) {
    return (
      <SkillDetailView
        slug={selectedSlug}
        onBack={() => setSelectedSlug(null)}
        onInstallDone={(slug) =>
          updateSkill(slug, { installed: true, enabled: true })
        }
        onUninstallDone={() => refetch()}
      />
    )
  }

  return (
    <div className="h-full w-full overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-7 py-10">
        <div className="mb-7 text-center">
          <h1 className="text-[28px] font-medium tracking-tight text-foreground">
            Discover Skills
          </h1>
          <p className="mt-1 text-[14px] text-muted-foreground">
            Browse and install skills from ClawHub
          </p>
        </div>
        <div className="mb-5 flex items-center gap-2.5">
          <div className="flex items-center gap-1.5">
            <TabButton
              active={activeTab === "all"}
              onClick={() => setActiveTab("all")}
              label="All"
            />
            <TabButton
              active={activeTab === "installed"}
              onClick={() => setActiveTab("installed")}
              label="Installed"
              count={installedCount}
            />
            {activeTab === "all" && (
              <SortDropdown
                value={sort}
                onChange={onSortChange}
              />
            )}
          </div>

          {activeTab === "all" && (
            <div className="relative ml-auto w-56">
              <Icons.Search
                size={14}
                strokeWidth={1.6}
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <input
                value={query}
                onChange={(e) => onQueryChange(e.target.value)}
                placeholder="Search skills..."
                className={cn(
                  "h-9 w-full rounded-lg border border-border/60 bg-card pl-10 pr-3",
                  "text-[13px] text-foreground outline-none transition-colors",
                  "placeholder:text-muted-foreground/80 focus:border-foreground/20",
                )}
              />
            </div>
          )}
        </div>
        {actionError && (
          <div className="mb-4 rounded-lg border border-red-400/20 bg-red-400/5 px-4 py-2.5 text-center text-[13px] text-red-400">
            {actionError}
          </div>
        )}

        {!loading && skills.length > 0 && (
          <div className="mb-5 flex items-center justify-between text-[13px] text-muted-foreground">
            <span>
              {skills.length} skill
              {skills.length === 1 ? "" : "s"}
            </span>
            {activeTab === "all" && sources.length > 0 && (
              <span>Sources: {sources.join(", ")}</span>
            )}
          </div>
        )}

        {loading ? (
          <GridSkeleton />
        ) : error ? (
          <EmptyState
            icon={<LuWifiOff size={28} />}
            title="Could not load skills"
            description={error}
          />
        ) : skills.length === 0 ? (
          activeTab === "installed" ? (
            <EmptyState
              icon={<LuPackageOpen size={28} />}
              title="No installed skills"
              description="Skills you install will appear here."
            />
          ) : query.trim() ? (
            <EmptyState
              icon={<LuSearchX size={28} />}
              title="No matching skills"
              description={`No skills match "${query}".`}
            />
          ) : (
            <EmptyState
              icon={<LuPackageOpen size={28} />}
              title="No skills found"
              description="No skills are available right now."
            />
          )
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {skills.map((skill) => (
                <SkillCard
                  key={skill.slug}
                  skill={skill}
                  installing={
                    installingSlug === skill.slug
                  }
                  onInstall={handleInstall}
                  onToggle={handleToggle}
                  onClick={setSelectedSlug}
                />
              ))}
            </div>

            {activeTab === "all" && nextCursor && (
              <div className="mt-6 text-center">
                <button
                  type="button"
                  onClick={loadMore}
                  className={cn(
                    "rounded-lg border border-border/60 bg-card px-6 py-2",
                    "text-[13px] text-foreground transition-colors hover:bg-card/80",
                  )}
                >
                  Load More
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
