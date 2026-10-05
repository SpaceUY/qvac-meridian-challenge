// Keeps the lazy File + a preview object URL; the ~33%-larger base64 the backend wants is only
// generated at send time (chat-client.ts's toOpenAIMessages), not held in memory the whole session.

export type SupportedImageMimeType = 'image/jpeg' | 'image/png'

export type ImageAttachment = {
  id: string
  file: File
  /** revokeAttachments() frees this on composer discard/unmount - sent-message copies are intentionally never revoked. */
  previewUrl: string
  mimeType: SupportedImageMimeType
}

/** Mirrors the backend's limits (chat.router.const.ts) for instant client-side feedback. MAX_IMAGES_PER_MESSAGE is temporarily 1: 2 attachments reproducibly crash the QVAC/llama.cpp worker - raise once that's fixed upstream. */
export const MAX_IMAGES_PER_MESSAGE = 1
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024
export const MAX_TOTAL_IMAGE_BYTES = 12 * 1024 * 1024

const ACCEPTED_MIME_TYPES = new Set<string>(['image/jpeg', 'image/png'])
export const ACCEPTED_FILE_INPUT_ACCEPT = 'image/jpeg,image/png'

export type AttachmentResult = { attachments: ImageAttachment[]; error?: string }

/** Never throws; only checks `file.type`/`file.size` as fast UX feedback - the backend re-validates (magic bytes) on send, this is not a security boundary. */
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

/** The shape the backend's `image_url.url` field expects. Only called at send time, never eagerly. */
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
