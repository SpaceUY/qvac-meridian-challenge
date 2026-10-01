import type { RetrievedChunk } from "../../rag/domain/types.js";
import type { AgentService, ConversationMessage } from "./agentService.js";
import type { TranscriptionService } from "../../speech/service/transcription.service.js";
import type { TtsService } from "../../tts/service/tts.service.js";

/** Thrown when transcription produced no usable text (silence, noise-only audio, a too-short clip) - there's no user message to run through the agent. */
export class EmptyTranscriptError extends Error {
  constructor() {
    super("transcription produced no text");
    this.name = "EmptyTranscriptError";
  }
}

export interface VoiceInvokeResult {
  transcript: string;
  answer: string;
  /** The model's raw reasoning/thinking trace for this reply, when the runtime captured one (see AgentService.InvokeResult). */
  thinkingText?: string;
  /** RAG chunks retrieved for this turn and passed to the model as grounding context. */
  chunks: RetrievedChunk[];
  /** Undefined when TTS synthesis fails — the turn still succeeds as text-only. */
  audio?: Buffer;
  sampleRate?: number;
}

/**
 * Composes the existing text orchestrator with STT/TTS for a single voice
 * turn: transcribe the incoming audio, run it through AgentService's graph
 * with the caller's prior history plus the new transcript, then synthesize
 * the answer. Degrades to text-only (no `audio`/`sampleRate`) if synthesis
 * fails - the turn itself already succeeded by that point.
 */
export class VoiceAgentService {
  constructor(
    private readonly agentService: AgentService,
    private readonly transcriptionService: TranscriptionService,
    private readonly ttsService: TtsService,
  ) {}

  async invoke(history: ConversationMessage[], audio: Buffer): Promise<VoiceInvokeResult> {
    const transcript = await this.transcriptionService.transcribeBuffer(audio);
    if (!transcript.trim()) {
      // Feeding an empty string into the RAG embedding step throws deep
      // inside the QVAC SDK ("Text cannot be empty") - catch it here, where
      // it's an expected outcome (silence/noise-only audio), not a 500.
      throw new EmptyTranscriptError();
    }

    const result = await this.agentService.invoke([
      ...history,
      { role: "user", message: transcript },
    ]);

    let synthesis: { audio: Buffer; sampleRate: number } | undefined;
    try {
      synthesis = await this.ttsService.synthesizeSync(result.answer);
    } catch (err) {
      console.error("[voice:tts]", err);
    }

    return {
      transcript,
      answer: result.answer,
      thinkingText: result.thinkingText,
      chunks: result.chunks,
      ...synthesis,
    };
  }
}
