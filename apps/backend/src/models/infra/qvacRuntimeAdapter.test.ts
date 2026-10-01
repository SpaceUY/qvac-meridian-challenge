import { describe, expect, it, vi } from "vitest";
import { OperationCancelledError } from "../domain/errors.js";

const { loadModelMock } = vi.hoisted(() => ({ loadModelMock: vi.fn() }));

/**
 * A cancelled `loadModel()` call never round-trips as an
 * `InferenceCancelledError` instance - per `@qvac/sdk`'s own
 * `rpc-error.ts` comment, that class is only ever constructed
 * client-side from the completion/streaming path's aggregated partial
 * state. A cancelled load instead crosses the RPC boundary as a
 * generic reconstructed error carrying the same `INFERENCE_CANCELLED`
 * code/message, since that code has no typed reconstructor registered.
 * Only `loadModel` is overridden here - everything else (including
 * `SDK_SERVER_ERROR_CODES`, used below) stays real.
 */
vi.mock("@qvac/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@qvac/sdk")>();
  return { ...actual, loadModel: loadModelMock };
});

const { QvacRuntimeAdapter } = await import("./qvacRuntimeAdapter.js");
const { SDK_SERVER_ERROR_CODES } = await import("@qvac/sdk");

describe("QvacRuntimeAdapter.load", () => {
  it("translates a cancelled load's generic RPC error into OperationCancelledError, not a genuine failure", async () => {
    const genericRpcError = Object.assign(
      new Error('Inference request "req-1" was cancelled before it could complete'),
      { code: SDK_SERVER_ERROR_CODES.INFERENCE_CANCELLED, name: "INFERENCE_CANCELLED" },
    );
    loadModelMock.mockReturnValue(
      Object.assign(Promise.reject(genericRpcError), { requestId: "req-1" }),
    );

    const adapter = new QvacRuntimeAdapter();
    const pending = adapter.load({ kind: "url", url: "https://example.com/model.gguf" });

    await expect(pending).rejects.toBeInstanceOf(OperationCancelledError);
  });
});
