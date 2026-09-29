import type { Request, Response } from 'express';
import { ModelManagementError } from '../domain/errors.js';
import type { ModelSource, RegistrySearchQuery } from '../domain/types.js';
import { MODEL_NOT_LOADED_ERROR, STAGE_STATUS } from './models.router.const.js';

/**
 * Logs the real error server-side and returns a safe, generic body — never
 * the SDK's internal message. `not-found` gets its own status/message since
 * it's a precondition failure (client asked about a model that isn't
 * loaded), not an upstream/runtime failure like the other stages.
 */
export function handleError(res: Response, err: unknown): void {
  if (!(err instanceof ModelManagementError)) {
    console.error('[models:unknown]', err);
    res.status(500).json({ error: 'internal error' });
    return;
  }
  console.error(`[models:${err.stage}]`, err.cause ?? err);
  if (err.stage === 'not-found') {
    res.status(404).json({ error: MODEL_NOT_LOADED_ERROR });
    return;
  }
  res.status(STAGE_STATUS[err.stage]).json({ error: `${err.stage} failed` });
}

/** Parses and validates a request body's `source` field into a `ModelSource`, or undefined if invalid. */
export function parseModelSource(body: unknown): ModelSource | undefined {
  const source = isRecord(body) ? body.source : undefined;
  if (!isRecord(source)) return undefined;
  const modelType = asString(source.modelType);

  if (source.kind === 'url' && typeof source.url === 'string' && source.url.length > 0) {
    return { kind: 'url', url: source.url, modelType };
  }
  if (source.kind === 'registry' && typeof source.registryPath === 'string' && typeof source.registrySource === 'string') {
    return { kind: 'registry', registryPath: source.registryPath, registrySource: source.registrySource, modelType };
  }
  return undefined;
}

/** Parses optional registry search filters from query params; undefined means "no filter" (list instead of search). */
export function parseRegistryQuery(query: Request['query']): RegistrySearchQuery | undefined {
  const filter = asString(query.filter);
  const engine = asString(query.engine);
  const quantization = asString(query.quantization);
  return filter || engine || quantization ? { filter, engine, quantization } : undefined;
}

/** Parses and trims a request body's `prompt` field, rejecting empty/whitespace-only values. */
export function parsePrompt(body: unknown): string | undefined {
  const prompt = isRecord(body) ? body.prompt : undefined;
  if (typeof prompt !== 'string') return undefined;
  const trimmed = prompt.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
