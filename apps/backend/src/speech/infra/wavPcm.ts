export interface WavPcmFormat {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
}

export interface WavPcm extends WavPcmFormat {
  data: Buffer;
}

/** Minimal RIFF/WAVE parser: finds `fmt `/`data` chunks, skipping the pad byte RIFF adds after an odd-sized chunk. No resampling. */
export function parseWavPcm(buffer: Buffer): WavPcm {
  if (buffer.length < 12 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Not a valid RIFF/WAVE file');
  }

  let offset = 12;
  let format: WavPcmFormat | undefined;
  let data: Buffer | undefined;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;

    if (chunkId === 'fmt ') {
      format = {
        channels: buffer.readUInt16LE(chunkStart + 2),
        sampleRate: buffer.readUInt32LE(chunkStart + 4),
        bitsPerSample: buffer.readUInt16LE(chunkStart + 14)
      };
    } else if (chunkId === 'data') {
      data = buffer.subarray(chunkStart, chunkStart + chunkSize);
    }

    offset = chunkStart + chunkSize + (chunkSize % 2);
  }

  if (!format) throw new Error('WAV file has no "fmt " chunk');
  if (!data) throw new Error('WAV file has no "data" chunk');
  return { ...format, data };
}

/** What whisper-tiny expects. Not enforced - `warnIfUnexpectedFormat` only logs. */
export const EXPECTED_WAV_FORMAT: WavPcmFormat = { sampleRate: 16000, channels: 1, bitsPerSample: 16 };

/** No resampling - just warns and lets the caller proceed regardless. */
export function warnIfUnexpectedFormat(format: WavPcmFormat, log: (message: string) => void = console.warn): void {
  const { sampleRate, channels, bitsPerSample } = EXPECTED_WAV_FORMAT;
  if (format.sampleRate !== sampleRate || format.channels !== channels || format.bitsPerSample !== bitsPerSample) {
    log(
      `WAV format is ${format.sampleRate}Hz/${format.channels}ch/${format.bitsPerSample}bit; ` +
        `whisper expects ${sampleRate}Hz/${channels}ch/${bitsPerSample}bit. Transcription quality may suffer.`
    );
  }
}

/** Splits `data` into fixed-size chunks (last one may be shorter), to feed a streaming session incrementally. */
export function chunkPcm(data: Buffer, chunkBytes: number): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < data.length; offset += chunkBytes) {
    chunks.push(data.subarray(offset, Math.min(offset + chunkBytes, data.length)));
  }
  return chunks;
}
