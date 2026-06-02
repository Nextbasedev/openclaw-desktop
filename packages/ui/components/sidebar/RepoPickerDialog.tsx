export function RepoPickerDialog({
  open,
  onOpenChange,
  onClose,
}: {
  open: boolean
  onOpenChange?: (open: boolean) => void
  onClose?: () => void
  onSelect?: (repo: { name: string; path: string }) => void | Promise<void>
}) {
  if (!open) return null
  const close = () => {
    onOpenChange?.(false)
    onClose?.()
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={close}>
      <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground" onClick={(event) => event.stopPropagation()}>
        Repo picker removed with old sidebar UI.
      </div>
    </div>
  )
}
