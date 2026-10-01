/**
 * Persistent Bare worker for the native embedding path (I.4 integration).
 * Unlike the I.4 spike's `experiments/native-embed-spike/bare/embedWorker.js`
 * (one-shot: load -> embed N texts -> unload -> exit, built for
 * benchmarking), this process loads the model ONCE and stays alive for the
 * life of the server, serving embed requests over a named pipe until told to
 * shut down or until it crashes. `nativeEmbeddingClient.ts` is the Node-side
 * counterpart.
 *
 * No `@qvac/sdk` import anywhere in this file or its dependency chain - same
 * property the spike established.
 *
 * Wire protocol: newline-delimited JSON over a `bare-pipe` connection to the
 * named pipe path passed as `Bare.argv[2]` (mirrors Node's `process.argv`:
 * [bareExePath, scriptPath, ...userArgs] - same indexing lesson the spike's
 * `embedWorker.js` documents).
 *
 *   argv: [pipePath, modelPath, configJson]
 *
 *   worker -> node, once connected and the model has loaded:
 *     {"type":"ready"}
 *   worker -> node, if the model fails to load:
 *     {"type":"initError","error":"..."}
 *   node -> worker:
 *     {"id":1,"type":"embed","texts":["a","b"]}
 *     {"id":2,"type":"shutdown"}
 *   worker -> node:
 *     {"id":1,"ok":true,"results":[{"embedding":[...],"stats":{...}}, ...]}
 *     {"id":1,"ok":false,"error":"..."}
 *     {"id":2,"ok":true}   // after shutdown - worker exits right after
 *
 * A single bad request (e.g. malformed JSON, unknown "type") reports an
 * error over the socket without killing the worker. An uncaught exception,
 * or a native crash the JS layer never gets a chance to catch, kills the
 * whole process - `nativeEmbeddingClient.ts` treats an unexpected exit as a
 * crash and fails the native provider over to the SDK path for the rest of
 * the session.
 */
import Pipe from "bare-pipe";
import GGMLBert from "@qvac/embed-llamacpp";
import { normalizeVector, extractSingleVector } from "./embeddingVectorNormalization.js";

const [, , pipePath, modelPath, configJson] = Bare.argv;
if (!pipePath || !modelPath) {
  console.error(`usage: bare embedServer.js <pipePath> <modelPath> <configJson> (got argv=${JSON.stringify(Bare.argv)})`);
  Bare.exit(1);
}

const config = configJson ? JSON.parse(configJson) : {};

const socket = new Pipe(pipePath);

function send(message) {
  socket.write(JSON.stringify(message) + "\n");
}

let model = null;

async function embedTexts(texts) {
  const results = [];
  for (const text of texts) {
    const response = await model.run(text);
    const rawEmbeddings = await response.await();
    results.push({ embedding: normalizeVector(extractSingleVector(rawEmbeddings)), stats: response.stats || null });
  }
  return results;
}

/** Requests are handled one at a time, in arrival order - matches GGMLBert's own single-job constraint (a second concurrent `run()` throws "Cannot set new job"), so there is no separate queue to maintain here. */
let processing = Promise.resolve();

async function handleMessage(message) {
  if (message.type === "shutdown") {
    try {
      await model.unload();
      send({ id: message.id, ok: true });
    } finally {
      socket.end();
      Bare.exit(0);
    }
    return;
  }

  if (message.type === "embed") {
    try {
      const results = await embedTexts(message.texts);
      send({ id: message.id, ok: true, results });
    } catch (err) {
      send({ id: message.id, ok: false, error: err && err.message ? err.message : String(err) });
    }
    return;
  }

  send({ id: message.id ?? null, ok: false, error: `unknown message type: ${message.type}` });
}

let buffer = "";
socket.on("data", (chunk) => {
  buffer += chunk.toString();
  let idx;
  while ((idx = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch (err) {
      send({ id: null, ok: false, error: `invalid JSON request: ${err.message}` });
      continue;
    }
    // Chain onto `processing` so concurrent lines (shouldn't happen given the
    // client is single-flight, but defends against it) are still handled
    // strictly in order rather than racing the addon's single-job queue.
    processing = processing.then(() => handleMessage(message));
  }
});

socket.on("error", (err) => {
  console.error("pipe error:", err && err.message ? err.message : String(err));
  Bare.exit(1);
});

socket.on("connect", () => {
  (async () => {
    try {
      model = new GGMLBert({ files: { model: [modelPath] }, config, opts: { stats: true } });
      await model.load();
      send({ type: "ready" });
    } catch (err) {
      send({ type: "initError", error: err && err.message ? err.message : String(err) });
      Bare.exit(1);
    }
  })();
});
