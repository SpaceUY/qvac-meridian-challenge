// apps/frontend/src/hooks/use-voice-turn.ts
//
// Orchestrates a voice turn: record -> stop -> send -> stream into the chat
// store. Sibling of use-chat.ts in shape (only state + refs + lifecycle -
// the real logic lives in mic-recorder.ts and voice-client.ts) - and, once
// the recording is stopped, IS effectively a text turn: 'processing' only
// covers turning the recording into a WAV. From there the message pair is
// in history (thinking-dots right away) and the answer
// streams into the same `history`/`isStreaming` machinery useChat uses, so
// MessageList's thinking-dots/cursor and the Composer's Stop button work
// for a voice turn with no changes there.

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
    // Talking over an answer that is still playing interrupts it - and
    // keeps the mic from recording the assistant's own voice.
    useChatStore.getState().speechStopped()

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
    // Stamped now: if New chat happens while this is in flight, the answer
    // belongs to a conversation that no longer exists.
    const sessionId = useChatStore.getState().sessionId
    setPhase({ type: 'processing' })

    const controller = new AbortController()
    abortRef.current = controller
    const userMessageId = crypto.randomUUID()
    const assistantMessageId = crypto.randomUUID()
    // Only true once a message pair actually exists in history - before
    // that, a failure (the WAV encoding) is shown in the composer's own
    // error banner. After that point - request included, so "model not
    // ready" too - a failure belongs to the message itself
    // (responseFailed), exactly like a text turn's.
    let turnStarted = false

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

      // Read before voiceTurnStarted: the request must carry the conversation
      // as it was, not the empty pair this turn is about to add.
      const priorHistory = useChatStore.getState().history

      // The message pair goes in now, before any network call - same moment
      // a text turn creates its own. Waiting for the response headers left
      // the chat with no thinking-dots for the whole STT + generation wait:
      // a proxy in between (Vite's, in dev) only forwards the headers
      // together with the first SSE event, i.e. once the first sentence is
      // already synthesized.
      turnStarted = true
      useChatStore.getState().voiceTurnStarted(userMessageId, assistantMessageId)
      useChatStore.getState().activeTurnStarted(controller)
      // From here the turn shows through the shared history/isStreaming
      // state (MessageList's own cursor/thinking-dots), same as a text
      // turn - 'processing' has done its job.
      if (mountedRef.current) setPhase({ type: 'idle' })

      const audioBase64 = await blobToBase64(blob)
      const messages = await toOpenAIMessages(priorHistory)
      const body = await requestVoiceCompletion({ messages, audioBase64, signal: controller.signal })

      if (useChatStore.getState().sessionId !== sessionId) return // New chat while the request was going out: this turn's messages are already gone

      for await (const delta of readVoiceDeltas(body)) {
        if (useChatStore.getState().sessionId !== sessionId) return // New chat mid-stream: this turn's messages are already gone

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
        // Aborted on purpose (unmount, New chat, or the composer's Stop
        // button) - not an error, same as a cancelled text turn.
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

  // New chat replaces sessionId: whatever voice turn is in progress belongs
  // to a conversation that no longer exists. subscribe() returns its own
  // unsubscribe - exactly the cleanup this effect needs.
  useEffect(
    () =>
      useChatStore.subscribe((state, previous) => {
        if (state.sessionId !== previous.sessionId) void cancel()
      }),
    [cancel],
  )

  return { phase, start, send: stopAndSend, discard, setLevelListener }
}

/**
 * Failures of the request itself (bad audio, model not ready, network),
 * shown under the assistant message. "No speech detected" is not one of
 * these - once
 * streaming, headers are already committed by the time that's known, so it
 * arrives as a `type: 'error'` SSE delta instead (see stopAndSend's loop),
 * carrying its own human-readable reason straight from the backend.
 */
function voiceErrorMessage(err: unknown): string {
  if (err instanceof EngineError && err.status === 503) return 'The model is not ready yet.'
  if (err instanceof EngineError) return err.message
  return 'Could not send the audio.'
}
