import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createAgent } from "langchain";
import { createDeepAgent } from "deepagents";
import { ProviderModels } from "../packages/agent-core/src/provider-models";
import { gameProductionProfile } from "../packages/agent-core/src/game-production-profile";
import { GAME_AGENT_TOOLS } from "../packages/agent-service/src/game-agent-tools";
import { gameProductionModule } from "../packages/game-design/src/production";

type WireSchema = { type?: string; const?: unknown; description?: string; properties?: Record<string, WireSchema>; required?: string[]; anyOf?: WireSchema[]; oneOf?:WireSchema[]; items?: WireSchema };
type WireRequest = { tools?: { type: string; function: { name: string; parameters: WireSchema } }[]; messages: { role: string; content?: unknown }[] };
const textContent = (content: unknown): string => typeof content === "string" ? content : Array.isArray(content)
  ? content.map(block => typeof block === "string" ? block : block && typeof block === "object" && typeof block.text === "string" ? block.text : "").join("") : "";

test("Standard/Deep preserve canonical game argument shapes and root guidance on the actual Chat Completions wire", async () => {
  for (const runtime of ["standard", "deep"] as const) {
    const requests: WireRequest[] = [];
    const server = createServer((request, response) => {
      let body = ""; request.setEncoding("utf8");request.on("data", chunk => { body += chunk; });
      request.on("end", () => {
        assert.equal(request.method, "POST");assert.equal(request.url, "/v1/chat/completions");
        requests.push(JSON.parse(body) as WireRequest);
        const first = requests.length === 1;
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ id: `wire-${requests.length}`, object: "chat.completion", created: 1, model: "wire-fixture",
          choices: [{ index: 0, message: first ? { role: "assistant", content: "", tool_calls: [{ id: "read-studio", type: "function", function: { name: "game_studio", arguments: "{}" } }] }
            : { role: "assistant", content: "READ_ONLY_WIRE_OK" }, finish_reason: first ? "tool_calls" : "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 } }));
      });
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();assert.ok(address && typeof address === "object");
    const signal = AbortSignal.timeout(10_000);
    const models = new ProviderModels({ kind: "ollama", endpoint: `http://127.0.0.1:${address.port}/v1`, roles: { executor: "wire-fixture" }, authHeader: "authorization" }, undefined, signal);
    const invoked: string[] = [];
    try {
      const model = models.model("executor", false);
      const profile = gameProductionProfile({ catalog: GAME_AGENT_TOOLS,
        invoke: async name => { invoked.push(name);assert.equal(name, "game_studio");return { module: { id: "fixture" }, capabilities: { adapters: [] } }; },
        evidence: () => ({ changes: [], projects: [] }) }, { mode: "execute", signal, modelForRole: () => model, readTools: [] })!;
      const options = { model, tools: profile.tools, systemPrompt: `HOST_WIRE_RULE\n${profile.systemPrompt}`, middleware: profile.middleware };
      const graph = runtime === "deep" ? createDeepAgent(options) : createAgent(options);
      await graph.invoke({ messages: [{ role: "user", content: "Read the registered studio capabilities only" }] }, { signal });
      assert.deepEqual(invoked, ["game_studio"]);assert.equal(requests.length, 2);
      for (const request of requests) {
        const create = request.tools?.find(tool => tool.function?.name === "game_create");assert.ok(create);assert.equal(create.type, "function");
        const document = create.function.parameters.properties?.document;assert.ok(document);assert.equal(document.type, "object");
        assert.match(document.description ?? "", /Never JSON-encode/);
        assert.equal(document.properties?.title?.type, "string");assert.equal(document.properties?.brief?.type, "object");
        assert.ok(!document.required?.includes("schemaVersion"), "input default must survive provider conversion");
        for (const field of ["design", "files", "assets"]) assert.ok(!document.required?.includes(field), "draft creation defaults must survive the actual wire conversion");
        const nullable = document.properties?.design;const design = nullable?.type === "object" ? nullable : nullable?.anyOf?.find(schema => schema.type === "object");assert.ok(design);
        assert.equal(design.properties?.camera?.type, "string");
        assert.equal(design.properties?.mechanics?.items?.properties?.name?.type, "string");
        const progression = design.properties?.progression;assert.equal(progression?.properties?.completion?.type, "object");
        assert.equal(progression?.properties?.stages?.items?.properties?.completion?.type, "string");
        assert.match(progression?.properties?.stages?.items?.properties?.completion?.description ?? "", /Stage success condition as plain text/);
        const update=request.tools?.find(tool=>tool.function.name==="game_update_design")!.function.parameters;
        assert.match(update?.properties?.assets?.description??"",/Omit to preserve current assets/);
        const provenance=update?.properties?.assets?.items?.properties?.origin?.properties?.referenceIds;
        assert.equal(provenance?.type,"array");assert.match(provenance?.description??"",/Required array.*Use \[\]/);
        const variant=(schema:WireSchema|undefined,key:string,value:string)=>(schema?.anyOf??schema?.oneOf??[]).find(item=>item.properties?.[key]?.const===value);
        const media=request.tools?.find(tool=>tool.function.name==="game_process_assets")!.function.parameters;assert.ok(media);
        const vector=variant(media.properties?.spec?.properties?.operation,"type","image.vector");assert.ok(vector);
        assert.match(vector.properties?.background?.description??"",/#RRGGBBAA.*8 hex digits.*Alpha/);
        const path=variant(vector.properties?.shapes?.items,"kind","path");assert.ok(path);
        assert.match(path.properties?.fill?.description??"",/8 digits/);
        const quadratic=variant(path.properties?.commands?.items,"op","Q");assert.ok(quadratic);
        assert.equal(quadratic.properties?.cx?.type,"number");assert.match(quadratic.properties?.cx?.description??"",/Quadratic Q control point x/);
        assert.ok(quadratic.required?.includes("cx")&&quadratic.required.includes("cy"),"guidance does not make control points optional");
        const system = request.messages.filter(message => message.role === "system" || message.role === "developer").map(message => textContent(message.content)).join("\n");
        assert.ok(system.includes("HOST_WIRE_RULE"));assert.equal(system.split(gameProductionModule.guide).length - 1, 1);
      }
    } finally {
      await models.close();server.closeAllConnections();await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }
});
