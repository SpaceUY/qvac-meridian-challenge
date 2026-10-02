/**
 * Validates multilingual (English + Spanish) local speech-to-text end to
 * end against real audio files, and proves the resulting transcript is
 * directly reusable as a normal assistant query:
 *
 *   load whisper (ModelManagementService, reused unchanged) ->
 *   transcribe() on an EN file and an ES file (human-checkable output) ->
 *   transcribeStream() on the EN file, fed as incremental PCM chunks (the
 *   hands-free flow) -> AgentService.invoke(transcript) (also unchanged) ->
 *   unload -> close
 *
 * Run with:
 *   npm run speech-demo --workspace=apps/backend -- --audio-en <path> --audio-es <path>
 */
import { readFile } from "node:fs/promises";
import { AgentService } from "../ai/orchestrator/agentService.js";
import { ModelManagementService } from "../models/service/models.service.js";
import { QvacRuntimeAdapter } from "../models/infra/qvacRuntimeAdapter.js";
import { QvacTranscriptionAdapter } from "./infra/qvacTranscriptionAdapter.js";
import { TranscriptionService } from "./service/transcription.service.js";
import {
  chunkPcm,
  parseWavPcm,
  warnIfUnexpectedFormat,
} from "./infra/wavPcm.js";
import { STREAM_CHUNK_BYTES } from "./demo.const.js";
import { ResilientEmbeddingService } from "../rag/service/resilientEmbeddingService.js";
import { QvacEmbeddingAdapter } from "../rag/infra/qvacEmbeddingAdapter.js";
import {
  DEFAULT_EMBEDDING_BATCH_SIZE,
  EMBEDDING_MODEL_EXPECTED_SIZE,
  EMBEDDING_MODEL_SOURCE,
} from "../config/models.config.js";
import { buildFixtureVectorStore } from "../rag/infra/fixtures/corpus-chunks.fixture.js";
import { RagRetrievalService } from "../rag/service/rag.service.js";
import { CorpusDocumentRepository } from "../document/infra/corpusDocumentRepository.js";

// Safety net for this CLI script only (not the adapter/service): the SDK's
// internal RPC stream can emit an unlistened 'error' event during
// unload/close when a streaming session didn't finish cleanly, which Node
// otherwise treats as an unrecoverable crash bypassing any try/catch here.
process.on("uncaughtException", (err) => {
  console.error(
    "\n✖ Uncaught error (likely the SDK RPC layer during shutdown):",
    err,
  );
  process.exit(1);
});

interface CliArgs {
  audioEnPath: string;
  audioEsPath: string;
}

function parseArgs(argv: string[]): CliArgs {
  const audioEnPath = readFlag(argv, "--audio-en");
  const audioEsPath = readFlag(argv, "--audio-es");
  if (!audioEnPath || !audioEsPath) {
    throw new Error(
      "Usage: npm run speech-demo --workspace=apps/backend -- --audio-en <path/to/english.wav> --audio-es <path/to/spanish.wav>",
    );
  }
  return { audioEnPath, audioEsPath };
}

function readFlag(argv: string[], flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  return idx >= 0 ? argv[idx + 1] : undefined;
}

async function transcribeViaStream(
  transcription: TranscriptionService,
  audioPath: string,
): Promise<string> {
  const wav = parseWavPcm(await readFile(audioPath));
  warnIfUnexpectedFormat(wav);

  const session = await transcription.transcribeLive();
  for (const chunk of chunkPcm(wav.data, STREAM_CHUNK_BYTES)) {
    session.write(chunk);
  }
  session.end();
  try {
    return await session.text;
  } finally {
    session.destroy();
  }
}

async function main(): Promise<void> {
  const { audioEnPath, audioEsPath } = parseArgs(process.argv.slice(2));

  const modelsAdapter = new QvacRuntimeAdapter();
  const models = new ModelManagementService(modelsAdapter, modelsAdapter);
  const transcription = new TranscriptionService(
    models,
    new QvacTranscriptionAdapter(),
  );

  const embeddingPort = new ResilientEmbeddingService(
    models,
    new QvacEmbeddingAdapter(),
    EMBEDDING_MODEL_SOURCE,
    DEFAULT_EMBEDDING_BATCH_SIZE,
    EMBEDDING_MODEL_EXPECTED_SIZE,
  );
  const vectorStore = await buildFixtureVectorStore(embeddingPort);
  const ragService = new RagRetrievalService(embeddingPort, vectorStore);

  const documentRepository = new CorpusDocumentRepository();
  const agent = new AgentService(models, ragService, documentRepository);

  let executionError: unknown;

  try {
    console.log("\n▸ [transcribe] English file...");
    const englishText = await transcription.transcribeFile(audioEnPath);
    console.log(`  ${englishText}`);

    console.log("\n▸ [transcribe] Spanish file...");
    const spanishText = await transcription.transcribeFile(audioEsPath);
    console.log(`  ${spanishText}`);

    console.log(
      "\n▸ [transcribeStream] English file, fed as incremental PCM chunks (hands-free flow)...",
    );
    const streamedText = await transcribeViaStream(transcription, audioEnPath);
    console.log(`  ${streamedText}`);

    console.log(
      "\n▸ Reusing the streamed transcript as a normal assistant query (AgentService.invoke)...",
    );
    const reply = await agent.invoke([{ role: "user", message: streamedText }]);
    console.log(`  Assistant: ${reply.answer}`);
    if (reply.thinkingText) {
      console.log(`  Thinking: ${reply.thinkingText}`);
    }

    console.log(
      "\n▸ Done: transcribe() and transcribeStream() both validated for English and Spanish.",
    );
  } catch (err) {
    executionError = err;
  }

  try {
    await embeddingPort.unload();
    await models.unloadAll();
    await models.close();
  } catch (cleanupErr) {
    console.error("Cleanup failed:", cleanupErr);
    if (!executionError) {
      throw cleanupErr;
    }
  }

  if (executionError) {
    throw executionError;
  }
}

main().catch((err) => {
  console.error("\n✖ Speech demo failed:", err);
  process.exit(1);
});
