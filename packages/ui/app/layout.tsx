import { Geist, Geist_Mono, JetBrains_Mono } from "next/font/google"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ToastProvider } from "@/components/ToastProvider"
import { QueryProvider } from "@/components/QueryProvider"
import { cn } from "@/lib/utils";

const PREHYDRATION_SPLASH_SCRIPT = `
try {
  var key = "openclaw.firstOpenSplashSeen.session";
  if (window.sessionStorage && window.sessionStorage.getItem(key) === "true") {
    document.documentElement.dataset.openclawSplashSeen = "true";
  }
} catch (_) {}
`

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
        <script dangerouslySetInnerHTML={{ __html: PREHYDRATION_SPLASH_SCRIPT }} />
        <div id="openclaw-prehydration-splash" aria-hidden="true">
          <div className="openclaw-prehydration-splash-inner">
            <div className="openclaw-lobster-icon">
              <svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  className="openclaw-lobster-body"
                  d="M60 10 C30 10 15 35 15 55 C15 75 30 95 45 100 L45 110 L55 110 L55 100 C55 100 60 102 65 100 L65 110 L75 110 L75 100 C90 95 105 75 105 55 C105 35 90 10 60 10Z"
                  fill="url(#openclaw-prehydration-lobster-gradient)"
                />
                <path
                  className="openclaw-lobster-left-claw"
                  d="M20 45 C5 40 0 50 5 60 C10 70 20 65 25 55 C28 48 25 45 20 45Z"
                  fill="url(#openclaw-prehydration-lobster-gradient)"
                />
                <path
                  className="openclaw-lobster-right-claw"
                  d="M100 45 C115 40 120 50 115 60 C110 70 100 65 95 55 C92 48 95 45 100 45Z"
                  fill="url(#openclaw-prehydration-lobster-gradient)"
                />
                <path className="openclaw-lobster-antenna openclaw-lobster-antenna-left" d="M45 15 Q35 5 30 8" stroke="#ff5a50" strokeWidth="2" strokeLinecap="round" />
                <path className="openclaw-lobster-antenna openclaw-lobster-antenna-right" d="M75 15 Q85 5 90 8" stroke="#ff5a50" strokeWidth="2" strokeLinecap="round" />
                <circle cx="45" cy="35" r="6" fill="#050810" />
                <circle cx="75" cy="35" r="6" fill="#050810" />
                <circle className="openclaw-lobster-eye-glow" cx="46" cy="34" r="2" fill="#00e5cc" />
                <circle className="openclaw-lobster-eye-glow" cx="76" cy="34" r="2" fill="#00e5cc" />
                <defs>
                  <linearGradient id="openclaw-prehydration-lobster-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#ff5a50" />
                    <stop offset="100%" stopColor="#991b1b" />
                  </linearGradient>
                </defs>
              </svg>
            </div>
            <p className="openclaw-splash-title" aria-label="OpenClaw">
              {"OpenClaw".split("").map((letter, index) => (
                <span
                  aria-hidden="true"
                  className="openclaw-splash-letter"
                  key={`${letter}-${index}`}
                  style={{ animationDelay: `${index * 55}ms` }}
                >
                  {letter}
                </span>
              ))}
            </p>
          </div>
        </div>
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
