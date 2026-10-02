import { describe, expect, it } from "vitest";
import {
  DelegatedProviderUnreachableError,
  isCancellationError,
  ModelManagementError,
} from "../../models/domain/errors.js";
import type {
  ChatCompletionRequest,
  ChatCompletionResult,
  LoadedModel,
  LoadedModelDelegationInfo,
  LoadModelOptions,
  ModelSource,
} from "../../models/domain/types.js";
import {
  QvacChatSession,
  type QvacChatSessionOptions,
  type QvacChatSessionService,
} from "./qvacChatSession.js";

const MODEL_SOURCE: ModelSource = { kind: "url", url: "https://example.com/model.gguf" };
const DELEGATE = { providerPublicKey: "pk-abc", fallbackToLocal: true };
const REQUEST: ChatCompletionRequest = { history: [{ role: "user", content: "hi" }] };

/** The error shape `ModelManagementService.chatComplete()` produces when a delegated provider dies. */
function providerUnreachableError(): ModelManagementError {
  return new ModelManagementError("inference", "provider unreachable", new DelegatedProviderUnreachableError());
}

type ChatOutcome = "succeed" | "provider-unreachable" | "genuine-failure" | "stream-then-provider-unreachable";

/** Records the `options` passed to `loadModel()`; resolves immediately with a per-load model id (`fake-model-<n>` for the n-th load). Records every `getLoadedModelInfo()` call so tests can assert whether it was even attempted. */
class RecordingChatService implements QvacChatSessionService {
  lastLoadOptions?: LoadModelOptions;
  loadCallCount = 0;
  getLoadedModelInfoCalls: string[] = [];
  delegationInfoResult: LoadedModelDelegationInfo | "throw" = { isDelegated: false };
  /** `chatComplete()`'s outcome per call, consumed in order; a call past the end of this array succeeds. */
  chatCompleteOutcomes: ChatOutcome[] = [];
  chatCompleteCallCount = 0;
  chatRequests: ChatCompletionRequest[] = [];
  cancelledRequestIds: string[] = [];
  cancelledCompletionModelIds: string[] = [];
  /** Ordered log of `"load"`/`"unload:<modelId>"` calls, so tests can assert the unload-before-reload sequence that clears a stale delegated registry entry. */
  operations: string[] = [];
  /** When true, `loadModel()` returns a promise that never settles - a delegated connection attempt stuck mid-connect. */
  hangLoad = false;
  /** When true, `chatComplete()` returns a promise that never settles - a completion still in flight. */
  hangChat = false;
  /** When true, the next `loadModel()` call rejects (then this resets to false). */
  failNextLoad = false;
  /** When true, every `loadModel()` call that carries a `delegate` rejects - a provider that answers but cannot load the model. Checked before `failNextLoad`, so it does not consume it. */
  rejectDelegatedLoads = false;
  /** When true, `unloadModel()` never settles - freezes a switch in its unload phase. */
  hangUnload = false;

  loadModel(source: ModelSource, options?: LoadModelOptions): Promise<LoadedModel> & { requestId: string } {
    this.loadCallCount += 1;
    this.lastLoadOptions = options;
    this.operations.push("load");
    let promise: Promise<LoadedModel>;
    if (this.rejectDelegatedLoads && options?.delegate) {
      promise = Promise.reject(new Error("Provider failed to load model"));
    } else if (this.failNextLoad) {
      this.failNextLoad = false;
      promise = Promise.reject(new Error("load failed"));
    } else if (this.hangLoad) {
      promise = new Promise<LoadedModel>(() => {});
    } else {
      promise = Promise.resolve({
        modelId: `fake-model-${this.loadCallCount}`,
        source,
        loadedAt: new Date(),
      });
    }
    return Object.assign(promise, { requestId: `req-load-${this.loadCallCount}` });
  }

  chatComplete(
    _modelId: string,
    request: ChatCompletionRequest,
    onToken?: (textDelta: string) => void,
  ): Promise<ChatCompletionResult> & { requestId: string } {
    this.chatCompleteCallCount += 1;
    this.chatRequests.push(request);
    const requestId = `req-chat-${this.chatCompleteCallCount}`;
    if (this.hangChat) {
      return Object.assign(new Promise<ChatCompletionResult>(() => {}), { requestId });
    }
    const outcome = this.chatCompleteOutcomes.shift() ?? "succeed";
    if (outcome === "provider-unreachable") {
      return Object.assign(Promise.reject(providerUnreachableError()), { requestId });
    }
    if (outcome === "stream-then-provider-unreachable") {
      onToken?.("par");
      return Object.assign(Promise.reject(providerUnreachableError()), { requestId });
    }
    if (outcome === "genuine-failure") {
      return Object.assign(Promise.reject(new Error("the model crashed")), { requestId });
    }
    onToken?.("ok");
    return Object.assign(Promise.resolve({ text: "ok", toolCalls: [] }), { requestId });
  }

  async cancel(requestId: string): Promise<void> {
    this.cancelledRequestIds.push(requestId);
  }

  async cancelCompletions(modelId: string): Promise<void> {
    this.cancelledCompletionModelIds.push(modelId);
  }

  async unloadModel(modelId: string): Promise<void> {
    this.operations.push(`unload:${modelId}`);
    if (this.hangUnload) await new Promise<void>(() => {});
  }

  async getLoadedModelInfo(modelId: string): Promise<LoadedModelDelegationInfo> {
    this.getLoadedModelInfoCalls.push(modelId);
    if (this.delegationInfoResult === "throw") throw new Error("boom");
    return this.delegationInfoResult;
  }
}

function buildSession(
  service: RecordingChatService,
  overrides: Partial<QvacChatSessionOptions> = {},
): QvacChatSession {
  return new QvacChatSession({ service, modelSource: MODEL_SOURCE, ...overrides });
}

function buildDelegatingSession(service: RecordingChatService): QvacChatSession {
  return buildSession(service, { delegate: DELEGATE });
}

/** Enough microtask ticks for a suspended async function to run up to its next real wait. */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
}

describe("QvacChatSession.ensureModel", () => {
  it("forwards a configured delegate to the model load", async () => {
    const service = new RecordingChatService();

    await buildDelegatingSession(service).ensureModel();

    expect(service.lastLoadOptions?.delegate).toEqual(DELEGATE);
  });

  it("omits delegate when none is configured", async () => {
    const service = new RecordingChatService();

    await buildSession(service).ensureModel();

    expect(service.lastLoadOptions?.delegate).toBeUndefined();
  });

  it("loads with tool parsing enabled, the default ctxSize and the configured engineConfig", async () => {
    const service = new RecordingChatService();

    await buildSession(service, { engineConfig: { flash_attn: "on" } }).ensureModel();

    expect(service.lastLoadOptions).toEqual({
      ctxSize: 4096,
      tools: true,
      engineConfig: { flash_attn: "on" },
      delegate: undefined,
    });
  });

  it("loads only once for concurrent callers", async () => {
    const service = new RecordingChatService();
    const session = buildSession(service);

    const [first, second] = await Promise.all([session.ensureModel(), session.ensureModel()]);

    expect(first).toBe("fake-model-1");
    expect(second).toBe("fake-model-1");
    expect(service.loadCallCount).toBe(1);
  });
});

describe("QvacChatSession.cancelLoad", () => {
  it("rejects ensureModel()'s pending promise with a cancellation error even when the underlying load never settles", async () => {
    const service = new RecordingChatService();
    service.hangLoad = true;
    const session = buildDelegatingSession(service);

    const pending = session.ensureModel();
    await Promise.resolve(); // let ensureModel() actually start the load

    await session.cancelLoad();

    const error = await pending.catch((err: unknown) => err);
    expect(isCancellationError(error)).toBe(true);
    expect(service.cancelledRequestIds).toEqual(["req-load-1"]);
  });

  it("does not disturb a load that settles normally (no lingering rejection after success)", async () => {
    const service = new RecordingChatService();
    const session = buildSession(service);

    await expect(session.ensureModel()).resolves.toBe("fake-model-1");
    await expect(session.cancelLoad()).resolves.toBeUndefined();
  });

  it("is a safe no-op when nothing is loading", async () => {
    const session = buildSession(new RecordingChatService());

    await expect(session.cancelLoad()).resolves.toBeUndefined();
  });
});

describe("QvacChatSession.cancelActive", () => {
  it("forwards the in-flight completion's request id to the service", async () => {
    const service = new RecordingChatService();
    const session = buildSession(service);
    await session.ensureModel();
    service.hangChat = true;

    session.complete(REQUEST).catch(() => {}); // rejects on cancel, as asserted elsewhere
    await flushMicrotasks();
    await session.cancelActive();

    expect(service.cancelledRequestIds).toEqual(["req-chat-1"]);
  });

  it("is a safe no-op when no completion is in flight", async () => {
    const service = new RecordingChatService();
    const session = buildSession(service);

    await expect(session.cancelActive()).resolves.toBeUndefined();
    expect(service.cancelledRequestIds).toEqual([]);
    expect(service.cancelledCompletionModelIds).toEqual([]);
  });

  it("rejects the pending complete() with a cancellation error and frees the session, even when the underlying completion never settles", async () => {
    const service = new RecordingChatService();
    const session = buildDelegatingSession(service);
    await session.ensureModel();
    service.hangChat = true;

    const pending = session.complete(REQUEST);
    await flushMicrotasks();
    await session.cancelActive();

    const error = await pending.catch((err: unknown) => err);
    expect(isCancellationError(error)).toBe(true);
    expect(session.isBusy()).toBe(false);
  });

  it("also cancels every completion on the model when a delegate is configured, because the SDK never aborts a delegated stream by request id", async () => {
    const service = new RecordingChatService();
    const session = buildDelegatingSession(service);
    await session.ensureModel();
    service.hangChat = true;

    session.complete(REQUEST).catch(() => {}); // rejects on cancel, as asserted elsewhere
    await flushMicrotasks();
    await session.cancelActive();

    expect(service.cancelledCompletionModelIds).toEqual(["fake-model-1"]);
  });

  it("still rejects the pending complete() when the service-level cancel fails", async () => {
    const service = new RecordingChatService();
    service.cancel = async () => {
      throw new Error("provider unreachable");
    };
    const session = buildDelegatingSession(service);
    await session.ensureModel();
    service.hangChat = true;

    const pending = session.complete(REQUEST);
    await flushMicrotasks();
    await expect(session.cancelActive()).rejects.toThrow("provider unreachable");

    expect(isCancellationError(await pending.catch((err: unknown) => err))).toBe(true);
  });

  it("leaves a local-only session to the request-id cancel alone (no model-wide cancel)", async () => {
    const service = new RecordingChatService();
    const session = buildSession(service);
    await session.ensureModel();
    service.hangChat = true;

    session.complete(REQUEST).catch(() => {}); // rejects on cancel, as asserted elsewhere
    await flushMicrotasks();
    await session.cancelActive();

    expect(service.cancelledCompletionModelIds).toEqual([]);
  });
});

describe("QvacChatSession.getDelegationInfo", () => {
  it("returns the service's delegation info once a delegated load has resolved", async () => {
    const service = new RecordingChatService();
    service.delegationInfoResult = { isDelegated: true, providerPublicKey: "pk-abc" };

    await expect(buildDelegatingSession(service).getDelegationInfo()).resolves.toEqual({
      isDelegated: true,
      providerPublicKey: "pk-abc",
    });
    expect(service.getLoadedModelInfoCalls).toEqual(["fake-model-1"]);
  });

  it("resolves undefined without querying the service when no delegate is configured", async () => {
    const service = new RecordingChatService();

    await expect(buildSession(service).getDelegationInfo()).resolves.toBeUndefined();
    expect(service.getLoadedModelInfoCalls).toEqual([]);
  });

  it("resolves undefined (best-effort) if the introspection query itself fails", async () => {
    const service = new RecordingChatService();
    service.delegationInfoResult = "throw";

    await expect(buildDelegatingSession(service).getDelegationInfo()).resolves.toBeUndefined();
  });
});

describe("QvacChatSession.getCachedDelegationInfo", () => {
  it("is undefined before getDelegationInfo() has ever resolved", () => {
    expect(buildSession(new RecordingChatService()).getCachedDelegationInfo()).toBeUndefined();
  });

  it("reflects the last getDelegationInfo() result synchronously", async () => {
    const service = new RecordingChatService();
    service.delegationInfoResult = { isDelegated: true, providerPublicKey: "pk-abc" };
    const session = buildDelegatingSession(service);

    await session.getDelegationInfo();

    expect(session.getCachedDelegationInfo()).toEqual({ isDelegated: true, providerPublicKey: "pk-abc" });
  });
});

describe("QvacChatSession.complete", () => {
  it("returns the service's result and threads kvCacheEnabled into the request", async () => {
    const service = new RecordingChatService();
    const session = buildSession(service, { kvCacheEnabled: false });

    const result = await session.complete(REQUEST);

    expect(result.text).toBe("ok");
    expect(service.chatRequests[0]).toEqual({ ...REQUEST, kvCacheEnabled: false });
  });

  it("leaves kvCacheEnabled undefined when not configured", async () => {
    const service = new RecordingChatService();

    await buildSession(service).complete(REQUEST);

    expect(service.chatRequests[0]?.kvCacheEnabled).toBeUndefined();
  });

  it("forwards onToken to the service", async () => {
    const service = new RecordingChatService();
    const tokens: string[] = [];

    await buildSession(service).complete(REQUEST, (delta) => tokens.push(delta));

    expect(tokens).toEqual(["ok"]);
  });
});

describe("QvacChatSession.complete delegation recovery", () => {
  it("recovers by reloading and retrying once when the delegated provider is unreachable", async () => {
    const service = new RecordingChatService();
    service.chatCompleteOutcomes = ["provider-unreachable"];
    const session = buildDelegatingSession(service);
    // State right after a successful *initial* delegated preload, before the provider died.
    service.delegationInfoResult = { isDelegated: true, providerPublicKey: "pk-abc" };
    await session.getDelegationInfo();

    // Once recovery has happened, the (now local) fallback model is what a fresh introspection reports.
    service.delegationInfoResult = { isDelegated: false };
    const result = await session.complete(REQUEST);

    expect(result.text).toBe("ok");
    expect(service.loadCallCount).toBe(2); // the initial load, plus one reload on recovery
    // Unloading the stale (still delegated) model BEFORE reloading is what makes the reload a
    // genuine local load rather than a same-modelId no-op that would leave it delegated forever.
    expect(service.operations).toEqual(["load", "unload:fake-model-1", "load"]);
    expect(session.getCachedDelegationInfo()).toEqual({ isDelegated: false });
  });

  it("does not retry (or reload) on a genuine completion failure", async () => {
    const service = new RecordingChatService();
    service.chatCompleteOutcomes = ["genuine-failure"];

    await expect(buildSession(service).complete(REQUEST)).rejects.toThrow("the model crashed");
    expect(service.loadCallCount).toBe(1);
  });

  it("propagates a second consecutive provider failure (recovery is one-shot)", async () => {
    const service = new RecordingChatService();
    service.chatCompleteOutcomes = ["provider-unreachable", "provider-unreachable"];

    await expect(buildDelegatingSession(service).complete(REQUEST)).rejects.toBeInstanceOf(ModelManagementError);
    expect(service.loadCallCount).toBe(2);
    expect(service.chatCompleteCallCount).toBe(2);
  });

  it("recovers while streaming when the provider dies before any token is emitted", async () => {
    const service = new RecordingChatService();
    service.chatCompleteOutcomes = ["provider-unreachable"];
    const tokens: string[] = [];

    const result = await buildDelegatingSession(service).complete(REQUEST, (delta) => tokens.push(delta));

    expect(result.text).toBe("ok");
    expect(tokens).toEqual(["ok"]);
    expect(service.operations).toEqual(["load", "unload:fake-model-1", "load"]);
  });

  it("does not recover once a token has been streamed (a retry would duplicate visible output)", async () => {
    const service = new RecordingChatService();
    service.chatCompleteOutcomes = ["stream-then-provider-unreachable"];
    const tokens: string[] = [];

    await expect(
      buildDelegatingSession(service).complete(REQUEST, (delta) => tokens.push(delta)),
    ).rejects.toBeInstanceOf(ModelManagementError);

    expect(tokens).toEqual(["par"]);
    expect(service.loadCallCount).toBe(1); // no reload
    expect(service.chatCompleteCallCount).toBe(1); // no retry
  });
});

describe("QvacChatSession.isRecovering", () => {
  it("is true only while the reload triggered by delegation recovery is still in flight", async () => {
    const service = new RecordingChatService();
    service.chatCompleteOutcomes = ["provider-unreachable"];
    const session = buildDelegatingSession(service);
    service.delegationInfoResult = { isDelegated: true, providerPublicKey: "pk-abc" };
    await session.getDelegationInfo();
    expect(session.isRecovering()).toBe(false);

    // Freezes the reload that recovery triggers, so the flag can be observed mid-recovery.
    service.hangLoad = true;
    void session.complete(REQUEST);
    await flushMicrotasks();

    expect(session.isRecovering()).toBe(true);
  });

  it("returns to false once recovery completes successfully", async () => {
    const service = new RecordingChatService();
    service.chatCompleteOutcomes = ["provider-unreachable"];
    const session = buildDelegatingSession(service);
    service.delegationInfoResult = { isDelegated: true, providerPublicKey: "pk-abc" };
    await session.getDelegationInfo();

    service.delegationInfoResult = { isDelegated: false };
    await session.complete(REQUEST);

    expect(session.isRecovering()).toBe(false);
  });
});

describe("QvacChatSession.switchTo", () => {
  it("unloads the current model, then loads a local one without a delegate", async () => {
    const service = new RecordingChatService();
    const session = buildDelegatingSession(service);
    service.delegationInfoResult = { isDelegated: true, providerPublicKey: "pk-abc" };
    await session.getDelegationInfo();
    service.operations.length = 0;

    service.delegationInfoResult = { isDelegated: false };
    await session.switchTo("local");

    expect(service.operations).toEqual(["unload:fake-model-1", "load"]);
    expect(service.lastLoadOptions?.delegate).toBeUndefined();
  });

  it("loads with the configured delegate when switching back to delegated", async () => {
    const service = new RecordingChatService();
    const session = buildDelegatingSession(service);
    await session.ensureModel();
    await session.switchTo("local");

    await session.switchTo("delegated");

    expect(service.lastLoadOptions?.delegate).toEqual(DELEGATE);
  });

  it("refreshes the cached delegation info once the switch settles", async () => {
    const service = new RecordingChatService();
    const session = buildDelegatingSession(service);
    service.delegationInfoResult = { isDelegated: true, providerPublicKey: "pk-abc" };
    await session.getDelegationInfo();

    service.delegationInfoResult = { isDelegated: false };
    await session.switchTo("local");

    expect(session.getCachedDelegationInfo()).toEqual({ isDelegated: false });
  });

  it("rejects switching to delegated when no delegate is configured", async () => {
    const service = new RecordingChatService();
    const session = buildSession(service);
    await session.ensureModel();

    await expect(session.switchTo("delegated")).rejects.toThrow(/no delegate/i);
    expect(service.loadCallCount).toBe(1);
  });

  it("shares the switch's load with a chat request that arrives mid-switch (no second load)", async () => {
    const service = new RecordingChatService();
    const session = buildDelegatingSession(service);
    await session.ensureModel();
    expect(service.loadCallCount).toBe(1);

    const switching = session.switchTo("local");
    const concurrent = session.ensureModel();

    await expect(concurrent).resolves.toBe("fake-model-2");
    await switching;
    expect(service.loadCallCount).toBe(2);
  });

  it("clears the cached model and delegation info when the switch fails, so a later ensureModel() reloads", async () => {
    const service = new RecordingChatService();
    const session = buildDelegatingSession(service);
    service.delegationInfoResult = { isDelegated: true, providerPublicKey: "pk-abc" };
    await session.getDelegationInfo();

    service.failNextLoad = true;
    await expect(session.switchTo("local")).rejects.toThrow("load failed");

    expect(session.getCachedDelegationInfo()).toBeUndefined();
    expect(session.isRecovering()).toBe(false);
    const loadsBefore = service.loadCallCount;
    await expect(session.ensureModel()).resolves.toBe("fake-model-3");
    expect(service.loadCallCount).toBe(loadsBefore + 1);
  });

  it("falls back to a local load inside the same call when the delegated load fails", async () => {
    const service = new RecordingChatService();
    const session = buildDelegatingSession(service);
    await session.ensureModel();
    service.operations.length = 0;
    service.rejectDelegatedLoads = true;

    await expect(session.switchTo("delegated")).resolves.toBe("fake-model-3");

    expect(service.operations).toEqual(["unload:fake-model-1", "load", "load"]);
    expect(service.lastLoadOptions?.delegate).toBeUndefined();
    expect(session.getCachedDelegationInfo()).toEqual({ isDelegated: false });
    await expect(session.ensureModel()).resolves.toBe("fake-model-3");
    expect(service.loadCallCount).toBe(3);
  });

  it("rejects and clears the cached model only when the local fallback also fails", async () => {
    const service = new RecordingChatService();
    const session = buildDelegatingSession(service);
    await session.ensureModel();
    service.rejectDelegatedLoads = true;
    service.failNextLoad = true;

    await expect(session.switchTo("delegated")).rejects.toThrow("load failed");

    expect(session.getCachedDelegationInfo()).toBeUndefined();
    expect(session.isBusy()).toBe(false);
    service.rejectDelegatedLoads = false;
    await expect(session.ensureModel()).resolves.toBe("fake-model-4");
  });
});

describe("QvacChatSession.isBusy", () => {
  it("is false when nothing is in flight", async () => {
    const session = buildDelegatingSession(new RecordingChatService());
    await session.ensureModel();

    expect(session.isBusy()).toBe(false);
  });

  it("is true while a load is in flight", async () => {
    const service = new RecordingChatService();
    service.hangLoad = true;
    const session = buildDelegatingSession(service);

    void session.ensureModel();
    await flushMicrotasks();

    expect(session.isBusy()).toBe(true);
  });

  it("is true while a completion is in flight", async () => {
    const service = new RecordingChatService();
    const session = buildDelegatingSession(service);
    await session.ensureModel();
    service.hangChat = true;

    void session.complete(REQUEST);
    await flushMicrotasks();

    expect(session.isBusy()).toBe(true);
  });

  it("is false again after a completion fails", async () => {
    const service = new RecordingChatService();
    service.chatCompleteOutcomes = ["genuine-failure"];
    const session = buildSession(service);

    await expect(session.complete(REQUEST)).rejects.toThrow("the model crashed");

    expect(session.isBusy()).toBe(false);
  });

  it("is true while a switch is in flight", async () => {
    const service = new RecordingChatService();
    const session = buildDelegatingSession(service);
    await session.ensureModel();
    service.hangLoad = true;

    void session.switchTo("local");
    await flushMicrotasks();

    expect(session.isBusy()).toBe(true);
    expect(session.isRecovering()).toBe(true);
  });

  it("is true while a switch to delegated is still unloading, without raising recovering", async () => {
    const service = new RecordingChatService();
    const session = buildDelegatingSession(service);
    await session.ensureModel();
    service.hangUnload = true;

    void session.switchTo("delegated");
    await flushMicrotasks();

    expect(service.operations).toEqual(["load", "unload:fake-model-1"]);
    expect(session.isBusy()).toBe(true);
    expect(session.isRecovering()).toBe(false);
  });

  it("is true while a switch to local is still unloading, and raises recovering", async () => {
    const service = new RecordingChatService();
    const session = buildDelegatingSession(service);
    await session.ensureModel();
    service.hangUnload = true;

    void session.switchTo("local");
    await flushMicrotasks();

    expect(service.operations).toEqual(["load", "unload:fake-model-1"]);
    expect(session.isBusy()).toBe(true);
    expect(session.isRecovering()).toBe(true);
  });

  it("stays true while an overlapping switch is still running after the first one settled", async () => {
    const service = new RecordingChatService();
    const session = buildDelegatingSession(service);
    service.hangUnload = true;

    // Nothing is loaded yet, so the first switch has nothing to unload and settles;
    // the second one then hangs unloading the first one's model.
    const first = session.switchTo("local");
    void session.switchTo("delegated");
    await first;
    await flushMicrotasks();

    expect(service.operations).toEqual(["load", "unload:fake-model-1"]);
    expect(session.isBusy()).toBe(true);
  });
});

describe("QvacChatSession.contextWindowTokens", () => {
  it("is the ctxSize the model is loaded with", () => {
    expect(buildSession(new RecordingChatService(), { ctxSize: 16384 }).contextWindowTokens).toBe(16384);
  });

  it("falls back to the same default the load uses", () => {
    expect(buildSession(new RecordingChatService()).contextWindowTokens).toBe(4096);
  });
});
