"use client"

type PlaceholderTabProps = {
  title: string
  description?: string
}

export function PlaceholderTab({ title, description }: PlaceholderTabProps) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="flex items-center justify-center rounded-xl border border-dashed border-border/50 bg-muted/10 py-16">
        <p className="text-sm text-muted-foreground">Coming soon</p>
      </div>
    </div>
  )
}
