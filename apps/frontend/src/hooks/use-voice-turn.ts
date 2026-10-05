// Orchestrates a voice turn: record -> stop -> send -> stream into the chat store.
// Once recording stops, it's effectively a text turn - the answer streams into the
// same history/isStreaming machinery useChat uses.

import { useCallback, useEffect, useRef, useState } from 'react'
import { EngineError, toOpenAIMessages } from '@/lib/chat-client'
import { useChatStore } from '@/lib/chat-store'
import { blobToBase64, MicRecorder } from '@/lib/mic-recorder'
import { readVoiceDeltas, requestVoiceCompletion } from '@/lib/voice-client'

export type VoicePhase =
  | { type: 'idle' }
  | { type: 'recording' }
  | { type: 'processing' }
  | { type: 'error'; message: string }

export function useVoiceTurn() {
  const [phase, setPhase] = useState<VoicePhase>({ type: 'idle' })
  const recorderRef = useRef<MicRecorder | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  // Guards against two start() calls before the first setPhase('recording') re-renders.
  const startingRef = useRef(false)
  const mountedRef = useRef(true)
  // Indirection so the recording bar can register its level handler before it's mounted.
  const levelListenerRef = useRef<((level: number) => void) | null>(null)
  const setLevelListener = useCallback((fn: ((level: number) => void) | null) => {
    levelListenerRef.current = fn
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      // Cancels even mid-getUserMedia-permission-prompt; start() re-checks mountedRef once it resolves.
      void recorderRef.current?.cancel()
      abortRef.current?.abort()
    }
  }, [])

  const start = useCallback(async () => {
    if (startingRef.current || recorderRef.current) return
    startingRef.current = true
    // Talking over an answer that is still playing interrupts it - and
    // keeps the mic from recording the assistant's own voice.
    useChatStore.getState().speechStopped()

    const recorder = new MicRecorder()
    // Set before getUserMedia resolves so the unmount cleanup above can still cancel it.
    recorderRef.current = recorder

    try {
      await recorder.start((level) => levelListenerRef.current?.(level))
    } catch {
      startingRef.current = false
      if (recorderRef.current === recorder) recorderRef.current = null
      await recorder.cancel()
      if (mountedRef.current) setPhase({ type: 'error', message: 'Could not access the microphone.' })
      return
    }

    startingRef.current = false

    if (!mountedRef.current) {
      await recorder.cancel()
      return
    }

    setPhase({ type: 'recording' })
  }, [])

  const stopAndSend = useCallback(async () => {
    const recorder = recorderRef.current
    if (!recorder) return
    recorderRef.current = null
    // Stamped now so a mid-flight New chat is detected as "stale" below.
    const sessionId = useChatStore.getState().sessionId
    setPhase({ type: 'processing' })

    const controller = new AbortController()
    abortRef.current = controller
    const userMessageId = crypto.randomUUID()
    const assistantMessageId = crypto.randomUUID()
    // Before this is true, a failure shows in the composer's error banner; after, it's responseFailed like a text turn.
    let turnStarted = false

    try {
      // stop() is inside this try too: if WAV encoding throws, it must still fall through to
      // the catch instead of leaving the phase stuck on 'processing' forever.
      const blob = await recorder.stop()
      if (!blob) {
        if (mountedRef.current) setPhase({ type: 'idle' })
        return
      }

      // Read before voiceTurnStarted: must carry history as it was, not the pair about to be added.
      const priorHistory = useChatStore.getState().history

      // Message pair goes in before the network call, not after headers arrive: the dev proxy only
      // forwards headers together with the first SSE event, which would delay the thinking-dots.
      turnStarted = true
      useChatStore.getState().voiceTurnStarted(userMessageId, assistantMessageId)
      useChatStore.getState().activeTurnStarted(controller)
      if (mountedRef.current) setPhase({ type: 'idle' })

      const audioBase64 = await blobToBase64(blob)
      const messages = await toOpenAIMessages(priorHistory)
      const body = await requestVoiceCompletion({ messages, audioBase64, signal: controller.signal })

      if (useChatStore.getState().sessionId !== sessionId) return // New chat: this turn's messages are already gone

      for await (const delta of readVoiceDeltas(body)) {
        if (useChatStore.getState().sessionId !== sessionId) return

        if (delta.type === 'audio') {
          useChatStore.getState().chunkReceived(assistantMessageId, delta.text)
          if (delta.audioDataUrl !== undefined) {
            useChatStore.getState().voiceAudioChunkReceived(assistantMessageId, delta.audioDataUrl)
          }
        } else if (delta.type === 'done') {
          useChatStore.getState().toolsReceived(assistantMessageId, delta.tools)
          useChatStore.getState().voiceTranscriptReceived(userMessageId, delta.transcript)
          useChatStore.getState().citationsReceived(assistantMessageId, delta.citations)
          if (delta.context) useChatStore.getState().contextUsageReceived(delta.context)
        } else {
          useChatStore.getState().responseFailed(assistantMessageId, delta.error)
          return
        }
      }
      useChatStore.getState().responseFinished(assistantMessageId)
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // Aborted on purpose (unmount, New chat, Stop button) - not an error.
        if (turnStarted) useChatStore.getState().responseFinished(assistantMessageId)
        if (mountedRef.current) setPhase({ type: 'idle' })
        return
      }
      if (turnStarted) {
        useChatStore.getState().responseFailed(assistantMessageId, voiceErrorMessage(err))
        if (mountedRef.current) setPhase({ type: 'idle' })
      } else if (mountedRef.current) {
        setPhase({ type: 'error', message: voiceErrorMessage(err) })
      }
    } finally {
      abortRef.current = null
      if (turnStarted) useChatStore.getState().activeTurnSettled(controller)
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

  /** Drops whatever voice turn is in progress - a recording or an audio already sent. Safe to call when idle. */
  const cancel = useCallback(async () => {
    abortRef.current?.abort()
    const recorder = recorderRef.current
    recorderRef.current = null
    await recorder?.cancel()
    if (mountedRef.current) setPhase({ type: 'idle' })
  }, [])

  // A sessionId change (New chat) cancels whatever voice turn is in progress.
  useEffect(
    () =>
      useChatStore.subscribe((state, previous) => {
        if (state.sessionId !== previous.sessionId) void cancel()
      }),
    [cancel],
  )

  return { phase, start, send: stopAndSend, discard, setLevelListener }
}

/** Failures of the request itself. "No speech detected" arrives later as a 'error' SSE delta instead (see stopAndSend's loop), since headers are already committed by the time it's known. */
function voiceErrorMessage(err: unknown): string {
  if (err instanceof EngineError && err.status === 503) return 'The model is not ready yet.'
  if (err instanceof EngineError) return err.message
  return 'Could not send the audio.'
}
