"use client"

import { Header } from "@/common/Header"
import { Sidebar } from "@/components/sidebar"
import { Footer } from "@/components/Footer"

export default function Page() {
  return (
    <div className="flex h-svh flex-col bg-background">
      <Header />

      {/* Content area: sidebar + main */}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />

        {/* Main content area */}
        <main className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-center">
            <span className="text-4xl">🤖</span>
            <h1 className="text-base font-semibold text-foreground">
              OpenClaw Desktop
            </h1>
            <p className="text-sm text-muted-foreground">
              Neural Operations Center — Ready
            </p>
          </div>
        </main>
      </div>

      <Footer />
    </div>
  )
}
