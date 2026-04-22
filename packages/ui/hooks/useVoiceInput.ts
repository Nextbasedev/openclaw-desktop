"use client"

import { useCallback, useEffect, useRef, useState } from "react"

export type VoiceInputState = "idle" | "listening" | "processing" | "error"

export interface VoiceInputOptions {
  onTranscript?: (text: string) => void
  onInterim?: (text: string) => void
  onError?: (message: string) => void
}

export interface VoiceInputResult {
  state: VoiceInputState
  interimTranscript: string
  isSupported: boolean
  error: string | null
  start: () => void
  stop: () => void
  toggle: () => void
}

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList
  resultIndex: number
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string
  message: string
}

interface SpeechRecognitionResultList {
  length: number
  item(index: number): SpeechRecognitionResult
  [index: number]: SpeechRecognitionResult
}

interface SpeechRecognitionResult {
  isFinal: boolean
  length: number
  item(index: number): SpeechRecognitionAlternative
  [index: number]: SpeechRecognitionAlternative
}

interface SpeechRecognitionAlternative {
  transcript: string
  confidence: number
}

interface SpeechRecognitionInstance extends EventTarget {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start(): void
  stop(): void
  abort(): void
  onresult: ((event: SpeechRecognitionEvent) => void) | null
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null
  onend: (() => void) | null
  onstart: (() => void) | null
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionInstance
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance
  }
}

function getSpeechRecognition(): (new () => SpeechRecognitionInstance) | null {
  if (typeof window === "undefined") return null
  return window.SpeechRecognition || window.webkitSpeechRecognition || null
}

export function useVoiceInput(options?: VoiceInputOptions): VoiceInputResult {
  const [state, setState] = useState<VoiceInputState>("idle")
  const [interimTranscript, setInterimTranscript] = useState("")
  const [error, setError] = useState<string | null>(null)
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)
  const isSupported = getSpeechRecognition() !== null
  const optionsRef = useRef(options)
  optionsRef.current = options

  const cleanup = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort()
      } catch {
        // ignore
      }
      recognitionRef.current = null
    }
  }, [])

  const start = useCallback(() => {
    const SpeechRecognitionCtor = getSpeechRecognition()
    if (!SpeechRecognitionCtor) {
      setError("Speech recognition is not supported in this browser")
      setState("error")
      optionsRef.current?.onError?.("Speech recognition is not supported in this browser")
      return
    }

    cleanup()
    setError(null)
    setInterimTranscript("")
    setState("listening")

    const recognition = new SpeechRecognitionCtor()
    recognition.lang = "en-US"
    recognition.continuous = true
    recognition.interimResults = true
    recognition.maxAlternatives = 1

    recognition.onstart = () => {
      setState("listening")
    }

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let finalText = ""
      let interimText = ""

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (result.isFinal) {
          finalText += result[0].transcript
        } else {
          interimText += result[0].transcript
        }
      }

      if (finalText) {
        optionsRef.current?.onTranscript?.(finalText)
      }
      setInterimTranscript(interimText)
      if (interimText) {
        optionsRef.current?.onInterim?.(interimText)
      }
    }

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === "aborted" || event.error === "no-speech") {
        // User stopped or no speech detected — not a real error
        return
      }
      const friendly =
        event.error === "not-allowed"
          ? "Microphone access denied. Please allow microphone permission."
          : event.error === "network"
            ? "Network error. Please check your connection."
            : event.error === "audio-capture"
              ? "No microphone found. Please connect a microphone."
              : `Speech recognition error: ${event.error}`
      setError(friendly)
      setState("error")
      optionsRef.current?.onError?.(friendly)
    }

    recognition.onend = () => {
      setState((current) => {
        if (current === "listening") {
          // If we were still listening when onend fired, transition to idle
          return "idle"
        }
        return current
      })
      setInterimTranscript("")
      recognitionRef.current = null
    }

    recognitionRef.current = recognition

    try {
      recognition.start()
    } catch (e) {
      const msg = "Failed to start speech recognition"
      setError(msg)
      setState("error")
      optionsRef.current?.onError?.(msg)
      recognitionRef.current = null
    }
  }, [cleanup])

  const stop = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop()
      } catch {
        // ignore
      }
    }
    setState("idle")
    setInterimTranscript("")
  }, [])

  const toggle = useCallback(() => {
    if (state === "listening") {
      stop()
    } else {
      start()
    }
  }, [state, start, stop])

  useEffect(() => {
    return () => {
      cleanup()
    }
  }, [cleanup])

  return {
    state,
    interimTranscript,
    isSupported,
    error,
    start,
    stop,
    toggle,
  }
}
