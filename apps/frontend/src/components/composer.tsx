import { useState, type KeyboardEvent } from 'react'
import { Send, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

type Props = {
  isStreaming: boolean
  onSend: (text: string) => void
  onStop: () => void
}

/** The bottom bar: write, send, or stop a response in progress (req. [1.4]). */
export function Composer({ isStreaming, onSend, onStop }: Props) {
  // What is being written, still not sent. It is pure UI - it does not matter
  // to anyone outside this component - that's why useState and not the chat reducer.
  const [text, setText] = useState('')

  function send() {
    if (!text.trim() || isStreaming) return
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

  return (
    <div className="mx-auto flex max-w-2xl items-end gap-2 rounded-3xl border bg-secondary/50 p-2 shadow-sm">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Pregunta lo que quieras"
        rows={1}
        className="max-h-40 min-h-9 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
      />
      {isStreaming ? (
        <Button size="icon" variant="destructive" className="shrink-0 rounded-full" onClick={onStop}>
          <Square className="size-4" />
        </Button>
      ) : (
        <Button size="icon" className="shrink-0 rounded-full" disabled={!text.trim()} onClick={send}>
          <Send className="size-4" />
        </Button>
      )}
    </div>
  )
}
