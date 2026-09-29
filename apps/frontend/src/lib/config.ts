// ---------------------------------------------------------------------------
// CONFIGURATION
//
// Everything that changes between environments lives here, not buried in a hook. It is read
// from environment variables with a default value, so the project starts
// without any .env and continues working.
//
// NOTE: Vite only exposes to the browser variables that start with VITE_.
// It is a protection, not a whim: anything that reaches the frontend ends up
// in plain text inside the bundle the user downloads. NEVER put a
// secret (an API key, a password) in a VITE_ variable.
// ---------------------------------------------------------------------------

export const CONFIG = {
  /**
   * Where the conversation is sent. It is a relative path on purpose: the proxy in
   * vite.config.ts forwards it to the chosen engine (LM Studio or the backend), so
   * the browser sees a single origin and there are no CORS problems.
   *
   * CORS: the browser rule that prevents a page served from one
   * domain from hitting another different domain without explicit permission. By passing everything through
   * the proxy, for the browser there is never "another domain".
   */
  completionsEndpoint: import.meta.env.VITE_ENDPOINT_COMPLETIONS ?? '/v1/chat/completions',

  /**
   * The name that LM Studio exposes today in /v1/models. When we talk to
   * our own API, this becomes the alias we define there (eg:
   * "meridian-assistant") - and now it changes without touching code.
   */
  model: import.meta.env.VITE_MODEL ?? 'llama-3.2-3b-instruct',

  /** Header with which the backend groups the KV cache by session (req. [6.3]). */
  sessionHeader: 'X-Meridian-Session',
} as const
