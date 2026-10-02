import { describe, expect, it } from 'vitest'
import { MAX_PROMPT_CHARS, promptLimitState } from '@/lib/prompt-limit'

describe('promptLimitState', () => {
  it('hides the counter while there is plenty of room', () => {
    expect(promptLimitState('')).toEqual({ remaining: MAX_PROMPT_CHARS, showCounter: false, atLimit: false })
  })

  it('shows the counter from 100 characters left', () => {
    expect(promptLimitState('x'.repeat(MAX_PROMPT_CHARS - 100))).toEqual({
      remaining: 100,
      showCounter: true,
      atLimit: false,
    })
  })

  it('reports the limit as reached at exactly MAX_PROMPT_CHARS', () => {
    expect(promptLimitState('x'.repeat(MAX_PROMPT_CHARS))).toMatchObject({ remaining: 0, atLimit: true })
  })

  it('never reports negative room for a text set past the limit programmatically', () => {
    expect(promptLimitState('x'.repeat(MAX_PROMPT_CHARS + 5))).toMatchObject({ remaining: 0, atLimit: true })
  })
})
