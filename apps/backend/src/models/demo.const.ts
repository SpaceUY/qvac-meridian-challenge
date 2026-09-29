export const HTTP_MODEL_URL =
  'https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_0.gguf';

/**
 * Exact name of the single-file (non-sharded) Qwen3 1.7B Q4 entry in the
 * QVAC registry - matches `@qvac/sdk`'s own exported catalog constant
 * `QWEN3_1_7B_INST_Q4` (registryPath: "unsloth/Qwen3-1.7B-GGUF/resolve/...",
 * registrySource: "hf"), verified against the installed 0.18.2 package.
 * Searched by name instead of importing that constant directly so `demo.ts`
 * stays free of `@qvac/sdk` imports (only qvacRuntimeAdapter.ts imports it).
 */
export const REGISTRY_MODEL_NAME = 'Qwen3-1.7B-Q4_0';

export const PROMPT = 'In one sentence, what is a local-first AI model?';
