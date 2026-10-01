import { describe, expect, it } from 'vitest'
import { buildImageAttachments, MAX_IMAGES_PER_MESSAGE } from '@/lib/image-attachments'

function fakeFile(type: string, sizeBytes: number, name = 'photo'): File {
  return new File([new Uint8Array(sizeBytes)], name, { type })
}

describe('buildImageAttachments', () => {
  it('rejects an unsupported format with "Unsupported image format"', () => {
    const result = buildImageAttachments([fakeFile('image/webp', 1024)], [])
    expect(result.error).toBe('Unsupported image format')
    expect(result.attachments).toEqual([])
  })

  it('rejects a second image with "Only 1 image per message is supported"', () => {
    expect(MAX_IMAGES_PER_MESSAGE).toBe(1)
    const first = buildImageAttachments([fakeFile('image/png', 1024)], [])
    const result = buildImageAttachments([fakeFile('image/png', 1024)], first.attachments)
    expect(result.error).toBe('Only 1 image per message is supported')
  })

  it('accepts a single well-formed JPEG', () => {
    const result = buildImageAttachments([fakeFile('image/jpeg', 1024)], [])
    expect(result.error).toBeUndefined()
    expect(result.attachments).toHaveLength(1)
    for (const a of result.attachments) URL.revokeObjectURL(a.previewUrl)
  })
})
