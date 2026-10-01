import { useState } from 'react'
import { Markdown } from '@/components/markdown'
import { AudioPlayback } from '@/components/audio-playback'
import { ImageLightbox } from '@/components/image-lightbox'
import { CitationSources } from '@/components/citation-sources'
import { parseThinking } from '@/lib/parse-thinking'
import type { History, Message } from '@/lib/chat-types'

type Props = { history: History }

/** The whole conversation, one bubble per message. Req. [2.4] + [6.1.2]. */
export function MessageList({ history }: Props) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-6">
      {history.map((message) => (
        <MessageBubble key={message.id} message={message} />
      ))}
    </div>
  )
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user'
  const parsed = parseThinking(message.text)
  // Waiting for the very first token, OR still inside an unclosed <think>
  // block: either way, there is nothing worth showing yet but the dots.
  const isThinking = message.status.type === 'streaming' && (message.text === '' || parsed.isThinking)
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)

  return (
    <div className={isUser ? 'ml-auto max-w-[75%]' : 'max-w-[85%]'}>
      {message.images && message.images.length > 0 && (
        <div className="mb-1.5 flex flex-wrap justify-end gap-1.5">
          {message.images.map((image) => (
            <img
              key={image.id}
              src={image.previewUrl}
              alt=""
              className="max-h-72 max-w-full cursor-pointer rounded-xl object-contain shadow-sm"
              onClick={() => setLightboxSrc(image.previewUrl)}
            />
          ))}
        </div>
      )}
      {/* An image-only user turn has no text - skip the empty bubble, the image already speaks for itself. */}
      {!(isUser && message.text === '') && (
        <div
          className={
            isUser
              ? 'rounded-2xl bg-primary px-4 py-2 text-sm text-primary-foreground'
              : 'text-sm leading-relaxed'
          }
        >
          {isThinking ? <ThinkingDots /> : isUser ? message.text : <Markdown text={parsed.answer} />}
          {message.status.type === 'streaming' && !isThinking && <Cursor />}
        </div>
      )}

      {message.status.type === 'error' && <p className="mt-1 text-xs text-destructive">{message.status.reason}</p>}
      {message.audio && <AudioPlayback audio={message.audio} autoPlay />}
      <CitationSources citations={message.citations} />
      <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
    </div>
  )
}

function ThinkingDots() {
  return (
    <span className="inline-flex gap-1 py-1">
      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.3s]" />
      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.15s]" />
      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground" />
    </span>
  )
}

function Cursor() {
  return <span className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-foreground align-middle" />
}

