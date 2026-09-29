import { describe, expect, it, vi } from "vitest";
import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { ChatQVAC } from "./qvacChatModel.js";
import type { RagRetrievalService } from "../../rag/service/rag.service.js";
import type { RetrievedChunk } from "../../rag/domain/types.js";
import {
  buildLlmNode,
  buildRetrieveNode,
  insufficientContextNode,
  routeOnEvidence,
} from "./ragGraph.js";
import { GROUNDING_INSTRUCTIONS, INSUFFICIENT_CONTEXT_MESSAGE } from "./ragGraph.const.js";

describe("routeOnEvidence", () => {
  it("routes to insufficientContext when hasEvidence is false", () => {
    expect(routeOnEvidence({ messages: [], chunks: [], hasEvidence: false }, {})).toBe(
      "insufficientContext",
    );
  });

  it("routes to llm when hasEvidence is true", () => {
    expect(routeOnEvidence({ messages: [], chunks: [], hasEvidence: true }, {})).toBe("llm");
  });
});

describe("insufficientContextNode", () => {
  it("returns the fixed insufficient-context message without calling any model", async () => {
    const update = (await insufficientContextNode({ messages: [], chunks: [], hasEvidence: false }, {})) as {
      messages: AIMessage[];
    };

    expect(update.messages).toHaveLength(1);
    const [message] = update.messages;
    expect(AIMessage.isInstance(message)).toBe(true);
    expect(message.text).toBe(INSUFFICIENT_CONTEXT_MESSAGE);
  });
});

describe("buildRetrieveNode", () => {
  it("calls RagRetrievalService.retrieve with the last human message and stores the result", async () => {
    const chunks: RetrievedChunk[] = [{ id: "a", content: "Chunk A", score: 0.9 }];
    const retrieve = vi.fn().mockResolvedValue({ chunks, hasEvidence: true });
    const ragService = { retrieve } as unknown as RagRetrievalService;

    const node = buildRetrieveNode(ragService);
    const update = await node(
      {
        messages: [new HumanMessage("What is the enterprise P1 SLA?")],
        chunks: [],
        hasEvidence: false,
      },
      {},
    );

    expect(retrieve).toHaveBeenCalledWith("What is the enterprise P1 SLA?");
    expect(update).toEqual({ chunks, hasEvidence: true });
  });

  it("returns no evidence when there is no human message in state", async () => {
    const retrieve = vi.fn();
    const ragService = { retrieve } as unknown as RagRetrievalService;

    const node = buildRetrieveNode(ragService);
    const update = await node({ messages: [], chunks: [], hasEvidence: false }, {});

    expect(retrieve).not.toHaveBeenCalled();
    expect(update).toEqual({ chunks: [], hasEvidence: false });
  });
});

describe("buildLlmNode", () => {
  it("injects the grounding instructions and formatted context as a system message", async () => {
    const chunks: RetrievedChunk[] = [
      {
        id: "chunk-sla-p1",
        content: "Enterprise P1 first-response SLA is 4 hours.",
        score: 0.9,
        source: "support-sla-faq.html",
      },
    ];
    const invoke = vi.fn().mockResolvedValue(new AIMessage("The SLA is 4 hours."));
    const model = { invoke } as unknown as ChatQVAC;

    const node = buildLlmNode(model);
    const humanMessage = new HumanMessage("What is the enterprise P1 SLA?");
    const update = (await node({ messages: [humanMessage], chunks, hasEvidence: true }, {})) as {
      messages: AIMessage[];
    };

    expect(invoke).toHaveBeenCalledTimes(1);
    const [messagesArg] = invoke.mock.calls[0] as [unknown[]];
    const [systemMessage, passedHuman] = messagesArg as [SystemMessage, HumanMessage];

    expect(SystemMessage.isInstance(systemMessage)).toBe(true);
    expect(systemMessage.text).toContain(GROUNDING_INSTRUCTIONS);
    expect(systemMessage.text).toContain("[Source: support-sla-faq.html | id: chunk-sla-p1]");
    expect(systemMessage.text).toContain("Enterprise P1 first-response SLA is 4 hours.");
    expect(passedHuman).toBe(humanMessage);

    expect(update.messages).toHaveLength(1);
  });
});
