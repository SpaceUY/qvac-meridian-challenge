// The middle column: the scrolling conversation with the composer floating on
// top of it. This is the only component that knows the conversation scrolls —
// MessageList just draws bubbles and Composer just draws an input.

import { ArrowDown } from 'lucide-react'
import { MessageList } from '@/components/message-list'
import { Composer } from '@/components/composer'
import { Welcome } from '@/components/welcome'
import { Button } from '@/components/ui/button'
import { useChat } from '@/hooks/use-chat'
import { useVoiceTurn } from '@/hooks/use-voice-turn'
import { useElementHeight } from '@/hooks/use-element-height'
import { useStickToBottom } from '@/hooks/use-stick-to-bottom'
import type { ModelStatus } from '@/lib/model-status-client'
import type { ImageAttachment } from '@/lib/image-attachments'

type Props = { modelStatus: ModelStatus; modelCancelled: boolean; embeddingReady: boolean; serverUnreachable: boolean }

export function ChatPanel({ modelStatus, modelCancelled, embeddingReady, serverUnreachable }: Props) {
  const { history, isStreaming, sendMessage, stop } = useChat()
  const { phase: voicePhase, start: startVoice, send: sendVoice, discard: discardVoice, setLevelListener } = useVoiceTurn()
  // The composer is out of the normal flow, so it takes up no room. The spacer
  // at the end of the list gives that room back, exactly as much as it needs.
  const [overlayRef, overlayHeight] = useElementHeight<HTMLDivElement>()
  const { scrollRef, contentRef, isPinned, scrollToBottom } = useStickToBottom<HTMLDivElement, HTMLDivElement>()

  // Sending always takes you back down: you just wrote it, you want to see it.
  function handleSend(text: string, images: ImageAttachment[]) {
    sendMessage(text, images)
    scrollToBottom()
  }

  const modelReady = modelStatus === 'ready'
  // Text and voice never compete for the same turn: each one disables the
  // other - except once voice is already recording, where the mic must
  // always be able to stop.
  const micDisabled = !modelReady || (voicePhase.type !== 'recording' && isStreaming)
  const textDisabled = !modelReady || voicePhase.type === 'recording' || voicePhase.type === 'processing'
  // Why the composer can't send right now, in the box itself. While the
  // model loads it stays neutral: the Welcome in the middle already says why.
  const placeholder =
    voicePhase.type === 'processing'
      ? 'Processing audio…'
      : isStreaming
        ? 'Waiting for the response…'
        : 'Ask about your documents…'

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} className="chat-scrollbar min-h-0 flex-1 overflow-y-auto">
        {/* min-h-full + flex: an empty conversation can center the Welcome
            in the visible area; the spacer keeps it above the composer. */}
        <div ref={contentRef} className="flex min-h-full flex-col">
          {history.length === 0 ? (
            <Welcome
              modelStatus={modelStatus}
              modelCancelled={modelCancelled}
              embeddingReady={embeddingReady}
              serverUnreachable={serverUnreachable}
              onAsk={(text) => handleSend(text, [])}
            />
          ) : (
            <MessageList history={history} />
          )}
          <div aria-hidden className="shrink-0" style={{ height: overlayHeight }} />
        </div>
      </div>

      {!isPinned && (
        <Button
          size="icon"
          variant="secondary"
          aria-label="Scroll to the latest message"
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
          <Composer
            isStreaming={isStreaming}
            textDisabled={textDisabled}
            placeholder={placeholder}
            onSend={handleSend}
            onStop={stop}
            voicePhase={voicePhase}
            micDisabled={micDisabled}
            onMicClick={startVoice}
            onVoiceCancel={discardVoice}
            onVoiceSend={sendVoice}
            registerVoiceLevelListener={setLevelListener}
          />
        </div>
      </div>
    </div>
  )
}
