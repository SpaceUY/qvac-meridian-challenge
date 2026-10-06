export interface BenchmarkQuestion {
  id: string;
  question: string;
  expected: string;
  /** Last table column: the source file(s), or - for the vision category - the attached image's path under `corpus/`. */
  source: string;
}

const ROW_PATTERN = /^\|\s*(\d{3})\s*\|/;
const IMAGE_SOURCE_PATTERN = /^pictures\/[\w.-]+\.(?:jpe?g|png|webp)$/i;

/**
 * Parses the question tables of `docs/meridian-benchmark-215-en.md` - the
 * repo's own held-out bank, so the benchmark measures the same questions the
 * team already uses for quality, not a separate set to keep in sync.
 * Columns are `ID | Question | Expected | Source`; the Spanish category adds
 * an English gloss column after the question, so expected/source are read
 * from the END of the row, not by fixed position.
 */
export function parseBenchmarkQuestions(markdown: string): Map<string, BenchmarkQuestion> {
  const questions = new Map<string, BenchmarkQuestion>();
  for (const line of markdown.split('\n')) {
    if (!ROW_PATTERN.test(line)) continue;
    const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
    if (cells.length < 4) continue;
    const [id, question] = cells;
    questions.set(id!, { id: id!, question: question!, expected: cells[cells.length - 2]!, source: cells[cells.length - 1]! });
  }
  return questions;
}

/** `corpus/`-relative image path for vision questions (IDs 203-206), undefined for text-only ones. */
export function imagePathFor(question: BenchmarkQuestion): string | undefined {
  return IMAGE_SOURCE_PATTERN.test(question.source) ? question.source : undefined;
}

/**
 * One question per hard-bank category plus easy single-fact lookups (and one
 * vision question), so a default run covers short and long prompts,
 * no-answer refusals, tool calls and the vision path - not 12 variations of
 * the same lookup.
 */
export const DEFAULT_QUESTION_IDS: readonly string[] = [
  '001', '012', '033', '060', // easy: single fact, single source
  '101', // relative dates
  '121', // rules with exceptions
  '132', // multi-document
  '154', // no answer in the corpus
  '165', // confusable numbers
  '183', // calculation
  '193', // in Spanish
  '208', // citation precision (the challenge's own example)
  '204', // vision
];
