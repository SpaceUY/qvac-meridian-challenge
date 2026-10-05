import type { DelegateOptions } from '../models/domain/types.js';

/** `@qvac/sdk`'s `delegateSchema` requires this exact pattern (a Hyperswarm/DHT key) and rejects `loadModel()` outright otherwise - checked here too so a malformed key degrades to local instead of breaking chat. */
const PROVIDER_PUBLIC_KEY_PATTERN = /^[0-9a-fA-F]{64}$/;

/** The SDK rejects a `delegate.timeout` below this (same reason as the key pattern above). */
const MIN_DELEGATE_TIMEOUT_MS = 100;

/** Cold-DHT bootstrap can take 15-45s (same figure `@qvac/sdk`'s own delegated-inference example uses) - applied whenever `DELEGATE_TIMEOUT_MS` is unset/invalid so a stalled provider falls back to local instead of hanging forever. */
const DEFAULT_DELEGATE_TIMEOUT_MS = 60_000;

/**
 * Derives the delegate target from env vars; a pure function of `env` (not a direct `process.env` read) so it's testable without module-reset tricks.
 * Never throws - an invalid key/timeout is warned and treated as unset/default, so a typo degrades to local rather than breaking chat.
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

/** Resolved once at startup so every consumer agrees on the same delegate target for the process's life. */
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

/** Derives heartbeat cadence from env vars; same never-throws contract as `resolveDelegateConfig()`. Timeout floor matches the SDK's `delegate.timeout` minimum. */
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
