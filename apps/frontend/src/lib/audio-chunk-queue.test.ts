import { describe, expect, it } from 'vitest'
import { AudioChunkQueue } from '@/lib/audio-chunk-queue'

describe('AudioChunkQueue', () => {
  describe('advance', () => {
    it('does nothing when there are no chunks yet', () => {
      const queue = new AudioChunkQueue()
      expect(queue.advance(0, true)).toBeUndefined()
    })

    it('starts at index 0 once the first chunk arrives, when autoPlay is on', () => {
      const queue = new AudioChunkQueue()
      expect(queue.advance(1, true)).toBe(0)
    })

    it('does not auto-start when autoPlay is off', () => {
      const queue = new AudioChunkQueue()
      expect(queue.advance(1, false)).toBeUndefined()
    })

    it('does nothing on later calls once already started and not waiting for more', () => {
      const queue = new AudioChunkQueue()
      queue.advance(1, true)
      expect(queue.advance(2, true)).toBeUndefined()
    })

    it('advances once a new chunk arrives while waiting for more', () => {
      const queue = new AudioChunkQueue()
      queue.advance(1, true) // -> 0
      queue.ended(1) // ran out, now waiting
      expect(queue.advance(2, true)).toBe(1)
    })

    it('stays put if it is waiting for more but no new chunk has arrived', () => {
      const queue = new AudioChunkQueue()
      queue.advance(1, true) // -> 0
      queue.ended(1) // waiting
      expect(queue.advance(1, true)).toBeUndefined()
    })
  })

  describe('ended', () => {
    it('moves to the next already-available chunk', () => {
      const queue = new AudioChunkQueue()
      queue.advance(2, true) // -> 0
      expect(queue.ended(2)).toBe(1)
    })

    it('returns undefined and remembers it is waiting when there is no next chunk yet', () => {
      const queue = new AudioChunkQueue()
      queue.advance(1, true) // -> 0
      expect(queue.ended(1)).toBeUndefined()
    })
  })

  describe('resumeFromStart', () => {
    it('starts at index 0 when nothing has played yet', () => {
      const queue = new AudioChunkQueue()
      expect(queue.resumeFromStart(1)).toBe(0)
    })

    it('does nothing once playback has already started', () => {
      const queue = new AudioChunkQueue()
      queue.advance(1, true) // -> 0
      expect(queue.resumeFromStart(1)).toBeUndefined()
    })

    it('does nothing when there are no chunks at all', () => {
      const queue = new AudioChunkQueue()
      expect(queue.resumeFromStart(0)).toBeUndefined()
    })
  })

  describe('currentIndex', () => {
    it('is -1 before anything has played', () => {
      expect(new AudioChunkQueue().currentIndex).toBe(-1)
    })

    it('tracks the index most recently returned by advance/ended/resumeFromStart', () => {
      const queue = new AudioChunkQueue()
      queue.advance(2, true)
      queue.ended(2)
      expect(queue.currentIndex).toBe(1)
    })
  })

  describe('stop / resume', () => {
    it('stops moving on by itself after stop(): neither a finished chunk nor a new one advances', () => {
      const queue = new AudioChunkQueue()
      queue.advance(2, true)
      queue.stop()
      expect(queue.ended(2)).toBeUndefined()
      expect(queue.advance(3, true)).toBeUndefined()
    })

    it('moves on again after resume()', () => {
      const queue = new AudioChunkQueue()
      queue.advance(2, true)
      queue.stop()
      queue.resume()
      expect(queue.ended(2)).toBe(1)
    })

    it('is no longer waiting for more once stopped', () => {
      const queue = new AudioChunkQueue()
      queue.advance(1, true)
      queue.ended(1)
      expect(queue.isWaitingForMore).toBe(true)
      queue.stop()
      expect(queue.isWaitingForMore).toBe(false)
    })
  })
})
