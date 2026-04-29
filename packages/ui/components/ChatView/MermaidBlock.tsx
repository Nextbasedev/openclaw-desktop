"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { LuCopy, LuCheck } from "react-icons/lu"
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter"
import oneDark from "react-syntax-highlighter/dist/esm/styles/prism/one-dark"

const cleanStyle: Record<string, React.CSSProperties> = Object.fromEntries(
  Object.entries(oneDark).map(([key, val]) => {
    if (typeof val === "object" && val !== null) {
      const { background, backgroundColor, ...rest } = val as Record<string, unknown>
      return [key, rest as React.CSSProperties]
    }
    return [key, val]
  }),
)

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [text])
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="flex size-6 cursor-pointer items-center justify-center rounded-md text-foreground/25 transition-colors hover:text-foreground/50"
    >
      {copied ? <LuCheck className="size-3.5" /> : <LuCopy className="size-3.5" />}
    </button>
  )
}

let mermaidId = 0

export function MermaidBlock({ code }: { code: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showDiagram, setShowDiagram] = useState(false)

  useEffect(() => {
    let cancelled = false
    import("mermaid").then((mod) => {
      const mermaid = mod.default
      mermaid.initialize({
        startOnLoad: false,
        theme: "dark",
        darkMode: true,
        fontFamily: "inherit",
        themeVariables: {
          primaryColor: "#3b82f6",
          primaryTextColor: "#ffffff",
          primaryBorderColor: "#3b82f680",
          lineColor: "#a1a1aa",
          secondaryColor: "#27272a",
          tertiaryColor: "#1a1a1e",
          background: "#1a1a1e",
          mainBkg: "#27272a",
          nodeBorder: "#3b82f680",
          clusterBkg: "#1a1a1e",
          clusterBorder: "#3b82f640",
          titleColor: "#ffffff",
          edgeLabelBackground: "#27272a",
          nodeTextColor: "#ffffff",
          labelTextColor: "#ffffff",
          signalTextColor: "#ffffff",
          actorTextColor: "#ffffff",
          noteBkgColor: "#27272a",
          noteTextColor: "#ffffff",
          sectionBkgColor: "#27272a",
          altSectionBkgColor: "#1a1a1e",
          taskTextColor: "#ffffff",
          taskTextDarkColor: "#ffffff",
          labelColor: "#ffffff",
        },
      })
      const id = `mermaid-${++mermaidId}`
      return mermaid.render(id, code)
    }).then((result) => {
      if (cancelled) return
      const parser = new DOMParser()
      const doc = parser.parseFromString(result.svg, "image/svg+xml")
      doc.querySelectorAll("text, .nodeLabel, .label, .edgeLabel, tspan").forEach((el) => {
        ;(el as HTMLElement).style.fill = "#ffffff"
        ;(el as HTMLElement).style.color = "#ffffff"
      })
      const svgEl = doc.querySelector("svg")
      if (svgEl) {
        svgEl.removeAttribute("width")
        svgEl.style.minWidth = "600px"
        svgEl.style.height = "auto"
        svgEl.style.fontSize = "18px"
      }
      setSvg(svgEl?.outerHTML ?? result.svg)
    }).catch((err) => {
      if (!cancelled) setError(String(err))
    })
    return () => { cancelled = true }
  }, [code])

  const showingDiagram = showDiagram && svg && !error

  return (
    <div className="group/code relative my-2 min-w-0 overflow-clip rounded-xl border border-border/20 bg-[#1a1a1e]">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border/15 bg-[#252529] px-4 py-2">
        <span className="flex items-center gap-2 text-[12px] font-medium text-foreground/60">
          <span className="text-foreground/40">&lt;/&gt;</span>
          Mermaid
        </span>
        <div className="flex items-center gap-1">
          {svg && !error && (
            <button
              type="button"
              onClick={() => setShowDiagram((v) => !v)}
              className="px-2 py-0.5 text-[11px] rounded-md text-foreground/30 transition-colors hover:text-foreground/60 cursor-pointer"
            >
              {showingDiagram ? "Code" : "Diagram"}
            </button>
          )}
          <CopyBtn text={code} />
        </div>
      </div>
      {showingDiagram ? (
        <div
          ref={containerRef}
          className="w-full overflow-x-auto rounded-b-xl bg-[#1a1a1e] p-6"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <div className="w-full overflow-x-auto rounded-b-xl px-4 py-4">
          <SyntaxHighlighter
            style={cleanStyle}
            language="markdown"
            PreTag="div"
            customStyle={{
              background: "transparent",
              margin: 0,
              padding: "4px 0",
              fontSize: "13px",
              minWidth: 0,
            }}
            codeTagProps={{ style: { background: "transparent" } }}
          >
            {code.replace(/\n$/, "")}
          </SyntaxHighlighter>
        </div>
      )}
    </div>
  )
}
