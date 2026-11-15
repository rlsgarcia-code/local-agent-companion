import { randomUUID } from "node:crypto";
import { AIMessage } from "@langchain/core/messages";
import { createMiddleware } from "langchain";

/** A provider response ID is not a graph-turn identity. Repair only collisions
 * before the official message reducer can replace an earlier turn. The new ID
 * is persisted with this response; checkpoint replay must keep it unchanged. */
export function modelMessageIdentity() {
  return createMiddleware({
    name: "ModelMessageIdentity",
    wrapModelCall: async (request, handler) => {
      const response = await handler(request);
      if (!response.id || ![...request.state.messages, ...request.messages].some(message => message.id === response.id)) return response;
      return new AIMessage({ ...response, id: `turn-${randomUUID()}` });
    },
  });
}
