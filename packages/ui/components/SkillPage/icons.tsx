import * as React from "react"
import { cn } from "@/lib/utils"

export function SkillGhostIcon({ className }: { className?: string }) {
  return <span className={cn("text-[13px]", className)}>👻</span>
}

export function SkillPdfIcon({ className }: { className?: string }) {
  return (
    <span className={cn("text-[9px] font-bold tracking-tight text-[#F04A46]", className)}>
      PDF
    </span>
  )
}

export function SkillDocIcon({ className }: { className?: string }) {
  return <span className={cn("text-[13px]", className)}>📄</span>
}

export function SkillLabIcon({ className }: { className?: string }) {
  return <span className={cn("text-[13px]", className)}>🧪</span>
}

export function SkillImageIcon({ className }: { className?: string }) {
  return <span className={cn("text-[13px]", className)}>🏖️</span>
}

export function SkillBookIcon({ className }: { className?: string }) {
  return <span className={cn("text-[13px]", className)}>📖</span>
}

export function SkillPencilIcon({ className }: { className?: string }) {
  return <span className={cn("text-[13px]", className)}>✏️</span>
}

export function SkillPuzzleIcon({ className }: { className?: string }) {
  return <span className={cn("text-[13px]", className)}>🧩</span>
}

export function SkillExcelIcon({ className }: { className?: string }) {
  return <span className={cn("text-[13px] text-[#8BE36A]", className)}>⊞</span>
}

export function SkillSlidesIcon({ className }: { className?: string }) {
  return <span className={cn("text-[13px]", className)}>🖥️</span>
}
