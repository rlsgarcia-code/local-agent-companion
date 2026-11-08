import { Command, type BaseCheckpointSaver } from "@langchain/langgraph";
import { AgentError, errors } from "../../contracts/src/index";

/** Resume the official graph without appending the user's request a second time. */
export async function checkpointInput<T>(
  graph: { getState: (config: { configurable: { thread_id: string } }) => Promise<unknown> },
  saver: BaseCheckpointSaver,
  threadId: string,
  initial: T,
  reconciliations: Record<string, unknown> = {},
  requireExisting = false,
): Promise<T | null | Command> {
  const config = { configurable: { thread_id: threadId } };
  let previous;
  try { previous = await saver.getTuple(config); }
  catch (error) {
    if (requireExisting) throw new AgentError(errors.reconciliation, "The checkpoint for executed operations is unavailable. Restore or reconcile it before continuing.");
    throw error;
  }
  if (!previous) {
    if (requireExisting) throw new AgentError(errors.reconciliation, "Executed operations exist without their graph checkpoint. Automatic repetition is prohibited.");
    return initial;
  }
  const snapshot = await graph.getState(config) as { tasks?: { interrupts?: { id?: string; value: unknown }[] }[] };
  const resumes: Record<string, unknown> = {};
  for (const task of snapshot.tasks ?? []) for (const pause of task.interrupts ?? []) {
    const value = pause.value as { callId?: string } | undefined;
    if (pause.id && value?.callId && Object.hasOwn(reconciliations, value.callId))
      resumes[pause.id] = reconciliations[value.callId];
  }
  return Object.keys(resumes).length ? new Command({ resume: resumes }) : null;
}
