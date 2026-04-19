"use client"

import * as React from "react"
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

type SkillCategory = "All" | "Recommended" | "System" | "Personal"

type DiscoveredSkill = {
  id: string
  slug: string
  name: string
  summary: string | null
  description: string | null
  source: "clawhub" | "local" | "github"
  version: string | null
  installed: boolean
  installSource: "clawhub" | "github" | "local"
  repoUrl: string | null
  homepageUrl: string | null
  localPath: string | null
  tags: string[]
}

type SkillDiscoverResponse = {
  query: string
  results: DiscoveredSkill[]
  warnings: string[]
  sources: Array<"clawhub" | "local" | "github">
}

type SkillItem = {
  id: string
  name: string
  description: string
  category: Exclude<SkillCategory, "All">
  iconBg: string
  iconKey: string
  installed?: boolean
  source?: string
  version?: string | null
}

export function SkillPage() {
  const [query, setQuery] = React.useState("")
  const [category, setCategory] = React.useState<SkillCategory>("All")
  const [skills, setSkills] = React.useState<SkillItem[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [meta, setMeta] = React.useState<SkillDiscoverResponse | null>(null)

  React.useEffect(() => {
    let cancelled = false

    async function loadSkills() {
      setLoading(true)
      setError(null)

      if (typeof window === "undefined" || !window.__TAURI_INTERNALS__) {
        setSkills([])
        setMeta(null)
        setError("Desktop runtime not detected, so middleware_skills_discover is unavailable.")
        setLoading(false)
        return
      }

      try {
        const { invoke } = await import("@tauri-apps/api/core")
        const response = await invoke<SkillDiscoverResponse>("middleware_skills_discover", {
          input: {
            query: "",
            limit: 20,
            includeLocal: true,
            includeClawHub: true,
            includeGithubProbe: true,
          },
        })

        if (cancelled) return

        setMeta(response)
        setSkills(response.results.map(mapBackendSkillToItem))
        setLoading(false)
      } catch (err) {
        if (cancelled) return
        console.error("middleware_skills_discover failed", err)
        setSkills([])
        setMeta(null)
        setError("Failed to load skills from middleware_skills_discover.")
        setLoading(false)
      }
    }

    loadSkills()
    return () => {
      cancelled = true
    }
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

      {meta && (
        <div className="mb-5 flex items-center justify-between text-[14px] text-muted-foreground">
          <span>{meta.results.length} skill{meta.results.length === 1 ? "" : "s"} discovered</span>
          <span>Sources: {meta.sources.join(", ")}</span>
        </div>
      )}

      {loading ? (
        <StatePanel text="Loading skills from middleware..." />
      ) : error ? (
        <StatePanel text={error} tone="error" />
      ) : filteredSections.length === 0 ? (
        <StatePanel text="No skills found from middleware_skills_discover for your current filters." />
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
                    <SkillCard key={item.id} item={item} />
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
          "text-[13px] text-foreground outline-none transition-colors hover:border-foreground/20",
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

function SkillCard({ item }: { item: SkillItem }) {
  return (
    <div className="flex items-center gap-3.5 border-b border-border/30 py-4.5">
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
        </div>
        <p className="truncate text-[12px] text-muted-foreground">{item.description}</p>
      </div>

      {item.installed ? (
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground">
          <svg viewBox="0 0 20 20" fill="none" className="size-3.5">
            <path d="m4.5 10 3.5 3.5L15.5 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      ) : (
        <button
          type="button"
          className={cn(
            "flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full",
            "bg-secondary/50 text-foreground transition-colors hover:bg-secondary",
          )}
          aria-label={`Install ${item.name}`}
        >
          <svg viewBox="0 0 20 20" fill="none" className="size-3.5">
            <path d="M10 4.5v11M4.5 10h11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
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

function StatePanel({ text, tone = "default" }: { text: string; tone?: "default" | "error" }) {
  return (
    <div className={cn(
      "rounded-xl border px-5 py-8 text-center",
      tone === "error"
        ? "border-destructive/20 bg-destructive/5"
        : "border-border/50 bg-card",
    )}>
      <p className={cn(
        "text-[13px]",
        tone === "error" ? "text-destructive" : "text-muted-foreground",
      )}>
        {text}
      </p>
    </div>
  )
}

function mapBackendSkillToItem(skill: DiscoveredSkill): SkillItem {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.summary || skill.description || "No description available.",
    category: mapDiscoveredSkillCategory(skill),
    iconBg: getSkillBackground(skill),
    iconKey: getSkillIconKey(skill),
    installed: skill.installed,
    source: skill.source,
    version: skill.version,
  }
}

function mapDiscoveredSkillCategory(skill: DiscoveredSkill): "Recommended" | "System" | "Personal" {
  if (skill.source === "local") return "Personal"

  const tags = skill.tags.map((tag) => tag.toLowerCase())
  if (tags.includes("system") || skill.installed) return "System"

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
  if (skill.slug.toLowerCase().includes("pdf")) return "bg-white"
  if (skill.slug.toLowerCase().includes("docs")) return "bg-[#FFF4EA]"
  return "bg-[#F0F0F0] dark:bg-[#202020]"
}
