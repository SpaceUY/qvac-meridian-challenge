import { useEffect, useRef, useState } from 'react'
import { Pause, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useMirrorRef } from '@/hooks/use-mirror-ref'
import { AudioChunkQueue } from '@/lib/audio-chunk-queue'

type Props = {
  /** Grows during a live voice turn; AudioChunkQueue decides when to auto-advance into a newly arrived chunk. */
  chunks: { dataUrl: string }[]
  autoPlay?: boolean
}

/** Autoplay is best-effort: if the browser blocks it, the button still works, silently. */
export function AudioPlayback({ chunks, autoPlay = false }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const queueRef = useRef(new AudioChunkQueue())
  const chunksRef = useMirrorRef(chunks)
  const [loadedIndex, setLoadedIndex] = useState<number | undefined>(undefined)
  const [isPlaying, setIsPlaying] = useState(false)

  // Decides whether to (auto)play on mount or auto-continue as new chunks arrive.
  useEffect(() => {
    const next = queueRef.current.advance(chunks.length, autoPlay)
    if (next !== undefined) setLoadedIndex(next)
  }, [chunks.length, autoPlay])

  // Single .play() call site for both initial autoplay and later auto-advance.
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
