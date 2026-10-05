import type { Citation, RetrievedChunk } from "../../rag/domain/types.js";
import type { AgentService, ConversationMessage, InvokeResult } from "./agentService.js";
import type { TranscriptionService } from "../../speech/service/transcription.service.js";
import type { TtsService } from "../../tts/service/tts.service.js";
import type { SpeechNormalizer } from "../../tts/domain/speech/speechNormalizer.js";
import { createEnglishSpeechNormalizer } from "../../tts/domain/speech/createEnglishSpeechNormalizer.js";
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

/** Collaborators with a production default - overridable for tests. */
export interface VoiceAgentOptions {
  /** Turns each answer chunk into the words TTS should say. Defaults to the English rules. */
  speech?: Pick<SpeechNormalizer, "normalize">;
  /** See SentenceChunker. */
  minSentenceChunkChars?: number;
}

export interface VoiceTurnOptions {
  /**
   * Aborting it stops the turn: the LLM is cancelled, no further sentence
   * is synthesized or emitted, and the call rejects with the signal's
   * reason. A transcription or a TTS job already running still finishes -
   * neither can be interrupted - but nothing comes after it.
   */
  signal?: AbortSignal;
}

type Synthesis = { audio: Buffer; sampleRate: number };

/**
 * Composes the existing text orchestrator with STT/TTS for a single voice
 * turn: transcribe the incoming audio, run it through AgentService's graph
 * with the caller's prior history plus the new transcript, then synthesize
 * the answer. Degrades to text-only (no `audio`/`sampleRate`) if synthesis
 * fails - the turn itself already succeeded by that point.
 */
export class VoiceAgentService {
  private readonly speech: Pick<SpeechNormalizer, "normalize">;
  private readonly minSentenceChunkChars: number;

  constructor(
    private readonly agentService: AgentService,
    private readonly transcriptionService: TranscriptionService,
    private readonly ttsService: TtsService,
    {
      speech = createEnglishSpeechNormalizer(),
      minSentenceChunkChars = DEFAULT_MIN_SENTENCE_CHUNK_CHARS,
    }: VoiceAgentOptions = {},
  ) {
    this.speech = speech;
    this.minSentenceChunkChars = minSentenceChunkChars;
  }

  async invoke(
    history: ConversationMessage[],
    audio: Buffer,
    { signal }: VoiceTurnOptions = {},
  ): Promise<VoiceInvokeResult> {
    const transcript = await this.transcribe(audio, signal);

    let streamedAnswer = "";
    const result = await this.runAgent(history, transcript, signal, (textDelta) => {
      streamedAnswer += textDelta;
    });
    // Prefer the text built up from the streamed deltas - falls back to the
    // graph's own resolved answer only if generation produced no stream
    // event at all (see AgentService.runInvoke's matching safety net).
    const answer = streamedAnswer || result.answer;

    const synthesis = await this.synthesize(answer, signal);
    signal?.throwIfAborted();

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
   * only the copy sent to TTS is normalized (see `synthesize`).
   */
  async invokeStreaming(
    history: ConversationMessage[],
    audio: Buffer,
    onChunk: (chunk: VoiceStreamChunk) => void | Promise<void>,
    { signal }: VoiceTurnOptions = {},
  ): Promise<VoiceStreamResult> {
    const transcript = await this.transcribe(audio, signal);

    const chunker = new SentenceChunker(this.minSentenceChunkChars);
    let streamedAnswer = "";
    // Chains sentence synthesis+emission one at a time, decoupled from the
    // token stream that discovers them - onToken below can't itself be
    // async (AgentService.invoke's callback is fire-and-forget per token).
    let processingChain: Promise<void> = Promise.resolve();
    const enqueueSentence = (sentence: string) => {
      processingChain = processingChain.then(() => this.synthesizeAndEmit(sentence, onChunk, signal));
    };

    let result: InvokeResult;
    try {
      result = await this.runAgent(history, transcript, signal, (textDelta) => {
        streamedAnswer += textDelta;
        for (const sentence of chunker.push(textDelta)) enqueueSentence(sentence);
      });
    } catch (err) {
      // Let the sentences already queued settle before the caller ends the
      // response - none of them emits anything once the turn is stopped.
      await processingChain;
      throw err;
    }

    const remainder = chunker.flush();
    if (remainder) enqueueSentence(remainder);
    await processingChain;
    signal?.throwIfAborted();

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

  /** The STT call itself can't be interrupted - a turn stopped meanwhile is noticed right after it. */
  private async transcribe(audio: Buffer, signal: AbortSignal | undefined): Promise<string> {
    const transcript = await this.transcriptionService.transcribeBuffer(audio);
    signal?.throwIfAborted();
    if (!transcript.trim()) {
      // Feeding an empty string into the RAG embedding step throws deep
      // inside the QVAC SDK ("Text cannot be empty") - catch it here, where
      // it's an expected outcome (silence/noise-only audio), not a 500.
      throw new EmptyTranscriptError();
    }
    return transcript;
  }

  /** Runs the agent on the history plus the new transcript, cancelling the LLM as soon as `signal` aborts - the call then rejects with the signal's reason, not the cancellation error. */
  private async runAgent(
    history: ConversationMessage[],
    transcript: string,
    signal: AbortSignal | undefined,
    onToken: (textDelta: string) => void,
  ): Promise<InvokeResult> {
    signal?.throwIfAborted();
    const pending = this.agentService.invoke([...history, { role: "user", message: transcript }], undefined, onToken);
    const cancelGeneration = () => {
      this.agentService.cancel(pending.requestId).catch((err: unknown) => {
        console.error("[voice:cancel]", err);
      });
    };
    signal?.addEventListener("abort", cancelGeneration, { once: true });
    try {
      return await pending;
    } catch (err) {
      signal?.throwIfAborted();
      throw err;
    } finally {
      signal?.removeEventListener("abort", cancelGeneration);
    }
  }

  private async synthesizeAndEmit(
    sentence: string,
    onChunk: (chunk: VoiceStreamChunk) => void | Promise<void>,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    if (signal?.aborted) return; // stopped: nothing more to say, nobody to send it to
    const synthesis = await this.synthesize(sentence, signal);
    if (signal?.aborted) return;
    await onChunk({ text: sentence, ...synthesis });
  }

  /**
   * The text goes out verbatim (its line breaks lay out the Markdown on
   * screen), but TTS gets the words to say: normalized, then trimmed. Text
   * with nothing left to say (whitespace, a lone "---") isn't synthesized
   * at all - the SDK rejects blank text outright. A failed synthesis
   * degrades to text only; a stopped one isn't a failure worth logging.
   */
  private async synthesize(text: string, signal: AbortSignal | undefined): Promise<Synthesis | undefined> {
    const speech = this.speech.normalize(text).trim();
    if (!speech) return undefined;
    try {
      return await this.ttsService.synthesizeSync(speech, { signal });
    } catch (err) {
      if (!signal?.aborted) console.error("[voice:tts]", err);
      return undefined;
    }
  }
}
