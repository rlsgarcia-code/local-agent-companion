import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import { APIConnectionTimeoutError } from "openai";
import { modelFailure, type ModelFailure } from "../../contracts/src/model-failure";
import { AgentError } from "../../contracts/src/index";

const messages: Record<ModelFailure["category"], string> = {
  response_inactivity: "O provedor ficou sem enviar dados durante a resposta e o prazo de espera terminou.",
  response_headers_timeout: "O provedor não iniciou a resposta dentro do prazo de espera.",
  request_timeout: "A solicitação ao provedor excedeu o prazo de espera.",
  connection_interrupted: "A conexão com o provedor caiu durante a solicitação.",
  connection_failed: "Não foi possível estabelecer a conexão com o provedor.",
  response_interrupted: "O provedor interrompeu a resposta; a causa não foi determinada.",
};

/** No raw cause is attached: service events/logs must not serialize it. */
export class ModelTransportError extends Error {
  public readonly failure: ModelFailure;
  constructor(failure: ModelFailure) {
    const safe = modelFailure.parse(failure);
    super(`${messages[safe.category]} A execução parou; confira o trabalho salvo antes de continuar.`);
    this.name = "ModelTransportError";
    this.failure = Object.freeze(safe);
  }
}

function classify(error: unknown): ModelFailure | undefined {
  const visited = new Set<object>();
  let current = error, failure: ModelFailure | undefined;
  for (let depth = 0; current && typeof current === "object" && depth < 8; depth++) {
    if (visited.has(current)) break;
    visited.add(current);
    const row = current as { status?: unknown; response?: {status?:unknown}; code?: unknown; name?: unknown; message?: unknown; cause?: unknown };
    // An HTTP response is not a transport diagnosis. Preserve authentication,
    // rate limits and existing status-based handling exactly as received.
    if (typeof row.status === "number" && row.status >= 400 || typeof row.response?.status === "number" && row.response.status >= 400) return;
    switch (row.code) {
      case "UND_ERR_BODY_TIMEOUT": failure = { category: "response_inactivity", code: row.code }; break;
      case "UND_ERR_HEADERS_TIMEOUT": failure = { category: "response_headers_timeout", code: row.code }; break;
      case "UND_ERR_SOCKET": case "ECONNRESET": case "EPIPE":
        failure = { category: "connection_interrupted", code: row.code }; break;
      case "ECONNREFUSED": case "ENOTFOUND": case "EAI_AGAIN":
        failure = { category: "connection_failed", code: row.code }; break;
    }
    // The pinned LangChain wrapper converts the SDK deadline to Error named
    // TimeoutError, discarding the SDK class/cause. Other paths retain the SDK
    // instance. Constructor names are not stable under bundling. Model origin
    // and terminal identity are still required by the callback below.
    if (!failure && (current instanceof APIConnectionTimeoutError || row.name === "TimeoutError")) failure = { category: "request_timeout" };
    if (!failure && row.name === "TypeError" && row.message === "terminated") failure = { category: "response_interrupted" };
    current = row.cause;
  }
  return failure;
}

/** Observe only official model callbacks. Do not reclassify arbitrary tool,
 * admission or reconciliation failures, alter retry decisions or store text. */
export class ModelFailureCallback extends BaseCallbackHandler {
  name = "local_model_failure";
  awaitHandlers = true;
  private readonly failures = new WeakMap<object, ModelFailure>();
  handleLLMError(error: unknown) {
    if (!error || typeof error !== "object" || error instanceof AgentError) return;
    try {
      const failure = classify(error);
      if (failure) this.failures.set(error, failure);
    } catch { /* Diagnostic failure cannot replace the model error. */ }
  }
  terminalError(error: unknown, signal: AbortSignal): unknown {
    if (signal.aborted || !error || typeof error !== "object") return error;
    const failure = this.failures.get(error);
    return failure ? new ModelTransportError(failure) : error;
  }
}
