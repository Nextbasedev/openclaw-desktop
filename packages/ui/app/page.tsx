"use client"

import { Header } from "@/common/Header"
import { Sidebar } from "@/components/sidebar"
import { Footer } from "@/components/Footer"
import { ChatBox } from "@/components/ChatBox"

export default function Page() {
  return (
    <div className="flex h-svh flex-col bg-background">
      <Header />

      {/* Content area: sidebar + main */}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />

        {/* Main content area */}
        <main className="flex flex-1 flex-col">
          {/* Message area (future) */}
          <div className="flex-1" />

          {/* Chat input */}
          <div className="pb-4">
            <ChatBox />
          </div>
        </main>
      </div>

      <Footer />
    </div>
  )
}
