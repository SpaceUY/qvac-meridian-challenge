import type { Citation, History, Message } from '@/lib/chat-types'

type Props = { history: History }

/** The whole conversation, one bubble per message. Req. [2.4] + [6.1.2]. */
export function MessageList({ history }: Props) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-6">
      {history.map((message) => (
        <MessageBubble key={message.id} message={message} />
      ))}
    </div>
  )
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user'
  // Status 'streaming' + no text yet = the model hasn't sent a single
  // word. It's not a separate prop: it is deduced from this same message.
  const isThinking = message.status.type === 'streaming' && message.text === ''

  return (
    <div className={isUser ? 'ml-auto max-w-[75%]' : 'max-w-[85%]'}>
      <div
        className={
          isUser
            ? 'rounded-2xl bg-primary px-4 py-2 text-sm text-primary-foreground'
            : 'text-sm leading-relaxed'
        }
      >
        {isThinking ? <ThinkingDots /> : message.text}
        {message.status.type === 'streaming' && !isThinking && <Cursor />}
      </div>

      {message.status.type === 'error' && <p className="mt-1 text-xs text-destructive">{message.status.reason}</p>}
      {message.citations.length > 0 && <CitationList citations={message.citations} />}
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

function CitationList({ citations }: { citations: Citation[] }) {
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {citations.map((citation, i) => (
        <span key={`${citation.file}-${i}`} className="rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
          {citation.file}
        </span>
      ))}
    </div>
  )
}
