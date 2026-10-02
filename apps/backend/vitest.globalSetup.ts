import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * One temp root per vitest run for `buildFixtureVectorStore`'s throwaway
 * LanceDB tables (it reads `FIXTURE_DB_ROOT`). Vitest workers don't fire
 * `process` exit hooks reliably, so removal happens here, once, in the main
 * process after every test file is done.
 */
export default function setup(): () => void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vitest-fixture-db-'));
  process.env.FIXTURE_DB_ROOT = root;
  return () => fs.rmSync(root, { recursive: true, force: true });
}
