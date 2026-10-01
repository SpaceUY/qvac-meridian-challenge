/**
 * Proves both model sources and the full local QVAC lifecycle end to end:
 *
 *   download/setup (provisionModel, via downloadAsset()) -> loadModel ->
 *   inference -> unloadModel -> close
 *
 * Provisioning and loading are deliberately two separate calls (not just
 * loadModel's implicit download) so the "downloaded during setup" step is
 * independently observable: the provision log line appears before the
 * separate load log line, and a subsequent load reuses the cached file
 * instead of re-downloading (see the cache note in qvacRuntimeAdapter.ts).
 *
 * Sources exercised:
 *  1. Registry: modelRegistrySearch() looks up a specific, intentionally
 *     chosen model - Qwen3-1.7B-Q4_0 - by name, then provisions/loads it
 *     by the registryPath/registrySource the search returned.
 *  2. HTTPS/HuggingFace: a model is provisioned/loaded directly from a
 *     HuggingFace file URL.
 *
 * Run with: npm run model-lifecycle-demo --workspace=apps/backend
 */
import { ModelManagementService } from './service/models.service.js';
import { QvacRuntimeAdapter } from './infra/qvacRuntimeAdapter.js';
import { ModelManagementError } from './domain/errors.js';
import type { ModelSource } from './domain/types.js';
import { PROMPT } from './demo.const.js';
import { HTTP_MODEL_URL, REGISTRY_MODEL_NAME } from '../config/models.config.js';

function logProgress(label: string, phase: string): (progress: { percentage: number }) => void {
  return (progress) => process.stderr.write(`\r▸ [${label}] ${phase}: ${progress.percentage.toFixed(0)}%`);
}

/**
 * Runs the full lifecycle for one source: provision (setup/download) ->
 * load -> inference -> unload. `unloadModel` runs in `finally` so it
 * executes even if inference fails - only `close()` (shared across all
 * sources) happens after this function returns.
 */
async function runSourceDemo(label: string, service: ModelManagementService, source: ModelSource): Promise<void> {
  console.log(`\n▸ [${label}] provisioning (downloadAsset - setup step, no load into memory yet)...`);
  await service.provisionModel(source, logProgress(label, 'downloading'));
  console.log(`\n▸ [${label}] provisioned: weights are on disk`);

  console.log(`▸ [${label}] loading into memory...`);
  const loaded = await service.loadModel(source, undefined, logProgress(label, 'loading'));
  console.log(`\n▸ [${label}] loaded, modelId=${loaded.modelId}`);

  try {
    const result = await service.infer(loaded.modelId, PROMPT);
    console.log(`▸ [${label}] inference result: ${result.text}`);
  } finally {
    await service.unloadModel(loaded.modelId);
    console.log(`▸ [${label}] unloaded`);
  }
}

async function resolveRegistrySource(service: ModelManagementService): Promise<ModelSource> {
  console.log(`▸ [registry] searching modelRegistrySearch() for "${REGISTRY_MODEL_NAME}"...`);
  const results = await service.searchRegistry({ filter: REGISTRY_MODEL_NAME, engine: 'llamacpp-completion' });
  const match = results.find((m) => m.name === REGISTRY_MODEL_NAME);
  if (!match) {
    throw new Error(`Registry search did not return "${REGISTRY_MODEL_NAME}" - has the QVAC catalog changed?`);
  }
  console.log(`▸ [registry] found "${match.name}" (${match.registrySource}/${match.registryPath})`);
  return { kind: 'registry', registryPath: match.registryPath, registrySource: match.registrySource };
}

async function main(): Promise<void> {
  const qvacRuntimeAdapter = new QvacRuntimeAdapter();
  const service = new ModelManagementService(qvacRuntimeAdapter, qvacRuntimeAdapter);
  try {
    const registrySource = await resolveRegistrySource(service);
    await runSourceDemo('registry', service, registrySource);

    await runSourceDemo('url', service, { kind: 'url', url: HTTP_MODEL_URL });

    console.log('\n▸ Done: both model sources and the full lifecycle completed successfully.');
  } finally {
    await service.unloadAll();
    await service.close();
  }
}

main().catch((err) => {
  if (err instanceof ModelManagementError) {
    console.error(`\n✖ Demo failed at stage "${err.stage}":`, err.cause ?? err.message);
  } else {
    console.error('\n✖ Demo failed:', err);
  }
  process.exit(1);
});
