/**
 * Pre-downloads every model asset the graded HTTP surface (`/v1/chat/completions`)
 * needs before `npm run serve` starts, so `serve` never touches the network -
 * required by qvac-eval.json's contract (Req 6.1.4: "start must not require
 * network access"). Run via `npm run models:fetch`.
 */
import { QvacRuntimeAdapter } from "./infra/qvacRuntimeAdapter.js";
import { ModelManagementService } from "./service/models.service.js";
import { LOW_RESOURCE_MODEL, HIGH_RESOURCE_MODEL, EMBEDDING_MODEL_SOURCE } from "../config/models.config.js";
import type { ModelSource } from "./domain/types.js";

const adapter = new QvacRuntimeAdapter();
const service = new ModelManagementService(adapter, adapter);

function projectionSource(engineConfig: Record<string, unknown> | undefined): ModelSource | undefined {
  const src = engineConfig?.projectionModelSrc;
  return typeof src === "string" ? { kind: "rawSrc", src } : undefined;
}

const sources: ModelSource[] = [
  LOW_RESOURCE_MODEL.modelSource,
  HIGH_RESOURCE_MODEL.modelSource,
  EMBEDDING_MODEL_SOURCE,
  projectionSource(LOW_RESOURCE_MODEL.engineConfig),
  projectionSource(HIGH_RESOURCE_MODEL.engineConfig),
].filter((source, index, all): source is ModelSource => {
  if (!source) return false;
  // De-dupe: LOW/HIGH resource tiers may resolve to the same source/projection today.
  const key = JSON.stringify(source);
  return all.findIndex((other) => other && JSON.stringify(other) === key) === index;
});

for (const source of sources) {
  const label = source.kind === "rawSrc" ? source.src : source.kind === "url" ? source.url : source.registryPath;
  console.log(`[models:fetch] provisioning ${label}...`);
  await service.provisionModel(source, (progress) => {
    if (progress.percentage % 20 < 1) console.log(`[models:fetch] ${label}: ${progress.percentage.toFixed(0)}%`);
  });
}
await service.close();
console.log("[models:fetch] done.");
