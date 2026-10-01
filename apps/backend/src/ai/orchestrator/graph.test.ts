import { describe, expect, it } from "vitest";
import { AIMessage, AIMessageChunk, HumanMessage } from "@langchain/core/messages";
import type { ChatQVAC } from "qvac-langgraph";
import { buildLlmNode } from "./graph.js";
import { INSUFFICIENT_CONTEXT_MESSAGE } from "./ragGraph.const.js";

/** Fakes just enough of ChatQVAC's bound-model surface for buildLlmNode: `bindTools(tools).stream([...])` yielding a single chunk. */
function fakeModelWithResponse(chunk: AIMessageChunk): ChatQVAC {
  const boundModel = {
    stream: async function* () {
      yield chunk;
    },
  };
  return { bindTools: () => boundModel } as unknown as ChatQVAC;
}

describe("buildLlmNode guard (graph.ts)", () => {
  it("returns the model's answer when the turn has an image but no RAG evidence", async () => {
    const model = fakeModelWithResponse(new AIMessageChunk({ content: "It's a cracked mounting bracket." }));
    const node = buildLlmNode([], model);

    const update = (await node(
      {
        messages: [new HumanMessage("what's wrong with this?")],
        chunks: [],
        hasEvidence: false,
        hasVisualInput: true,
        temperature: undefined,
        seed: undefined, sessionId: undefined, requestId: undefined,
      },
      {},
    )) as { messages: AIMessage[] };

    expect(update.messages).toHaveLength(1);
    expect(update.messages[0].text).toBe("It's a cracked mounting bracket.");
  });

  it("uses the model's answer when there is both an image and RAG evidence", async () => {
    const model = fakeModelWithResponse(new AIMessageChunk({ content: "Combined answer." }));
    const node = buildLlmNode([], model);

    const update = (await node(
      {
        messages: [new HumanMessage("does this match the warranty terms?")],
        chunks: [{ id: "c1", content: "Warranty covers 24 months.", score: 0.9 }],
        hasEvidence: true,
        hasVisualInput: true,
        temperature: undefined,
        seed: undefined, sessionId: undefined, requestId: undefined,
      },
      {},
    )) as { messages: AIMessage[] };

    expect(update.messages[0].text).toBe("Combined answer.");
  });

  it("falls back to the fixed insufficient-context message when there is no evidence of any kind", async () => {
    const model = fakeModelWithResponse(new AIMessageChunk({ content: "I'd guess it's fine." }));
    const node = buildLlmNode([], model);

    const update = (await node(
      {
        messages: [new HumanMessage("what's the SLA for enterprise P1?")],
        chunks: [],
        hasEvidence: false,
        hasVisualInput: false,
        temperature: undefined,
        seed: undefined, sessionId: undefined, requestId: undefined,
      },
      {},
    )) as { messages: AIMessage[] };

    expect(update.messages[0].text).toBe(INSUFFICIENT_CONTEXT_MESSAGE);
  });
});
