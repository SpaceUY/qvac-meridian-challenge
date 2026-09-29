import { describe, expect, it } from 'vitest';
import { FakeEmbeddingPort } from './fakeEmbedding.adapter.js';

function dot(a: number[], b: number[]): number {
  return a.reduce((sum, value, index) => sum + value * b[index], 0);
}

describe('FakeEmbeddingPort', () => {
  it('is deterministic: the same text embeds to the same vector', async () => {
    const port = new FakeEmbeddingPort();
    const a = await port.embed('Enterprise P1 first-response SLA is 4 hours.');
    const b = await port.embed('Enterprise P1 first-response SLA is 4 hours.');
    expect(a).toEqual(b);
  });

  it('produces a fixed-length, L2-normalized vector for non-empty text', async () => {
    const port = new FakeEmbeddingPort();
    const vector = await port.embed('warranty terms');
    expect(vector).toHaveLength(256);
    const norm = Math.sqrt(dot(vector, vector));
    expect(norm).toBeCloseTo(1, 5);
  });

  it('embeds empty/whitespace-only text to the zero vector', async () => {
    const port = new FakeEmbeddingPort();
    const vector = await port.embed('   ');
    expect(vector).toHaveLength(256);
    expect(vector.every((value) => value === 0)).toBe(true);
  });

  it('scores identical text as more similar than unrelated text', async () => {
    const port = new FakeEmbeddingPort();
    const query = await port.embed('enterprise P1 first response SLA');
    const same = await port.embed('enterprise P1 first response SLA');
    const unrelated = await port.embed('quarterly hiring plan for field technicians');

    expect(dot(query, same)).toBeCloseTo(1, 5);
    expect(dot(query, unrelated)).toBeLessThan(dot(query, same));
  });
});
