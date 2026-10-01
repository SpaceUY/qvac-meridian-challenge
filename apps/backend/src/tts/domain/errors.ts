/** Thrown when synthesize() is called while another synthesis is still pending - single slot, no queue. */
export class SynthesisInProgressError extends Error {
  constructor() {
    super('a synthesis is already in progress');
    this.name = 'SynthesisInProgressError';
  }
}
