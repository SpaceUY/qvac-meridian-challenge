/**
 * End-to-end local VLM proof: load Qwen3-VL-2B + its vision projector,
 * send each sample image under corpus/pictures/ with a question, print the
 * model's answer - no HTTP, no RAG, no LangGraph, just ChatQVAC talking to
 * the real QVAC runtime. Proves the multimodal pipeline end to end against
 * real files: image -> ChatQVAC content block -> ChatMessage.images ->
 * qvacRuntimeAdapter's temp-file attachments -> QVAC -> answer.
 *
 * pic2.png is deliberately NOT sent to the model: `file` confirms it's
 * actually WebP despite its .png extension, and chat.router.helpers.ts
 * rejects WebP by design (see docs/superpowers/specs/
 * 2026-09-24-multimodal-vlm-backend-design.md). This script logs that
 * instead of sending it, since only chat.router.helpers.ts (an HTTP-layer
 * concern) does that rejection - this script talks to ChatQVAC directly.
 *
 * Run with: npm run multimodal-demo --workspace=apps/backend
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { HumanMessage } from "@langchain/core/messages";
import { ChatQVAC } from "@space-uy/qvac-langgraph";
import { QvacChatSession } from "./orchestrator/qvacChatSession.js";
import { ModelManagementService } from "../models/service/models.service.js";
import { QvacRuntimeAdapter } from "../models/infra/qvacRuntimeAdapter.js";
import { CORPUS_ROOT } from "../config/rag.config.js";
import { LLM_MODELS_BY_TIER } from "../config/models.config.js";

const CORPUS_PICTURES_DIR = path.join(CORPUS_ROOT, "pictures");

async function askAboutImage(
  model: ChatQVAC,
  fileName: string,
  mimeType: "image/jpeg" | "image/png",
  question: string,
): Promise<void> {
  const filePath = path.join(CORPUS_PICTURES_DIR, fileName);
  const data = await fs.readFile(filePath);

  console.log(`\n▸ [${fileName}] asking: "${question}"`);
  const response = await model.invoke([
    new HumanMessage({
      content: [
        { type: "text", text: question },
        { type: "image", mimeType, data },
      ],
    }),
  ]);
  console.log(`▸ [${fileName}] answer: ${response.text}`);
}

async function main(): Promise<void> {
  const adapter = new QvacRuntimeAdapter();
  const service = new ModelManagementService(adapter, adapter);

  const chatSession = new QvacChatSession({
    service,
    modelSource: LLM_MODELS_BY_TIER.low.modelSource,
    ctxSize: LLM_MODELS_BY_TIER.low.ctxSize,
    engineConfig: LLM_MODELS_BY_TIER.low.engineConfig,
  });
  const model = new ChatQVAC({
    complete: chatSession.complete,
    temperature: LLM_MODELS_BY_TIER.low.temperature,
  });

  try {
    await askAboutImage(model, "pic1.jpeg", "image/jpeg", "What do you see in this image?");

    console.log(
      "\n▸ [pic2.png] skipped: magic bytes detect this file as WebP (confirmed with `file`), " +
        "which is rejected by design at the API boundary - not sent to the model here.",
    );

    console.log("\n▸ Done: the multimodal pipeline answered from a real image in corpus/pictures/.");
  } finally {
    await service.unloadAll();
    await service.close();
  }
}

main().catch((err) => {
  console.error("\n✖ Multimodal demo failed:", err);
  process.exit(1);
});
