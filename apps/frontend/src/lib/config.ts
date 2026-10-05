// Env vars, with defaults so the project runs without a .env. Vite only exposes VITE_-prefixed
// vars to the browser (they end up in plain text in the bundle) - never put a secret in one.

export const CONFIG = {
  /** Relative path on purpose: vite.config.ts's proxy forwards it to the chosen engine, keeping the browser on a single origin (no CORS). */
  completionsEndpoint: import.meta.env.VITE_ENDPOINT_COMPLETIONS ?? '/v1/chat/completions',

  /** The model alias the target engine (LM Studio or our own API) exposes at /v1/models. */
  model: import.meta.env.VITE_MODEL ?? 'llama-3.2-3b-instruct',

  /** Header with which the backend groups the KV cache by session (req. [6.3]). */
  sessionHeader: 'X-Meridian-Session',
} as const
