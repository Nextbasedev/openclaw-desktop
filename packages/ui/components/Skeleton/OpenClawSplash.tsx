export function OpenClawLobsterIcon() {
  return (
    <div className="openclaw-lobster-icon" aria-hidden="true">
      <svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          className="openclaw-lobster-body"
          d="M60 10 C30 10 15 35 15 55 C15 75 30 95 45 100 L45 110 L55 110 L55 100 C55 100 60 102 65 100 L65 110 L75 110 L75 100 C90 95 105 75 105 55 C105 35 90 10 60 10Z"
          fill="url(#openclaw-lobster-gradient)"
        />
        <path
          className="openclaw-lobster-left-claw"
          d="M20 45 C5 40 0 50 5 60 C10 70 20 65 25 55 C28 48 25 45 20 45Z"
          fill="url(#openclaw-lobster-gradient)"
        />
        <path
          className="openclaw-lobster-right-claw"
          d="M100 45 C115 40 120 50 115 60 C110 70 100 65 95 55 C92 48 95 45 100 45Z"
          fill="url(#openclaw-lobster-gradient)"
        />
        <path
          className="openclaw-lobster-antenna openclaw-lobster-antenna-left"
          d="M45 15 Q35 5 30 8"
          stroke="#ff5a50"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path
          className="openclaw-lobster-antenna openclaw-lobster-antenna-right"
          d="M75 15 Q85 5 90 8"
          stroke="#ff5a50"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <circle cx="45" cy="35" r="6" fill="#050810" />
        <circle cx="75" cy="35" r="6" fill="#050810" />
        <circle className="openclaw-lobster-eye-glow" cx="46" cy="34" r="2" fill="#00e5cc" />
        <circle className="openclaw-lobster-eye-glow" cx="76" cy="34" r="2" fill="#00e5cc" />
        <defs>
          <linearGradient id="openclaw-lobster-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#ff5a50" />
            <stop offset="100%" stopColor="#991b1b" />
          </linearGradient>
        </defs>
      </svg>
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
