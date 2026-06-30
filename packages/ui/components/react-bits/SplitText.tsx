"use client"

import { useEffect, useRef, useState, type CSSProperties, type ElementType } from "react"
import { gsap } from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"
import { SplitText as GSAPSplitText } from "gsap/SplitText"
import { useGSAP } from "@gsap/react"
import "./SplitText.css"

gsap.registerPlugin(ScrollTrigger, GSAPSplitText, useGSAP)

type SplitTarget = "chars" | "words" | "lines" | "words, chars"
type GsapVars = gsap.TweenVars

type SplitTextProps = {
  tag?: ElementType
  text?: string
  className?: string
  delay?: number
  duration?: number
  ease?: string
  splitType?: SplitTarget
  from?: GsapVars
  to?: GsapVars
  threshold?: number
  rootMargin?: string
  textAlign?: CSSProperties["textAlign"]
  onLetterAnimationComplete?: () => void
}

type SplitElement = HTMLElement & {
  _rbsplitInstance?: GSAPSplitText | null
}

function assignTargets(split: GSAPSplitText, splitType: SplitTarget): Element[] {
  let targets: Element[] | undefined

  if (splitType.includes("chars") && split.chars.length) targets = split.chars
  if (!targets && splitType.includes("words") && split.words.length) targets = split.words
  if (!targets && splitType.includes("lines") && split.lines.length) targets = split.lines
  if (!targets) targets = split.chars.length ? split.chars : split.words.length ? split.words : split.lines

  return targets
}

function getScrollStart(threshold: number, rootMargin: string) {
  const clampedThreshold = Math.max(0, Math.min(1, threshold))
  const startPct = (1 - clampedThreshold) * 100
  const marginMatch = /^(-?\d+(?:\.\d+)?)(px|em|rem|%)?$/.exec(rootMargin.trim())
  const marginValue = marginMatch ? Number.parseFloat(marginMatch[1]) : 0
  const marginUnit = marginMatch?.[2] || "px"
  const sign = marginValue === 0
    ? ""
    : marginValue < 0
      ? `-=${Math.abs(marginValue)}${marginUnit}`
      : `+=${marginValue}${marginUnit}`

  return `top ${startPct}%${sign}`
}

export default function SplitText({
  text = "",
  className = "",
  delay = 50,
  duration = 1.25,
  ease = "power3.out",
  splitType = "chars",
  from = { opacity: 0, y: 40 },
  to = { opacity: 1, y: 0 },
  threshold = 0.1,
  rootMargin = "-100px",
  textAlign = "center",
  tag: Tag = "p",
  onLetterAnimationComplete,
}: SplitTextProps) {
  const ref = useRef<SplitElement | null>(null)
  const animationCompletedRef = useRef(false)
  const onCompleteRef = useRef(onLetterAnimationComplete)
  const [fontsLoaded, setFontsLoaded] = useState(false)
  const fromKey = JSON.stringify(from)
  const toKey = JSON.stringify(to)

  useEffect(() => {
    onCompleteRef.current = onLetterAnimationComplete
  }, [onLetterAnimationComplete])

  useEffect(() => {
    animationCompletedRef.current = false
  }, [text, splitType, fromKey, toKey])

  useEffect(() => {
    let cancelled = false
    const fonts = document.fonts

    if (!fonts || fonts.status === "loaded") {
      setFontsLoaded(true)
      return
    }

    fonts.ready.then(() => {
      if (!cancelled) setFontsLoaded(true)
    })

    return () => {
      cancelled = true
    }
  }, [])

  useGSAP(
    () => {
      if (!ref.current || !text || !fontsLoaded) return
      if (animationCompletedRef.current) return

      const el = ref.current
      const start = getScrollStart(threshold, rootMargin)
      let tween: gsap.core.Tween | undefined

      if (el._rbsplitInstance) {
        try {
          el._rbsplitInstance.revert()
        } catch {
          // noop
        }
        el._rbsplitInstance = null
      }

      const splitInstance = new GSAPSplitText(el, {
        type: splitType,
        smartWrap: true,
        autoSplit: splitType === "lines",
        linesClass: "split-line",
        wordsClass: "split-word",
        charsClass: "split-char",
        reduceWhiteSpace: false,
        onSplit: (self) => {
          const targets = assignTargets(self, splitType)
          if (!targets.length) return

          const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
          if (prefersReducedMotion) {
            gsap.set(targets, to)
            animationCompletedRef.current = true
            onCompleteRef.current?.()
            return
          }

          tween = gsap.fromTo(
            targets,
            { ...from },
            {
              ...to,
              duration,
              ease,
              stagger: delay / 1000,
              scrollTrigger: {
                trigger: el,
                start,
                once: true,
                fastScrollEnd: true,
                anticipatePin: 0.4,
              },
              onComplete: () => {
                animationCompletedRef.current = true
                onCompleteRef.current?.()
              },
              willChange: "transform, opacity",
              force3D: true,
            },
          )
        },
      })

      el._rbsplitInstance = splitInstance

      return () => {
        tween?.kill()
        ScrollTrigger.getAll().forEach((scrollTrigger) => {
          if (scrollTrigger.trigger === el) scrollTrigger.kill()
        })
        try {
          splitInstance.revert()
        } catch {
          // noop
        }
        el._rbsplitInstance = null
      }
    },
    {
      scope: ref,
      dependencies: [text, delay, duration, ease, splitType, fromKey, toKey, threshold, rootMargin, fontsLoaded],
    },
  )

  return (
    <Tag
      ref={ref}
      className={`split-parent ${className}`.trim()}
      style={{
        textAlign,
        overflow: "hidden",
        display: "inline-block",
        whiteSpace: "normal",
        wordWrap: "break-word",
        willChange: "transform, opacity",
      }}
    >
      {text}
    </Tag>
  )
}
