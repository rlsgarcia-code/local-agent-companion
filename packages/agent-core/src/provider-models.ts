import { withOfflineTokenCounting } from "./offline-token-count";
import type { Registration, RunSpec } from "../../contracts/src/index";
import { embeddingsBaseUrl, embeddingsUrl } from "./litellm";
import { ChatOpenAICompletions, ChatOpenAIResponses } from "@langchain/openai";
import { Agent as UndiciAgent } from "undici";
import { AgentError, errors, type ProviderSpec } from "../../contracts/src/index";
import { chatCompletionsBaseUrl, chatCompletionsModelOptions, chatCompletionsUrl, responsesBaseUrl, responsesUrl, resolveLiteLlmModelApi, validateLiteLlmModelProfile } from "./litellm";
import { gatewayFetch } from "./gateway";

export function validateProvider(
  reg: Registration,
  spec: RunSpec["provider"],
): URL {
  if (!reg.providers.includes(spec.kind))
    throw new AgentError(
      errors.forbidden,
      "This product does not permit the requested provider.",
    );
  const url = new URL(spec.endpoint);
  if (url.username || url.password || url.hash || url.search)
    throw new AgentError(
      errors.invalid,
      "Provider URLs cannot contain credentials, query or fragment.",
    );
  if (spec.kind === "ollama") {
    if (
      !["127.0.0.1", "[::1]", "localhost"].includes(url.hostname) ||
      !["http:", "https:"].includes(url.protocol) ||
      !/^\/v1\/?$/.test(url.pathname)
    )
      throw new AgentError(
        errors.forbidden,
        "Ollama must use an explicit loopback /v1 endpoint.",
      );
  } else if (spec.kind === "openai") {
    if (url.href.replace(/\/$/, "") !== "https://api.openai.com/v1")
      throw new AgentError(
        errors.forbidden,
        "OpenAI variant permits only the fixed Chat Completions endpoint.",
      );
  } else if (spec.kind === "kidos-gateway") {
    if (url.href.replace(/\/$/, "") !== "http://127.0.0.1:8788")
      throw new AgentError(
        errors.forbidden,
        "KidOS uses only its protected local gateway.",
      );
  } else if (url.protocol !== "https:")
    throw new AgentError(
      errors.forbidden,
      "LiteLLM requires the configured HTTPS endpoint.",
    );
  return url;
}


export class ProviderModels {
  private readonly dispatcher?: UndiciAgent;
  constructor(private readonly provider: ProviderSpec,private readonly credential:string|undefined,private readonly signal:AbortSignal) {
    if(provider.corporateCa?.length) {
      if(provider.kind!=="litellm")throw new AgentError(errors.forbidden,"Corporate CA configuration belongs only to the configured LiteLLM provider.");
      this.dispatcher=new UndiciAgent({connect:{ca:provider.corporateCa}});
    }
  }
  model(role:"executor"|"planner"|"evaluator"|"advisor"|"vision"="executor",streaming=role==="executor", options: { timeout?: number; maxRetries?: number; requiresTools?: boolean } = {}) {
    const provider=this.provider;
    const alias=provider.roles[role]||provider.roles.executor;
    const profile=provider.modelProfiles?.[alias] ?? (alias===provider.roles.executor ? provider.profile??{} : {});
    if(provider.kind==="kidos-gateway")throw new AgentError(errors.unavailable,"Install the protected KidOS model adapter.");
    if(provider.kind!=="litellm"&&profile.api==="responses")throw new AgentError(errors.forbidden,"This product permits only Chat Completions for this provider.");
    if(provider.kind==="litellm" || profile.capabilities)validateLiteLlmModelProfile(alias,profile,true,options.requiresTools !== false,provider.endpoint);
    if(role==="vision" && profile.capabilities && !profile.capabilities.vision)
      throw new AgentError(errors.invalid,"Vision is not declared for the selected model alias.");
    const connection={endpoint:provider.endpoint,model:provider.roles[role]||provider.roles.executor,apiKey:this.credential||"ollama-local",authHeader:provider.authHeader};
    const responses=provider.kind==="litellm"&&resolveLiteLlmModelApi(connection.model,profile,connection.endpoint)==="responses";
    const common={model:connection.model,apiKey:connection.apiKey,streaming,disableStreaming:!streaming,maxRetries:options.maxRetries ?? 0,...(options.timeout ? {timeout:options.timeout}:{}),
      configuration:{baseURL:responses?responsesBaseUrl(connection,connection.model):chatCompletionsBaseUrl(connection),
        ...(this.credential&&provider.authHeader!=="authorization"?{defaultHeaders:{[provider.authHeader]:this.credential}}:{}),
        fetch:gatewayFetch(responses?responsesUrl(connection,connection.model):chatCompletionsUrl(connection),provider.authHeader!=="authorization",this.dispatcher,this.signal)}};
    return withOfflineTokenCounting(responses?new ChatOpenAIResponses(common):new ChatOpenAICompletions({...common,...chatCompletionsModelOptions(profile)}),connection.model);
  }
  embeddingOptions(model: string, endpoint?: string) {
    validateProvider({ providers: [this.provider.kind] } as Registration, { ...this.provider, endpoint: endpoint || this.provider.endpoint });
    const connection = { endpoint: endpoint || this.provider.endpoint, model: this.provider.roles.executor };
    return { embeddingModel: model, embeddingsBaseUrl: embeddingsBaseUrl(connection, model, Boolean(endpoint)),
      apiKey: this.credential || "ollama-local",
      ...(this.credential && this.provider.authHeader !== "authorization" ? { defaultHeaders: { [this.provider.authHeader]: this.credential } } : {}),
      fetch: gatewayFetch(embeddingsUrl(connection, model, Boolean(endpoint)), this.provider.authHeader !== "authorization", this.dispatcher, this.signal) };
  }
  async close(){await this.dispatcher?.close();}
}
