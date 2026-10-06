import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildImageAttachments,
  MAX_IMAGE_BYTES,
  MAX_IMAGES_PER_MESSAGE,
  readFileAsDataUrl,
  revokeAttachments,
} from '@/lib/image-attachments'

function fakeFile(type: string, sizeBytes: number, name = 'photo'): File {
  return new File([new Uint8Array(sizeBytes)], name, { type })
}

/** No Buffer in the frontend's browser-only tsconfig; this is the same encoding without it. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/** Node has no FileReader; this mirrors just enough of it (readAsDataURL -> onload/onerror) for readFileAsDataUrl. */
class FakeFileReader {
  result: string | null = null
  error: Error | null = null
  onload: (() => void) | null = null
  onerror: (() => void) | null = null

  readAsDataURL(file: File) {
    if (file.name === 'unreadable') {
      this.error = new Error('disk error')
      this.onerror?.()
      return
    }
    file.arrayBuffer().then((buf) => {
      this.result = `data:${file.type};base64,${bytesToBase64(new Uint8Array(buf))}`
      this.onload?.()
    })
  }
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

  it('rejects a single file over MAX_IMAGE_BYTES', () => {
    const result = buildImageAttachments([fakeFile('image/png', MAX_IMAGE_BYTES + 1)], [])
    expect(result.error).toBe(`Image is too large (max ${MAX_IMAGE_BYTES / (1024 * 1024)}MB)`)
    expect(result.attachments).toEqual([])
  })

  it('returns no attachments and no error for an empty file list', () => {
    expect(buildImageAttachments([], [])).toEqual({ attachments: [] })
  })
})

describe('readFileAsDataUrl', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('resolves with the data: URL FileReader produced', async () => {
    vi.stubGlobal('FileReader', FakeFileReader)
    const file = new File([new Uint8Array([1, 2, 3])], 'part.png', { type: 'image/png' })

    await expect(readFileAsDataUrl(file)).resolves.toBe('data:image/png;base64,AQID')
  })

  it('rejects with the reader error', async () => {
    vi.stubGlobal('FileReader', FakeFileReader)
    const file = new File([], 'unreadable', { type: 'image/png' })

    await expect(readFileAsDataUrl(file)).rejects.toThrow('disk error')
  })
})

describe('revokeAttachments', () => {
  it('revokes the preview URL of every attachment', () => {
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL')
    const { attachments } = buildImageAttachments([fakeFile('image/jpeg', 1024)], [])

    revokeAttachments(attachments)

    expect(revokeSpy).toHaveBeenCalledWith(attachments[0].previewUrl)
    revokeSpy.mockRestore()
  })
})
