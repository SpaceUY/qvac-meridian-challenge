import { describe, expect, it, vi } from "vitest";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { ChatQVAC } from "@space-uy/qvac-langgraph";
import type { RagRetrievalService } from "../../rag/service/rag.service.js";
import type { RetrievedChunk } from "../../rag/domain/types.js";
import {
  buildLlmNode,
  buildRetrieveNode,
  hasImageContent,
  insufficientContextNode,
  routeOnEvidence,
} from "./ragGraph.js";
import {
  GROUNDING_INSTRUCTIONS,
  INSUFFICIENT_CONTEXT_MESSAGE,
} from "./ragGraph.const.js";

describe("routeOnEvidence", () => {
  const BASE_STATE = {
    temperature: undefined,
    seed: undefined,
    sessionId: undefined,
  };

  it("routes to insufficientContext when hasEvidence is false", () => {
    expect(
      routeOnEvidence(
        {
          ...BASE_STATE,
          messages: [],
          chunks: [],
          hasEvidence: false,
          hasVisualInput: false,
        },
        {},
      ),
    ).toBe("insufficientContext");
  });

  it("routes to llm when hasEvidence is true", () => {
    expect(
      routeOnEvidence(
        {
          ...BASE_STATE,
          messages: [],
          chunks: [],
          hasEvidence: true,
          hasVisualInput: false,
        },
        {},
      ),
    ).toBe("llm");
  });

  it("routes to llm when there is no RAG evidence but there is visual input", () => {
    expect(
      routeOnEvidence(
        {
          ...BASE_STATE,
          messages: [],
          chunks: [],
          hasEvidence: false,
          hasVisualInput: true,
        },
        {},
      ),
    ).toBe("llm");
  });
});

describe("insufficientContextNode", () => {
  it("returns the fixed insufficient-context message without calling any model", async () => {
    const update = (await insufficientContextNode(
      {
        temperature: undefined,
        seed: undefined,
        sessionId: undefined,
        messages: [],
        chunks: [],
        hasEvidence: false,
        hasVisualInput: false,
      },
      {},
    )) as {
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
    const chunks: RetrievedChunk[] = [
      { id: "a", content: "Chunk A", score: 0.9 },
    ];
    const retrieve = vi.fn().mockResolvedValue({ chunks, hasEvidence: true });
    const ragService = { retrieve } as unknown as RagRetrievalService;

    const node = buildRetrieveNode(ragService);
    const update = await node(
      {
        messages: [new HumanMessage("What is the enterprise P1 SLA?")],
        chunks: [],
        hasEvidence: false,
        hasVisualInput: false,
        temperature: undefined,
        seed: undefined,
        sessionId: undefined,
      },
      {},
    );

    expect(retrieve).toHaveBeenCalledWith("What is the enterprise P1 SLA?");
    expect(update).toEqual({
      chunks,
      hasEvidence: true,
      hasVisualInput: false,
    });
  });

  it("returns no evidence when there is no human message in state", async () => {
    const retrieve = vi.fn();
    const ragService = { retrieve } as unknown as RagRetrievalService;

    const node = buildRetrieveNode(ragService);
    const update = await node(
      {
        messages: [],
        chunks: [],
        hasEvidence: false,
        hasVisualInput: false,
        temperature: undefined,
        seed: undefined,
        sessionId: undefined,
      },
      {},
    );

    expect(retrieve).not.toHaveBeenCalled();
    expect(update).toEqual({
      chunks: [],
      hasEvidence: false,
      hasVisualInput: false,
    });
  });

  it("returns hasVisualInput true and skips RAG search when the question is image-only (empty text)", async () => {
    const retrieve = vi.fn();
    const ragService = { retrieve } as unknown as RagRetrievalService;

    const node = buildRetrieveNode(ragService);
    const imageMessage = new HumanMessage({
      content: [
        {
          type: "image",
          mimeType: "image/jpeg",
          data: new Uint8Array([0xff, 0xd8]),
        },
      ],
    });
    const update = await node(
      {
        messages: [imageMessage],
        chunks: [],
        hasEvidence: false,
        hasVisualInput: false,
        temperature: undefined,
        seed: undefined,
        sessionId: undefined,
      },
      {},
    );

    expect(retrieve).not.toHaveBeenCalled();
    expect(update).toEqual({
      chunks: [],
      hasEvidence: false,
      hasVisualInput: true,
    });
  });

  it("returns hasVisualInput true alongside real RAG evidence when both are present", async () => {
    const chunks: RetrievedChunk[] = [
      { id: "a", content: "Chunk A", score: 0.9 },
    ];
    const retrieve = vi.fn().mockResolvedValue({ chunks, hasEvidence: true });
    const ragService = { retrieve } as unknown as RagRetrievalService;

    const node = buildRetrieveNode(ragService);
    const message = new HumanMessage({
      content: [
        { type: "text", text: "what's wrong with this?" },
        {
          type: "image",
          mimeType: "image/jpeg",
          data: new Uint8Array([0xff, 0xd8]),
        },
      ],
    });
    const update = await node(
      {
        messages: [message],
        chunks: [],
        hasEvidence: false,
        hasVisualInput: false,
        temperature: undefined,
        seed: undefined,
        sessionId: undefined,
      },
      {},
    );

    expect(retrieve).toHaveBeenCalledWith("what's wrong with this?");
    expect(update).toEqual({ chunks, hasEvidence: true, hasVisualInput: true });
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
    const invoke = vi
      .fn()
      .mockResolvedValue(new AIMessage("The SLA is 4 hours."));
    const model = { invoke } as unknown as ChatQVAC;

    const node = buildLlmNode(model);
    const humanMessage = new HumanMessage("What is the enterprise P1 SLA?");
    const update = (await node(
      {
        messages: [humanMessage],
        chunks,
        hasEvidence: true,
        hasVisualInput: false,
        temperature: undefined,
        seed: undefined,
        sessionId: undefined,
      },
      {},
    )) as {
      messages: AIMessage[];
    };

    expect(invoke).toHaveBeenCalledTimes(1);
    const [messagesArg] = invoke.mock.calls[0] as [unknown[]];
    const [systemMessage, passedHuman] = messagesArg as [
      SystemMessage,
      HumanMessage,
    ];

    expect(SystemMessage.isInstance(systemMessage)).toBe(true);
    expect(systemMessage.text).toContain(GROUNDING_INSTRUCTIONS);
    expect(systemMessage.text).toContain(
      "[Source: support-sla-faq.html | id: chunk-sla-p1]",
    );
    expect(systemMessage.text).toContain(
      "Enterprise P1 first-response SLA is 4 hours.",
    );
    expect(passedHuman).toBe(humanMessage);

    expect(update.messages).toHaveLength(1);
  });
});

describe("hasImageContent", () => {
  it("is false for a text-only message", () => {
    expect(hasImageContent(new HumanMessage("hello"))).toBe(false);
  });

  it("is true when content includes an image block", () => {
    const message = new HumanMessage({
      content: [
        { type: "text", text: "what's this?" },
        {
          type: "image",
          mimeType: "image/jpeg",
          data: new Uint8Array([
            0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01, 0x02, 0x03,
          ]),
        },
      ],
    });
    expect(hasImageContent(message)).toBe(true);
  });
});
