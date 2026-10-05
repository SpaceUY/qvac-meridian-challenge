import { useState } from 'react'
import { Markdown } from '@/components/markdown'
import { AudioPlayback } from '@/components/audio-playback'
import { ImageLightbox } from '@/components/image-lightbox'
import { CitationSources } from '@/components/citation-sources'
import { ToolBadges } from '@/components/tool-badges'
import { BrandMark } from '@/components/brand-mark'
import { parseThinking } from '@/lib/parse-thinking'
import type { History, Message } from '@/lib/chat-types'

type Props = { history: History }

/** The whole conversation, one bubble per message. Req. [2.4] + [6.1.2]. */
export function MessageList({ history }: Props) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-7 px-4 py-8">
      {history.map((message) => (
        <MessageBubble key={message.id} message={message} />
      ))}
    </div>
  )
}

/** Neutral, not brand-colored: with the mint primary, a primary bubble would shout louder than the answer. */
const USER_BUBBLE = 'rounded-2xl rounded-br-md bg-secondary px-4 py-2.5 text-[15px] leading-relaxed text-secondary-foreground'

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user'
  const parsed = parseThinking(message.text)
  // Waiting for the very first token, OR still inside an unclosed <think>
  // block: either way, there is nothing worth showing yet but the dots.
  const isThinking = message.status.type === 'streaming' && (message.text === '' || parsed.isThinking)
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)

  const body = (
    <>
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
        <div className={isUser ? USER_BUBBLE : 'text-[15px] leading-relaxed'}>
          {isThinking ? <ThinkingDots /> : isUser ? message.text : <Markdown text={parsed.answer} />}
          {message.status.type === 'streaming' && !isThinking && <Cursor />}
        </div>
      )}
      {message.status.type === 'error' && <p className="mt-1 text-xs text-destructive">{message.status.reason}</p>}
      {message.audioChunks && message.audioChunks.length > 0 && (
        <AudioPlayback
          messageId={message.id}
          chunks={message.audioChunks}
          streaming={message.status.type === 'streaming'}
          autoPlay
        />
      )}
      {/* Tools first (how the answer was made), then sources (what it rests on). Each renders nothing when its list is empty. */}
      <ToolBadges tools={message.tools} />
      <CitationSources citations={message.citations} />
      <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
    </>
  )

  if (isUser) return <div className="ml-auto max-w-[75%]">{body}</div>
  return (
    <div className="flex gap-3">
      <BrandMark className="mt-0.5" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <p className="text-sm font-semibold">Meridian</p>
        {body}
      </div>
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

