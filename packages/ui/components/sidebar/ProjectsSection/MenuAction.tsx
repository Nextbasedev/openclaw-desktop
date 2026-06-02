import type { ReactNode } from "react"

export function MenuAction({
  children,
  label,
  icon,
  onClick,
  disabled,
  danger,
}: {
  children?: ReactNode
  label?: string
  icon?: ReactNode
  onClick?: () => void
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={danger
        ? "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-red-400 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50"
        : "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground hover:bg-secondary/60 disabled:cursor-not-allowed disabled:opacity-50"}
    >
      {icon}
      {children ?? label}
    </button>
  )
}
