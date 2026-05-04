"use client"

import { useCallback, useEffect, useRef, useState } from "react"

export type VoiceRecorderState = "idle" | "recording" | "processing" | "error"

export interface VoiceRecorderOptions {
  onAudioFile?: (file: File) => void | Promise<void>
  onError?: (message: string) => void
}

export interface VoiceRecorderResult {
  state: VoiceRecorderState
  isSupported: boolean
  error: string | null
  start: () => Promise<void>
  stop: () => void
  toggle: () => void
}

const RECORDER_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/ogg",
  "audio/mp4",
]

const EXTENSION_BY_MIME: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
}

function getMediaRecorder(): typeof MediaRecorder | null {
  if (typeof window === "undefined") return null
  return window.MediaRecorder ?? null
}

function getUserMedia(): MediaDevices["getUserMedia"] | null {
  if (typeof navigator === "undefined") return null
  return navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices) ?? null
}

function normalizeMimeBase(mimeType: string): string {
  return mimeType.split(";")[0]?.trim().toLowerCase() || "audio/webm"
}

export function resolveRecorderMimeType(
  isTypeSupported: (candidate: string) => boolean,
): string {
  return RECORDER_MIME_CANDIDATES.find((candidate) => isTypeSupported(candidate)) ?? ""
}

export function createRecordedAudioFile(params: {
  chunks: BlobPart[]
  mimeType: string
  now?: () => Date
}): File {
  const mimeType = normalizeMimeBase(params.mimeType || "audio/webm")
  const extension = EXTENSION_BY_MIME[mimeType] ?? "webm"
  const timestamp = (params.now?.() ?? new Date())
    .toISOString()
    .replace(/[:.]/g, "-")
  return new File(params.chunks, `voice-${timestamp}.${extension}`, { type: mimeType })
}

function stopStream(stream: MediaStream | null) {
  for (const track of stream?.getTracks() ?? []) {
    track.stop()
  }
}

export function useVoiceRecorder(options?: VoiceRecorderOptions): VoiceRecorderResult {
  const [state, setState] = useState<VoiceRecorderState>("idle")
  const [error, setError] = useState<string | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const optionsRef = useRef(options)
  const isSupported = getMediaRecorder() !== null && getUserMedia() !== null

  useEffect(() => {
    optionsRef.current = options
  }, [options])

  const fail = useCallback((message: string) => {
    setError(message)
    setState("error")
    optionsRef.current?.onError?.(message)
  }, [])

  const cleanup = useCallback(() => {
    const recorder = recorderRef.current
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop()
      } catch {
        // ignore
      }
    }
    recorderRef.current = null
    stopStream(streamRef.current)
    streamRef.current = null
    chunksRef.current = []
  }, [])

  const start = useCallback(async () => {
    const MediaRecorderCtor = getMediaRecorder()
    const getUserMediaFn = getUserMedia()
    if (!MediaRecorderCtor || !getUserMediaFn) {
      fail("Voice recording is not supported in this app window")
      return
    }

    cleanup()
    setError(null)
    chunksRef.current = []

    let stream: MediaStream
    try {
      stream = await getUserMediaFn({ audio: true })
    } catch (err) {
      const name = err instanceof DOMException ? err.name : ""
      const message = name === "NotAllowedError"
        ? "Microphone access denied. Please allow microphone permission."
        : "Could not access microphone. Please check your audio input."
      fail(message)
      return
    }

    const mimeType = resolveRecorderMimeType((candidate) => MediaRecorderCtor.isTypeSupported(candidate))
    let recorder: MediaRecorder
    try {
      recorder = mimeType
        ? new MediaRecorderCtor(stream, { mimeType })
        : new MediaRecorderCtor(stream)
    } catch {
      stopStream(stream)
      fail("Could not start voice recorder")
      return
    }

    streamRef.current = stream
    recorderRef.current = recorder

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        chunksRef.current.push(event.data)
      }
    }

    recorder.onerror = () => {
      stopStream(streamRef.current)
      streamRef.current = null
      fail("Voice recording failed")
    }

    recorder.onstop = () => {
      const chunks = chunksRef.current
      chunksRef.current = []
      stopStream(streamRef.current)
      streamRef.current = null
      recorderRef.current = null

      if (chunks.length === 0) {
        setState("idle")
        return
      }

      setState("processing")
      const file = createRecordedAudioFile({
        chunks,
        mimeType: recorder.mimeType || mimeType || "audio/webm",
      })

      Promise.resolve(optionsRef.current?.onAudioFile?.(file))
        .then(() => {
          setState("idle")
        })
        .catch(() => {
          fail("Could not attach recorded audio")
        })
    }

    try {
      recorder.start()
      setState("recording")
    } catch {
      stopStream(stream)
      fail("Could not start voice recorder")
    }
  }, [cleanup, fail])

  const stop = useCallback(() => {
    const recorder = recorderRef.current
    if (!recorder || recorder.state === "inactive") {
      setState("idle")
      return
    }
    setState("processing")
    recorder.stop()
  }, [])

  const toggle = useCallback(() => {
    if (state === "recording") {
      stop()
    } else if (state !== "processing") {
      void start()
    }
  }, [state, start, stop])

  useEffect(() => cleanup, [cleanup])

  return {
    state,
    isSupported,
    error,
    start,
    stop,
    toggle,
  }
}
