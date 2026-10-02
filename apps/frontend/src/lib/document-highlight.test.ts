import { describe, expect, it } from 'vitest'
import { highlightSegments } from '@/lib/document-highlight'

const DOC = 'Alpha beta gamma delta epsilon zeta eta theta'

const joined = (segments: { text: string }[]) => segments.map((s) => s.text).join('')

describe('highlightSegments', () => {
  it('marks the chunk where it sits in the document, and the segments rebuild the document exactly', () => {
    const { segments, missing } = highlightSegments(DOC, [{ content: 'gamma delta' }])

    expect(segments).toEqual([
      { text: 'Alpha beta ', highlighted: false },
      { text: 'gamma delta', highlighted: true },
      { text: ' epsilon zeta eta theta', highlighted: false },
    ])
    expect(missing).toBe(0)
    expect(joined(segments)).toBe(DOC)
  })

  it('emits no empty segment when the chunk starts or ends the document', () => {
    expect(highlightSegments(DOC, [{ content: 'Alpha beta' }]).segments[0]).toEqual({ text: 'Alpha beta', highlighted: true })
    expect(highlightSegments(DOC, [{ content: 'eta theta' }]).segments.at(-1)).toEqual({ text: 'eta theta', highlighted: true })
    expect(highlightSegments(DOC, [{ content: DOC }]).segments).toEqual([{ text: DOC, highlighted: true }])
  })

  it('merges overlapping chunks into one highlight, since neighbouring chunks overlap by design', () => {
    const { segments } = highlightSegments(DOC, [{ content: 'beta gamma delta' }, { content: 'gamma delta epsilon' }])

    expect(segments).toEqual([
      { text: 'Alpha ', highlighted: false },
      { text: 'beta gamma delta epsilon', highlighted: true },
      { text: ' zeta eta theta', highlighted: false },
    ])
  })

  it('merges chunks that touch without a gap', () => {
    const { segments } = highlightSegments('abcdef', [{ content: 'abc' }, { content: 'def' }])

    expect(segments).toEqual([{ text: 'abcdef', highlighted: true }])
  })

  it('keeps separate highlights apart and in document order, whatever order the chunks arrive in', () => {
    // The backend sends chunks best-score first, not in document order.
    const { segments } = highlightSegments(DOC, [{ content: 'eta theta' }, { content: 'Alpha' }])

    expect(segments).toEqual([
      { text: 'Alpha', highlighted: true },
      { text: ' beta gamma delta epsilon zeta ', highlighted: false },
      { text: 'eta theta', highlighted: true },
    ])
  })

  it('counts a chunk it cannot find, e.g. the file changed after it was indexed, and highlights the rest', () => {
    const { segments, missing } = highlightSegments(DOC, [{ content: 'not in the document' }, { content: 'zeta' }])

    expect(missing).toBe(1)
    expect(segments.filter((s) => s.highlighted)).toEqual([{ text: 'zeta', highlighted: true }])
    expect(joined(segments)).toBe(DOC)
  })

  it('shows the whole document unmarked when nothing is found, and counts an empty chunk as missing', () => {
    expect(highlightSegments(DOC, [{ content: 'nope' }])).toEqual({ segments: [{ text: DOC, highlighted: false }], missing: 1 })
    expect(highlightSegments(DOC, [{ content: '' }]).missing).toBe(1)
  })

  it('returns no segments for an empty document', () => {
    expect(highlightSegments('', [])).toEqual({ segments: [], missing: 0 })
  })
})
