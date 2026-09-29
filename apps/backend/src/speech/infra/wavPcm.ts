export interface WavPcmFormat {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
}

export interface WavPcm extends WavPcmFormat {
  data: Buffer;
}

/**
 * Minimal RIFF/WAVE parser: walks the chunk list to find `fmt ` and `data`,
 * ignoring any other chunks (e.g. `LIST`). Handles chunk padding - RIFF
 * chunks are word-aligned, so an odd-sized chunk is followed by one pad
 * byte that must be skipped before reading the next chunk header. No
 * resampling or format conversion - see `warnIfUnexpectedFormat`.
 */
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

/** Logs (via `log`, default `console.warn`) if `format` doesn't match `EXPECTED_WAV_FORMAT`. No resampling - the caller proceeds regardless. */
export function warnIfUnexpectedFormat(format: WavPcmFormat, log: (message: string) => void = console.warn): void {
  const { sampleRate, channels, bitsPerSample } = EXPECTED_WAV_FORMAT;
  if (format.sampleRate !== sampleRate || format.channels !== channels || format.bitsPerSample !== bitsPerSample) {
    log(
      `WAV format is ${format.sampleRate}Hz/${format.channels}ch/${format.bitsPerSample}bit; ` +
        `whisper expects ${sampleRate}Hz/${channels}ch/${bitsPerSample}bit. Transcription quality may suffer.`
    );
  }
}

/** Splits `data` into fixed-size `Uint8Array` chunks (the last chunk may be shorter), for feeding a streaming session incrementally. */
export function chunkPcm(data: Buffer, chunkBytes: number): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < data.length; offset += chunkBytes) {
    chunks.push(data.subarray(offset, Math.min(offset + chunkBytes, data.length)));
  }
  return chunks;
}
