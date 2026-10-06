import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_QUESTION_IDS, imagePathFor, parseBenchmarkQuestions } from './benchmarkQuestions.js';

const REAL_BANK = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..', 'docs', 'meridian-benchmark-215-en.md'),
  'utf8',
);

describe('parseBenchmarkQuestions', () => {
  it('reads a 4-column row: id, question, expected, source', () => {
    const bank = parseBenchmarkQuestions('| 001 | What is X? | 72 | data/a.json |');

    expect(bank.get('001')).toEqual({ id: '001', question: 'What is X?', expected: '72', source: 'data/a.json' });
  });

  it('reads expected/source from the END of a 5-column row (the Spanish category\'s gloss column)', () => {
    const bank = parseBenchmarkQuestions('| 193 | ¿Cuál es el SLA? | [What is the SLA?] | 4 hours | emails/007.md |');

    expect(bank.get('193')).toMatchObject({ question: '¿Cuál es el SLA?', expected: '4 hours', source: 'emails/007.md' });
  });

  it('skips headers, separators, prose and ad-hoc tables whose first cell is not a 3-digit id', () => {
    const markdown = ['| ID | Question | Expected | Source |', '|---|---|---|---|', 'Some prose.', '| 1 | ad hoc | x | y |', '| 002 | Q | A | S |'].join('\n');

    expect([...parseBenchmarkQuestions(markdown).keys()]).toEqual(['002']);
  });

  describe('against the real docs/meridian-benchmark-215-en.md', () => {
    const bank = parseBenchmarkQuestions(REAL_BANK);

    it('finds all 215 questions, ids 001-215', () => {
      expect(bank.size).toBe(215);
      expect(bank.has('001')).toBe(true);
      expect(bank.has('215')).toBe(true);
    });

    it('contains every default question id', () => {
      for (const id of DEFAULT_QUESTION_IDS) expect(bank.has(id), id).toBe(true);
    });

    it('keeps the challenge\'s own example question (208) intact', () => {
      expect(bank.get('208')?.question).toBe('What was Q2 2026 total revenue?');
    });
  });
});

describe('imagePathFor', () => {
  const bank = parseBenchmarkQuestions(REAL_BANK);

  it.each(['203', '204', '205', '206'])('returns the attached picture for vision question %s, and the file exists in corpus/', (id) => {
    const image = imagePathFor(bank.get(id)!);

    expect(image).toMatch(/^pictures\//);
    expect(fs.existsSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..', 'corpus', image!))).toBe(true);
  });

  it('returns undefined for 207, the vision question deliberately sent with no image', () => {
    expect(imagePathFor(bank.get('207')!)).toBeUndefined();
  });

  it('returns undefined for text questions', () => {
    expect(imagePathFor(bank.get('001')!)).toBeUndefined();
  });
});
