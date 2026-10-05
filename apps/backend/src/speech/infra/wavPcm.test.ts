import { describe, expect, it, vi } from 'vitest';
import { chunkPcm, EXPECTED_WAV_FORMAT, parseWavPcm, warnIfUnexpectedFormat } from './wavPcm.js';

/** One RIFF chunk: id + little-endian size + payload (+1 pad byte if odd-length, per the RIFF spec). */
function chunk(id: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.write(id, 0, 'ascii');
  header.writeUInt32LE(payload.length, 4);
  const padding = payload.length % 2 === 1 ? Buffer.alloc(1) : Buffer.alloc(0);
  return Buffer.concat([header, payload, padding]);
}

function fmtChunkPayload(format: { sampleRate: number; channels: number; bitsPerSample: number }): Buffer {
  const byteRate = (format.sampleRate * format.channels * format.bitsPerSample) / 8;
  const blockAlign = (format.channels * format.bitsPerSample) / 8;
  const payload = Buffer.alloc(16);
  payload.writeUInt16LE(1, 0); // PCM
  payload.writeUInt16LE(format.channels, 2);
  payload.writeUInt32LE(format.sampleRate, 4);
  payload.writeUInt32LE(byteRate, 8);
  payload.writeUInt16LE(blockAlign, 12);
  payload.writeUInt16LE(format.bitsPerSample, 14);
  return payload;
}

/** Minimal valid RIFF/WAVE buffer (`fmt `+`data` chunks), optionally surrounded by extra chunks. */
function buildWavBuffer(
  format: { sampleRate: number; channels: number; bitsPerSample: number },
  pcmData: Buffer,
  extraChunks: { before?: Buffer; after?: Buffer } = {}
): Buffer {
  const chunks = [
    ...(extraChunks.before ? [extraChunks.before] : []),
    chunk('fmt ', fmtChunkPayload(format)),
    chunk('data', pcmData),
    ...(extraChunks.after ? [extraChunks.after] : [])
  ];
  const riffBody = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(4 + riffBody.length, 4);
  header.write('WAVE', 8, 'ascii');
  return Buffer.concat([header, riffBody]);
}

describe('parseWavPcm', () => {
  it('extracts format fields and the raw PCM data', () => {
    const pcmData = Buffer.from([1, 2, 3, 4, 5, 6]);
    const wav = buildWavBuffer({ sampleRate: 16000, channels: 1, bitsPerSample: 16 }, pcmData);

    const result = parseWavPcm(wav);

    expect(result).toEqual({ sampleRate: 16000, channels: 1, bitsPerSample: 16, data: pcmData });
  });

  it('throws on a buffer that is not a RIFF/WAVE file', () => {
    expect(() => parseWavPcm(Buffer.from('not a wav file at all'))).toThrow('Not a valid RIFF/WAVE file');
  });

  it('throws when the fmt chunk is missing', () => {
    const riffBody = chunk('data', Buffer.alloc(0));
    const header = Buffer.alloc(12);
    header.write('RIFF', 0, 'ascii');
    header.writeUInt32LE(4 + riffBody.length, 4);
    header.write('WAVE', 8, 'ascii');
    const wav = Buffer.concat([header, riffBody]);

    expect(() => parseWavPcm(wav)).toThrow('WAV file has no "fmt " chunk');
  });

  it('throws when the data chunk is missing', () => {
    const riffBody = chunk('fmt ', fmtChunkPayload({ sampleRate: 16000, channels: 1, bitsPerSample: 16 }));
    const header = Buffer.alloc(12);
    header.write('RIFF', 0, 'ascii');
    header.writeUInt32LE(4 + riffBody.length, 4);
    header.write('WAVE', 8, 'ascii');
    const wav = Buffer.concat([header, riffBody]);

    expect(() => parseWavPcm(wav)).toThrow('WAV file has no "data" chunk');
  });

  it('skips unknown chunks and handles the pad byte after an odd-length data chunk', () => {
    const pcmData = Buffer.from([9, 8, 7]); // odd length -> data chunk is padded
    const before = chunk('JUNK', Buffer.from([0, 0, 0, 0]));
    const after = chunk('LIST', Buffer.from('INFO'));
    const wav = buildWavBuffer({ sampleRate: 16000, channels: 1, bitsPerSample: 16 }, pcmData, { before, after });

    const result = parseWavPcm(wav);

    expect(result).toEqual({ sampleRate: 16000, channels: 1, bitsPerSample: 16, data: pcmData });
  });
});

describe('warnIfUnexpectedFormat', () => {
  it('does not log when the format matches EXPECTED_WAV_FORMAT', () => {
    const log = vi.fn();

    warnIfUnexpectedFormat(EXPECTED_WAV_FORMAT, log);

    expect(log).not.toHaveBeenCalled();
  });

  it('logs a warning when the sample rate does not match', () => {
    const log = vi.fn();

    warnIfUnexpectedFormat({ sampleRate: 44100, channels: 1, bitsPerSample: 16 }, log);

    expect(log).toHaveBeenCalledWith(expect.stringContaining('44100Hz'));
  });
});

describe('chunkPcm', () => {
  it('splits data into fixed-size chunks, with a shorter final chunk', () => {
    const data = Buffer.from([1, 2, 3, 4, 5, 6, 7]);

    const chunks = chunkPcm(data, 3);

    expect(chunks).toEqual([Buffer.from([1, 2, 3]), Buffer.from([4, 5, 6]), Buffer.from([7])]);
  });

  it('returns an empty array for empty data', () => {
    expect(chunkPcm(Buffer.alloc(0), 3)).toEqual([]);
  });
});
