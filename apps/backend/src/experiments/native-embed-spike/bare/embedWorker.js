/**
 * I.4 spike - runs INSIDE the Bare runtime (spawned by nativeEmbedClient.ts
 * via `bare-runtime/spawn`), never inside Node/tsx. This is what makes the
 * path "native": `@qvac/embed-llamacpp`'s `binding.js` does
 * `module.exports = require.addon()`, a Bare-only loader Node does not
 * implement, so the addon can only be required from here - not from a
 * regular Node script. ESM, not CJS: `apps/backend/package.json` sets
 * `"type": "module"`, so Bare's module loader (same resolution rules as
 * Node) parses every `.js` under this tree as ESM - matches the import
 * style `@qvac/sdk`'s own `llamacpp-embedding/plugin.js` uses for the same
 * package.
 *
 * No `@qvac/sdk` import anywhere in this file or its dependency chain.
 *
 * `normalizeVector`/`extractSingleVector` are imported from the production
 * native embedding module (`rag/infra/nativeEmbedding/bare/`) rather than
 * defined here - they used to be duplicated byte-for-byte between this file
 * and its production counterpart (`embedServer.js`).
 *
 * Protocol: `Bare.argv` mirrors Node's `process.argv`
 * ([bareExePath, scriptPath, ...userArgs]), so the two args we pass land at
 * index 2 and 3: `[requestPath, responsePath]`. Request JSON:
 * `{ modelPath: string, config: Record<string, string>, texts: string[] }`.
 * Response JSON: `{ loadTimeMs: number, calls: Array<{ elapsedMs, embedding, stats }> }`
 * on success, or `{ error: string, stack?: string }` (still exit code 1) on failure.
 */
import fs from "bare-fs";
import GGMLBert from "@qvac/embed-llamacpp";
import { normalizeVector, extractSingleVector } from "../../../rag/infra/nativeEmbedding/bare/embeddingVectorNormalization.js";

function getArgs() {
  const [, , requestPath, responsePath] = Bare.argv;
  return { requestPath, responsePath };
}

async function main() {
  const { requestPath, responsePath } = getArgs();
  if (!requestPath || !responsePath) {
    throw new Error(`usage: bare embedWorker.js <requestPath> <responsePath> (got argv=${JSON.stringify(Bare.argv)})`);
  }

  const request = JSON.parse(fs.readFileSync(requestPath, "utf8"));
  const { modelPath, config, texts } = request;

  const model = new GGMLBert({
    files: { model: [modelPath] },
    config,
    opts: { stats: true }
  });

  const loadStart = Date.now();
  await model.load();
  const loadTimeMs = Date.now() - loadStart;

  const calls = [];
  try {
    for (const text of texts) {
      const callStart = Date.now();
      const response = await model.run(text);
      const rawEmbeddings = await response.await();
      const elapsedMs = Date.now() - callStart;
      const embedding = normalizeVector(extractSingleVector(rawEmbeddings));
      calls.push({ elapsedMs, embedding, stats: response.stats || null });
    }
  } finally {
    await model.unload();
  }

  fs.writeFileSync(responsePath, JSON.stringify({ loadTimeMs, calls }));
}

main()
  .then(() => Bare.exit(0))
  .catch((err) => {
    try {
      const { responsePath } = getArgs();
      if (responsePath) {
        fs.writeFileSync(
          responsePath,
          JSON.stringify({ error: err && err.message ? err.message : String(err), stack: err && err.stack })
        );
      }
    } catch {
      // best-effort error reporting only
    }
    console.error(err && err.stack ? err.stack : String(err));
    Bare.exit(1);
  });
