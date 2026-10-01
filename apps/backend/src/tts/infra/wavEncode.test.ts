import { describe, expect, it } from 'vitest';
import { parseWavPcm } from '../../speech/infra/wavPcm.js';
import { pcmToWav } from './wavEncode.js';

describe('pcmToWav', () => {
  it('produces a WAV buffer that parseWavPcm reads back with the same format and data', () => {
    const samples = [0, 100, -100, 32767, -32768, 12345];

    const wav = pcmToWav(samples, 44100);
    const parsed = parseWavPcm(wav);

    expect(parsed.sampleRate).toBe(44100);
    expect(parsed.channels).toBe(1);
    expect(parsed.bitsPerSample).toBe(16);
    const expectedData = Buffer.alloc(samples.length * 2);
    samples.forEach((s, i) => expectedData.writeInt16LE(s, i * 2));
    expect(parsed.data).toEqual(expectedData);
  });

  it('clamps out-of-range sample values to the int16 bounds', () => {
    const wav = pcmToWav([40000, -40000], 44100);

    const parsed = parseWavPcm(wav);

    expect(parsed.data.readInt16LE(0)).toBe(32767);
    expect(parsed.data.readInt16LE(2)).toBe(-32768);
  });

  it('produces an empty data chunk for an empty sample array', () => {
    const wav = pcmToWav([], 44100);

    const parsed = parseWavPcm(wav);

    expect(parsed.data.length).toBe(0);
  });
});
