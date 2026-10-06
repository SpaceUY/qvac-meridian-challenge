import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { DEFAULT_QUESTION_IDS, parseBenchmarkQuestions, type BenchmarkQuestion } from './benchmarkQuestions.js';
import { renderBenchReport } from './benchReport.js';
import { ProfilerUnavailableError, runProfileBench } from './profileBench.js';

/** A mistake in how the command was called - printed as one line, not a stack trace. */
class UsageError extends Error {}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..');

function selectQuestions(bank: Map<string, BenchmarkQuestion>, ids: readonly string[]): BenchmarkQuestion[] {
  return ids.map((id) => {
    const question = bank.get(id);
    if (!question) throw new UsageError(`Question ${id} is not in docs/meridian-benchmark-215-en.md`);
    return question;
  });
}

/**
 * `npm run perf:profile --workspace=apps/backend -- [--label medium] [--ids 001,101] [--audio turn.wav] [--out-dir docs/perf]`
 *
 * Req. [I.6]: against a server already running with QVAC_PROFILER=verbose
 * (see apps/backend/README.md § Performance profiling), writes the
 * profiler's JSON export + client-side timings to `<out-dir>/<label>.json`
 * and a readable report to `<out-dir>/<label>.md`.
 */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'base-url': { type: 'string', default: 'http://127.0.0.1:3001' },
      label: { type: 'string' },
      ids: { type: 'string' },
      audio: { type: 'string' },
      'out-dir': { type: 'string', default: path.join(repoRoot, 'docs', 'perf') },
    },
  });

  const bank = parseBenchmarkQuestions(await fs.readFile(path.join(repoRoot, 'docs', 'meridian-benchmark-215-en.md'), 'utf8'));
  const ids = values.ids ? values.ids.split(',').map((id) => id.trim()) : DEFAULT_QUESTION_IDS;

  const result = await runProfileBench({
    baseUrl: values['base-url'].replace(/\/$/, ''),
    ...(values.label ? { label: values.label } : {}),
    questions: selectQuestions(bank, ids),
    corpusRoot: path.join(repoRoot, 'corpus'),
    ...(values.audio ? { audioFile: path.resolve(values.audio) } : {}),
    log: (line) => console.log(line),
  });

  const outDir = path.resolve(values['out-dir']);
  await fs.mkdir(outDir, { recursive: true });
  const report = renderBenchReport(result);
  await fs.writeFile(path.join(outDir, `${result.label}.json`), `${JSON.stringify(result, null, 2)}\n`);
  await fs.writeFile(path.join(outDir, `${result.label}.md`), report);

  console.log(`\n${report}`);
  console.log(`Wrote ${path.join(outDir, `${result.label}.json`)} and .md`);
}

main().catch((err: unknown) => {
  console.error(err instanceof ProfilerUnavailableError || err instanceof UsageError ? `\n${err.message}` : err);
  process.exit(1);
});
