"use client"

import * as React from "react"
import { Icons } from "@/components/icons"
import { cn } from "@/lib/utils"

type SkillCategory = "All" | "Recommended" | "System" | "Personal"

type SkillItem = {
  id: string
  name: string
  description: string
  category: Exclude<SkillCategory, "All">
  iconBg: string
  iconContent: React.ReactNode
  installed?: boolean
}

type SkillSection = {
  title: Exclude<SkillCategory, "All">
  items: SkillItem[]
}

type SkillPageProps = {
  data?: SkillSection[]
}

const DEFAULT_SKILL_DATA: SkillSection[] = [
  {
    title: "Recommended",
    items: [
      {
        id: "sora",
        name: "Sora",
        description: "Generate, edit, extend, and manage Sora content.",
        category: "Recommended",
        iconBg: "bg-[#0E5BC9]",
        iconContent: <span className="text-base">👻</span>,
      },
      {
        id: "pdf",
        name: "PDF",
        description: "Create, edit, and review PDFs.",
        category: "Recommended",
        iconBg: "bg-white",
        iconContent: <span className="text-[10px] font-bold text-[#F04A46]">PDF</span>,
      },
      {
        id: "doc",
        name: "Doc",
        description: "Edit and review docx files.",
        category: "Recommended",
        iconBg: "bg-[#ECECEC]",
        iconContent: <span className="text-lg">📄</span>,
      },
      {
        id: "playwright",
        name: "Playwright",
        description: "Automate real browsers from the terminal.",
        category: "Recommended",
        iconBg: "bg-[#F0F0F0]",
        iconContent: <span className="text-lg">🧪</span>,
      },
    ],
  },
  {
    title: "System",
    items: [
      {
        id: "image-gen",
        name: "Image Gen",
        description: "Generate or edit images for websites, games, and products.",
        category: "System",
        iconBg: "bg-[#2FC3F4]",
        iconContent: <span className="text-lg">🏖️</span>,
        installed: true,
      },
      {
        id: "openai-docs",
        name: "OpenAI Docs",
        description: "Reference official OpenAI docs, including APIs and guides.",
        category: "System",
        iconBg: "bg-[#FFF4EA]",
        iconContent: <span className="text-lg">📖</span>,
        installed: true,
      },
      {
        id: "plugin-creator",
        name: "Plugin Creator",
        description: "Scaffold plugins and marketplace entries.",
        category: "System",
        iconBg: "bg-[#1D1D1D]",
        iconContent: <span className="text-lg">✏️</span>,
        installed: true,
      },
      {
        id: "skill-creator",
        name: "Skill Creator",
        description: "Create or update a skill.",
        category: "System",
        iconBg: "bg-[#1D1D1D]",
        iconContent: <span className="text-lg">✏️</span>,
        installed: true,
      },
      {
        id: "skill-installer",
        name: "Skill Installer",
        description: "Install curated skills from openai/skills or other sources.",
        category: "System",
        iconBg: "bg-[#FFCC47]",
        iconContent: <span className="text-lg">🧩</span>,
        installed: true,
      },
    ],
  },
  {
    title: "Personal",
    items: [
      {
        id: "excel",
        name: "Excel",
        description: "Create and edit spreadsheet or excel files.",
        category: "Personal",
        iconBg: "bg-[#1F3B1E]",
        iconContent: <span className="text-lg text-[#8BE36A]">⊞</span>,
        installed: true,
      },
      {
        id: "powerpoint",
        name: "PowerPoint",
        description: "Create and edit presentation slide decks.",
        category: "Personal",
        iconBg: "bg-[#FFF1E7]",
        iconContent: <span className="text-lg">🖥️</span>,
        installed: true,
      },
    ],
  },
]

export function SkillPage({ data = DEFAULT_SKILL_DATA }: SkillPageProps) {
  const [query, setQuery] = React.useState("")
  const [category, setCategory] = React.useState<SkillCategory>("All")

  const filteredSections = React.useMemo(() => {
    return data
      .map((section) => ({
        ...section,
        items: section.items.filter((item) => {
          const matchesCategory = category === "All" || item.category === category
          const q = query.trim().toLowerCase()
          const matchesQuery =
            q.length === 0 ||
            item.name.toLowerCase().includes(q) ||
            item.description.toLowerCase().includes(q)

          return matchesCategory && matchesQuery
        }),
      }))
      .filter((section) => section.items.length > 0)
  }, [data, query, category])

  return (
    <div className="mx-auto w-full max-w-4xl px-8 py-12">
      <div className="mb-8 text-center">
        <h1 className="text-4xl font-medium tracking-tight text-foreground">
          Make Codex work your way
        </h1>
      </div>

      {/* Search + filter */}
      <div className="mb-9 flex items-center gap-3">
        <div className="relative flex-1">
          <Icons.Search
            size={16}
            strokeWidth={1.7}
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search skills"
            className={cn(
              "h-11 w-full rounded-xl border border-border/60 bg-card pl-11 pr-4",
              "text-sm text-foreground outline-none transition-colors",
              "placeholder:text-muted-foreground/80 focus:border-foreground/20",
            )}
          />
        </div>

        <div className="relative">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as SkillCategory)}
            className={cn(
              "h-11 appearance-none rounded-xl border border-border/60 bg-card px-4 pr-9",
              "text-sm text-foreground outline-none transition-colors focus:border-foreground/20",
            )}
          >
            <option>All</option>
            <option>Recommended</option>
            <option>System</option>
            <option>Personal</option>
          </select>
          <svg
            viewBox="0 0 20 20"
            fill="none"
            className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          >
            <path d="m5 7.5 5 5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>

      <div className="space-y-9">
        {filteredSections.map((section) => (
          <section key={section.title}>
            <h2 className="mb-4 text-[15px] font-medium text-foreground">
              {section.title}
            </h2>

            <div className="border-t border-border/40">
              <div className="grid grid-cols-1 gap-x-10 md:grid-cols-2">
                {section.items.map((item) => (
                  <SkillCard key={item.id} item={item} />
                ))}
              </div>
            </div>
          </section>
        ))}

        {filteredSections.length === 0 && (
          <div className="rounded-2xl border border-border/50 bg-card px-6 py-10 text-center">
            <p className="text-sm text-muted-foreground">
              No skills found for your current filters.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function SkillCard({ item }: { item: SkillItem }) {
  return (
    <div className="flex items-center gap-4 border-b border-border/30 py-6">
      <div
        className={cn(
          "flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-xl",
          item.iconBg,
        )}
      >
        {item.iconContent}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-medium text-foreground">
          {item.name}
        </p>
        <p className="truncate text-sm text-muted-foreground">
          {item.description}
        </p>
      </div>

      {item.installed ? (
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-transparent text-muted-foreground">
          <svg viewBox="0 0 20 20" fill="none" className="size-4">
            <path d="m4.5 10 3.5 3.5L15.5 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      ) : (
        <button
          type="button"
          className={cn(
            "flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full",
            "bg-secondary/50 text-foreground transition-colors hover:bg-secondary",
          )}
          aria-label={`Install ${item.name}`}
        >
          <svg viewBox="0 0 20 20" fill="none" className="size-4">
            <path d="M10 4.5v11M4.5 10h11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    </div>
  )
}
