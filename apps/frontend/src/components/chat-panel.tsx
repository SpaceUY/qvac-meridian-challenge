// Only this component knows the conversation scrolls; MessageList and Composer don't.

import { ArrowDown } from 'lucide-react'
import { MessageList } from '@/components/message-list'
import { Composer } from '@/components/composer'
import { Welcome } from '@/components/welcome'
import { ContextExhaustedDialog } from '@/components/context-exhausted-dialog'
import { Button } from '@/components/ui/button'
import { useChat } from '@/hooks/use-chat'
import { useVoiceTurn } from '@/hooks/use-voice-turn'
import { useElementHeight } from '@/hooks/use-element-height'
import { useStickToBottom } from '@/hooks/use-stick-to-bottom'
import { useChatStore } from '@/lib/chat-store'
import type { ModelStatus } from '@/lib/model-status-client'
import type { ImageAttachment } from '@/lib/image-attachments'

type Props = { modelStatus: ModelStatus; modelCancelled: boolean; embeddingReady: boolean; serverUnreachable: boolean }

export function ChatPanel({ modelStatus, modelCancelled, embeddingReady, serverUnreachable }: Props) {
  const { history, isStreaming, sendMessage, stop } = useChat()
  const { phase: voicePhase, start: startVoice, send: sendVoice, discard: discardVoice, setLevelListener } = useVoiceTurn()
  // Composer floats out of flow; this spacer reserves its height at the end of the list.
  const [overlayRef, overlayHeight] = useElementHeight<HTMLDivElement>()
  const { scrollRef, contentRef, isPinned, scrollToBottom } = useStickToBottom<HTMLDivElement, HTMLDivElement>()

  function handleSend(text: string, images: ImageAttachment[]) {
    sendMessage(text, images)
    scrollToBottom()
  }

  const modelReady = modelStatus === 'ready'
  // Exhausted: a full conversation accepts no new messages of any kind; only New chat continues.
  const contextExhausted = useChatStore((state) => state.contextExhausted)
  // An answer still playing keeps the turn open: Stop stays, sending waits.
  const isSpeaking = useChatStore((state) => state.speakingMessageId !== null)
  // Text and voice disable each other, except the mic must stay enabled to stop an in-progress recording.
  const micDisabled = !modelReady || contextExhausted || (voicePhase.type !== 'recording' && isStreaming)
  const textDisabled =
    !modelReady || contextExhausted || voicePhase.type === 'recording' || voicePhase.type === 'processing'
  // Model-loading isn't reflected here; the Welcome screen already covers that case.
  const placeholder = contextExhausted
    ? 'This chat is full. Start a new chat to continue.'
    : voicePhase.type === 'processing'
      ? 'Processing audio…'
      : isStreaming
        ? 'Waiting for the response…'
        : isSpeaking
          ? 'Playing the answer…'
          : 'Ask about your documents…'

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} className="chat-scrollbar min-h-0 flex-1 overflow-y-auto">
        {/* min-h-full + flex: centers Welcome in the visible area above the composer. */}
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

      {/* pointer-events-none on the wrapper, auto on the bar: fade strip stays click-through, text under it stays selectable. */}
      <div ref={overlayRef} className="pointer-events-none absolute inset-x-0 bottom-0">
        <div className="h-8 bg-linear-to-t from-background to-background/0" />
        <div className="pointer-events-auto bg-background px-3 pb-3">
          <Composer
            isStreaming={isStreaming || isSpeaking}
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
      <ContextExhaustedDialog />
    </div>
  )
}
