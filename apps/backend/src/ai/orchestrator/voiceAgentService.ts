import type { Citation, RetrievedChunk } from "../../rag/domain/types.js";
import type { AgentService, ConversationMessage } from "./agentService.js";
import type { TranscriptionService } from "../../speech/service/transcription.service.js";
import type { TtsService } from "../../tts/service/tts.service.js";
import type { ContextUsage } from "./contextBudget.js";
import { SentenceChunker } from "./sentenceChunker.js";
import { DEFAULT_MIN_SENTENCE_CHUNK_CHARS } from "../../config/voice.config.js";

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
  /** Same tool-usage list AgentService computed for this turn. */
  toolsUsed: string[];
  /** Same citations AgentService computed for this turn - voice and text answers cite identically. */
  citations: Citation[];
  /** Undefined when TTS synthesis fails — the turn still succeeds as text-only. */
  audio?: Buffer;
  sampleRate?: number;
}

/** One sentence-sized piece of a streamed voice answer. `audio`/`sampleRate` are undefined if that sentence's synthesis failed - the chunk still carries its text. */
export interface VoiceStreamChunk {
  text: string;
  audio?: Buffer;
  sampleRate?: number;
}

/** Final summary once a streamed voice turn finishes - same fields as `VoiceInvokeResult` minus `audio`/`sampleRate`, which arrived incrementally via `onChunk`. */
export interface VoiceStreamResult {
  transcript: string;
  answer: string;
  thinkingText?: string;
  chunks: RetrievedChunk[];
  toolsUsed: string[];
  citations: Citation[];
  /** Same context usage AgentService measured for this turn. */
  context?: ContextUsage;
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
    private readonly minSentenceChunkChars: number = DEFAULT_MIN_SENTENCE_CHUNK_CHARS,
  ) {}

  async invoke(history: ConversationMessage[], audio: Buffer): Promise<VoiceInvokeResult> {
    const transcript = await this.transcriptionService.transcribeBuffer(audio);
    if (!transcript.trim()) {
      // Feeding an empty string into the RAG embedding step throws deep
      // inside the QVAC SDK ("Text cannot be empty") - catch it here, where
      // it's an expected outcome (silence/noise-only audio), not a 500.
      throw new EmptyTranscriptError();
    }

    let streamedAnswer = "";
    const result = await this.agentService.invoke(
      [...history, { role: "user", message: transcript }],
      undefined,
      (textDelta) => {
        streamedAnswer += textDelta;
      },
    );
    // Prefer the text built up from the streamed deltas - falls back to the
    // graph's own resolved answer only if generation produced no stream
    // event at all (see AgentService.runInvoke's matching safety net).
    const answer = streamedAnswer || result.answer;

    let synthesis: { audio: Buffer; sampleRate: number } | undefined;
    try {
      synthesis = await this.ttsService.synthesizeSync(answer);
    } catch (err) {
      console.error("[voice:tts]", err);
    }

    return {
      transcript,
      answer,
      thinkingText: result.thinkingText,
      chunks: result.chunks,
      toolsUsed: result.toolsUsed,
      citations: result.citations,
      ...synthesis,
    };
  }

  /**
   * Same turn as `invoke()`, but synthesizes and emits audio sentence by
   * sentence as the answer streams in, instead of waiting for the whole
   * answer before running TTS once. Sentence boundaries come from
   * `SentenceChunker`; each completed sentence is synthesized and passed to
   * `onChunk` strictly in order - one TTS call at a time, since the
   * underlying model isn't safe for concurrent use. A chunk whose synthesis
   * fails still goes out with its text, `audio`/`sampleRate` undefined.
   * Each chunk's `text` is the sentence verbatim, surrounding whitespace
   * included, so the chunks joined back together are the exact answer;
   * only the copy sent to TTS is trimmed.
   */
  async invokeStreaming(
    history: ConversationMessage[],
    audio: Buffer,
    onChunk: (chunk: VoiceStreamChunk) => void | Promise<void>,
  ): Promise<VoiceStreamResult> {
    const transcript = await this.transcriptionService.transcribeBuffer(audio);
    if (!transcript.trim()) {
      throw new EmptyTranscriptError();
    }

    const chunker = new SentenceChunker(this.minSentenceChunkChars);
    let streamedAnswer = "";
    // Chains sentence synthesis+emission one at a time, decoupled from the
    // token stream that discovers them - onToken below can't itself be
    // async (AgentService.invoke's callback is fire-and-forget per token).
    let processingChain: Promise<void> = Promise.resolve();
    const enqueueSentence = (sentence: string) => {
      processingChain = processingChain.then(() => this.synthesizeAndEmit(sentence, onChunk));
    };

    const result = await this.agentService.invoke(
      [...history, { role: "user", message: transcript }],
      undefined,
      (textDelta) => {
        streamedAnswer += textDelta;
        for (const sentence of chunker.push(textDelta)) enqueueSentence(sentence);
      },
    );

    const remainder = chunker.flush();
    if (remainder) enqueueSentence(remainder);
    await processingChain;

    const answer = streamedAnswer || result.answer;

    return {
      transcript,
      answer,
      thinkingText: result.thinkingText,
      chunks: result.chunks,
      toolsUsed: result.toolsUsed,
      citations: result.citations,
      ...(result.context ? { context: result.context } : {}),
    };
  }

  private async synthesizeAndEmit(
    sentence: string,
    onChunk: (chunk: VoiceStreamChunk) => void | Promise<void>,
  ): Promise<void> {
    // The chunk goes out verbatim (its line breaks lay out the Markdown on
    // screen), but TTS only needs the words - and the SDK rejects
    // whitespace-only text outright, so such a chunk goes out as text only.
    const speech = sentence.trim();
    let synthesis: { audio: Buffer; sampleRate: number } | undefined;
    if (speech) {
      try {
        synthesis = await this.ttsService.synthesizeSync(speech);
      } catch (err) {
        console.error("[voice:tts]", err);
      }
    }
    await onChunk({ text: sentence, ...synthesis });
  }
}
