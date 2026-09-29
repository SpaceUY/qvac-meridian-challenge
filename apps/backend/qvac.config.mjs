// @qvac/sdk config for this workspace. A .mjs file (not .json) so the cache
// path is computed relative to this file's own location instead of being
// hardcoded per developer machine - portable across clones/OSes/drives.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backendDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(backendDir, '..', '..');

export default {
  cacheDirectory: path.join(repoRoot, '.qvac-cache')
};
