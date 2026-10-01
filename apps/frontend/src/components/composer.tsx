import { useEffect, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react'
import { Send, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { MicButton } from '@/components/mic-button'
import { RecordingBar } from '@/components/recording-bar'
import { AttachButton } from '@/components/attach-button'
import { ImageThumbnailRow } from '@/components/image-thumbnail-row'
import { ImageLightbox } from '@/components/image-lightbox'
import { useMirrorRef } from '@/hooks/use-mirror-ref'
import {
  buildImageAttachments,
  revokeAttachments,
  MAX_IMAGES_PER_MESSAGE,
  type ImageAttachment,
} from '@/lib/image-attachments'
import type { VoicePhase } from '@/hooks/use-voice-turn'

type Props = {
  isStreaming: boolean
  textDisabled?: boolean
  onSend: (text: string, images: ImageAttachment[]) => void
  onStop: () => void
  voicePhase: VoicePhase
  micDisabled?: boolean
  onMicClick: () => void
  onVoiceCancel: () => void
  onVoiceSend: () => void
  registerVoiceLevelListener: (fn: ((level: number) => void) | null) => void
  /** Chosen by ChatPanel, which knows *why* the composer can't send right now. */
  placeholder: string
}

/** The bottom bar: write, send, or stop a response in progress (req. [1.4]), plus voice input and (now) image attachments. While recording, RecordingBar takes over the whole row - no Textarea, no MicButton, no attachments row (the images/text state is preserved underneath, just not rendered). */
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
  placeholder,
}: Props) {
  // What is being written, still not sent. It is pure UI - it does not matter
  // to anyone outside this component - that's why useState and not the chat reducer.
  const [text, setText] = useState('')
  const [images, setImages] = useState<ImageAttachment[]>([])
  const [attachError, setAttachError] = useState<string | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)
  const imagesRef = useMirrorRef(images)
  // Typing the next question while the answer streams is fine (it just
  // can't be sent yet); attaching is not - same rule as the mic.
  const attachBlocked = textDisabled || isStreaming

  // Revoke any still-pending (never sent) preview URLs if the composer goes
  // away - sent images are handed off to chat history and outlive this.
  useEffect(() => () => revokeAttachments(imagesRef.current), [imagesRef])

  function handleFilesSelected(files: File[]) {
    if (attachBlocked) return
    const result = buildImageAttachments(files, images)
    if (result.error) {
      setAttachError(result.error)
      return
    }
    setAttachError(null)
    setImages((prev) => [...prev, ...result.attachments])
  }

  function removeImage(id: string) {
    setImages((prev) => {
      const removed = prev.find((image) => image.id === id)
      if (removed) revokeAttachments([removed])
      return prev.filter((image) => image.id !== id)
    })
  }

  function send() {
    if ((!text.trim() && images.length === 0) || isStreaming || textDisabled) return
    onSend(text, images)
    setText('') // empty it now: no need to wait for the server to reply
    setImages([]) // ownership moves to chat history - don't revoke, it still needs these
    setAttachError(null)
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends, Shift+Enter adds a line - the convention of any chat.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  function handlePaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData.items)
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null)
    if (files.length === 0) return // no image in the clipboard: let normal text paste happen
    e.preventDefault()
    handleFilesSelected(files)
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    if (attachBlocked || !e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    setIsDragOver(true)
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    // Only clear when actually leaving the composer, not when moving between its children.
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
    setIsDragOver(false)
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setIsDragOver(false)
    const files = Array.from(e.dataTransfer.files).filter((file) => file.type.startsWith('image/'))
    if (files.length > 0) handleFilesSelected(files)
  }

  if (voicePhase.type === 'recording') {
    return (
      <RecordingBar onCancel={onVoiceCancel} onSend={onVoiceSend} registerLevelListener={registerVoiceLevelListener} />
    )
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-1.5">
      {voicePhase.type === 'error' && (
        <p className="rounded-md bg-destructive/10 px-3 py-1.5 text-xs text-destructive">{voicePhase.message}</p>
      )}
      {attachError && (
        <p className="rounded-md bg-destructive/10 px-3 py-1.5 text-xs text-destructive">{attachError}</p>
      )}
      <div
        className="relative flex flex-col gap-1.5 rounded-2xl border bg-card p-2 shadow-lg shadow-black/20"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isDragOver && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary bg-primary/5 text-sm font-medium text-primary">
            Drop image here
          </div>
        )}
        <ImageThumbnailRow images={images} onRemove={removeImage} onPreview={setLightboxSrc} />
        <div className="flex items-end gap-2">
          <AttachButton
            disabled={attachBlocked || images.length >= MAX_IMAGES_PER_MESSAGE}
            onFilesSelected={handleFilesSelected}
          />
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            disabled={textDisabled}
            placeholder={placeholder}
            rows={1}
            className="no-scrollbar max-h-40 min-h-9 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
            // The base Textarea defaults to field-sizing: content (grows to fit,
            // no scroll). Forced back to the classic fixed-box behavior here via
            // inline style (wins regardless of how cn()/tailwind-merge resolves
            // the class list) so max-h-40 actually clips and scrolls internally
            // instead of the two properties fighting over how overflow works.
            style={{ fieldSizing: 'fixed' }}
          />
          {isStreaming ? (
            <Button size="icon-lg" variant="destructive" className="shrink-0 rounded-xl" onClick={onStop} aria-label="Stop response">
              <Square className="size-4" />
            </Button>
          ) : (
            <Button
              size="icon-lg"
              className="shrink-0 rounded-xl"
              disabled={(!text.trim() && images.length === 0) || textDisabled}
              onClick={send}
              aria-label="Send"
            >
              <Send className="size-4" />
            </Button>
          )}
          <MicButton phase={voicePhase} disabled={micDisabled} onClick={onMicClick} />
        </div>
      </div>
      <p className="px-2 text-center text-xs text-muted-foreground">Answers come from your local corpus — check the cited sources.</p>
      <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
    </div>
  )
}
