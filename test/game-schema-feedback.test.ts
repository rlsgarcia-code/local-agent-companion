import assert from "node:assert/strict";
import test from "node:test";
import { createAgent, FakeToolCallingModel } from "langchain";
import { gameProductionProfile } from "../packages/agent-core/src/game-production-profile";
import { GAME_AGENT_TOOLS } from "../packages/agent-service/src/game-agent-tools";
import type { GameAgentToolName, GameToolInputRejection } from "../packages/contracts/src/game-agent";
import { fixtureGameDocument } from "./game-fixtures";
import {gameRgbaColor} from "../packages/contracts/src/game-colors";
import {gameAssetSpec} from "../packages/contracts/src/game-assets";

const marker = "SUBMITTED_VALUE_MUST_NOT_BECOME_A_HINT";
async function rejected(name: GameAgentToolName, args: unknown, schema?: Record<string, unknown>) {
  const definition = GAME_AGENT_TOOLS.find(tool => tool.name === name)!;
  const model = new FakeToolCallingModel({ toolCalls: [[{ name, args: args as Record<string, unknown>, id: "invalid-schema-input" }], []] });
  let calls = 0;
  const profile = gameProductionProfile({ catalog: [{ ...definition, ...(schema ? { schema } : {}) }],
    invoke: async () => { calls++;throw Error("Malformed input must never dispatch"); }, evidence: () => ({ changes: [], projects: [] }) },
    { mode: "execute", signal: new AbortController().signal, modelForRole: () => model, readTools: [] })!;
  const state = await createAgent({ model, tools: profile.tools, middleware: profile.middleware }).invoke({ messages: [{ role: "user", content: "Check the declared input" }] });
  const message = state.messages.find(message => message.getType() === "tool");assert.ok(message);
  const raw = String(message.content);assert.ok(Buffer.byteLength(raw) < 6000);assert.doesNotMatch(raw, new RegExp(marker));
  const response = JSON.parse(raw) as GameToolInputRejection & { ok: boolean };
  assert.equal(response.ok, false);assert.equal(response.rejectedBeforeDispatch, true);assert.equal(calls, 0);
  return response.error.issues;
}

test("official tool feedback explains nested objects, array item text and nonempty content without echoing input", async () => {
  const full = fixtureGameDocument(), design = full.design!;
  const root = await rejected("game_create", { document: marker });
  assert.match(root[0]!.hint ?? "", /Nested project object/);
  const brief = await rejected("game_create", { document: { ...full, brief: marker } });
  assert.match(brief[0]!.hint ?? "", /Brief is an object/);
  const stages = await rejected("game_update_design", { projectId: "game", expectedRevision: 1, design: { ...design,
    progression: { ...design.progression, stages: design.progression.stages.map(stage => ({ ...stage, completion: { description: marker } })) } } });
  const item = stages.find(issue => issue.path.join(".") === "design.progression.stages.0.completion");assert.ok(item);
  assert.equal(item.expected, "string");assert.match(item.hint ?? "", /Stage success condition as plain text/);
  const empty = await rejected("game_update_design", { projectId: "game", expectedRevision: 1, design: { ...design, content: [] } });
  assert.match(empty.find(issue => issue.path.join(".") === "design.content")?.hint ?? "", /Nonempty array/);
});

test("vector RGBA/curve and asset-provenance errors explain the exact canonical format without coercing or echoing input",async()=>{
  const input={projectId:"game",revision:1,spec:{processorId:"local-media-v1",target:{id:"art",role:"Fixture",placeholder:true},operation:{type:"image.vector",output:"assets/art.svg",width:64,height:64,shapes:[
    {kind:"path",id:"shape",fill:"#ff0000",stroke:{paint:marker,width:1},commands:[{op:"M",x:0,y:0},{op:"Q",x:64,y:64}]}]}}};
  const before=JSON.stringify(input),issues=await rejected("game_process_assets",input);assert.equal(JSON.stringify(input),before);
  const color=issues.find(issue=>issue.path.join(".")==="spec.operation.shapes.0.fill");assert.ok(color);assert.match(color.message,/#RRGGBBAA.*8 hex digits.*alpha/);assert.match(color.hint??"",/8 digits/);
  const curve=issues.find(issue=>issue.path.join(".")==="spec.operation.shapes.0.commands.1.cx");assert.ok(curve);assert.equal(curve.expected,"number");assert.match(curve.hint??"",/Quadratic Q control point x/);
  const asset={id:"art",kind:"image",role:"Fixture",files:["assets/art.svg"],placeholder:true,origin:{kind:"procedural",source:marker,author:marker,license:marker}};
  const provenance=await rejected("game_update_design",{projectId:"game",expectedRevision:1,design:fixtureGameDocument().design,assets:[asset]});
  assert.match(provenance.find(issue=>issue.path.join(".")==="assets.0.origin.referenceIds")?.hint??"",/Required array.*Use \[\]/);
  for(const value of ["#f00","#ff0000","red","rgba(255,0,0,1)",marker])assert.equal(gameRgbaColor.safeParse(value).success,false);
  assert.equal(gameRgbaColor.parse("#Ff00Aa80"),"#Ff00Aa80","case/alpha remain the submitted value; no normalization");
  const corrected=structuredClone(input);corrected.spec.operation.shapes[0]!.fill="#ff0000ff";corrected.spec.operation.shapes[0]!.stroke.paint="#00112280";
  Object.assign(corrected.spec.operation.shapes[0]!.commands[1]!,{cx:12,cy:34});assert.ok(gameAssetSpec.safeParse(corrected.spec).success);
});

test("schema hints ignore inherited, ambiguous, remote-reference and over-budget metadata and bound complete Unicode", async () => {
  const full = fixtureGameDocument();const args = { projectId: "game", expectedRevision: 1, design: { ...full.design!, camera: { description: marker } } };
  const schema = (camera: unknown): Record<string, unknown> => ({ type: "object", properties: { design: { type: "object", properties: { camera } } } });
  const prefix = "x".repeat(200);
  const inherited = Object.assign(Object.create({ description: "INHERITED_METADATA" }), { type: "string" });
  const inheritedPath = { type: "object", properties: Object.create({ design: { properties: { camera: { description: "INHERITED_PATH" } } } }) };
  for (const declared of [schema(inherited), inheritedPath,
    schema({ anyOf: [{ type: "string", description: prefix + "A" }, { type: "string", description: prefix + "B" }] }),
    schema({ anyOf: [{ type: "string", description: "Only one branch has metadata" }, { type: "number" }] }),
    schema({ $ref: "https://example.invalid/schema.json", description: "Must not resolve or guess" }),
    schema({ anyOf: Array.from({ length: 17 }, () => ({ type: "string", description: "Over budget" })) }),
    schema({ type: "string", description: "x".repeat(4097) }),
  ]) {
    const issues = await rejected("game_update_design", args, declared);
    assert.equal(issues.find(issue => issue.path.join(".") === "design.camera")?.hint, undefined);
  }
  const issues = await rejected("game_update_design", args, schema({ type: "string", description: "🌱".repeat(200) }));
  const hint = issues.find(issue => issue.path.join(".") === "design.camera")?.hint;assert.equal(hint, "🌱".repeat(160));
});
