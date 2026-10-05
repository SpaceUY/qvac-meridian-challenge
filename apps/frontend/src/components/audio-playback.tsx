// apps/frontend/src/components/audio-playback.tsx
import { useEffect, useRef, useState } from 'react'
import { Pause, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useMirrorRef } from '@/hooks/use-mirror-ref'
import { AudioChunkQueue } from '@/lib/audio-chunk-queue'
import { useChatStore } from '@/lib/chat-store'

type Props = {
  messageId: string
  /** One entry per synthesized sentence. During a live voice turn this array keeps growing - AudioChunkQueue decides when to auto-advance into a chunk that just arrived. */
  chunks: { dataUrl: string }[]
  /** Whether the answer is still arriving - more chunks may come. */
  streaming: boolean
  autoPlay?: boolean
}

/**
 * Play/pause for a message's synthesized audio, one chunk at a time.
 * Autoplay is best-effort: if the browser blocks it, the button stays
 * available regardless, with no error shown. While it plays (or waits for
 * its next chunk) this message is the store's `speakingMessageId`; when
 * something else clears or takes that over - Stop, a new voice turn, New
 * chat - it goes quiet and stops moving on by itself.
 */
export function AudioPlayback({ messageId, chunks, streaming, autoPlay = false }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const queueRef = useRef(new AudioChunkQueue())
  const chunksRef = useMirrorRef(chunks)
  const streamingRef = useMirrorRef(streaming)
  const [loadedIndex, setLoadedIndex] = useState<number | undefined>(undefined)
  const [isPlaying, setIsPlaying] = useState(false)
  const isSpeaking = useChatStore((state) => state.speakingMessageId === messageId)
  const wasSpeakingRef = useRef(false)

  // Runs on mount (first chunk already present) and every time the chunk
  // count grows - decides whether to start playing (autoPlay) or
  // auto-continue into a chunk that just arrived after playback had run out
  // and was waiting for more.
  useEffect(() => {
    const next = queueRef.current.advance(chunks.length, autoPlay)
    if (next !== undefined) setLoadedIndex(next)
  }, [chunks.length, autoPlay])

  // Plays whatever index was just loaded - covers both the initial autoplay
  // and every later auto-advance, without duplicating a .play() call at
  // each call site above.
  useEffect(() => {
    if (loadedIndex !== undefined) audioRef.current?.play().catch(() => {})
  }, [loadedIndex])

  // Losing the floor (speaking -> not speaking, by someone else's hand):
  // go quiet now and don't move on to the next chunk by itself.
  useEffect(() => {
    if (wasSpeakingRef.current && !isSpeaking) {
      queueRef.current.stop()
      audioRef.current?.pause()
    }
    wasSpeakingRef.current = isSpeaking
  }, [isSpeaking])

  // The answer finished arriving while playback was already waiting for
  // one more chunk that will now never come: the speech is over.
  useEffect(() => {
    if (!streaming && queueRef.current.isWaitingForMore) useChatStore.getState().speechEnded(messageId)
  }, [streaming, messageId])

  useEffect(() => () => useChatStore.getState().speechEnded(messageId), [messageId])

  function handlePlay() {
    setIsPlaying(true)
    useChatStore.getState().speechStarted(messageId)
  }

  function handleEnded() {
    setIsPlaying(false)
    const next = queueRef.current.ended(chunksRef.current.length)
    if (next !== undefined) setLoadedIndex(next)
    else if (!streamingRef.current) useChatStore.getState().speechEnded(messageId)
  }

  function toggle() {
    if (isPlaying) {
      audioRef.current?.pause()
      useChatStore.getState().speechEnded(messageId)
      return
    }
    queueRef.current.resume()
    if (loadedIndex === undefined) {
      const start = queueRef.current.resumeFromStart(chunksRef.current.length)
      if (start !== undefined) setLoadedIndex(start)
      return
    }
    audioRef.current?.play().catch(() => {})
  }

  const src = loadedIndex !== undefined ? chunks[loadedIndex]?.dataUrl : undefined

  return (
    <div className="mt-1 flex items-center gap-1.5">
      <audio ref={audioRef} src={src} onPlay={handlePlay} onPause={() => setIsPlaying(false)} onEnded={handleEnded} />
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        className="rounded-full transition-transform active:scale-[0.98]"
        onClick={toggle}
        aria-label={isPlaying ? 'Pause audio' : 'Play audio'}
        aria-pressed={isPlaying}
      >
        {isPlaying ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
      </Button>
    </div>
  )
}
