import { describe, expect, it } from "vitest";
import { ModelManagementService } from "../../models/service/models.service.js";
import type {
  ModelProvisioningPort,
  ModelRuntimePort,
} from "../../models/domain/ports.js";
import type {
  ChatCompletionRequest,
  ChatCompletionResult,
  InferenceResult,
  LoadedModel,
  ModelSource,
} from "../../models/domain/types.js";
import { AgentService } from "./agentService.js";
import type { ConversationMessage } from "./agentService.js";
import { RagRetrievalService } from "../../rag/service/rag.service.js";
import { FakeEmbeddingPort } from "../../rag/infra/fakeEmbedding.adapter.js";
import { buildFixtureVectorStore } from "../../rag/infra/fixtures/corpus-chunks.fixture.js";
import type { DocumentRepository } from "../../document/domain/document-repository.port.js";
import {
  DocumentFormat,
  DocumentStatus,
  DocumentType,
  type ArchitectureDocument,
} from "../../document/domain/document.model.js";
import { TranscriptionService } from "../../speech/service/transcription.service.js";
import type { SpeechTranscriptionPort } from "../../speech/domain/ports.js";
import type { AudioInput, StreamTranscriptSession, TranscriptionResult } from "../../speech/domain/types.js";
import { TtsService } from "../../tts/service/tts.service.js";
import type { TextToSpeechPort } from "../../tts/domain/ports.js";
import type { SynthesisResult } from "../../tts/domain/types.js";
import { EmptyTranscriptError, VoiceAgentService } from "./voiceAgentService.js";

/** Immediately resolves load/chat calls; replays `responses` one per `chatComplete` call (repeating the last one), recording every request for assertions. Mirrors agentService.test.ts's fake. */
class FakeModelRuntime implements ModelProvisioningPort, ModelRuntimePort {
  readonly chatRequests: ChatCompletionRequest[] = [];
  private callCount = 0;

  constructor(
    private readonly responses: ChatCompletionResult[] = [
      { text: "ok", toolCalls: [] },
    ],
  ) {}

  get lastChatRequest(): ChatCompletionRequest | undefined {
    return this.chatRequests.at(-1);
  }

  async searchRegistry() {
    return [];
  }

  async listRegistry() {
    return [];
  }

  async provision() {}

  load(source: ModelSource): Promise<LoadedModel> & { requestId: string } {
    return Object.assign(
      Promise.resolve({ modelId: "fake-model", source, loadedAt: new Date() }),
      { requestId: "req-load" },
    );
  }

  infer(): Promise<InferenceResult> & { requestId: string } {
    return Object.assign(Promise.resolve({ text: "" }), {
      requestId: "req-infer",
    });
  }

  chatComplete(
    _modelId: string,
    request: ChatCompletionRequest,
    onToken?: (textDelta: string) => void,
  ): Promise<ChatCompletionResult> & { requestId: string } {
    this.chatRequests.push(request);
    const response =
      this.responses[Math.min(this.callCount, this.responses.length - 1)];
    this.callCount++;
    // Mirrors the real adapter's streaming contract: deltas sum to the full
    // text, so a single delta with the whole response satisfies it here.
    // AgentService.invoke() now always streams (graph.stream(...) drives
    // ChatQVAC._streamResponseChunks), which only ever sees the answer text
    // through this callback - without it, the final answer is always "".
    if (response.text) onToken?.(response.text);
    return Object.assign(Promise.resolve(response), {
      requestId: `req-chat-${this.chatRequests.length}`,
    });
  }

  async unload() {}

  async close() {}

  async cancel() {}
}

class FakeDocumentRepository implements DocumentRepository {
  constructor(private readonly documents: ArchitectureDocument[]) {}

  async findAll(): Promise<ArchitectureDocument[]> {
    return this.documents;
  }

  async findById(id: string): Promise<ArchitectureDocument | null> {
    return this.documents.find((document) => document.id === id) ?? null;
  }

  async findByStatus(status: DocumentStatus): Promise<ArchitectureDocument[]> {
    return this.documents.filter((document) => document.status === status);
  }

  async findByType(type: DocumentType): Promise<ArchitectureDocument[]> {
    return this.documents.filter((document) => document.type === type);
  }

  async create(): Promise<ArchitectureDocument> {
    throw new Error("FakeDocumentRepository is read-only");
  }
}

const FAKE_DOCUMENTS: ArchitectureDocument[] = [
  {
    id: "policies/warranty-terms.md",
    title: "Warranty Terms",
    type: DocumentType.POLICIES,
    format: DocumentFormat.MARKDOWN,
    status: DocumentStatus.ACTIVE,
    tags: [],
    content: "Standard warranty covers 24 months.",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  },
  {
    id: "faqs/support-sla-faq.html",
    title: "Support Sla Faq",
    type: DocumentType.FAQ,
    format: DocumentFormat.HTML,
    status: DocumentStatus.ACTIVE,
    tags: [],
    content: "Enterprise P1 SLA is 4 hours.",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  },
];

/** Returns a fixed transcript for every call, regardless of the audio passed in. */
class FakeSpeechPort implements SpeechTranscriptionPort {
  transcribeCalls: { modelId: string; audio: AudioInput }[] = [];

  constructor(private readonly text: string) {}

  async transcribe(modelId: string, audio: AudioInput): Promise<TranscriptionResult> {
    this.transcribeCalls.push({ modelId, audio });
    return { text: this.text };
  }

  async transcribeStream(): Promise<StreamTranscriptSession> {
    throw new Error("not used by VoiceAgentService");
  }
}

/** Controllable fake: synthesize() only settles when the test calls resolveNext()/rejectNext(). Mirrors tts.service.test.ts's fake. */
class FakeTtsPort implements TextToSpeechPort {
  synthesizeCalls: { modelId: string; text: string }[] = [];
  private pendingResolve?: (result: SynthesisResult) => void;
  private pendingReject?: (err: unknown) => void;

  synthesize(modelId: string, text: string): Promise<SynthesisResult> {
    this.synthesizeCalls.push({ modelId, text });
    return new Promise((resolve, reject) => {
      this.pendingResolve = resolve;
      this.pendingReject = reject;
    });
  }

  async cancel(): Promise<void> {}

  resolveNext(result: SynthesisResult): void {
    this.pendingResolve?.(result);
  }

  rejectNext(err: unknown): void {
    this.pendingReject?.(err);
  }
}

/** Lets already-queued microtasks (model loads, the graph's internal chat round trips) run before assertions. */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function setup(responses: ChatCompletionResult[], transcript: string) {
  const runtime = new FakeModelRuntime(responses);
  const modelService = new ModelManagementService(runtime, runtime);

  const embeddingPort = new FakeEmbeddingPort();
  const vectorStore = await buildFixtureVectorStore(embeddingPort);
  const ragService = new RagRetrievalService(embeddingPort, vectorStore);

  const agentService = new AgentService(modelService, ragService, new FakeDocumentRepository(FAKE_DOCUMENTS));

  const transcriptionService = new TranscriptionService(modelService, new FakeSpeechPort(transcript));

  const ttsPort = new FakeTtsPort();
  const ttsService = new TtsService(modelService, ttsPort);

  const voiceAgentService = new VoiceAgentService(agentService, transcriptionService, ttsService);

  return { runtime, voiceAgentService, ttsPort };
}

describe("VoiceAgentService.invoke", () => {
  it("transcribes the audio, appends it to the given history, and returns transcript+answer+synthesized audio", async () => {
    const { runtime, voiceAgentService, ttsPort } = await setup(
      [
        { text: "", toolCalls: [{ id: "call_1", name: "list_documents", arguments: {} }] },
        { text: "There are 2 documents ingested.", toolCalls: [] },
      ],
      "What documents are ingested?",
    );

    const history: ConversationMessage[] = [
      { role: "user", message: "hi" },
      { role: "assistant", message: "hello" },
    ];

    const resultPromise = voiceAgentService.invoke(history, Buffer.from([1, 2, 3]));
    await flushMicrotasks();
    const synthesizedAudio = Buffer.from([9, 9]);
    ttsPort.resolveNext({ audio: synthesizedAudio, sampleRate: 44100 });
    const result = await resultPromise;

    expect(result.transcript).toBe("What documents are ingested?");
    expect(result.answer).toBe("There are 2 documents ingested.");
    expect(result.audio).toEqual(synthesizedAudio);
    expect(result.sampleRate).toBe(44100);

    const finalHistory = runtime.lastChatRequest?.history ?? [];
    const userMessages = finalHistory
      .filter((message) => message.role === "user")
      .map((message) => message.content);
    expect(userMessages).toEqual(["hi", "What documents are ingested?"]);
  });

  it("degrades to text-only (no audio/sampleRate) when TTS synthesis fails, and accepts an empty history", async () => {
    const { voiceAgentService, ttsPort } = await setup(
      [
        { text: "", toolCalls: [{ id: "call_1", name: "list_documents", arguments: {} }] },
        { text: "There are 2 documents ingested.", toolCalls: [] },
      ],
      "What documents are ingested?",
    );

    const resultPromise = voiceAgentService.invoke([], Buffer.from([1, 2, 3]));
    await flushMicrotasks();
    ttsPort.rejectNext(new Error("synthesis boom"));
    const result = await resultPromise;

    expect(result.transcript).toBe("What documents are ingested?");
    expect(result.answer).toBe("There are 2 documents ingested.");
    expect(result.audio).toBeUndefined();
    expect(result.sampleRate).toBeUndefined();
  });

  it("rejects with EmptyTranscriptError instead of invoking the agent when transcription yields no text", async () => {
    const { runtime, voiceAgentService } = await setup(
      [{ text: "ok", toolCalls: [] }],
      "   ", // whitespace-only: whisper's real-world equivalent of "heard nothing"
    );

    await expect(voiceAgentService.invoke([], Buffer.from([1, 2, 3]))).rejects.toThrow(EmptyTranscriptError);
    expect(runtime.lastChatRequest).toBeUndefined();
  });
});
