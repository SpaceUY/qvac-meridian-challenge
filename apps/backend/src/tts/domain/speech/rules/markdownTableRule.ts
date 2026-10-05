import type { SpeechRule } from '../speechRule.js';

/** A run of consecutive lines that start with "|" - one Markdown table. */
const TABLE_BLOCK_RE = /^[ \t]*\|.*(?:\r?\n[ \t]*\|.*)*/gm;
/** The "|---|:---:|" row under the headers. */
const SEPARATOR_CELL_RE = /^:?-{3,}:?$/;
/** Cells that say "nothing here": empty, a dash placeholder, "n/a". */
const EMPTY_CELL_RE = /^(?:[—–-]+|n\/?a)?$/i;

function cellsOf(row: string): string[] {
  return row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.every((cell) => SEPARATOR_CELL_RE.test(cell));
}

/** ["Total Revenue", "$18.4M", "—"] with headers → "Total Revenue: Actual $18.4M." */
function rowToSentence(cells: string[], headers: string[] | undefined): string {
  const [label = '', ...values] = cells;
  const readings = values.flatMap((value, i) => {
    if (EMPTY_CELL_RE.test(value)) return [];
    const header = headers?.[i + 1];
    return [header ? `${header} ${value}` : value];
  });
  const sentence = [EMPTY_CELL_RE.test(label) ? '' : label, readings.join(', ')].filter(Boolean).join(': ');
  return sentence ? `${sentence}.` : '';
}

function tableToSentences(block: string): string {
  const rows = block.split(/\r?\n/).map(cellsOf);
  const hasHeaders = rows.length >= 2 && isSeparatorRow(rows[1]!);
  const headers = hasHeaders ? rows[0] : undefined;
  const body = hasHeaders ? rows.slice(2) : rows.filter((cells) => !isSeparatorRow(cells));
  return body.map((cells) => rowToSentence(cells, headers)).filter(Boolean).join('\n');
}

/**
 * Reads a Markdown table row by row, each row as one sentence that names
 * its columns: "| **Total Revenue** | $18.4M |" under the headers
 * "Metric | Actual" becomes "**Total Revenue**: Actual $18.4M." Runs first:
 * it needs the "|" and the header row intact. Empty cells are skipped.
 */
export const markdownTableRule: SpeechRule = {
  apply: (text) => text.replace(TABLE_BLOCK_RE, tableToSentences),
};
