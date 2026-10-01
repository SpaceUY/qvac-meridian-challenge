// apps/frontend/src/hooks/use-voice-turn.ts
//
// Orchestrates a voice turn: record -> stop -> send -> resolve into the
// chat store. Sibling of use-chat.ts in shape (only state + refs +
// lifecycle - the real logic lives in mic-recorder.ts and voice-client.ts),
// but here the request/response is a single round trip, not a stream.

import { useCallback, useEffect, useRef, useState } from 'react'
import { EngineError, toOpenAIMessages } from '@/lib/chat-client'
import { useChatStore } from '@/lib/chat-store'
import { blobToBase64, MicRecorder } from '@/lib/mic-recorder'
import { requestVoiceCompletion } from '@/lib/voice-client'

export type VoicePhase =
  | { type: 'idle' }
  | { type: 'recording' }
  | { type: 'processing' }
  | { type: 'error'; message: string }

export function useVoiceTurn() {
  const [phase, setPhase] = useState<VoicePhase>({ type: 'idle' })
  const recorderRef = useRef<MicRecorder | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  // Double-click guard: two quick clicks while 'idle' could fire two
  // start() calls before the first setPhase('recording') re-renders.
  const startingRef = useRef(false)
  const mountedRef = useRef(true)
  // Indirection so the recording bar can register/unregister its level
  // handler without start() needing to know it exists yet - start() is
  // called while still 'idle', before the recording bar has ever mounted.
  const levelListenerRef = useRef<((level: number) => void) | null>(null)
  const setLevelListener = useCallback((fn: ((level: number) => void) | null) => {
    levelListenerRef.current = fn
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      // If getUserMedia is still waiting on the user's permission prompt
      // (can take seconds), this cancels it anyway - start() checks
      // mountedRef once it resolves and won't transition to 'recording'
      // if the component is already gone.
      void recorderRef.current?.cancel()
      abortRef.current?.abort()
    }
  }, [])

  const start = useCallback(async () => {
    if (startingRef.current || recorderRef.current) return
    startingRef.current = true

    const recorder = new MicRecorder()
    // Visible to the unmount cleanup from here already, even though
    // getUserMedia hasn't resolved yet - if the user navigates away while
    // the browser's permission prompt is still open, the effect above can
    // still cancel this instance.
    recorderRef.current = recorder

    try {
      await recorder.start((level) => levelListenerRef.current?.(level))
    } catch {
      startingRef.current = false
      if (recorderRef.current === recorder) recorderRef.current = null
      await recorder.cancel() // in case getUserMedia granted the stream but the AudioContext/Worklet failed afterward
      if (mountedRef.current) setPhase({ type: 'error', message: 'Could not access the microphone.' })
      return
    }

    startingRef.current = false

    if (!mountedRef.current) {
      // Unmounted while we were waiting on the permission prompt - don't
      // transition to 'recording', shut down what just got turned on.
      await recorder.cancel()
      return
    }

    setPhase({ type: 'recording' })
  }, [])

  const stopAndSend = useCallback(async () => {
    const recorder = recorderRef.current
    if (!recorder) return
    recorderRef.current = null
    setPhase({ type: 'processing' })

    const controller = new AbortController()
    abortRef.current = controller

    try {
      // stop() inside the same try: if resampling or WAV encoding throws
      // (not just the network request), it still has to fall through to
      // the catch and leave 'processing' - otherwise the phase gets stuck
      // there forever.
      const blob = await recorder.stop()
      if (!blob) {
        if (mountedRef.current) setPhase({ type: 'idle' })
        return
      }

      const audioBase64 = await blobToBase64(blob)
      const messages = toOpenAIMessages(useChatStore.getState().history)
      const result = await requestVoiceCompletion({ messages, audioBase64, signal: controller.signal })

      useChatStore.getState().voiceTurnAdded({
        userMessageId: crypto.randomUUID(),
        transcript: result.transcript,
        assistantMessageId: crypto.randomUUID(),
        answer: result.answer,
        citations: result.citations,
        audio: result.audioDataUrl ? { dataUrl: result.audioDataUrl } : undefined,
      })
      if (mountedRef.current) setPhase({ type: 'idle' })
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return // unmounted mid-flight, not an error
      if (mountedRef.current) setPhase({ type: 'error', message: voiceErrorMessage(err) })
    } finally {
      abortRef.current = null
    }
  }, [])

  /** Discards a recording in progress without sending it - the user hit cancel. Distinct from stopAndSend: no request, no store update. */
  const discard = useCallback(async () => {
    const recorder = recorderRef.current
    if (!recorder) return
    recorderRef.current = null
    await recorder.cancel()
    if (mountedRef.current) setPhase({ type: 'idle' })
  }, [])

  return { phase, start, send: stopAndSend, discard, setLevelListener }
}

function voiceErrorMessage(err: unknown): string {
  if (err instanceof EngineError && err.status === 503) return 'The model is not ready yet.'
  if (err instanceof EngineError && err.status === 400) return 'No speech detected. Try again.'
  if (err instanceof EngineError) return err.message
  return 'Could not send the audio.'
}
