import { describe, expect, it } from 'vitest';
import { unitForMetric } from './metricUnits.js';

describe('unitForMetric', () => {
  it.each([
    'loadModel',
    'rpc.connection',
    'loadModel.serverWait',
    'loadModel.checksumValidationTime',
    'completionStream.modelExecutionTime',
    'completionStream.timeToFirstToken',
    'completionStream.ttfb',
    'completionStream.request.zodValidation',
  ])('treats %s as a duration in ms', (key) => {
    expect(unitForMetric(key)).toBe('ms');
  });

  it.each([
    ['completionStream.tokensPerSecond', 'tokens/s'],
    ['completionStream.cacheTokens', 'tokens'],
    ['embed.totalTokens', 'tokens'],
    ['transcribeStream.realTimeFactor', 'ratio'],
    ['transcribeStream.totalSegments', 'count'],
    ['textToSpeech.totalSamples', 'samples'],
    ['loadModel.totalBytesDownloaded', 'bytes'],
    ['loadModel.downloadSpeedBps', 'bytes/s'],
  ] as const)('reads the gauge name of %s as %s, not ms', (key, unit) => {
    expect(unitForMetric(key)).toBe(unit);
  });

  it.each(['textToSpeech.audioDuration', 'textToSpeechStream.audioDuration'])(
    'reads %s as ms - verified: it equals totalSamples / 44.1 kHz in a real capture',
    (key) => {
      expect(unitForMetric(key)).toBe('ms');
    },
  );

  it.each(['transcribeStream.audioDuration', 'someFutureOp.audioDuration'])('reports %s as unknown instead of guessing', (key) => {
    expect(unitForMetric(key)).toBe('unknown');
  });

  it('only matches the LAST segment, so an op that merely contains a gauge name is still a duration', () => {
    expect(unitForMetric('tokensPerSecond.serverWait')).toBe('ms');
  });
});
