export function OpenClawLobsterIcon() {
  return (
    <div className="openclaw-lobster-icon" aria-hidden="true">
      <img
        src="/logo.png"
        alt="OpenClaw"
        width={100}
        height={100}
        style={{ width: "100%", height: "100%", display: "block", objectFit: "contain" }}
      />
    </div>
  )
}

const OPENCLAW_LETTERS = "OpenClaw".split("")

export function OpenClawSplash() {
  return (
    <div className="flex h-dvh min-h-dvh items-center justify-center overflow-hidden bg-background text-foreground">
      <div className="flex flex-col items-center gap-5" role="status" aria-live="polite" aria-label="OpenClaw">
        <OpenClawLobsterIcon />
        <p className="openclaw-splash-title" aria-label="OpenClaw">
          {OPENCLAW_LETTERS.map((letter, index) => (
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
  )
}
