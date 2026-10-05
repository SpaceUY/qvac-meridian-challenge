// Env vars, with defaults so the project runs without a .env. Vite only exposes VITE_-prefixed
// vars to the browser (they end up in plain text in the bundle) - never put a secret in one.

export const CONFIG = {
  /** Relative path on purpose: vite.config.ts's proxy forwards it to the chosen engine, keeping the browser on a single origin (no CORS). */
  completionsEndpoint: import.meta.env.VITE_ENDPOINT_COMPLETIONS ?? '/v1/chat/completions',

  /** The public chat model alias the backend exposes at /v1/models (PUBLIC_CHAT_MODEL in chat.router.const.ts). */
  model: import.meta.env.VITE_MODEL ?? 'meridian-assistant',

  /** Header with which the backend groups the KV cache by session (req. [6.3]). */
  sessionHeader: 'X-Meridian-Session',
} as const
