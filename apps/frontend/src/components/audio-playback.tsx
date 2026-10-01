// apps/frontend/src/components/audio-playback.tsx
import { useEffect, useRef, useState } from 'react'
import { Pause, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'

type Props = {
  audio: { dataUrl: string }
  autoPlay?: boolean
}

/** Play/pause for a message's synthesized audio. Autoplay is best-effort: if the browser blocks it, the button stays available regardless, with no error shown. */
export function AudioPlayback({ audio, autoPlay = false }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)

  useEffect(() => {
    // Mount only: a message never changes its audio once created, and the
    // autoplay attempt must happen exactly once, not on every rerender.
    if (autoPlay) audioRef.current?.play().catch(() => {})
    // eslint-disable-next-line -- mount only, see comment above
  }, [])

  function toggle() {
    if (isPlaying) audioRef.current?.pause()
    else audioRef.current?.play().catch(() => {})
  }

  return (
    <div className="mt-1 flex items-center gap-1.5">
      <audio
        ref={audioRef}
        src={audio.dataUrl}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
      />
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
