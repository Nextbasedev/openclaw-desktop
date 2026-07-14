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

const HIDE_SEEN_PREHYDRATION_SPLASH_SCRIPT = `
try {
  if (document.documentElement.dataset.openclawSplashSeen === "true") {
    var splash = document.getElementById("openclaw-prehydration-splash");
    if (splash) splash.style.display = "none";
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
        <div
          id="openclaw-prehydration-splash"
          aria-hidden="true"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 2147483647,
            overflow: "hidden",
            background: "#0b0b0d",
            color: "#f8f8f8",
          }}
        >
          <div
            className="openclaw-prehydration-splash-inner"
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "1.25rem",
            }}
          >
            <div className="openclaw-lobster-icon" style={{ width: 96, height: 96 }}>
              <img
                src="/logo.png"
                alt="OpenClaw"
                width={96}
                height={96}
                style={{ width: "100%", height: "100%", display: "block", objectFit: "contain" }}
              />
            </div>
            <p
              className="openclaw-splash-title"
              aria-label="OpenClaw"
              style={{
                display: "inline-flex",
                alignItems: "baseline",
                overflow: "hidden",
                margin: 0,
                fontSize: "1.5rem",
                fontWeight: 600,
                letterSpacing: "-0.04em",
                lineHeight: 1.1,
              }}
            >
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
        <script dangerouslySetInnerHTML={{ __html: HIDE_SEEN_PREHYDRATION_SPLASH_SCRIPT }} />
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
