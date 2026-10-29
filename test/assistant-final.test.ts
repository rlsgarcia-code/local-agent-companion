import assert from "node:assert/strict";
import test from "node:test";
import { extractFinalAssistantText, hasTerminalAssistantMessage } from "../src/assistant-final";

test("extracts the final assistant message from canonical graph state", () => {
  assert.equal(extractFinalAssistantText({
    messages: [
      { type: "ai", content: "I will inspect files.", tool_calls: [{ name: "read_file" }] },
      { type: "tool", content: "file contents" },
      { type: "ai", content: [{ type: "text", text: "The review is complete." }] }
    ]
  }), "The review is complete.");
});

test("extracts serialized and wrapped adapter output without replaying old turns", () => {
  assert.equal(extractFinalAssistantText({ output: {
    kwargs: {
      messages: [
        { id: ["langchain", "AIMessage"], kwargs: { content: "Final answer" } }
      ]
    }
  }}), "Final answer");
});

test("returns a plain final output string", () => {
  assert.equal(extractFinalAssistantText("A final response"), "A final response");
});

test("does not promote an earlier analysis when the graph ends on a tool or tool call", () => {
  const toolLast = { messages: [
    { type: "ai", content: "I will implement this." },
    { type: "tool", content: "The edit failed." }
  ] };
  assert.equal(extractFinalAssistantText(toolLast), "");
  assert.equal(hasTerminalAssistantMessage(toolLast), false);
  const pendingCall = { messages: [{ type: "ai", content: "Editing...", tool_calls: [{ name: "edit_file" }] }] };
  assert.equal(extractFinalAssistantText(pendingCall), "");
  assert.equal(hasTerminalAssistantMessage(pendingCall), false);
});
