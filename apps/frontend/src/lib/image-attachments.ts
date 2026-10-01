// ---------------------------------------------------------------------------
// IMAGE ATTACHMENTS
//
// An attachment keeps the File itself (cheap, lazy - the browser doesn't
// fully materialize its bytes until read) plus an object URL for preview.
// The base64 data URL the backend actually wants is only ever generated at
// send time (see chat-client.ts's toOpenAIMessages) - reading the same File
// into a ~33%-larger base64 string here, ahead of time, and holding onto it
// for the whole session would waste memory on every image left in history.
// ---------------------------------------------------------------------------

export type SupportedImageMimeType = 'image/jpeg' | 'image/png'

export type ImageAttachment = {
  id: string
  file: File
  /** URL.createObjectURL(file) - revoke via revokeAttachments() once no longer shown (composer discard/unmount). Sent-message copies are intentionally never revoked: they stay visible for the life of the conversation. */
  previewUrl: string
  mimeType: SupportedImageMimeType
}

/**
 * Mirrors the backend's own limits (chat.router.const.ts) - same numbers,
 * so a rejection is instant client-side feedback instead of a round trip
 * to discover it. MAX_IMAGES_PER_MESSAGE is temporarily 1: 2 attachments in
 * one message reproducibly crashes the QVAC/llama.cpp worker process
 * (native exit, confirmed independent of reusing the same file path) -
 * raise back to 2 once that's root-caused/fixed upstream.
 */
export const MAX_IMAGES_PER_MESSAGE = 1
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024
export const MAX_TOTAL_IMAGE_BYTES = 12 * 1024 * 1024

const ACCEPTED_MIME_TYPES = new Set<string>(['image/jpeg', 'image/png'])
export const ACCEPTED_FILE_INPUT_ACCEPT = 'image/jpeg,image/png'

export type AttachmentResult = { attachments: ImageAttachment[]; error?: string }

/**
 * Validates `files` against `existing` (already-pending attachments) and
 * returns either the new attachments to append or a compact, user-facing
 * error string - never throws, never alert()s. Only reads `file.type`/
 * `file.size`, never the file's content: the real, authoritative check
 * (magic bytes) is the backend's job and happens anyway on send - this is
 * just fast UX feedback, not a security boundary.
 */
export function buildImageAttachments(files: File[], existing: ImageAttachment[]): AttachmentResult {
  if (files.length === 0) return { attachments: [] }

  const unsupported = files.find((file) => !ACCEPTED_MIME_TYPES.has(file.type))
  if (unsupported) return { attachments: [], error: 'Unsupported image format' }

  const oversized = files.find((file) => file.size > MAX_IMAGE_BYTES)
  if (oversized) return { attachments: [], error: `Image is too large (max ${MAX_IMAGE_BYTES / (1024 * 1024)}MB)` }

  if (existing.length + files.length > MAX_IMAGES_PER_MESSAGE) {
    return {
      attachments: [],
      error: `Only ${MAX_IMAGES_PER_MESSAGE} image${MAX_IMAGES_PER_MESSAGE === 1 ? '' : 's'} per message is supported`,
    }
  }

  const existingBytes = existing.reduce((sum, a) => sum + a.file.size, 0)
  const newBytes = files.reduce((sum, f) => sum + f.size, 0)
  if (existingBytes + newBytes > MAX_TOTAL_IMAGE_BYTES) {
    return { attachments: [], error: 'These images are too large together' }
  }

  const attachments = files.map((file) => ({
    id: crypto.randomUUID(),
    file,
    previewUrl: URL.createObjectURL(file),
    mimeType: file.type as SupportedImageMimeType,
  }))

  return { attachments }
}

/** Reads `file` into a base64 data URL - the exact shape the backend's `image_url.url` field expects. Only called at send time (chat-client.ts), never eagerly. */
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error('could not read file'))
    reader.readAsDataURL(file)
  })
}

export function revokeAttachments(attachments: ImageAttachment[]): void {
  for (const attachment of attachments) URL.revokeObjectURL(attachment.previewUrl)
}
