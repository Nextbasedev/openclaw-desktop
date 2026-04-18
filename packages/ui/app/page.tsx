"use client"

import { Header } from "@/common/Header"
import { Sidebar } from "@/components/sidebar"
import { Footer } from "@/components/Footer"
import { ChatBox } from "@/components/ChatBox"
import { AnimatedGreeting } from "@/components/AnimatedGreeting"

export default function Page() {
  return (
    <div className="flex h-svh flex-col bg-background">
      <Header />

      {/* Content area: sidebar + main */}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />

        {/* Main content area — vertically centered */}
        <main className="flex flex-1 items-center justify-center">
          <div className="flex w-full flex-col items-center gap-8">
            <AnimatedGreeting />
            <ChatBox />
          </div>
        </main>
      </div>

      <Footer />
    </div>
  )
}
