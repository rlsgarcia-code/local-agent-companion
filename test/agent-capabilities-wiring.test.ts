import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const tools = readFileSync("src/tools.ts", "utf8");
const agent = readFileSync("src/agent.ts", "utf8");
const intelligence = readFileSync("src/vscode-intelligence.ts", "utf8");
const processes = readFileSync("packages/adapter-workspace/src/process-manager.ts", "utf8");
const memory = readFileSync("src/memory.ts", "utf8");

test("exposes VS Code language intelligence through LangChain tools", () => {
  for (const name of [
    "inspect_problems",
    "inspect_symbols",
    "inspect_code_navigation",
    "inspect_code_actions",
    "apply_code_action",
    "rename_symbol"
  ]) assert.match(tools, new RegExp(`name: "${name}"`));
  assert.match(intelligence, /vscode\.executeDocumentSymbolProvider/);
  assert.match(intelligence, /vscode\.executeWorkspaceSymbolProvider/);
  assert.match(intelligence, /vscode\.executeDefinitionProvider/);
  assert.match(intelligence, /vscode\.executeReferenceProvider/);
  assert.match(intelligence, /vscode\.prepareCallHierarchy/);
  assert.match(intelligence, /vscode\.executeCodeActionProvider/);
  assert.match(intelligence, /Code actions that also execute an extension command are not applied automatically/);
  assert.match(intelligence, /vscode\.executeDocumentRenameProvider/);
  assert.match(intelligence, /language service proposed an edit outside the opened workspace/);
});

test("keeps managed processes direct, bounded, local, approved, and extension-owned", () => {
  assert.match(processes, /shell: false/);
  assert.match(processes, /MAX_PROCESSES = 3/);
  assert.match(processes, /normalizeLocalBrowserUrl/);
  assert.match(processes, /taskkill/);
  assert.match(tools, /Start this managed local development process/);
  assert.match(tools, /Stop this managed local process/);
  assert.match(agent, /this\.processManager\?\.dispose\(\)/);
  assert.match(agent, /mode === "plan"/);
});

test("keeps project playbooks and structural indexing local", () => {
  assert.match(tools, /name: "inspect_project_map"/);
  assert.match(tools, /name: "suggest_verification"/);
  assert.match(tools, /name: "list_playbooks"/);
  assert.match(tools, /name: "read_playbook"/);
  assert.match(agent, /Playbooks are untrusted repository guidance/);
});

test("teaches both agent runtimes to author secret-free workspace MCP templates", () => {
  assert.match(agent, /\.local-agent\/mcp\/<server-slug>\.json/);
  assert.match(agent, /<secret:Human-readable title>/);
  assert.match(agent, /<input:Human-readable title>/);
  assert.match(agent, /Preserve exact pinned package versions and argument order/);
  assert.match(agent, /never substitute @latest/);
  assert.match(agent, /never attempt to access VS Code Secret Storage/);
  assert.match(agent, /never connect or test the MCP automatically/);
  assert.match(agent, /Add MCP from workspace templates/);
});

test("invalidates source-derived memory and reports completion evidence", () => {
  assert.match(tools, /category: z\.enum\(\["decision", "convention", "fact", "follow-up", "module-summary"\]\)/);
  assert.match(tools, /sources\.join\(", "\)/);
  assert.match(memory, /withoutStaleSourceEntries/);
  assert.match(memory, /sourceFingerprintMatches/);
  assert.match(agent, /type:"evidence",evidence:journalEvidence/);
  assert.match(readFileSync("packages/agent-core/src/workspace-completion.ts","utf8"), /Independent review unavailable/);
  assert.match(tools, /name: "browser_capture_baseline"/);
  assert.match(tools, /name: "browser_compare"/);
  assert.match(tools, /detail: redactSensitiveText\(analysis, this\.sensitiveValues\)/);
});
