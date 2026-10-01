import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelManagementService } from "../../models/service/models.service.js";
import { DelegatedProviderUnreachableError } from "../../models/domain/errors.js";
import type { ModelProvisioningPort, ModelRuntimePort } from "../../models/domain/ports.js";
import type {
  ChatCompletionResult,
  InferenceResult,
  LoadedModel,
  LoadedModelDelegationInfo,
  LoadModelOptions,
  ModelSource,
} from "../../models/domain/types.js";
import { RagRetrievalService } from "../../rag/service/rag.service.js";
import { FakeEmbeddingPort } from "../../rag/infra/fakeEmbedding.adapter.js";
import { buildFixtureVectorStore } from "../../rag/infra/fixtures/corpus-chunks.fixture.js";
import type { DocumentRepository } from "../../document/domain/document-repository.port.js";

const DELEGATE = { providerPublicKey: "pk-abc", fallbackToLocal: true };

vi.mock("../../config/delegate.config.js", () => ({
  DELEGATE_CONFIG: DELEGATE,
  HEARTBEAT_CONFIG: { intervalMs: 15_000, timeoutMs: 3_000 },
}));

const { AgentService } = await import("./agentService.js");

class EmptyDocumentRepository implements DocumentRepository {
  async findAll() {
    return [];
  }

  async findById() {
    return null;
  }

  async findByStatus() {
    return [];
  }

  async findByType() {
    return [];
  }

  async create(): Promise<never> {
    throw new Error("EmptyDocumentRepository is read-only");
  }
}

/** Records the `options` passed to `load()`; resolves immediately with a fixed model id. */
class RecordingModelRuntime implements ModelProvisioningPort, ModelRuntimePort {
  lastLoadOptions?: LoadModelOptions;
  /** The registry's live mode for the loaded model: set by every `load()` (and `driftToLocal()`), read by `getLoadedModelInfo()`. */
  private liveDelegated = false;
  /** When true, a `load()` that carries a `delegate` still ends up running locally - the SDK's `fallbackToLocal` behaviour. */
  delegatedLoadsLandLocal = false;
  /** Called at the start of every `load()`, before the live mode changes. */
  onLoad?: () => void;
  /** `chatComplete()`'s outcome per call, consumed in order; a call past the end of this array succeeds. */
  chatCompleteOutcomes: Array<"succeed" | "provider-unreachable"> = [];
  loadCallCount = 0;
  heartbeatOutcome: "ok" | "fail" = "ok";
  heartbeatCalls = 0;
  /** When true, every `load()` that carries a `delegate` rejects - a provider that answers heartbeats but cannot load the model. */
  rejectDelegatedLoads = false;
  /** When true, every `load()` rejects, delegated or not - a switch that cannot end up with any model loaded. */
  rejectAllLoads = false;

  async heartbeat(): Promise<void> {
    this.heartbeatCalls += 1;
    if (this.heartbeatOutcome === "fail") throw new Error("provider unreachable");
  }

  async searchRegistry() {
    return [];
  }

  async listRegistry() {
    return [];
  }

  async provision() {}

  load(source: ModelSource, options?: LoadModelOptions): Promise<LoadedModel> & { requestId: string } {
    this.loadCallCount += 1;
    this.lastLoadOptions = options;
    this.onLoad?.();
    if (this.rejectAllLoads || (this.rejectDelegatedLoads && options?.delegate)) {
      return Object.assign(Promise.reject(new Error("Provider failed to load model")), { requestId: "req-load" });
    }
    this.liveDelegated = Boolean(options?.delegate) && !this.delegatedLoadsLandLocal;
    return Object.assign(
      Promise.resolve({ modelId: "fake-model", source, loadedAt: new Date() }),
      { requestId: "req-load" },
    );
  }

  infer(): Promise<InferenceResult> & { requestId: string } {
    return Object.assign(Promise.resolve({ text: "" }), { requestId: "req-infer" });
  }

  chatComplete(
    _modelId: string,
    _request: unknown,
    onToken?: (textDelta: string) => void,
  ): Promise<ChatCompletionResult> & { requestId: string } {
    const requestId = `req-chat-${Math.random()}`;
    const outcome = this.chatCompleteOutcomes.shift() ?? "succeed";
    if (outcome === "provider-unreachable") {
      return Object.assign(Promise.reject(new DelegatedProviderUnreachableError()), { requestId });
    }
    onToken?.("ok");
    return Object.assign(Promise.resolve({ text: "ok", toolCalls: [] }), { requestId });
  }

  async unload() {}

  async close() {}

  async cancel() {}

  /** Flips the live registry to local without any `load()` - the model changing mode behind the chat model's back. */
  driftToLocal(): void {
    this.liveDelegated = false;
  }

  async getLoadedModelInfo(): Promise<LoadedModelDelegationInfo> {
    return this.liveDelegated ? { isDelegated: true, providerPublicKey: "pk-abc" } : { isDelegated: false };
  }
}

/** When `hang` is set, `embed()` never settles - freezes an `invoke()` in RAG retrieval, before any chat completion starts. */
class HangingEmbeddingPort extends FakeEmbeddingPort {
  hang = false;

  override async embed(text: string): Promise<number[]> {
    if (this.hang) return new Promise<number[]>(() => {});
    return super.embed(text);
  }
}

async function buildAgentService(
  runtime: RecordingModelRuntime,
  embeddingPort: FakeEmbeddingPort = new FakeEmbeddingPort(),
) {
  const modelService = new ModelManagementService(runtime, runtime);
  const vectorStore = await buildFixtureVectorStore(embeddingPort);
  const ragService = new RagRetrievalService(embeddingPort, vectorStore);
  return new AgentService(modelService, ragService, new EmptyDocumentRepository());
}

describe("AgentService delegate wiring", () => {
  it("passes the configured DELEGATE_CONFIG through to the chat model's load", async () => {
    const runtime = new RecordingModelRuntime();
    const agentService = await buildAgentService(runtime);

    await agentService.preload();

    expect(runtime.lastLoadOptions?.delegate).toEqual(DELEGATE);
  });

  it("reports delegation info once the model is ready", async () => {
    const runtime = new RecordingModelRuntime();
    const agentService = await buildAgentService(runtime);

    await agentService.preload();

    expect(agentService.getStatus()).toMatchObject({
      status: "ready",
      delegation: { isDelegated: true, providerPublicKey: "pk-abc" },
    });
  });

  it("omits delegation info from status until it's known (not present before preload)", async () => {
    const runtime = new RecordingModelRuntime();
    const agentService = await buildAgentService(runtime);

    expect(agentService.getStatus().delegation).toBeUndefined();
  });

  it("refreshes status once the model recovers from a dead provider mid-session", async () => {
    const runtime = new RecordingModelRuntime();
    const agentService = await buildAgentService(runtime);
    await agentService.preload();
    expect(agentService.getStatus().delegation).toEqual({
      isDelegated: true,
      providerPublicKey: "pk-abc",
    });

    // The provider is now dead: the first chat completion fails, recovery
    // reloads locally, and the retry succeeds - a fresh introspection
    // query at that point reports local, not delegated.
    runtime.chatCompleteOutcomes = ["provider-unreachable"];
    runtime.delegatedLoadsLandLocal = true;
    await agentService.invoke([{ role: "user", message: "hi" }]);

    // The engine panel (GET /api/chat/status) must reflect the recovery,
    // not the stale "still delegated" snapshot cached at preload time.
    expect(agentService.getStatus().delegation).toEqual({ isDelegated: false });
  });

  it("reports recovering:false once the model has settled (not stuck mid-recovery)", async () => {
    const runtime = new RecordingModelRuntime();
    const agentService = await buildAgentService(runtime);
    await agentService.preload();

    expect(agentService.getStatus().recovering).toBe(false);

    runtime.chatCompleteOutcomes = ["provider-unreachable"];
    runtime.delegatedLoadsLandLocal = true;
    await agentService.invoke([{ role: "user", message: "hi" }]);

    expect(agentService.getStatus().recovering).toBe(false);
  });
});

describe("AgentService provider health checks", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("omits providerHealth before preload (the monitor has not started)", async () => {
    const agentService = await buildAgentService(new RecordingModelRuntime());

    expect(agentService.getStatus().providerHealth).toBeUndefined();
  });

  it("reports providerHealth as up once the model is ready", async () => {
    const agentService = await buildAgentService(new RecordingModelRuntime());

    await agentService.preload();

    expect(agentService.getStatus().providerHealth).toEqual({ state: "up", consecutiveFailures: 0 });
  });

  it("does not reload the model while heartbeats keep succeeding", async () => {
    const runtime = new RecordingModelRuntime();
    const agentService = await buildAgentService(runtime);
    vi.useFakeTimers();
    await agentService.preload();

    await vi.advanceTimersByTimeAsync(60_000);

    expect(runtime.heartbeatCalls).toBe(4);
    expect(runtime.loadCallCount).toBe(1);
    expect(agentService.getStatus().providerHealth).toMatchObject({ state: "up", lastLatencyMs: 0 });
  });

  it("falls back to a local model after three failed heartbeats, then re-delegates once the provider answers twice", async () => {
    const runtime = new RecordingModelRuntime();
    const agentService = await buildAgentService(runtime);
    vi.useFakeTimers();
    await agentService.preload();
    expect(runtime.loadCallCount).toBe(1);

    runtime.heartbeatOutcome = "fail";
    await vi.advanceTimersByTimeAsync(45_000);

    expect(runtime.loadCallCount).toBe(2);
    expect(runtime.lastLoadOptions?.delegate).toBeUndefined();
    expect(agentService.getStatus()).toMatchObject({
      delegation: { isDelegated: false },
      providerHealth: { state: "down", consecutiveFailures: 3 },
      recovering: false,
    });

    runtime.heartbeatOutcome = "ok";
    await vi.advanceTimersByTimeAsync(30_000);

    expect(runtime.loadCallCount).toBe(3);
    expect(runtime.lastLoadOptions?.delegate).toEqual(DELEGATE);
    expect(agentService.getStatus()).toMatchObject({
      delegation: { isDelegated: true, providerPublicKey: "pk-abc" },
      providerHealth: { state: "up", consecutiveFailures: 0 },
    });
  });

  it("starts a model that fell back to local at preload as down, and keeps it local while heartbeats fail", async () => {
    const runtime = new RecordingModelRuntime();
    runtime.delegatedLoadsLandLocal = true;
    runtime.heartbeatOutcome = "fail";
    const agentService = await buildAgentService(runtime);
    vi.useFakeTimers();
    await agentService.preload();

    await vi.advanceTimersByTimeAsync(45_000);

    expect(runtime.heartbeatCalls).toBe(3);
    expect(runtime.loadCallCount).toBe(1);
    expect(agentService.getStatus().providerHealth?.state).toBe("down");
  });

  it("re-delegates a model that started local once, after two successful heartbeats", async () => {
    const runtime = new RecordingModelRuntime();
    runtime.delegatedLoadsLandLocal = true;
    const agentService = await buildAgentService(runtime);
    vi.useFakeTimers();
    await agentService.preload();
    expect(agentService.getStatus().providerHealth?.state).toBe("down");

    runtime.delegatedLoadsLandLocal = false;
    await vi.advanceTimersByTimeAsync(30_000);

    expect(runtime.loadCallCount).toBe(2);
    expect(runtime.lastLoadOptions?.delegate).toEqual(DELEGATE);
    expect(agentService.getStatus()).toMatchObject({
      delegation: { isDelegated: true, providerPublicKey: "pk-abc" },
      providerHealth: { state: "up" },
    });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(runtime.loadCallCount).toBe(2);
  });

  it("keeps chat working, with a bounded number of loads, when the provider answers heartbeats but cannot load the model", async () => {
    const runtime = new RecordingModelRuntime();
    runtime.delegatedLoadsLandLocal = true;
    const agentService = await buildAgentService(runtime);
    vi.useFakeTimers();
    await agentService.preload();
    runtime.rejectDelegatedLoads = true;

    await vi.advanceTimersByTimeAsync(120_000);

    // The preload, then one re-delegation attempt: the rejected delegated load plus its local fallback.
    expect(runtime.loadCallCount).toBe(3);
    expect(runtime.lastLoadOptions?.delegate).toBeUndefined();
    expect(agentService.getStatus()).toMatchObject({
      status: "ready",
      delegation: { isDelegated: false },
      providerHealth: { state: "up" },
      recovering: false,
    });

    vi.useRealTimers();
    // Resolving at all is the point: the model is loaded (locally), so the turn no longer throws "Provider failed to load model".
    await expect(agentService.invoke([{ role: "user", message: "hi" }])).resolves.toHaveProperty("answer");
    expect(runtime.loadCallCount).toBe(3);
  });

  it("attempts re-delegation once per down->up transition when it keeps landing local", async () => {
    const runtime = new RecordingModelRuntime();
    // Every load, delegated or not, reports running locally.
    runtime.delegatedLoadsLandLocal = true;
    const agentService = await buildAgentService(runtime);
    vi.useFakeTimers();
    await agentService.preload();

    await vi.advanceTimersByTimeAsync(150_000);

    expect(runtime.loadCallCount).toBe(2);
    expect(runtime.lastLoadOptions?.delegate).toEqual(DELEGATE);

    runtime.heartbeatOutcome = "fail";
    await vi.advanceTimersByTimeAsync(45_000);
    expect(agentService.getStatus().providerHealth?.state).toBe("down");
    expect(runtime.loadCallCount).toBe(2);

    runtime.heartbeatOutcome = "ok";
    await vi.advanceTimersByTimeAsync(30_000);
    expect(runtime.loadCallCount).toBe(3);
    expect(runtime.lastLoadOptions?.delegate).toEqual(DELEGATE);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(runtime.loadCallCount).toBe(3);
  });

  it("sends no heartbeat while an invoke() is pending, even before its chat completion starts", async () => {
    const runtime = new RecordingModelRuntime();
    const embeddingPort = new HangingEmbeddingPort();
    const agentService = await buildAgentService(runtime, embeddingPort);
    vi.useFakeTimers();
    await agentService.preload();
    embeddingPort.hang = true;

    void agentService.invoke([{ role: "user", message: "hi" }]);
    await vi.advanceTimersByTimeAsync(45_000);

    expect(runtime.heartbeatCalls).toBe(0);
    expect(agentService.getStatus().providerHealth).toEqual({ state: "up", consecutiveFailures: 0 });
  });

  it("logs a re-delegation attempt and that the chat model ended up on the provider", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const runtime = new RecordingModelRuntime();
    const agentService = await buildAgentService(runtime);
    vi.useFakeTimers();
    await agentService.preload();
    runtime.heartbeatOutcome = "fail";
    await vi.advanceTimersByTimeAsync(45_000);
    info.mockClear();

    runtime.heartbeatOutcome = "ok";
    await vi.advanceTimersByTimeAsync(30_000);

    const messages = info.mock.calls.map(([message]) => String(message));
    expect(messages).toHaveLength(2);
    expect(messages[0]).toContain("[provider-health] re-delegation attempt started");
    expect(messages[1]).toContain("[provider-health] re-delegation attempt finished");
    expect(messages[1]).toContain("running on the provider");
  });

  it("logs when a re-delegation attempt lands on a local model, and that it will not be retried until the next recovery", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const runtime = new RecordingModelRuntime();
    runtime.delegatedLoadsLandLocal = true;
    const agentService = await buildAgentService(runtime);
    vi.useFakeTimers();
    await agentService.preload();

    await vi.advanceTimersByTimeAsync(150_000);

    const messages = info.mock.calls.map(([message]) => String(message));
    expect(messages).toHaveLength(2);
    expect(messages[1]).toContain("[provider-health] re-delegation attempt finished");
    expect(messages[1]).toContain("running locally");
    expect(messages[1]).toContain("not retried until the provider recovers again");
  });

  it("logs an error when a re-delegation attempt fails outright, and keeps the monitor ticking", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const runtime = new RecordingModelRuntime();
    const agentService = await buildAgentService(runtime);
    vi.useFakeTimers();
    await agentService.preload();
    runtime.heartbeatOutcome = "fail";
    await vi.advanceTimersByTimeAsync(45_000);
    error.mockClear();

    runtime.heartbeatOutcome = "ok";
    runtime.rejectAllLoads = true;
    await vi.advanceTimersByTimeAsync(30_000);

    const messages = error.mock.calls.map(([message]) => String(message));
    expect(messages.some((message) => message.includes("[provider-health] re-delegation attempt failed"))).toBe(true);
    expect(agentService.getStatus().providerHealth?.state).toBe("up");
  });

  it("notices a model that drifted to local behind its back, warns, and re-delegates it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    const runtime = new RecordingModelRuntime();
    const agentService = await buildAgentService(runtime);
    vi.useFakeTimers();
    await agentService.preload();
    expect(agentService.getStatus().delegation).toEqual({ isDelegated: true, providerPublicKey: "pk-abc" });

    let delegationSeenAtReload: LoadedModelDelegationInfo | undefined;
    runtime.onLoad = () => {
      delegationSeenAtReload = agentService.getStatus().delegation;
    };
    runtime.driftToLocal();
    await vi.advanceTimersByTimeAsync(15_000);

    expect(delegationSeenAtReload).toEqual({ isDelegated: false });
    const warnings = warn.mock.calls.map(([message]) => String(message));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("[provider-health] the chat model's mode changed outside a tracked switch");
    expect(warnings[0]).toContain("it was reported as delegated, the SDK now reports local");
    expect(runtime.loadCallCount).toBe(2);
    expect(runtime.lastLoadOptions?.delegate).toEqual(DELEGATE);
    expect(agentService.getStatus().delegation).toEqual({ isDelegated: true, providerPublicKey: "pk-abc" });
  });

  it("re-delegates a drifted model again after an earlier successful re-delegation, without another down->up transition", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const runtime = new RecordingModelRuntime();
    const agentService = await buildAgentService(runtime);
    vi.useFakeTimers();
    await agentService.preload();
    runtime.heartbeatOutcome = "fail";
    await vi.advanceTimersByTimeAsync(45_000);
    runtime.heartbeatOutcome = "ok";
    await vi.advanceTimersByTimeAsync(30_000);
    expect(runtime.loadCallCount).toBe(3);
    expect(agentService.getStatus().delegation?.isDelegated).toBe(true);

    // A tick that observes the model running on the provider is what restores the re-delegation budget.
    await vi.advanceTimersByTimeAsync(15_000);
    runtime.driftToLocal();
    await vi.advanceTimersByTimeAsync(15_000);

    expect(runtime.loadCallCount).toBe(4);
    expect(runtime.lastLoadOptions?.delegate).toEqual(DELEGATE);
    expect(agentService.getStatus()).toMatchObject({
      delegation: { isDelegated: true, providerPublicKey: "pk-abc" },
      providerHealth: { state: "up" },
    });
  });

  it("re-delegates again when the model drifts right after a successful re-delegation, before any tick has observed it", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const runtime = new RecordingModelRuntime();
    const agentService = await buildAgentService(runtime);
    vi.useFakeTimers();
    await agentService.preload();
    runtime.heartbeatOutcome = "fail";
    await vi.advanceTimersByTimeAsync(45_000);
    runtime.heartbeatOutcome = "ok";
    await vi.advanceTimersByTimeAsync(30_000);
    expect(runtime.loadCallCount).toBe(3);
    expect(agentService.getStatus().delegation?.isDelegated).toBe(true);

    runtime.driftToLocal();
    await vi.advanceTimersByTimeAsync(15_000);

    expect(runtime.loadCallCount).toBe(4);
    expect(runtime.lastLoadOptions?.delegate).toEqual(DELEGATE);
    expect(agentService.getStatus()).toMatchObject({
      delegation: { isDelegated: true, providerPublicKey: "pk-abc" },
      providerHealth: { state: "up" },
    });
  });

  it("does not reload every tick when a drifted model's re-delegation lands local again", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const runtime = new RecordingModelRuntime();
    const agentService = await buildAgentService(runtime);
    vi.useFakeTimers();
    await agentService.preload();
    runtime.driftToLocal();
    runtime.delegatedLoadsLandLocal = true;

    await vi.advanceTimersByTimeAsync(150_000);

    expect(runtime.loadCallCount).toBe(2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(agentService.getStatus().delegation).toEqual({ isDelegated: false });
  });
});
