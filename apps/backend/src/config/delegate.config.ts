import type { DelegateOptions } from '../models/domain/types.js';

/**
 * `@qvac/sdk`'s `delegateSchema` validates `providerPublicKey` against this
 * exact pattern (a Hyperswarm/DHT public key) and rejects the whole
 * `loadModel()` call - before `fallbackToLocal` ever gets a chance - when
 * it doesn't match. Checked here too so a malformed key degrades to local
 * inference instead of breaking chat.
 */
const PROVIDER_PUBLIC_KEY_PATTERN = /^[0-9a-fA-F]{64}$/;

/** The SDK rejects a `delegate.timeout` below this (same reason as the key pattern above). */
const MIN_DELEGATE_TIMEOUT_MS = 100;

/**
 * Cold-DHT bootstrap (looking up a provider for the first time in a
 * process) can take 15-45s per `@qvac/sdk`'s own delegated-inference
 * example (`examples/delegated-inference/consumer.js`), which uses the
 * same 60s figure for exactly this reason. Applied whenever
 * `DELEGATE_TIMEOUT_MS` is unset or invalid, so a delegated load always
 * has a bound and a stalled/unreachable provider falls back to local
 * instead of hanging indefinitely (the SDK never times out a call with no
 * `timeout` at all).
 */
const DEFAULT_DELEGATE_TIMEOUT_MS = 60_000;

/**
 * Derives the chat-completion model's delegate target from environment
 * variables. A pure function of `env` (not just a module-level read of
 * `process.env`) so it's directly testable without module-reset tricks -
 * see `delegate.config.test.ts`.
 *
 * `fallbackToLocal` is always `true` when a provider key is configured -
 * not a separate env toggle, matching the P2P delegated inference spec
 * exactly. Never throws: an invalid key or timeout is logged as a warning
 * and treated as unset/default respectively, so a typo degrades to local
 * inference rather than breaking the chat model entirely.
 */
export function resolveDelegateConfig(env: NodeJS.ProcessEnv = process.env): DelegateOptions | undefined {
  const providerPublicKey = env.DELEGATE_PROVIDER_PUBLIC_KEY?.trim();
  if (!providerPublicKey) return undefined;

  if (!PROVIDER_PUBLIC_KEY_PATTERN.test(providerPublicKey)) {
    console.warn(
      '[delegate.config] DELEGATE_PROVIDER_PUBLIC_KEY is not a 64-character hex public key - ignoring; the chat model will load locally.',
    );
    return undefined;
  }

  const parsedTimeout = env.DELEGATE_TIMEOUT_MS ? Number(env.DELEGATE_TIMEOUT_MS) : undefined;
  let timeout = DEFAULT_DELEGATE_TIMEOUT_MS;
  if (parsedTimeout !== undefined) {
    if (Number.isFinite(parsedTimeout) && parsedTimeout >= MIN_DELEGATE_TIMEOUT_MS) {
      timeout = parsedTimeout;
    } else {
      console.warn(
        `[delegate.config] DELEGATE_TIMEOUT_MS must be a number >= ${MIN_DELEGATE_TIMEOUT_MS} - ignoring; using the default of ${DEFAULT_DELEGATE_TIMEOUT_MS}ms instead.`,
      );
    }
  }

  return { providerPublicKey, timeout, fallbackToLocal: true };
}

/**
 * Resolved once at process startup. `AgentService` reads this (not
 * `resolveDelegateConfig()` directly) so every consumer of the chat model
 * agrees on the same delegate target for the life of the process.
 */
export const DELEGATE_CONFIG: DelegateOptions | undefined = resolveDelegateConfig();

const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;
const MIN_HEARTBEAT_INTERVAL_MS = 1_000;
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 3_000;

export interface HeartbeatConfig {
  intervalMs: number;
  timeoutMs: number;
}

function parseMillisecondsEnv(env: NodeJS.ProcessEnv, name: string, minimum: number, fallback: number): number {
  const raw = env[name];
  if (!raw) return fallback;

  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed >= minimum) return parsed;

  console.warn(
    `[delegate.config] ${name} must be a number >= ${minimum} - ignoring; using the default of ${fallback}ms instead.`,
  );
  return fallback;
}

/**
 * Derives the provider heartbeat cadence from environment variables. Same
 * contract as `resolveDelegateConfig()`: never throws, an invalid value is
 * warned about and replaced by its default. The timeout minimum matches
 * the SDK's `delegate.timeout` floor (`MIN_DELEGATE_TIMEOUT_MS`).
 */
export function resolveHeartbeatConfig(env: NodeJS.ProcessEnv = process.env): HeartbeatConfig {
  return {
    intervalMs: parseMillisecondsEnv(
      env,
      'DELEGATE_HEARTBEAT_INTERVAL_MS',
      MIN_HEARTBEAT_INTERVAL_MS,
      DEFAULT_HEARTBEAT_INTERVAL_MS,
    ),
    timeoutMs: parseMillisecondsEnv(
      env,
      'DELEGATE_HEARTBEAT_TIMEOUT_MS',
      MIN_DELEGATE_TIMEOUT_MS,
      DEFAULT_HEARTBEAT_TIMEOUT_MS,
    ),
  };
}

/** Resolved once at process startup, like `DELEGATE_CONFIG`. */
export const HEARTBEAT_CONFIG: HeartbeatConfig = resolveHeartbeatConfig();
