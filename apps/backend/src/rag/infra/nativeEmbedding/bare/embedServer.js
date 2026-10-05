/**
 * Persistent Bare worker (unlike the I.4 spike's one-shot `embedWorker.js`): loads the model once,
 * serves embed requests over a named pipe (newline-delimited JSON) until shutdown or crash.
 * argv: [pipePath, modelPath, configJson]. A crash here makes `nativeEmbeddingClient.ts` fail the
 * session over to the SDK embedding path.
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
    // Chain onto processing so lines stay ordered, defending against the addon's single-job queue.
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
