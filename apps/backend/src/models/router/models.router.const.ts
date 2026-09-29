import type { ModelManagementError } from '../domain/errors.js';

/** HTTP status returned for each `ModelManagementError` stage. */
export const STAGE_STATUS: Record<ModelManagementError['stage'], number> = {
  discovery: 502,
  download: 502,
  load: 502,
  inference: 502,
  unload: 502,
  close: 502,
  'not-found': 404
};

export const INVALID_SOURCE_ERROR = 'body must include a valid "source" (registry or url)';
export const MODEL_NOT_LOADED_ERROR = 'model is not currently loaded';
export const EMPTY_PROMPT_ERROR = 'body must include a non-empty "prompt" string';
