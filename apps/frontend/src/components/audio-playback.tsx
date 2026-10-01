// apps/frontend/src/components/audio-playback.tsx
import { useEffect, useRef, useState } from 'react'
import { Pause, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useMirrorRef } from '@/hooks/use-mirror-ref'
import { AudioChunkQueue } from '@/lib/audio-chunk-queue'

type Props = {
  /** One entry per synthesized sentence. During a live voice turn this array keeps growing - AudioChunkQueue decides when to auto-advance into a chunk that just arrived. */
  chunks: { dataUrl: string }[]
  autoPlay?: boolean
}

/** Play/pause for a message's synthesized audio, one chunk at a time. Autoplay is best-effort: if the browser blocks it, the button stays available regardless, with no error shown. */
export function AudioPlayback({ chunks, autoPlay = false }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const queueRef = useRef(new AudioChunkQueue())
  const chunksRef = useMirrorRef(chunks)
  const [loadedIndex, setLoadedIndex] = useState<number | undefined>(undefined)
  const [isPlaying, setIsPlaying] = useState(false)

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

  function handleEnded() {
    setIsPlaying(false)
    const next = queueRef.current.ended(chunksRef.current.length)
    if (next !== undefined) setLoadedIndex(next)
  }

  function toggle() {
    if (isPlaying) {
      audioRef.current?.pause()
      return
    }
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
      <audio ref={audioRef} src={src} onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} onEnded={handleEnded} />
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
