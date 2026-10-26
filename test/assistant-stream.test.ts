import assert from "node:assert/strict";
import test from "node:test";
import {
  consumeAssistantMessageStreams,
  type StreamedAssistantMessage
} from "../src/assistant-stream";

async function* text(...chunks: string[]): AsyncIterable<string> {
  yield* chunks;
}

async function* messages(
  ...items: Array<{ chunks: string[]; toolCalls?: unknown[] }>
): AsyncIterable<StreamedAssistantMessage> {
  for (const item of items) {
    yield {
      text: text(...item.chunks),
      output: Promise.resolve({ tool_calls: item.toolCalls ?? [] })
    };
  }
}

test("streams text deltas in order and clears transient tool-call prose", async () => {
  const events: string[] = [];

  await consumeAssistantMessageStreams(
    messages(
      { chunks: ["I will ", "inspect that."], toolCalls: [{ name: "read_file" }] },
      { chunks: ["The issue ", "is fixed."] }
    ),
    async (delta) => { events.push(`delta:${delta}`); },
    async (toolTurn) => { if (toolTurn) events.push("reset"); }
  );

  assert.deepEqual(events, [
    "delta:I will ",
    "delta:inspect that.",
    "reset",
    "delta:The issue ",
    "delta:is fixed."
  ]);
});

test("does not create empty deltas and resets tool-only turns", async () => {
  const events: string[] = [];

  await consumeAssistantMessageStreams(
    messages({ chunks: ["", ""], toolCalls: [{ name: "search_files" }] }),
    async (delta) => { events.push(`delta:${delta}`); },
    async (toolTurn) => { if (toolTurn) events.push("reset"); }
  );

  assert.deepEqual(events, ["reset"]);
});

test("detects tool calls nested in LangChain run output", async () => {
  const events: string[] = [];
  const nested: AsyncIterable<StreamedAssistantMessage> = (async function* () {
    yield {
      text: text("Vou consultar os arquivos."),
      output: Promise.resolve({ messages: [{ additional_kwargs: { tool_calls: [{ name: "read_file" }] } }] })
    };
  })();

  await consumeAssistantMessageStreams(
    nested,
    async (delta) => { events.push(`delta:${delta}`); },
    async (toolTurn) => { if (toolTurn) events.push("reset"); }
  );

  assert.deepEqual(events, ["delta:Vou consultar os arquivos.", "reset"]);
});

test("normalizes cumulative and repeated provider chunks", async () => {
  const events: string[] = [];

  await consumeAssistantMessageStreams(
    messages({ chunks: ["Vamos", "Vamos também", "Vamos também ver", "Vamos também ver"] }),
    async (delta) => { events.push(delta); },
    async () => undefined
  );

  assert.deepEqual(events, ["Vamos", " também", " ver"]);
});

test("closes the current message lifecycle before propagating a stream failure", async () => {
  const events: string[] = [];
  async function* failingText(): AsyncIterable<string> {
    yield "partial";
    throw new Error("stream interrupted");
  }
  async function* failingMessages(): AsyncIterable<StreamedAssistantMessage> {
    yield { text: failingText(), output: Promise.resolve({}) };
  }

  await assert.rejects(
    consumeAssistantMessageStreams(
      failingMessages(),
      async (delta) => { events.push(`delta:${delta}`); },
      async (toolTurn) => { events.push(`end:${toolTurn}`); }
    ),
    /stream interrupted/
  );

  assert.deepEqual(events, ["delta:partial", "end:false"]);
});
