import { Geist, Geist_Mono, JetBrains_Mono } from "next/font/google"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ToastProvider } from "@/components/ToastProvider"
import { QueryProvider } from "@/components/QueryProvider"
import { cn } from "@/lib/utils";

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
})

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
})

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        "antialiased",
        geistSans.variable,
        geistMono.variable,
        jetbrainsMono.variable,
        "font-sans",
      )}
    >
      <body>
        <ThemeProvider>
          <QueryProvider>
            <TooltipProvider delayDuration={0}>{children}</TooltipProvider>
            <ToastProvider />
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
