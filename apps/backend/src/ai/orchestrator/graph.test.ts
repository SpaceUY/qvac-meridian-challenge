import { describe, expect, it, vi } from "vitest";
import {
  AIMessage,
  AIMessageChunk,
  HumanMessage,
} from "@langchain/core/messages";
import { ChatQVAC } from "@space-uy/qvac-langgraph";
import { buildLlmNode, classifyGreeting } from "./graph.js";
import { INSUFFICIENT_CONTEXT_MESSAGE } from "./ragGraph.const.js";

/**
 * Fakes just enough of ChatQVAC's surface for buildLlmNode:
 * `bindTools(tools).stream([...])` yielding a single chunk for the main
 * reply, and `invoke()` for the greeting classifier call the guard makes
 * when that reply has no evidence, no image, and no tool call.
 */
function fakeModelWithResponse(
  chunk: AIMessageChunk,
  classifierReplyText = "OTHER",
): ChatQVAC {
  const boundModel = {
    stream: async function* () {
      yield chunk;
    },
  };
  return {
    bindTools: () => boundModel,
    invoke: async () => new AIMessage(classifierReplyText),
  } as unknown as ChatQVAC;
}

describe("buildLlmNode guard (graph.ts)", () => {
  it("returns the model's answer when the turn has an image but no RAG evidence", async () => {
    const model = fakeModelWithResponse(
      new AIMessageChunk({ content: "It's a cracked mounting bracket." }),
    );
    const node = buildLlmNode([], model);

    const update = (await node(
      {
        messages: [new HumanMessage("what's wrong with this?")],
        chunks: [],
        hasEvidence: false,
        hasVisualInput: true,
        temperature: undefined,
        seed: undefined, sessionId: undefined, requestId: undefined, completionStats: undefined,
      },
      {},
    )) as { messages: AIMessage[] };

    expect(update.messages).toHaveLength(1);
    expect(update.messages[0].text).toBe("It's a cracked mounting bracket.");
  });

  it("uses the model's answer when there is both an image and RAG evidence", async () => {
    const model = fakeModelWithResponse(
      new AIMessageChunk({ content: "Combined answer." }),
    );
    const node = buildLlmNode([], model);

    const update = (await node(
      {
        messages: [new HumanMessage("does this match the warranty terms?")],
        chunks: [
          { id: "c1", content: "Warranty covers 24 months.", score: 0.9 },
        ],
        hasEvidence: true,
        hasVisualInput: true,
        temperature: undefined,
        seed: undefined, sessionId: undefined, requestId: undefined, completionStats: undefined,
      },
      {},
    )) as { messages: AIMessage[] };

    expect(update.messages[0].text).toBe("Combined answer.");
  });

  it("falls back to the fixed insufficient-context message when there is no evidence of any kind", async () => {
    const model = fakeModelWithResponse(
      new AIMessageChunk({ content: "I'd guess it's fine." }),
      "OTHER",
    );
    const node = buildLlmNode([], model);

    const update = (await node(
      {
        messages: [new HumanMessage("what's the SLA for enterprise P1?")],
        chunks: [],
        hasEvidence: false,
        hasVisualInput: false,
        temperature: undefined,
        seed: undefined, sessionId: undefined, requestId: undefined, completionStats: undefined,
      },
      {},
    )) as { messages: AIMessage[] };

    expect(update.messages[0].text).toBe(INSUFFICIENT_CONTEXT_MESSAGE);
  });

  it("records the model call's token counters, even when the guard replaces the reply", async () => {
    const stats = { cacheTokens: 900, promptTokens: 700, generatedTokens: 20 };
    const model = fakeModelWithResponse(
      new AIMessageChunk({
        content: "I'd guess.",
        response_metadata: { stats },
      }),
      "OTHER",
    );
    const node = buildLlmNode([], model);

    const update = (await node(
      {
        messages: [new HumanMessage("anything")],
        chunks: [],
        hasEvidence: false,
        hasVisualInput: false,
        temperature: undefined,
        seed: undefined,
        sessionId: undefined,
        requestId: undefined,
        completionStats: undefined,
      },
      {},
    )) as { messages: AIMessage[]; completionStats?: unknown };

    expect(update.messages[0].text).toBe(INSUFFICIENT_CONTEXT_MESSAGE);
    expect(update.completionStats).toEqual(stats);
  });

  it("returns the model's answer for a greeting even with no evidence of any kind", async () => {
    const model = fakeModelWithResponse(
      new AIMessageChunk({ content: "Hi, I'm Meridian's assistant!" }),
      "GREETING",
    );
    const node = buildLlmNode([], model);

    const update = (await node(
      {
        messages: [new HumanMessage("hola")],
        chunks: [],
        hasEvidence: false,
        hasVisualInput: false,
        temperature: undefined,
        seed: undefined, sessionId: undefined, requestId: undefined, completionStats: undefined,
      },
      {},
    )) as { messages: AIMessage[] };

    expect(update.messages[0].text).toBe("Hi, I'm Meridian's assistant!");
  });

  it("never classifies - and returns the tool call as-is - when the model already asked to call a tool, even with no evidence yet", async () => {
    const toolCallChunk = new AIMessageChunk({
      content: "",
      tool_calls: [
        { name: "lookup_stock", args: { sku: "SD-X4-001" }, id: "call-1" },
      ],
    });
    const classifierInvoke = vi.fn();
    const model = {
      bindTools: () => ({
        stream: async function* () {
          yield toolCallChunk;
        },
      }),
      invoke: classifierInvoke,
    } as unknown as ChatQVAC;
    const node = buildLlmNode([], model);

    const update = (await node(
      {
        messages: [new HumanMessage("how many SD-X4-001 are in stock?")],
        chunks: [],
        hasEvidence: false,
        hasVisualInput: false,
        temperature: undefined,
        seed: undefined, sessionId: undefined, requestId: undefined, completionStats: undefined,
      },
      {},
    )) as { messages: AIMessage[] };

    expect(update.messages[0].tool_calls).toHaveLength(1);
    expect(classifierInvoke).not.toHaveBeenCalled();
  });
});

describe("classifyGreeting (graph.ts)", () => {
  function fakeClassifierModel(replyText: string): ChatQVAC {
    return {
      invoke: async () => new AIMessage(replyText),
    } as unknown as ChatQVAC;
  }

  it("returns true for a plain greeting", async () => {
    const result = await classifyGreeting(
      fakeClassifierModel("GREETING"),
      new HumanMessage("buenas"),
    );
    expect(result).toBe(true);
  });

  it("returns false for a real question", async () => {
    const result = await classifyGreeting(
      fakeClassifierModel("OTHER"),
      new HumanMessage("what's the SLA for enterprise P1?"),
    );
    expect(result).toBe(false);
  });
});
