import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { OpenAIEmbeddings } from "@langchain/openai";
import { tool } from "langchain";
import { z } from "zod";
import type { ModelAssistance, ModelAssistanceResult } from "../../contracts/src/index";
import { ProviderModels } from "./provider-models";

const CATALOG_INSTRUCTIONS = `You are an MCP catalog author. Convert the supplied documentation and images into JSON only. Never connect to, install, or test an MCP. Never preserve live credentials. Return an object with catalogVersion: 1, name, description, sourceNotes, confidence, missingInputs, and mcpServers. mcpServers must use the portable format accepted by the Companion. Use type http with a complete HTTPS URL, or type stdio with command, args, and env. Use <secret:Human-readable title> for every credential and <input:Human-readable title> for every value the user must provide. Preserve exact package versions and argument order; never invent missing values and never use @latest. missingInputs must distinguish secret, input, and confirmation entries. If a detail is absent or ambiguous, leave a placeholder and explain it in missingInputs. tools may be an empty array when the documentation does not list a safe allowlist.`;

/** Model calls use LangChain; diagnostics bind a schema but never execute a returned tool. */
export async function assistModel(request: ModelAssistance, credential: string | undefined,
  signal: AbortSignal, images: { mime: string; data: string }[] = []): Promise<ModelAssistanceResult> {
  const models = new ProviderModels(request.provider, credential, signal);
  try {
    if (request.purpose === "embedding") {
      const options = models.embeddingOptions(request.model, request.endpoint);
      const vector = await new OpenAIEmbeddings({model: request.model, apiKey: options.apiKey,
        maxRetries: 0, timeout: 20_000, configuration: {baseURL: options.embeddingsBaseUrl,
          ...(options.defaultHeaders ? {defaultHeaders: options.defaultHeaders} : {}), fetch: options.fetch}
      }).embedQuery("Local Agent Companion connection diagnostic");
      if (!Array.isArray(vector) || !vector.length) throw new Error("The embeddings endpoint returned an empty vector.");
      return {text: `Model “${request.model}” returned ${vector.length} dimensions`, dimensions: vector.length};
    }
    const model = models.model("executor", request.purpose === "connection", {
      timeout: request.purpose === "connection" ? 20_000 : 90_000,
      maxRetries: request.purpose === "connection" ? 0 : 1,
    });
    if (request.purpose === "connection") {
      const probe = tool(() => "probe-ok", {name:"connection_probe",
        description:"A harmless local tool exposed only to verify streaming and function-tool compatibility.",schema:z.object({})});
      await model.bindTools([probe]).invoke([
        new HumanMessage("Connection diagnostic only. Reply with OK without calling the available tool.")
      ], {signal});
      return {text:"The configured model accepted streaming and function tools"};
    }
    const content = request.purpose === "catalog" ? [
      {type:"text" as const,text:request.instructions.trim() || "No text was supplied. Read the attached screenshot(s)."},
      ...images.map(image => ({type:"image_url" as const,image_url:{url:`data:${image.mime};base64,${image.data}`}})),
    ] : request.prompt;
    const response = await model.invoke([
      new SystemMessage(request.purpose === "catalog" ? CATALOG_INSTRUCTIONS : "You are a local Ollama setup advisor. Return only the requested JSON object."),
      new HumanMessage({content}),
    ], {signal});
    if (response.text.length > 1_000_000) throw new Error("The model assistance response is too large.");
    return {text:response.text};
  } finally { await models.close(); }
}
