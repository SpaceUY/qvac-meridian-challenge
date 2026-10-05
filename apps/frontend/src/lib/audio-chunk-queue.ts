// Decides which audio chunk index to play next as a streamed voice turn's chunks arrive - pure decision logic, no DOM (AudioPlayback wires the result to an <audio> element).

/** Index the player should now load and play - `undefined` means nothing to do right now. */
export type AudioChunkQueueAction = number | undefined

export class AudioChunkQueue {
  private index = -1
  private waitingForMore = false

  /** Call whenever the number of available chunks may have grown. */
  advance(totalChunks: number, autoPlay: boolean): AudioChunkQueueAction {
    if (totalChunks === 0) return undefined

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

  get currentIndex(): number {
    return this.index
  }
}
