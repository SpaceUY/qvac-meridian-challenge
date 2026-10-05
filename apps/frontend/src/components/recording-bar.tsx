import { useEffect, useRef, useState } from 'react'
import { Send, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

type Props = {
  onCancel: () => void
  onSend: () => void
  registerLevelListener: (fn: ((level: number) => void) | null) => void
}

const BAR_COUNT = 24
const LEVEL_PAINT_INTERVAL_MS = 50
const MIN_BAR_SCALE = 0.15

/** Replaces the Composer's Textarea + MicButton + Send while recording - the standard "voice note" pattern (WhatsApp/Telegram/iMessage): cancel on the left, live timer + waveform in the middle, send on the right. Escape also cancels. */
export function RecordingBar({ onCancel, onSend, registerLevelListener }: Props) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const barRefs = useRef<(HTMLSpanElement | null)[]>([])
  const levelsRef = useRef<number[]>(new Array(BAR_COUNT).fill(MIN_BAR_SCALE))
  const lastPaintRef = useRef(0)

  useEffect(() => {
    const startedAt = Date.now()
    const interval = setInterval(() => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)), 250)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    // Mutates the DOM directly instead of useState: levels arrive several times/sec from the audio thread, and useState would repaint the whole tree on every one.
    registerLevelListener((level) => {
      const now = performance.now()
      if (now - lastPaintRef.current < LEVEL_PAINT_INTERVAL_MS) return
      lastPaintRef.current = now

      levelsRef.current.shift()
      levelsRef.current.push(Math.max(MIN_BAR_SCALE, level))

      for (let i = 0; i < BAR_COUNT; i++) {
        const bar = barRefs.current[i]
        if (bar) bar.style.transform = `scaleY(${levelsRef.current[i]})`
      }
    })
    return () => registerLevelListener(null)
  }, [registerLevelListener])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onCancel])

  const mm = String(Math.floor(elapsedSeconds / 60)).padStart(2, '0')
  const ss = String(elapsedSeconds % 60).padStart(2, '0')

  return (
    <div className="mx-auto flex max-w-3xl items-center gap-2 rounded-2xl border bg-card p-2 shadow-lg shadow-black/20">
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="shrink-0 rounded-full"
        onClick={onCancel}
        aria-label="Cancel recording"
      >
        <X className="size-4" />
      </Button>

      <div className="flex min-w-0 flex-1 items-center gap-2 px-1">
        <span className="size-2 shrink-0 animate-pulse rounded-full bg-destructive" aria-hidden />
        <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
          {mm}:{ss}
        </span>
        <div className="flex h-5 min-w-0 flex-1 items-center gap-[3px] overflow-hidden">
          {Array.from({ length: BAR_COUNT }, (_, i) => (
            <span
              key={i}
              ref={(el) => {
                barRefs.current[i] = el
              }}
              className="h-full w-[3px] shrink-0 origin-center rounded-full bg-primary/60 transition-transform duration-75"
              style={{ transform: `scaleY(${MIN_BAR_SCALE})` }}
            />
          ))}
        </div>
      </div>

      <Button type="button" size="icon-lg" className="shrink-0 rounded-xl" onClick={onSend} aria-label="Send recording">
        <Send className="size-4" />
      </Button>
    </div>
  )
}
