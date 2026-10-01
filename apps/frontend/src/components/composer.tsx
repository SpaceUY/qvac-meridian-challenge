import { useState, type KeyboardEvent } from 'react'
import { Send, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { MicButton } from '@/components/mic-button'
import { RecordingBar } from '@/components/recording-bar'
import type { VoicePhase } from '@/hooks/use-voice-turn'

type Props = {
  isStreaming: boolean
  textDisabled?: boolean
  onSend: (text: string) => void
  onStop: () => void
  voicePhase: VoicePhase
  micDisabled?: boolean
  onMicClick: () => void
  onVoiceCancel: () => void
  onVoiceSend: () => void
  registerVoiceLevelListener: (fn: ((level: number) => void) | null) => void
}

/** The bottom bar: write, send, or stop a response in progress (req. [1.4]), plus voice input. While recording, RecordingBar takes over the whole row - no Textarea, no MicButton. */
export function Composer({
  isStreaming,
  textDisabled = false,
  onSend,
  onStop,
  voicePhase,
  micDisabled = false,
  onMicClick,
  onVoiceCancel,
  onVoiceSend,
  registerVoiceLevelListener,
}: Props) {
  // What is being written, still not sent. It is pure UI - it does not matter
  // to anyone outside this component - that's why useState and not the chat reducer.
  const [text, setText] = useState('')

  function send() {
    if (!text.trim() || isStreaming || textDisabled) return
    onSend(text)
    setText('') // empty it now: no need to wait for the server to reply
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends, Shift+Enter adds a line - the convention of any chat.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  if (voicePhase.type === 'recording') {
    return (
      <RecordingBar onCancel={onVoiceCancel} onSend={onVoiceSend} registerLevelListener={registerVoiceLevelListener} />
    )
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-1.5">
      {voicePhase.type === 'error' && (
        <p className="rounded-md bg-destructive/10 px-3 py-1.5 text-xs text-destructive">{voicePhase.message}</p>
      )}
      <div className="flex items-end gap-2 rounded-3xl border bg-secondary/50 p-2 shadow-sm">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={textDisabled}
          placeholder={textDisabled ? 'Loading the model…' : 'Ask anything'}
          rows={1}
          className="max-h-40 min-h-9 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
        />
        <MicButton phase={voicePhase} disabled={micDisabled} onClick={onMicClick} />
        {isStreaming ? (
          <Button size="icon" variant="destructive" className="shrink-0 rounded-full" onClick={onStop}>
            <Square className="size-4" />
          </Button>
        ) : (
          <Button size="icon" className="shrink-0 rounded-full" disabled={!text.trim() || textDisabled} onClick={send}>
            <Send className="size-4" />
          </Button>
        )}
      </div>
    </div>
  )
}
