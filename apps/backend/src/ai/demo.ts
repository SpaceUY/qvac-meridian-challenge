import { ChatQVAC } from "./orchestrator/qvacChatModel.js";
import { createGraph } from "./orchestrator/graph.js";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { QWEN3_600M_INST_Q4 } from "@qvac/sdk";
import { ModelManagementService } from "../models/service/models.service.js";
import { QvacRuntimeAdapter } from "../models/infra/qvacRuntimeAdapter.js";

async function main(): Promise<void> {
  const adapter = new QvacRuntimeAdapter();
  const service = new ModelManagementService(adapter, adapter);

  const qvacModel = new ChatQVAC({
    service,
    modelSource: {
      kind: "registry",
      registryPath: QWEN3_600M_INST_Q4.registryPath,
      registrySource: QWEN3_600M_INST_Q4.registrySource,
    },
    temperature: 0, // 0.7 being too high for a 600M/Q4 quantized model to reliably follow the strict tool-call format.
  });

  try {
    const graph = createGraph(qvacModel);

    const result = await graph.invoke({
      messages: [
        new HumanMessage(
          "Can you give me all the stock information about SKU: SD-X4-HT?",
        ),
      ],
    });

    const lastAIMessage = [...result.messages]
      .reverse()
      .find((message): message is AIMessage => AIMessage.isInstance(message));

    console.log(lastAIMessage?.content);
  } finally {
    await service.unloadAll();
    await service.close();
  }
}

main().catch((err) => {
  console.error("\n✖ Demo failed:", err);
  process.exit(1);
});
