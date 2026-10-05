// apps/frontend/src/lib/audio-chunk-queue.ts
//
// Decides which audio chunk index a player should load/play next, as
// chunks arrive one at a time (a streamed voice turn) and as each one
// finishes - the sibling of the backend's SentenceChunker: pure decision
// logic, no DOM. AudioPlayback wires its answers to an <audio> element.

/** Index the player should now load and play - `undefined` means nothing to do right now. */
export type AudioChunkQueueAction = number | undefined

export class AudioChunkQueue {
  private index = -1
  private waitingForMore = false
  /** Set by stop(): nothing advances on its own until resume(). */
  private stopped = false

  /** Call whenever the number of available chunks may have grown. */
  advance(totalChunks: number, autoPlay: boolean): AudioChunkQueueAction {
    if (totalChunks === 0 || this.stopped) return undefined

    if (this.index === -1) {
      if (!autoPlay) return undefined
      this.index = 0
      return this.index
    }

    if (this.waitingForMore && totalChunks > this.index + 1) {
      this.waitingForMore = false
      this.index += 1
      return this.index
    }

    return undefined
  }

  /** Call when the currently loaded chunk finishes playing. */
  ended(totalChunks: number): AudioChunkQueueAction {
    if (this.stopped) return undefined
    if (this.index + 1 < totalChunks) {
      this.index += 1
      return this.index
    }
    this.waitingForMore = true
    return undefined
  }

  /** Call when the user presses play with nothing loaded yet. */
  resumeFromStart(totalChunks: number): AudioChunkQueueAction {
    if (this.index !== -1 || totalChunks === 0) return undefined
    this.index = 0
    return this.index
  }

  /** Call when the user hits Stop: stays on the current chunk, but no longer moves on by itself. */
  stop(): void {
    this.stopped = true
    this.waitingForMore = false
  }

  /** Call when the user presses play again after a stop(): moving on resumes. */
  resume(): void {
    this.stopped = false
  }

  /** True once the last available chunk finished and the queue is waiting for another to arrive. */
  get isWaitingForMore(): boolean {
    return this.waitingForMore
  }

  get currentIndex(): number {
    return this.index
  }
}
