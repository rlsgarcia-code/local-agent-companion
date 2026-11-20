import type { GraphSubagentStream, GraphToolStream } from "./graph";
import { consumeAssistantMessageStreams } from "./assistant-stream";

export async function settleToolCallStreams(streams: AsyncIterable<GraphToolStream>): Promise<void> {
  const active = new Set<Promise<void>>();
  try {
    for await (const call of streams) {
      const settled = Promise.allSettled([call.output, call.status, call.error]).then(() => {});
      active.add(settled); void settled.then(() => active.delete(settled));
    }
  } finally { await Promise.all(active); }
}

/** Observe the official v3 projections, not another execution loop. A failed
 * child's output promise must be consumed even when the supervisor handles its
 * failure. Child outcomes do not decide root success or expose private text. */
export async function settleSubagentStreams(streams?: AsyncIterable<GraphSubagentStream>): Promise<void> {
  if (!streams) return;
  const active = new Set<Promise<void>>();
  try {
    for await (const child of streams) {
      const settled = Promise.allSettled([
        child.output,
        consumeAssistantMessageStreams(child.messages, async () => {}, async () => {}, () => false),
        settleToolCallStreams(child.toolCalls),
        settleSubagentStreams(child.subagents),
      ]).then(() => {});
      active.add(settled);
      void settled.then(() => active.delete(settled));
    }
  } catch { /* The root values/error remains authoritative for the run. */ }
  await Promise.all(active);
}
