"use client"

const MESSAGE_COUNT = 2000

export default function PlainDivAuditPage() {
  const items = Array.from({ length: MESSAGE_COUNT }, (_, i) => i)

  return (
    <main className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <div className="flex-1 overflow-y-auto [overflow-anchor:none]" data-plain-container="true">
        <div className="flex flex-col gap-2 p-4">
          {items.map((i) => (
            <div key={i} className="rounded border p-2" data-row-index={i}>
              <p>Item {i}: Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.</p>
              <p>More content for item {i} with some additional text to make it taller and more realistic.</p>
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}
