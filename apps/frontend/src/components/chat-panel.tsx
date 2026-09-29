// The middle column: the scrolling conversation with the composer floating on
// top of it. This is the only component that knows the conversation scrolls —
// MessageList just draws bubbles and Composer just draws an input.

import { ArrowDown } from 'lucide-react'
import { MessageList } from '@/components/message-list'
import { Composer } from '@/components/composer'
import { Button } from '@/components/ui/button'
import { useChat } from '@/hooks/use-chat'
import { useElementHeight } from '@/hooks/use-element-height'
import { useStickToBottom } from '@/hooks/use-stick-to-bottom'

export function ChatPanel() {
  const { history, isStreaming, sendMessage, stop } = useChat()
  // The composer is out of the normal flow, so it takes up no room. The spacer
  // at the end of the list gives that room back, exactly as much as it needs.
  const [overlayRef, overlayHeight] = useElementHeight<HTMLDivElement>()
  const { scrollRef, contentRef, isPinned, scrollToBottom } = useStickToBottom<HTMLDivElement, HTMLDivElement>()

  // Sending always takes you back down: you just wrote it, you want to see it.
  function handleSend(text: string) {
    sendMessage(text)
    scrollToBottom()
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div ref={contentRef}>
          <MessageList history={history} />
          <div aria-hidden style={{ height: overlayHeight }} />
        </div>
      </div>

      {!isPinned && (
        <Button
          size="icon"
          variant="secondary"
          aria-label="Ir al final de la conversacion"
          onClick={scrollToBottom}
          className="absolute left-1/2 z-10 -translate-x-1/2 rounded-full border shadow-md"
          style={{ bottom: overlayHeight + 8 }}
        >
          <ArrowDown className="size-4" />
        </Button>
      )}

      {/* pointer-events-none on the wrapper, auto on the bar: the fade strip
          is see-through to the mouse, so text under it stays selectable. */}
      <div ref={overlayRef} className="pointer-events-none absolute inset-x-0 bottom-0">
        <div className="h-8 bg-linear-to-t from-background to-background/0" />
        <div className="pointer-events-auto bg-background px-3 pb-3">
          <Composer isStreaming={isStreaming} onSend={handleSend} onStop={stop} />
        </div>
      </div>
    </div>
  )
}
