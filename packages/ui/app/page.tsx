import { ChatBox } from "@/components/chat-box"

export default function Page() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-end bg-background pb-6 text-foreground">
      <ChatBox />
    </main>
  )
}
