"use client"

interface Props {
  barCount?: number
  className?: string
}

export function VoiceWaveIcon({ barCount = 5, className }: Props) {
  const barWidth = 3
  const barGap = 1.5
  const totalWidth = barCount * barWidth + (barCount - 1) * barGap
  const height = 20

  return (
    <svg
      width={totalWidth}
      height={height}
      viewBox={`0 0 ${totalWidth} ${height}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {Array.from({ length: barCount }).map((_, i) => {
        const x = i * (barWidth + barGap)
        const delay = i * 0.15
        return (
          <rect
            key={i}
            x={x}
            y={(height - 8) / 2}
            width={barWidth}
            height={8}
            rx={1.5}
            fill="currentColor"
            style={{
              animation: `voiceWave 1.2s ease-in-out ${delay}s infinite`,
              transformOrigin: "center",
              transformBox: "fill-box",
            }}
          />
        )
      })}
      <style>{`
        @keyframes voiceWave {
          0%, 100% { transform: scaleY(0.5); }
          50% { transform: scaleY(1.5); }
        }
      `}</style>
    </svg>
  )
}
