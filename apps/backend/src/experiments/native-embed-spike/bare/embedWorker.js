/**
 * I.4 spike - runs inside the Bare runtime (spawned by nativeEmbedClient.ts), never Node/tsx: `@qvac/embed-llamacpp`'s `binding.js` uses a Bare-only addon loader Node doesn't implement.
 * `normalizeVector`/`extractSingleVector` are imported from the production module (`rag/infra/nativeEmbedding/bare/`) rather than duplicated here.
 * Protocol: `Bare.argv` carries `[requestPath, responsePath]` at index 2/3. Request: `{modelPath, config, texts}`. Response: `{loadTimeMs, calls}` or `{error, stack}` (exit code 1) on failure.
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
