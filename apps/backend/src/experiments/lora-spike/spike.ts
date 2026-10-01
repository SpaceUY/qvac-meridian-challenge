/**
 * I.5 Stage 1 — LoRA compatibility spike. TEMPORARY, throwaway code (see
 * README.md in this directory). Proves the full lifecycle
 * (finetune() -> adapter file -> modelConfig.lora -> inference, both text
 * and vision) works against our real production low-tier model
 * (Qwen3-VL-2B, Q4_K GGUF) on @qvac/sdk 0.18.2. Quality of the trained
 * adapter does not matter here - only whether each step completes.
 *
 * Run from apps/backend (qvac.config.mjs resolves relative to cwd):
 *   npx tsx src/experiments/lora-spike/spike.ts
 *   npx tsx src/experiments/lora-spike/spike.ts --control   # Qwen3-0.6B control run
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { finetune } from "@qvac/sdk";
import { QvacRuntimeAdapter } from "../../models/infra/qvacRuntimeAdapter.js";
import { ModelManagementService } from "../../models/service/models.service.js";
import { ModelManagementError } from "../../models/domain/errors.js";
import type { ModelSource } from "../../models/domain/types.js";
import { LLM_MODELS_BY_TIER, QWEN3_600M_MODEL_SOURCE } from "../../config/models.config.js";
import { CORPUS_DIR } from "../../document/infra/corpusDocumentRepository.js";

const IS_CONTROL = process.argv.includes("--control");

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(scriptDir, "..", "..", "..");
const repoRoot = path.resolve(backendDir, "..", "..");
const OUTPUT_DIR = path.join(repoRoot, ".qvac-cache", "experiments", "lora-spike");
const DATASET_PATH = path.join(scriptDir, "dataset.jsonl");
const ADAPTER_OUTPUT_DIR = path.join(OUTPUT_DIR, IS_CONTROL ? "adapter-control" : "adapter-qwen3vl2b");
const CHECKPOINT_DIR = path.join(OUTPUT_DIR, IS_CONTROL ? "checkpoints-control" : "checkpoints-qwen3vl2b");

const LOW_TIER = LLM_MODELS_BY_TIER.low;
const PROJECTION_SRC = LOW_TIER.engineConfig?.projectionModelSrc;
if (typeof PROJECTION_SRC !== "string") {
  throw new Error("LLM_MODELS_BY_TIER.low.engineConfig.projectionModelSrc is not a string - has models.config.ts changed shape?");
}

/**
 * finetune() rejects our production quantization outright:
 * "Finetuning is not supported for this quantization type (file_type=15).
 * Supported: F32, F16, Q4_0, Q8_0, TQ1_0, TQ2_0" - Q4_K_M (what
 * LLM_MODELS_BY_TIER.low actually serves) is not in that list. Q8_0 of the
 * exact same base model IS, and is published in the same HF repo
 * (Qwen/Qwen3-VL-2B-Instruct-GGUF) the production Q4_K_M entry resolves
 * from. So: train against the Q8_0 build, then verify the resulting
 * adapter loads and runs against the REAL production Q4_K_M model via
 * modelConfig.lora - that cross-quantization compatibility is the actual
 * question this spike now needs to answer.
 */
const QWEN3VL_2B_Q8_0_URL =
  "https://huggingface.co/Qwen/Qwen3-VL-2B-Instruct-GGUF/resolve/main/Qwen3VL-2B-Instruct-Q8_0.gguf";
const TRAIN_MODEL_SOURCE: ModelSource = IS_CONTROL ? QWEN3_600M_MODEL_SOURCE : { kind: "url", url: QWEN3VL_2B_Q8_0_URL };
const SERVE_MODEL_SOURCE: ModelSource = IS_CONTROL ? QWEN3_600M_MODEL_SOURCE : LOW_TIER.modelSource;
const PROJECTION_SOURCE: ModelSource = { kind: "rawSrc", src: PROJECTION_SRC };

interface StepTiming {
  step: string;
  ms: number;
}
const timings: StepTiming[] = [];
const warnings: string[] = [];

async function timed<T>(step: string, fn: () => Promise<T>): Promise<T> {
  const startFreeMem = os.freemem();
  const start = Date.now();
  console.log(`\n▸ [${step}] starting...`);
  try {
    const result = await fn();
    const ms = Date.now() - start;
    timings.push({ step, ms });
    const freeDeltaGB = ((startFreeMem - os.freemem()) / 1024 ** 3).toFixed(2);
    console.log(`▸ [${step}] done in ${ms}ms (system free-RAM delta: ${freeDeltaGB}GB)`);
    return result;
  } catch (err) {
    const ms = Date.now() - start;
    timings.push({ step: `${step} (FAILED)`, ms });
    console.error(`✖ [${step}] failed after ${ms}ms`);
    throw err;
  }
}

function findAdapterFile(dir: string): { path: string; sizeBytes: number } | undefined {
  if (!fs.existsSync(dir)) return undefined;
  const entries = fs.readdirSync(dir, { withFileTypes: true, recursive: true } as fs.ReaddirOptions & { recursive: true });
  for (const entry of entries as fs.Dirent[]) {
    if (entry.isFile() && entry.name.endsWith(".gguf")) {
      const full = path.join((entry as unknown as { parentPath?: string; path?: string }).parentPath ?? (entry as unknown as { path: string }).path ?? dir, entry.name);
      return { path: full, sizeBytes: fs.statSync(full).size };
    }
  }
  return undefined;
}

async function main(): Promise<void> {
  fs.mkdirSync(ADAPTER_OUTPUT_DIR, { recursive: true });
  fs.mkdirSync(CHECKPOINT_DIR, { recursive: true });

  console.log(
    IS_CONTROL
      ? "▸ Model under test: Qwen3-0.6B (CONTROL - QVAC's own documented example model)"
      : "▸ Model under test: Qwen3-VL-2B - train on Q8_0 (finetune()-supported quant), serve/verify on Q4_K_M (real production quant)",
  );
  console.log(`▸ Platform: ${os.platform()} ${os.arch()}, ${os.cpus().length} cores, ${(os.totalmem() / 1024 ** 3).toFixed(1)}GB RAM`);
  console.log(`▸ Adapter output dir: ${ADAPTER_OUTPUT_DIR}`);

  const runtimeAdapter = new QvacRuntimeAdapter();
  const service = new ModelManagementService(runtimeAdapter, runtimeAdapter);

  let adapterInfo: { path: string; sizeBytes: number } | undefined;
  let finetuneResultStatus: string | undefined;
  let finetuneStats: unknown;
  let progressSamples: Array<{ global_steps: number; loss: number | null; is_train: boolean }> = [];

  try {
    // --- 1. Provision (download, no load) ---
    await timed("provision:train-model", () => service.provisionModel(TRAIN_MODEL_SOURCE));
    await timed("provision:serve-model", () => service.provisionModel(SERVE_MODEL_SOURCE));
    if (!IS_CONTROL) {
      await timed("provision:mmproj", () => service.provisionModel(PROJECTION_SOURCE));
    }

    // --- 2. Load the TRAIN-quantization model for training (CPU explicitly -
    //     no confirmed GPU backend for training on this machine's AMD GPU;
    //     isolates the LoRA compatibility question from GPU-backend
    //     variability). This is Q8_0, not the production Q4_K_M - see the
    //     TRAIN_MODEL_SOURCE comment above for why. ---
    const trainLoad = await timed("load:for-training", () =>
      service.loadModel(TRAIN_MODEL_SOURCE, { ctxSize: 4096, engineConfig: { device: "cpu" } }),
    );
    const trainModelId = trainLoad.modelId;
    console.log(`▸ Loaded for training, modelId=${trainModelId}`);

    // --- 3. Finetune ---
    try {
      const handle = finetune({
        modelId: trainModelId,
        options: {
          trainDatasetDir: DATASET_PATH,
          validation: { type: "none" },
          outputParametersDir: ADAPTER_OUTPUT_DIR,
          numberOfEpochs: 3,
          learningRate: 1e-4,
          contextLength: 1024,
          batchSize: 8,
          microBatchSize: 8,
          assistantLossOnly: true,
          loraRank: 8,
          loraAlpha: 16,
          loraModules: "attn_q,attn_k,attn_v,attn_o,ffn_gate,ffn_up,ffn_down",
          checkpointSaveDir: CHECKPOINT_DIR,
        },
      });

      const finetuneStart = Date.now();
      for await (const progress of handle.progressStream) {
        progressSamples.push({ global_steps: progress.global_steps, loss: progress.loss, is_train: progress.is_train });
        console.log(
          `  step=${progress.global_steps} epoch=${progress.current_epoch + 1} batch=${progress.current_batch}/${progress.total_batches} ` +
            `${progress.is_train ? "train" : "val"} loss=${progress.loss?.toFixed?.(4) ?? progress.loss} eta=${Math.round(progress.eta_ms / 1000)}s`,
        );
      }
      const result = await handle.result;
      const finetuneMs = Date.now() - finetuneStart;
      timings.push({ step: "finetune()", ms: finetuneMs });
      finetuneResultStatus = result.status;
      finetuneStats = result.stats;
      console.log(`▸ [finetune()] status=${result.status} stats=${JSON.stringify(result.stats)}`);
    } finally {
      await timed("unload:after-training", () => service.unloadModel(trainModelId));
    }

    // --- 4. Locate adapter artifact ---
    adapterInfo = findAdapterFile(ADAPTER_OUTPUT_DIR);
    if (!adapterInfo) {
      warnings.push(`No .gguf file found under ${ADAPTER_OUTPUT_DIR} after finetune() reported status=${finetuneResultStatus}`);
      console.warn(`⚠ ${warnings.at(-1)}`);
    } else {
      console.log(`▸ Adapter artifact: ${adapterInfo.path} (${(adapterInfo.sizeBytes / 1024 / 1024).toFixed(2)}MB)`);
    }

    // --- 5. Verify: reload the REAL production model (Q4_K_M) with
    //     modelConfig.lora pointed at the Q8_0-trained adapter. This is the
    //     actual cross-quantization compatibility question. ---
    if (adapterInfo) {
      const textLoad = await timed("verify:load-serve-model-with-lora-text-only", () =>
        service.loadModel(SERVE_MODEL_SOURCE, {
          ctxSize: 4096,
          engineConfig: { device: "cpu", lora: adapterInfo!.path },
        }),
      );
      try {
        const textResult = await timed("verify:text-inference", () =>
          service.infer(textLoad.modelId, "What is the list price of the Aurora-7 arm?"),
        );
        console.log(`▸ [verify:text] modelId=${textLoad.modelId} answer: ${textResult.text}`);
      } catch (err) {
        warnings.push(`Text inference with adapter loaded threw: ${err instanceof Error ? err.message : String(err)}`);
        console.error(`✖ ${warnings.at(-1)}`);
      } finally {
        await service.unloadModel(textLoad.modelId).catch(() => {});
      }
    }

    // --- 6. Verify: reload the REAL production model with lora +
    //     projectionModelSrc, vision inference ---
    if (adapterInfo && !IS_CONTROL) {
      const visionLoad = await timed("verify:load-serve-model-with-lora-and-mmproj", () =>
        service.loadModel(SERVE_MODEL_SOURCE, {
          ctxSize: 4096,
          engineConfig: { device: "cpu", lora: adapterInfo!.path, projectionModelSrc: PROJECTION_SRC },
        }),
      );
      try {
        const picPath = path.join(CORPUS_DIR, "pictures", "pic1.jpeg");
        const imageData = fs.readFileSync(picPath);
        const visionResult = await timed("verify:vision-inference", () =>
          service.chatComplete(visionLoad.modelId, {
            history: [
              {
                role: "user",
                content: "What do you see in this image?",
                images: [{ mimeType: "image/jpeg", data: imageData }],
              },
            ],
          }),
        );
        console.log(`▸ [verify:vision] modelId=${visionLoad.modelId} answer: ${visionResult.text}`);
      } catch (err) {
        warnings.push(`Vision inference with adapter loaded threw: ${err instanceof Error ? err.message : String(err)}`);
        console.error(`✖ ${warnings.at(-1)}`);
      } finally {
        await service.unloadModel(visionLoad.modelId).catch(() => {});
      }
    }
  } finally {
    await service.unloadAll().catch(() => {});
    await service.close().catch(() => {});
  }

  // --- Summary ---
  console.log("\n========== STAGE 1 SPIKE SUMMARY ==========");
  console.log(JSON.stringify({
    model: IS_CONTROL ? "Qwen3-0.6B (control)" : "Qwen3-VL-2B Q4_K (production)",
    device: "cpu",
    finetuneStatus: finetuneResultStatus,
    finetuneStats,
    progressSamples,
    adapter: adapterInfo,
    timingsMs: timings,
    warnings,
  }, null, 2));
}

main().catch((err) => {
  if (err instanceof ModelManagementError) {
    console.error(`\n✖ Spike failed at stage "${err.stage}":`, err.cause ?? err.message);
  } else {
    console.error("\n✖ Spike failed:", err);
  }
  console.log("\n========== STAGE 1 SPIKE SUMMARY (FAILED) ==========");
  console.log(JSON.stringify({ timingsMs: timings, warnings, failed: true }, null, 2));
  process.exit(1);
});
