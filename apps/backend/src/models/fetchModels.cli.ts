/** Pre-downloads every asset `/v1/chat/completions` needs so `npm run serve` never touches the network (qvac-eval.json Req 6.1.4). Only provisions the resolved tier - set `QVAC_RESOURCE_TIER` to pin one. */
import { QvacRuntimeAdapter } from "./infra/qvacRuntimeAdapter.js";
import { ModelManagementService } from "./service/models.service.js";
import { LLM_MODELS_BY_TIER, WHISPER_MODELS_BY_TIER, TTS_MODELS_BY_TIER, EMBEDDING_MODEL_SOURCE } from "../config/models.config.js";
import { RESOURCE_TIER } from "../config/resourceTier.js";
import type { ModelSource } from "./domain/types.js";

const adapter = new QvacRuntimeAdapter();
const service = new ModelManagementService(adapter, adapter);

function projectionSource(engineConfig: Record<string, unknown> | undefined): ModelSource | undefined {
  const src = engineConfig?.projectionModelSrc;
  return typeof src === "string" ? { kind: "rawSrc", src } : undefined;
}

console.log(`[models:fetch] resource tier: ${RESOURCE_TIER}`);

const llmModel = LLM_MODELS_BY_TIER[RESOURCE_TIER];

const sources: ModelSource[] = [
  llmModel.modelSource,
  WHISPER_MODELS_BY_TIER[RESOURCE_TIER],
  TTS_MODELS_BY_TIER[RESOURCE_TIER],
  EMBEDDING_MODEL_SOURCE,
  projectionSource(llmModel.engineConfig),
].filter((source): source is ModelSource => source !== undefined);

for (const source of sources) {
  const label = source.kind === "rawSrc" ? source.src : source.kind === "url" ? source.url : source.registryPath;
  console.log(`[models:fetch] provisioning ${label}...`);
  await service.provisionModel(source, (progress) => {
    if (progress.percentage % 20 < 1) console.log(`[models:fetch] ${label}: ${progress.percentage.toFixed(0)}%`);
  });
}
await service.close();
console.log("[models:fetch] done.");
