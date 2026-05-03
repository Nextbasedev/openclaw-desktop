"use client"

import { cn } from "@/lib/utils"
import { LuFileCode, LuTerminal } from "react-icons/lu"
import {
  DiHtml5 as DiHtml, DiCss3 as DiCss, DiJavascript1 as DiJavascript,
  DiPython, DiRuby, DiRust, DiGo, DiJava, DiPhp, DiSwift,
  DiReact, DiMarkdown, DiDocker, DiSass, DiLess, DiTerminal,
} from "react-icons/di"
import {
  SiTypescript, SiKotlin, SiGraphql, SiCplusplus, SiToml, SiYaml,
} from "react-icons/si"

function BracesIcon({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg className={className} style={style} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 3H6a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h2" />
      <path d="M16 3h2a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2 2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-2" />
    </svg>
  )
}

const LANG_ICONS: Record<string, { icon: React.ElementType; color: string }> = {
  html: { icon: DiHtml, color: "#E44D26" },
  css: { icon: BracesIcon, color: "#519ABA" },
  scss: { icon: DiSass, color: "#CC6699" },
  sass: { icon: DiSass, color: "#CC6699" },
  less: { icon: DiLess, color: "#1D365D" },
  js: { icon: DiJavascript, color: "#F7DF1E" },
  javascript: { icon: DiJavascript, color: "#F7DF1E" },
  ts: { icon: SiTypescript, color: "#3178C6" },
  typescript: { icon: SiTypescript, color: "#3178C6" },
  tsx: { icon: DiReact, color: "#61DAFB" },
  jsx: { icon: DiReact, color: "#61DAFB" },
  py: { icon: DiPython, color: "#3776AB" },
  python: { icon: DiPython, color: "#3776AB" },
  rb: { icon: DiRuby, color: "#CC342D" },
  ruby: { icon: DiRuby, color: "#CC342D" },
  rs: { icon: DiRust, color: "#DEA584" },
  rust: { icon: DiRust, color: "#DEA584" },
  go: { icon: DiGo, color: "#00ADD8" },
  java: { icon: DiJava, color: "#ED8B00" },
  kotlin: { icon: SiKotlin, color: "#7F52FF" },
  cpp: { icon: SiCplusplus, color: "#00599C" },
  c: { icon: LuFileCode, color: "#A8B9CC" },
  cs: { icon: LuFileCode, color: "#68217A" },
  csharp: { icon: LuFileCode, color: "#68217A" },
  php: { icon: DiPhp, color: "#777BB4" },
  swift: { icon: DiSwift, color: "#FA7343" },
  sh: { icon: DiTerminal, color: "#89E051" },
  bash: { icon: DiTerminal, color: "#89E051" },
  zsh: { icon: DiTerminal, color: "#89E051" },
  powershell: { icon: LuTerminal, color: "#012456" },
  ps1: { icon: LuTerminal, color: "#012456" },
  sql: { icon: LuFileCode, color: "#E38C00" },
  json: { icon: BracesIcon, color: "#CBCB41" },
  yaml: { icon: SiYaml, color: "#CB171E" },
  yml: { icon: SiYaml, color: "#CB171E" },
  xml: { icon: LuFileCode, color: "#E44D26" },
  toml: { icon: SiToml, color: "#9C4121" },
  md: { icon: DiMarkdown, color: "#FFFFFF" },
  markdown: { icon: DiMarkdown, color: "#FFFFFF" },
  graphql: { icon: SiGraphql, color: "#E10098" },
  docker: { icon: DiDocker, color: "#2496ED" },
  dockerfile: { icon: DiDocker, color: "#2496ED" },
}

export function LanguageIcon({ lang, className }: { lang?: string; className?: string }) {
  const cls = className ?? "size-3.5"
  const entry = lang ? LANG_ICONS[lang.toLowerCase()] : undefined
  if (entry) {
    const Icon = entry.icon
    return <Icon className={cls} style={{ color: entry.color }} />
  }
  return (
    <span className={cn("font-mono text-[10px] leading-none text-foreground/40", cls)}>
      &lt;/&gt;
    </span>
  )
}
