export const DEMO_TEXT =
  'The engine is operating within normal parameters. No maintenance action is required at this time.';

/** Long enough to reliably outlast CANCEL_AFTER_MS, so there's something real to interrupt. */
export const DEMO_CANCEL_TEXT =
  'This is a much longer passage than the first one, included specifically so that synthesizing it takes ' +
  'enough time for the demo to reliably cancel it before it finishes, proving the stop control actually ' +
  'interrupts an in-flight local text to speech synthesis without depending on any cloud service whatsoever.';

export const DEMO_OUTPUT_WAV = 'tts-demo-output.wav';
export const POLL_INTERVAL_MS = 200;
export const CANCEL_AFTER_MS = 150;
