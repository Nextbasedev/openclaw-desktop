import { AdminAccessDemo } from "@/components/admin-access-demo"
import { DesktopChatDemo } from "@/components/desktop-chat-demo"

export default function Page() {
  return (
    <main className="min-h-svh bg-muted/40 px-6 py-10 text-sm text-foreground">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <DesktopChatDemo />
        <AdminAccessDemo />
      </div>
    </main>
  )
}
