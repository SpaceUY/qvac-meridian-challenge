import { describe, expect, it } from 'vitest';
import { toSdkModelConfig } from './loadModelConfig.js';

describe('toSdkModelConfig', () => {
  it('returns undefined when no options are passed', () => {
    expect(toSdkModelConfig(undefined)).toBeUndefined();
  });

  it('maps ctxSize and tools to their SDK field names', () => {
    expect(toSdkModelConfig({ ctxSize: 4096, tools: true })).toEqual({
      ctx_size: 4096,
      tools: true
    });
  });

  it('omits ctx_size/tools entirely when unset, instead of including them as undefined', () => {
    // Some engines' modelConfig schemas (e.g. whisper's) reject unrecognized
    // keys even when their value is undefined - see loadModelConfig.ts.
    const config = toSdkModelConfig({ engineConfig: { detect_language: true } });

    expect(config).toEqual({ detect_language: true });
    expect(config).not.toHaveProperty('ctx_size');
    expect(config).not.toHaveProperty('tools');
  });

  it('lets engineConfig fields coexist with an explicit ctxSize', () => {
    expect(toSdkModelConfig({ ctxSize: 2048, engineConfig: { language: 'es' } })).toEqual({
      ctx_size: 2048,
      language: 'es'
    });
  });
});
