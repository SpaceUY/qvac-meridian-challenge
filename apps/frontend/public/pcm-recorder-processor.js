// apps/frontend/public/pcm-recorder-processor.js
//
// Runs in the AudioWorkletGlobalScope: a separate JS realm per audio
// thread. No DOM, no access to the rest of the app - `AudioWorkletProcessor`
// and `registerProcessor` are globals there. Plain and import-free on
// purpose: it lives in public/ (served as-is, untransformed, in both dev
// and build) instead of a .ts file under src/ loaded via
// `new URL(..., import.meta.url)` - Vite only special-cases that pattern
// for `new Worker(...)`, not for `audioWorklet.addModule()`, so a .ts
// referenced that way could reach the browser untranspiled.

const PCM_RECORDER_PROCESSOR_NAME = 'pcm-recorder-processor' // must match mic-recorder.ts

class PcmRecorderProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    // The audio engine reuses the underlying buffer on the next render
    // quantum - copy it before posting, or the data gets overwritten.
    if (channel && channel.length > 0) this.port.postMessage(channel.slice())
    return true // keep the processor alive for the life of the node
  }
}

registerProcessor(PCM_RECORDER_PROCESSOR_NAME, PcmRecorderProcessor)
