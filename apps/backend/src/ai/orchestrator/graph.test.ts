import { describe, expect, it, vi } from "vitest";
import {
  AIMessage,
  AIMessageChunk,
  HumanMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import { ChatQVAC } from "@space-uy/qvac-langgraph";
import { buildLlmNode, classifyGreeting } from "./graph.js";
import { INSUFFICIENT_CONTEXT_MESSAGE } from "./ragGraph.const.js";

/** Fakes just enough of ChatQVAC for buildLlmNode: `bindTools(tools).stream([...])` yields the main reply, and `invoke()` handles the greeting classifier call the guard makes when that reply has no evidence/image/tool call. */
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

const SLA_CHUNK = {
  id: "chunk-sla-p1",
  source: "support-sla-faq.html",
  content: "Enterprise P1 first-response SLA is 4 hours.",
  score: 0.9,
};
const WARRANTY_CHUNK = {
  id: "chunk-warranty",
  source: "warranty-terms.md",
  content: "Standard hardware warranty covers 24 months.",
  score: 0.9,
};

/** Runs buildLlmNode once and returns the exact messages the model was asked to complete. */
async function messagesSentToModel(
  messages: BaseMessage[],
  chunks: (typeof SLA_CHUNK)[],
): Promise<BaseMessage[]> {
  const sent: BaseMessage[][] = [];
  const model = {
    bindTools: () => ({
      stream: async function* (received: BaseMessage[]) {
        sent.push(received);
        yield new AIMessageChunk({ content: "ok" });
      },
    }),
    invoke: async () => new AIMessage("OTHER"),
  } as unknown as ChatQVAC;

  await buildLlmNode([], model)(
    {
      messages,
      chunks,
      hasEvidence: chunks.length > 0,
      hasVisualInput: false,
      temperature: undefined,
      seed: undefined,
      sessionId: undefined,
      requestId: undefined,
      completionStats: undefined,
    },
    {},
  );
  return sent[0];
}

describe("buildLlmNode context placement (KV-cache friendly prompt)", () => {
  it("keeps the system message identical across turns whose retrieved chunks differ", async () => {
    const turn1 = await messagesSentToModel([new HumanMessage("SLA?")], [SLA_CHUNK]);
    const turn2 = await messagesSentToModel([new HumanMessage("warranty?")], [WARRANTY_CHUNK]);

    expect(turn1[0].text).toBe(turn2[0].text);
    expect(turn1[0].text).not.toContain(SLA_CHUNK.content);
    expect(turn2[0].text).not.toContain(WARRANTY_CHUNK.content);
  });

  it("puts the retrieved context in the latest user message and leaves earlier turns untouched", async () => {
    const sent = await messagesSentToModel(
      [
        new HumanMessage("What is the P1 SLA?"),
        new AIMessage("It is 4 hours."),
        new HumanMessage("And the warranty?"),
      ],
      [WARRANTY_CHUNK],
    );

    const [, firstHuman, assistant, lastHuman] = sent;
    expect(firstHuman.text).toBe("What is the P1 SLA?");
    expect(assistant.text).toBe("It is 4 hours.");
    expect(lastHuman.text).toContain("[Source: warranty-terms.md | id: chunk-warranty]");
    expect(lastHuman.text).toContain(WARRANTY_CHUNK.content);
    expect(lastHuman.text).toContain("And the warranty?");
  });

  it("keeps the context on the user message when a tool result follows it", async () => {
    const sent = await messagesSentToModel(
      [
        new HumanMessage("How many SD-X4-001 are in stock?"),
        new AIMessage({
          content: "",
          tool_calls: [{ name: "lookup_stock", args: { sku: "SD-X4-001" }, id: "call-1" }],
        }),
        new ToolMessage({ content: "22 units", tool_call_id: "call-1", name: "lookup_stock" }),
      ],
      [SLA_CHUNK],
    );

    expect(sent).toHaveLength(4);
    expect(sent[1].text).toContain(SLA_CHUNK.content);
    expect(sent[1].text).toContain("How many SD-X4-001 are in stock?");
    expect(ToolMessage.isInstance(sent[3])).toBe(true);
  });

  it("keeps an attached image on the user message and adds the context as text", async () => {
    const withImage = new HumanMessage({
      content: [
        { type: "text", text: "does this match the warranty?" },
        { type: "image", mimeType: "image/png", data: Buffer.from("png-bytes") },
      ],
    });

    const [, lastHuman] = await messagesSentToModel([withImage], [WARRANTY_CHUNK]);

    expect(lastHuman.contentBlocks.some((block) => block.type === "image")).toBe(true);
    expect(lastHuman.text).toContain(WARRANTY_CHUNK.content);
    expect(lastHuman.text).toContain("does this match the warranty?");
  });

  it("does not modify the messages held in graph state", async () => {
    const human = new HumanMessage("What is the P1 SLA?");

    await messagesSentToModel([human], [SLA_CHUNK]);

    expect(human.text).toBe("What is the P1 SLA?");
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
