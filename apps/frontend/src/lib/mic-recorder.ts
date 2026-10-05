// Captures mic audio at its native sample rate (an AudioWorklet has no time to resample on the
// audio thread) and resamples to 16kHz once, after stop(), via the browser's OfflineAudioContext.

const PCM_RECORDER_WORKLET_URL = '/pcm-recorder-processor.js'
const PCM_RECORDER_PROCESSOR_NAME = 'pcm-recorder-processor' // must match public/pcm-recorder-processor.js
const TARGET_SAMPLE_RATE = 16000
const MIN_RECORDING_MS = 300

export class MicRecorder {
  private stream?: MediaStream
  private audioContext?: AudioContext
  private workletNode?: AudioWorkletNode
  private chunks: Float32Array<ArrayBuffer>[] = []
  private cleaned = false

  /** `onLevel`, if given, is called with a rough 0-1 loudness reading on every incoming chunk - for a live level meter, not for anything that affects the recording itself. */
  async start(onLevel?: (level: number) => void): Promise<void> {
    this.cleaned = false
    this.chunks = []

    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } })
    this.audioContext = new AudioContext()
    await this.audioContext.audioWorklet.addModule(PCM_RECORDER_WORKLET_URL)

    this.workletNode = new AudioWorkletNode(this.audioContext, PCM_RECORDER_PROCESSOR_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1,
    })
    this.workletNode.port.onmessage = (event: MessageEvent<Float32Array<ArrayBuffer>>) => {
      this.chunks.push(event.data)
      if (onLevel) onLevel(rmsLevel(event.data))
    }

    const source = this.audioContext.createMediaStreamSource(this.stream)
    source.connect(this.workletNode)
    // Never connects to audioContext.destination - capture only, no mic-to-speaker loopback.
  }

  /** Stops capture, resamples to 16kHz, and encodes a WAV. `undefined` if the recording was under ~300ms (ignored, not an error). */
  async stop(): Promise<Blob | undefined> {
    const nativeSampleRate = this.audioContext?.sampleRate ?? TARGET_SAMPLE_RATE
    const samples = concatFloat32(this.chunks)
    await this.cleanup()

    const minSamples = (MIN_RECORDING_MS / 1000) * nativeSampleRate
    if (samples.length < minSamples) return undefined

    const resampled = await resampleTo16k(samples, nativeSampleRate)
    return encodeWav(resampled, TARGET_SAMPLE_RATE)
  }

  /** Aborts without producing a Blob. Safe to call more than once, and after stop(). */
  async cancel(): Promise<void> {
    await this.cleanup()
  }

  private async cleanup(): Promise<void> {
    if (this.cleaned) return
    this.cleaned = true
    this.workletNode?.disconnect()
    this.stream?.getTracks().forEach((track) => track.stop())
    if (this.audioContext && this.audioContext.state !== 'closed') {
      await this.audioContext.close()
    }
  }
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i] ?? 0)
  return btoa(binary)
}

/** Rough loudness (0-1) of one chunk, for a live level meter - not calibrated, just enough to see the mic react. */
function rmsLevel(samples: Float32Array<ArrayBuffer>): number {
  let sumSquares = 0
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i] ?? 0
    sumSquares += s * s
  }
  const rms = Math.sqrt(sumSquares / samples.length)
  return Math.min(1, rms * 4) // typical speech RMS sits well under 1.0 - boost it into a visible range
}

function concatFloat32(chunks: Float32Array<ArrayBuffer>[]): Float32Array<ArrayBuffer> {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const result = new Float32Array(length)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}

async function resampleTo16k(
  samples: Float32Array<ArrayBuffer>,
  nativeSampleRate: number,
): Promise<Float32Array<ArrayBuffer>> {
  if (nativeSampleRate === TARGET_SAMPLE_RATE) return samples

  const targetLength = Math.max(1, Math.ceil((samples.length * TARGET_SAMPLE_RATE) / nativeSampleRate))
  const offlineContext = new OfflineAudioContext(1, targetLength, TARGET_SAMPLE_RATE)
  const sourceBuffer = offlineContext.createBuffer(1, Math.max(1, samples.length), nativeSampleRate)
  sourceBuffer.copyToChannel(samples, 0)

  const source = offlineContext.createBufferSource()
  source.buffer = sourceBuffer
  source.connect(offlineContext.destination)
  source.start()

  const rendered = await offlineContext.startRendering()
  return rendered.getChannelData(0)
}

/** Mono 16-bit PCM WAV (44-byte header) - the browser-side counterpart of apps/backend/src/tts/infra/wavEncode.ts. */
function encodeWav(samples: Float32Array<ArrayBuffer>, sampleRate: number): Blob {
  const data = floatTo16BitPcm(samples)
  const header = new ArrayBuffer(44)
  const view = new DataView(header)

  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + data.byteLength, true)
  writeAscii(view, 8, 'WAVE')

  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true) // chunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample

  writeAscii(view, 36, 'data')
  view.setUint32(40, data.byteLength, true)

  return new Blob([header, data], { type: 'audio/wav' })
}

function floatTo16BitPcm(samples: Float32Array<ArrayBuffer>): ArrayBuffer {
  const buffer = new ArrayBuffer(samples.length * 2)
  const view = new DataView(buffer)
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i] ?? 0))
    view.setInt16(i * 2, clamped < 0 ? clamped * 32768 : clamped * 32767, true)
  }
  return buffer
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
}
