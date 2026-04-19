"use client"

import * as React from "react"
import { invoke } from "@/lib/ipc"
import { Icons } from "@/components/icons"
import { cn } from "@/lib/utils"
import {
  SkillGhostIcon,
  SkillPdfIcon,
  SkillDocIcon,
  SkillLabIcon,
  SkillImageIcon,
  SkillBookIcon,
  SkillPencilIcon,
  SkillPuzzleIcon,
  SkillExcelIcon,
  SkillSlidesIcon,
} from "./icons"
import { LuPackageOpen, LuSearchX, LuWifiOff } from "react-icons/lu"

type SkillCategory = "All" | "Recommended" | "System" | "Personal"

type DiscoveredSkill = {
  slug: string
  name: string
  description: string | null
  source: "clawhub" | "local" | "github" | "builtin" | "catalog"
  version: string | null
  installed: boolean
  enabled: boolean
}

type SkillDiscoverResponse = {
  query: string | null
  results: DiscoveredSkill[]
  warnings: string[]
  sources: string[]
}

type SkillInstallResponse = {
  status: string
  skill: Record<string, unknown>
  location: string
  actions: string[]
  warnings: string[]
}

type SkillItem = {
  id: string
  name: string
  description: string
  category: Exclude<SkillCategory, "All">
  iconBg: string
  iconKey: string
  installed: boolean
  enabled: boolean
  source: string
  version: string | null
  slug: string
}

export function SkillPage() {
  const [query, setQuery] = React.useState("")
  const [category, setCategory] = React.useState<SkillCategory>("All")
  const [skills, setSkills] = React.useState<SkillItem[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [meta, setMeta] = React.useState<SkillDiscoverResponse | null>(null)
  const [installingId, setInstallingId] = React.useState<string | null>(null)
  const [installError, setInstallError] = React.useState<string | null>(null)
  const loadedRef = React.useRef(false)
  const togglingRef = React.useRef<Set<string>>(new Set())

  const handleInstall = React.useCallback(async (item: SkillItem) => {
    if (installingId) return
    setInstallingId(item.id)
    setInstallError(null)

    try {
      await invoke<SkillInstallResponse>(
        "middleware_skills_install",
        {
          input: {
            source: item.source,
            slug: item.slug,
            scope: "user",
          },
        },
      )
      setSkills((prev) =>
        prev.map((s) => s.id === item.id ? { ...s, installed: true, enabled: true } : s),
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Install failed"
      setInstallError(msg)
      setTimeout(() => setInstallError(null), 4000)
    } finally {
      setInstallingId(null)
    }
  }, [installingId])

  const handleToggle = React.useCallback(async (item: SkillItem) => {
    if (togglingRef.current.has(item.id)) return
    togglingRef.current.add(item.id)

    const newEnabled = !item.enabled
    setSkills((prev) =>
      prev.map((s) =>
        s.id === item.id ? { ...s, enabled: newEnabled } : s,
      ),
    )

    try {
      await invoke("middleware_skills_toggle", {
        input: { slug: item.slug, enabled: newEnabled },
      })
    } catch (err) {
      setSkills((prev) =>
        prev.map((s) =>
          s.id === item.id ? { ...s, enabled: !newEnabled } : s,
        ),
      )
      const msg = err instanceof Error ? err.message : "Toggle failed"
      setInstallError(msg)
      setTimeout(() => setInstallError(null), 4000)
    } finally {
      togglingRef.current.delete(item.id)
    }
  }, [])

  React.useEffect(() => {
    if (loadedRef.current) return
    loadedRef.current = true

    async function loadSkills() {
      setLoading(true)
      setError(null)

      try {
        const response = await invoke<SkillDiscoverResponse>(
          "middleware_skills_discover",
          {
            input: {
              query: "",
              limit: 50,
              includeLocal: true,
              includeClawHub: true,
            },
          },
        )

        setMeta(response)
        setSkills(response.results.map(mapBackendSkillToItem))
        setLoading(false)
      } catch (err) {
        console.error("middleware_skills_discover failed", err)
        setSkills([])
        setMeta(null)
        setError("Unable to load skills. Please check your connection and try again.")
        setLoading(false)
      }
    }

    loadSkills()
  }, [])

  const filteredSections = React.useMemo(() => {
    const filtered = skills.filter((item) => {
      const matchesCategory = category === "All" || item.category === category
      const q = query.trim().toLowerCase()
      const matchesQuery =
        q.length === 0 ||
        item.name.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q)

      return matchesCategory && matchesQuery
    })

    return (["Recommended", "System", "Personal"] as const)
      .map((title) => ({
        title,
        items: filtered.filter((item) => item.category === title),
      }))
      .filter((section) => section.items.length > 0)
  }, [skills, query, category])

  return (
    <div className="mx-auto w-full max-w-4xl px-7 py-10">
      <div className="mb-7 text-center">
        <h1 className="text-[28px] font-medium tracking-tight text-foreground">
          Make Tauri work your way
        </h1>
      </div>

      <div className="mb-8 flex items-center gap-2.5">
        <div className="relative flex-1">
          <Icons.Search
            size={14}
            strokeWidth={1.6}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search skills"
            className={cn(
              "h-9 w-full rounded-lg border border-border/60 bg-card pl-10 pr-3",
              "text-[13px] text-foreground outline-none transition-colors",
              "placeholder:text-muted-foreground/80 focus:border-foreground/20",
            )}
          />
        </div>

        <CategoryDropdown category={category} setCategory={setCategory} />
      </div>

      {installError && (
        <div className="mb-4 rounded-lg border border-red-400/20 bg-red-400/5 px-4 py-2.5 text-center text-[13px] text-red-400">
          {installError}
        </div>
      )}

      {!loading && meta && (
        <div className="mb-5 flex items-center justify-between text-[14px] text-muted-foreground">
          <span>{meta.results.length} skill{meta.results.length === 1 ? "" : "s"} discovered</span>
          <span>Sources: {meta.sources.join(", ")}</span>
        </div>
      )}

      {loading ? (
        <SkillPageSkeleton />
      ) : error ? (
        <EmptyState
          icon={<LuWifiOff size={28} />}
          title="Could not load skills"
          description={error}
        />
      ) : filteredSections.length === 0 ? (
        query.trim() ? (
          <EmptyState
            icon={<LuSearchX size={28} />}
            title="No matching skills"
            description={`No skills match "${query}". Try a different search term.`}
          />
        ) : (
          <EmptyState
            icon={<LuPackageOpen size={28} />}
            title={category === "Personal" ? "No personal skills yet" : "No skills found"}
            description={
              category === "Personal"
                ? "Personal skills you create or install locally will appear here."
                : "No skills are available for the selected category."
            }
          />
        )
      ) : (
        <div className="space-y-8">
          {filteredSections.map((section) => (
            <section key={section.title}>
              <h2 className="mb-3 text-[14px]">
                {section.title}
              </h2>

              <div className="border-t border-border/40">
                <div className="grid grid-cols-1 gap-x-8 md:grid-cols-2">
                  {section.items.map((item) => (
                    <SkillCard
                      key={item.id}
                      item={item}
                      installing={installingId === item.id}
                      onInstall={handleInstall}
                      onToggle={handleToggle}
                    />
                  ))}
                </div>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

const CATEGORIES: SkillCategory[] = ["All", "Recommended", "System", "Personal"]

function CategoryDropdown({
  category,
  setCategory,
}: {
  category: SkillCategory
  setCategory: (c: SkillCategory) => void
}) {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-9 items-center gap-1.5 rounded-lg border border-border/60 bg-card px-3 pr-8",
          "text-[13px] text-foreground outline-none transition-colors",
        )}
      >
        {category}
      </button>
      <svg
        viewBox="0 0 20 20"
        fill="none"
        className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
      >
        <path
          d="m5 7.5 5 5 5-5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>

      {open && (
        <div
          className={cn(
            "absolute right-0 top-[calc(100%+6px)] z-50 min-w-[160px] overflow-hidden rounded-xl p-1",
            "border border-white/[0.12] bg-white/[0.06] shadow-xl shadow-black/30",
            "backdrop-blur-2xl",
          )}
        >
          {CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => {
                setCategory(c)
                setOpen(false)
              }}
              className={cn(
                "flex w-full items-center rounded-lg px-3 py-2 text-[13px] transition-colors",
                c === category
                  ? "bg-white/[0.12] text-foreground"
                  : "text-foreground/80 hover:bg-white/[0.08] hover:text-foreground my-1",
              )}
            >
              {c}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function SkillCard({
  item,
  installing,
  onInstall,
  onToggle,
}: {
  item: SkillItem
  installing: boolean
  onInstall: (item: SkillItem) => void
  onToggle: (item: SkillItem) => void
}) {
  return (
    <div className={cn(
      "flex items-center gap-3.5 border-b border-border/30 py-4.5",
      item.installed && !item.enabled && "opacity-50",
    )}>
      <div className={cn("flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md", item.iconBg)}>
        <SkillTileIcon iconKey={item.iconKey} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-[14px]">{item.name}</p>
          {item.version && (
            <span className="rounded bg-secondary/50 px-1.5 py-0.5 text-[12px] text-muted-foreground">
              {item.version}
            </span>
          )}
          {item.installed && !item.enabled && (
            <span className="rounded bg-muted/50 px-1.5 py-0.5 text-[11px] text-muted-foreground">
              off
            </span>
          )}
        </div>
        <p className="truncate text-[12px] text-muted-foreground">{item.description}</p>
      </div>

      {item.installed ? (
        <button
          type="button"
          onClick={() => onToggle(item)}
          className="shrink-0 cursor-pointer"
          aria-label={`${item.enabled ? "Disable" : "Enable"} ${item.name}`}
        >
          <div className={cn(
            "relative h-5 w-9 rounded-full transition-colors",
            item.enabled ? "bg-green-500" : "bg-muted-foreground/30",
          )}>
            <div className={cn(
              "absolute top-0.5 size-4 rounded-full bg-white shadow-sm transition-transform",
              item.enabled ? "translate-x-4" : "translate-x-0.5",
            )} />
          </div>
        </button>
      ) : installing ? (
        <div className="flex size-8 shrink-0 items-center justify-center">
          <div className="size-4 animate-spin rounded-full border-2 border-border border-t-foreground/50" />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => onInstall(item)}
          className={cn(
            "flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full",
            "bg-secondary/50 text-foreground transition-colors hover:bg-secondary",
          )}
          aria-label={`Install ${item.name}`}
        >
          <svg viewBox="0 0 20 20" fill="none" className="size-3.5">
            <path d="M10 3v10m0 0-3.5-3.5M10 13l3.5-3.5M4 16h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    </div>
  )
}

function SkillTileIcon({ iconKey }: { iconKey: string }) {
  switch (iconKey) {
    case "ghost": return <SkillGhostIcon />
    case "pdf": return <SkillPdfIcon />
    case "doc": return <SkillDocIcon />
    case "lab": return <SkillLabIcon />
    case "image": return <SkillImageIcon />
    case "book": return <SkillBookIcon />
    case "pencil": return <SkillPencilIcon />
    case "puzzle": return <SkillPuzzleIcon />
    case "excel": return <SkillExcelIcon />
    case "slides": return <SkillSlidesIcon />
    default: return <SkillPuzzleIcon />
  }
}

function EmptyState({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode
  title: string
  description: string
}) {
  return (
    <div className="rounded-xl border border-border/50 bg-card px-5 py-12 text-center">
      <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-muted/30 text-muted-foreground/60">
        {icon}
      </div>
      <p className="text-[14px] font-medium text-foreground">{title}</p>
      <p className="mt-1 text-[13px] text-muted-foreground/70">{description}</p>
    </div>
  )
}

function SkillCardSkeleton() {
  return (
    <div className="flex items-center gap-3.5 border-b border-border/30 py-4.5">
      <div className="size-12 shrink-0 animate-pulse rounded-md bg-muted/30" />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-center gap-2">
          <div className="h-3.5 w-24 animate-pulse rounded bg-muted/30" />
          <div className="h-3 w-10 animate-pulse rounded bg-muted/20" />
        </div>
        <div className="h-3 w-48 animate-pulse rounded bg-muted/20" />
      </div>
      <div className="size-8 shrink-0 animate-pulse rounded-full bg-muted/20" />
    </div>
  )
}

function SkillPageSkeleton() {
  return (
    <div className="space-y-8">
      <div className="mb-5 flex items-center justify-between">
        <div className="h-3.5 w-28 animate-pulse rounded bg-muted/25" />
        <div className="h-3.5 w-32 animate-pulse rounded bg-muted/25" />
      </div>

      <section>
        <div className="mb-3 h-4 w-28 animate-pulse rounded bg-muted/25" />
        <div className="border-t border-border/40">
          <div className="grid grid-cols-1 gap-x-8 md:grid-cols-2">
            <SkillCardSkeleton />
            <SkillCardSkeleton />
            <SkillCardSkeleton />
            <SkillCardSkeleton />
            <SkillCardSkeleton />
            <SkillCardSkeleton />
          </div>
        </div>
      </section>

      <section>
        <div className="mb-3 h-4 w-16 animate-pulse rounded bg-muted/25" />
        <div className="border-t border-border/40">
          <div className="grid grid-cols-1 gap-x-8 md:grid-cols-2">
            <SkillCardSkeleton />
            <SkillCardSkeleton />
            <SkillCardSkeleton />
          </div>
        </div>
      </section>
    </div>
  )
}

function mapBackendSkillToItem(skill: DiscoveredSkill): SkillItem {
  return {
    id: skill.slug,
    name: skill.name,
    description: skill.description || "No description available.",
    category: mapDiscoveredSkillCategory(skill),
    iconBg: getSkillBackground(skill),
    iconKey: getSkillIconKey(skill),
    installed: skill.installed,
    enabled: skill.enabled,
    source: skill.source,
    version: skill.version,
    slug: skill.slug,
  }
}

function mapDiscoveredSkillCategory(skill: DiscoveredSkill): "Recommended" | "System" | "Personal" {
  if (skill.source === "local") return "Personal"
  if (skill.source === "builtin" || skill.source === "catalog") return "System"
  if (skill.source === "clawhub") return "Recommended"
  return "Recommended"
}

function getSkillIconKey(skill: DiscoveredSkill) {
  const slug = skill.slug.toLowerCase()
  if (slug.includes("pdf")) return "pdf"
  if (slug.includes("doc")) return "doc"
  if (slug.includes("image")) return "image"
  if (slug.includes("excel") || slug.includes("sheet")) return "excel"
  if (slug.includes("powerpoint") || slug.includes("slides")) return "slides"
  if (slug.includes("playwright") || slug.includes("browser")) return "lab"
  if (slug.includes("creator") || slug.includes("edit")) return "pencil"
  if (slug.includes("sora")) return "ghost"
  if (slug.includes("docs")) return "book"
  return "puzzle"
}

function getSkillBackground(skill: DiscoveredSkill) {
  if (skill.installed) return "bg-[#1D1D1D]"
  if (skill.source === "local") return "bg-[#1F3B1E]"
  if (skill.slug.includes("pdf")) return "bg-white"
  if (skill.slug.includes("docs")) return "bg-[#FFF4EA]"
  return "bg-[#F0F0F0] dark:bg-[#202020]"
}
