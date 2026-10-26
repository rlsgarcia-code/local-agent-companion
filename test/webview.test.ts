import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = ["src/webview.ts", "src/webview-protocol.ts", "src/change-review.ts"]
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");

function assertMessageType(type: string): void {
  assert.ok(
    source.includes(`type: "${type}"`) ||
      source.includes(`z.literal("${type}")`) ||
      source.includes(`noPayload("${type}")`),
    `missing webview protocol type: ${type}`
  );
}

test("keeps the embedded webview script syntactically valid", () => {
  const marker = "const script = String.raw`";
  const start = source.indexOf(marker);
  assert.notEqual(start, -1);
  const bodyStart = start + marker.length;
  const end = source.indexOf("\n`;", bodyStart);
  assert.notEqual(end, -1);
  const script = source
    .slice(bodyStart, end)
    .replace("${JSON.stringify(LITELLM_MODEL_CAPABILITIES)}", "{}")
    .replace("${JSON.stringify(LITELLM_MODEL_CATALOG)}", "{}");

  assert.doesNotThrow(() => new Function(script));
});

test("keeps a closed content policy and validates the inbound webview protocol", () => {
  assert.match(source, /default-src 'none'; style-src \$\{webview\.cspSource\} 'nonce-\$\{nonce\}'; script-src 'nonce-\$\{nonce\}';/);
  assert.match(source, /onDidReceiveMessage\(\(message: unknown\) => void this\.receiveMessage\(message\)\)/);
  assert.match(source, /const message = parseIncomingMessage\(value\)/);
  assert.match(source, /case 'protocolError'/);
});

test("keeps webview element identifiers unique", () => {
  const htmlStart = source.indexOf("return `<!doctype html>");
  const htmlEnd = source.indexOf("const styles = String.raw`");
  assert.notEqual(htmlStart, -1);
  assert.notEqual(htmlEnd, -1);
  const html = source.slice(htmlStart, htmlEnd);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);

  assert.deepEqual(duplicates, []);
  assert.ok(ids.includes("connection-readiness"));
  assert.ok(ids.includes("connection-diagnostics"));
  assert.ok(ids.includes("model-compatibility"));
  assert.ok(ids.includes("profile-import"));
  assert.ok(ids.includes("profile-export"));
  assert.ok(ids.includes("support-export"));
  assert.ok(ids.includes("litellm-test"));
  assert.ok(ids.includes("thread-panel"));
  assert.ok(ids.includes("memory-panel"));
  assert.ok(ids.includes("brief-panel"));
  assert.ok(ids.includes("memory-list"));
  assert.ok(ids.includes("thread-list"));
  assert.ok(ids.includes("thread-search"));
  assert.ok(ids.includes("threads-toggle"));
  assert.ok(ids.includes("browser-control"));
  assert.ok(ids.includes("mcp-connections"));
  assert.ok(ids.includes("composer-hint"));
  assert.ok(ids.includes("context-add-file"));
  assert.ok(ids.includes("context-budget-track"));
  assert.ok(ids.includes("context-memory-entry"));
  assert.ok(ids.includes("run-review-panel"));
  assert.ok(ids.includes("run-review-content"));
  assert.ok(ids.includes("run-review-close"));
  assert.ok(ids.includes("setup-callout"));
  assert.ok(ids.includes("setup-callout-action"));
  assert.ok(ids.includes("jump-latest"));
  assert.ok(ids.includes("activity-meta"));
  assert.ok(ids.includes("final-review-mode"));
  assert.ok(ids.includes("plan-summary"));
  assert.ok(ids.includes("plan-activity-items"));
});

test("keeps local browser control visible, opt-in, and revocable", () => {
  const agentSource = readFileSync("src/agent.ts", "utf8");
  assertMessageType("setLocalBrowserToolsEnabled");
  assert.match(source, /id="browser-control"[^>]*aria-pressed="false"/);
  assert.match(source, /setBrowserControl\(Boolean\(data\.browserControlEnabled\)\)/);
  assert.match(source, /configuration\.update\("localBrowserToolsEnabled", enabled, vscode\.ConfigurationTarget\.Workspace\)/);
  assert.match(source, /await this\.agent\.setLocalBrowserToolsEnabled\(enabled\)/);
  assert.match(agentSource, /await browserSession\?\.close\(\)/);
  assert.match(source, /browserControl\.disabled = locked \|\| browserControlPending/);
});

test("keeps corporate MCP onboarding native, secret-separated, and approval-gated", () => {
  const agentSource = readFileSync("src/agent.ts", "utf8");
  const managerSource = readFileSync("src/mcp-manager.ts", "utf8");
  const stdioSource = readFileSync("src/mcp-stdio.ts", "utf8");
  const transportSource = readFileSync("src/mcp-transport.ts", "utf8");
  assertMessageType("openMcpConnections");
  assertMessageType("generateMcpCatalog");
  assert.match(source, /id="mcp-connections"[^>]*aria-pressed="false"/);
  assert.match(source, /id="mcp-catalog"/);
  assert.match(source, /Generate catalog item from pasted instructions/);
  assert.match(source, /\/mcp-catalog/);
  assert.match(source, /Add corporate MCP from clipboard/);
  assert.match(source, /Add MCP from workspace templates/);
  assert.match(source, /vscode\.Uri\.joinPath\(folder\.uri, "\.local-agent", "mcp"\)/);
  assert.match(source, /vscode\.Uri\.joinPath\(directory, "example\.json"\)/);
  assert.match(source, /mcpTemplatePlaceholders\(template\)/);
  assert.match(source, /Values copied inside JSON are never trusted or persisted/);
  assert.match(source, /password: true/);
  assert.match(source, /Credentials remain in VS Code Secret Storage/);
  assert.match(source, /Handshake and list tools without executing one/);
  assert.match(source, /Start .* once to discover its tools/);
  assert.match(source, /npx may obtain the pinned package from the configured corporate registry/);
  assert.match(source, /this\.agent\.discoverMcpTools\(draft\)/);
  assert.match(source, /No MCP tool is executed during discovery/);
  assert.match(managerSource, /this\.context\.secrets\.store/);
  assert.match(managerSource, /connectStdioMcpClient/);
  assert.match(stdioSource, /new StdioClientTransport/);
  assert.match(stdioSource, /cwd: options\.workspace/);
  assert.match(stdioSource, /stderr: "pipe"/);
  assert.match(stdioSource, /NODE_EXTRA_CA_CERTS: options\.caCertificatePath/);
  assert.match(stdioSource, /npm_config_cafile: options\.caCertificatePath/);
  assert.match(managerSource, /prefixToolNameWithServerName: true/);
  assert.match(managerSource, /resource: "artifact"/);
  assert.match(managerSource, /sanitizeMcpResult/);
  assert.match(managerSource, /beforeToolCall: async/);
  assert.match(managerSource, /The user declined this MCP tool call/);
  assert.match(managerSource, /if \(options\.mode === "plan"\) return emptySession\(\)/);
  assert.match(transportSource, /redirect: "manual"/);
  assert.match(agentSource, /\.\.\.mcpSession\.tools/);
});

test("keeps recovery actions and per-thread draft persistence wired", () => {
  assertMessageType("draftChanged");
  assertMessageType("retry");
  assertMessageType("discardRecovery");
  assert.match(source, /replacePendingUser: replacePending/);
  assert.match(source, /data-retry-pending/);
  assert.match(source, /data-edit-pending/);
  assert.match(source, /data-discard-pending/);
  assert.match(source, /type: 'discardRecovery', threadId: activeThreadId, messageId: pendingRequestId/);
  assert.match(source, /case 'recoveryDiscarded'/);
  assert.match(source, /Files, commands, or memory updates already made by the interrupted run are not reverted/);
  assert.match(
    readFileSync("src/agent.ts", "utf8"),
    /The unfinished request changed in another VS Code window and was not discarded/
  );
  assert.match(source, /localAgentCompanion\.threadDrafts/);
  assert.match(source, /function persistWebviewState\(\)[\s\S]{0,100}drafts: localDrafts, brief: briefState/);
  assertMessageType("addFileContext");
  assert.match(source, /data-remove-context/);
  assertMessageType("refreshRunState");
  assert.match(source, /data-refresh-run/);
  assert.match(source, /Restarting replays this request safely from the beginning/);
  assert.match(source, /case 'sendRejected'/);
  assert.match(source, /case 'preflightFailed'/);
  assert.match(source, /case 'pendingUserReplaced'/);
});

test("keeps local conversations searchable, pinnable, and safe across windows", () => {
  assertMessageType("toggleThreadPinned");
  assert.match(source, /private async toggleThreadPinned/);
  assert.match(source, /assertThreadEditable/);
  assert.match(source, /Wait for the active agent run to finish before changing conversations/);
  assert.match(source, /id="thread-search" type="search"/);
  assert.match(source, /function renderThreadList/);
  assert.match(source, /pinned favorite important/);
  assert.match(source, /data-pin-thread/);
  assert.match(source, /aria-pressed=/);
  assert.match(source, /No conversations match this search/);
});

test("shows a local pre-send context budget and its contributing sources", () => {
  assert.match(source, /collector\.preview\(maximumCharacters, autoContext\)/);
  assert.match(source, /id="context-budget-track"[^>]*role="progressbar"/);
  assert.match(source, /function updatePromptTokenEstimate/);
  assert.match(source, /Automatic editor context disabled · pinned items still included/);
  assert.match(source, /No AGENTS\.md or standard repository guidance detected/);
  assert.match(source, /local guidance file/);
  assert.match(source, /Show included files/);
  assert.match(source, /case 'contextReceipt'/);
  assert.match(source, /CONTEXT USED/);
  assert.match(source, /Semantic retrieval fell back to recent local memory/);
  assert.match(source, /contextAddFile\.disabled = locked/);
  assert.match(source, /Sensitive file · excluded from automatic and pinned context/);
  assert.match(source, /Semantic retrieval after send/);
  assert.match(source, /The provider reports exact usage after the run/);
});

test("keeps durable project memory inspectable and editable from one local center", () => {
  assert.match(source, /id="memory-panel" role="region" aria-labelledby="memory-panel-title"/);
  assertMessageType("openMemoryCenter");
  assertMessageType("addMemoryEntry");
  assertMessageType("editMemoryEntry");
  assertMessageType("deleteMemoryEntry");
  assert.match(source, /function renderMemoryState/);
  assert.match(source, /data-edit-memory/);
  assert.match(source, /data-delete-memory/);
  assert.match(source, /Semantic vectors refresh automatically on the next retrieval/);
  assert.match(source, /Wait for the active agent run to finish before changing project memory/);
  assert.match(source, /credential-like text hidden/);
});

test("imports and exports explicit secret-free connection profiles", () => {
  assertMessageType("exportConnectionProfile");
  assertMessageType("importConnectionProfile");
  assert.match(source, /createConnectionProfile/);
  assert.match(source, /parseConnectionProfile/);
  assert.match(source, /serializeConnectionProfile/);
  assert.match(source, /Connection profile exported without the gateway key or corporate CA/);
  assert.match(source, /Connection profile exceeds the 256 KB safety limit/);
  assert.match(source, /Existing Secret Storage credentials remain unchanged/);
  assert.match(source, /Wait for the active agent run to finish before changing provider configuration/);
  assert.match(source, /Keys and CA certificates are never included/);
});

test("exports a sanitized support bundle without user or connection identifiers", () => {
  assertMessageType("exportSupportBundle");
  assert.match(source, /createSupportBundle/);
  assert.match(source, /serializeSupportBundle/);
  assert.match(source, /Sanitized support bundle exported without user content or connection identifiers/);
  assert.match(source, /diagnostics: lastConnectionDiagnostics/);
  assert.match(source, /Support bundles also omit endpoints, aliases, chats, paths, commands and filenames/);
});

test("keeps native diff review and guarded restore actions wired", () => {
  assertMessageType("openChangeDiff");
  assertMessageType("restoreChange");
  assertMessageType("restoreRunChanges");
  assert.match(source, /data-review-change/);
  assert.match(source, /data-restore-change/);
  assert.match(source, /data-restore-run/);
  assert.match(source, /case 'changes'/);
  assert.match(source, /case 'changeRestored'/);
  assert.match(source, /case 'runChangesRestored'/);
  assert.match(source, /No files were restored so newer work is preserved/);
  assert.match(source, /commands and memory updates are not reversed/);
  assert.match(source, /for \(const \{ change \} of prepared\) change\.restored = true;\s+const unsavedPaths/);
  assert.match(source, /if \(!await restoredDocument\.save\(\)\) unsavedPaths\.push\(change\.path\)/);
  assert.match(source, /File restored · manual save required/);
  assert.match(source, /Run changes restored · manual save required/);
  assert.match(source, /Save the open document/);
  assert.match(source, /data-open-run-review/);
  assert.match(source, /function renderRunReview/);
  assert.match(source, /COMMANDS & CHECKS/);
  assert.match(source, /USAGE & MEMORY/);
});

test("keeps live execution activity in one fixed expandable dock", () => {
  assert.match(source, /class="activity-dock"/);
  assert.match(source, /function ensureRunActivity/);
  assert.match(source, /state\.events\.push/);
  assert.match(source, /function renderActivityOverview/);
  assert.match(source, /RUN PROGRESS/);
  assert.match(source, /LATEST ACTIVITY/);
  assert.match(source, /runActivityState\?\.events\.slice\(-3\)/);
  assert.match(source, /completed \+ '\/' \+ total \+ ' complete'/);
  assert.match(source, /function clearCurrentPlan\(\) \{\s+currentRunSummary\.plan = \[\]/);
  assert.match(source, /finishRunActivity\(\);\s+currentRunSummary\.finishedAt/);
  assert.doesNotMatch(source, /data-toggle-live-run/);
  assert.doesNotMatch(source, /className = 'live-run'/);
  assert.doesNotMatch(source, /element\.className = 'activity'/);
  assert.match(readFileSync("src/local-approval.ts", "utf8"), /kind: "approval"/);
});

test("keeps the three autonomy modes visible, persistent, and recovery-aware", () => {
  assert.match(source, /<option value="review">Ask first<\/option>/);
  assert.match(source, /<option value="execute">Auto edits<\/option>/);
  assert.match(source, /<option value="plan">Plan only<\/option>/);
  assert.match(source, /type: 'selectAutonomy'/);
  assert.match(source, /case 'autonomyChanged'/);
  assert.match(source, /recovery\?\.mode \|\| threads\?\.autonomyMode \|\| 'review'/);
  assert.match(source, /autonomyMode\.disabled = locked/);
});

test("keeps technical run choices behind one compact explained control", () => {
  assert.match(source, /<details class="run-controls" id="run-controls">/);
  assert.match(source, /id="run-controls-label">Ask first · Standard/);
  assert.match(source, /id="runtime-help">Predictable for most development work/);
  assert.match(source, /id="mode-help">Confirm every workspace change and command/);
  assert.match(source, /function updateRunControlsSummary/);
  assert.match(source, /runControlsLabel\.textContent = modeLabels\[mode\] \+ ' · ' \+ runtimeLabels\[runtime\] \+ ' · ' \+ reviewLabels\[review\]/);
  assert.match(source, /type: 'selectFinalReview', mode: finalReviewMode\.value/);
  assert.match(source, /case 'finalReviewChanged'/);
  assert.match(source, /runControls\.classList\.toggle\('locked', locked\)/);
  assert.match(source, /runControls\.querySelector\('summary'\)\.tabIndex = locked \? -1 : 0/);
  assert.match(source, /if \(runControls\.open\)[\s\S]{0,180}runControls\.querySelector\('summary'\)\.focus\(\)/);
  assert.match(source, /\.run-controls-panel \{ position: absolute/);
});

test("shows independent and browser-comparison evidence in the run review", () => {
  assert.match(source, /INDEPENDENT VERIFICATION/);
  assert.match(source, /LOCAL EVIDENCE/);
  assert.match(source, /Visual observations/);
  assert.match(source, /summary\.evidence\.browser\.filter\(item => item\.detail\)/);
});

test("turns a local task brief into an editable draft without sending it", () => {
  assert.match(source, /id="brief-panel" role="region" aria-labelledby="brief-panel-title" aria-hidden="true"/);
  assert.match(source, /id="brief-objective"[^>]*maxlength="4000"/);
  assert.match(source, /id="brief-scope"[^>]*maxlength="2000"/);
  assert.match(source, /id="brief-done"[^>]*maxlength="2000"/);
  assert.match(source, /id="brief-constraints"[^>]*maxlength="2000"/);
  assert.match(source, /function normalizeBriefState/);
  assert.match(source, /vscode\.setState\(\{ drafts: localDrafts, brief: briefState \}\)/);
  assert.match(source, /function taskBriefMessage/);
  assert.match(source, /Working agreement/);
  assert.match(source, /prompt\.value = \(existing \? existing \+ '\\n\\n' : ''\) \+ message/);
  assert.match(source, /prompt\.value = prompt\.value\.slice\(0, 50000\)/);
  assert.match(source, /Nothing has been sent/);
  assert.match(source, /briefToggle\.disabled = locked/);
  const useBriefStart = source.indexOf("function useTaskBrief()");
  const useBriefEnd = source.indexOf("function clearTaskBrief()", useBriefStart);
  assert.notEqual(useBriefStart, -1);
  assert.notEqual(useBriefEnd, -1);
  assert.doesNotMatch(source.slice(useBriefStart, useBriefEnd), /postMessage/);
});

test("keeps sidebar panels and live updates accessible by keyboard and assistive technology", () => {
  assert.match(source, /id="announcer" role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(source, /id="timeline" aria-label="Conversation"/);
  assert.doesNotMatch(source, /id="timeline"[^>]*aria-live/);
  assert.match(source, /id="thread-panel" role="region" aria-labelledby="thread-panel-title" aria-hidden="true"/);
  assert.match(source, /id="run-review-panel" role="region" aria-labelledby="run-review-title" aria-hidden="true"/);
  assert.match(source, /id="brief-panel" role="region" aria-labelledby="brief-panel-title" aria-hidden="true"/);
  assert.match(source, /id="litellm-settings" role="region" aria-labelledby="litellm-settings-title" aria-hidden="true"/);
  assert.match(source, /function openTopPanel/);
  assert.match(source, /function closeTopPanels/);
  assert.match(source, /trigger\?\.isConnected[^\n]+trigger\.focus\(\)/);
  assert.match(source, /event\.key !== 'Escape'/);
  assert.match(source, /setContextExpanded\(false\);\s+contextToggle\.focus\(\)/);
  assert.match(source, /setActivityExpanded\(false\);\s+activityToggle\.focus\(\)/);
  assert.match(source, /button:focus-visible/);
  assert.match(source, /@media \(forced-colors: active\)/);
  assert.match(source, /aria-label="View diff for /);
  assert.match(source, /aria-label="Restore /);
});

test("makes incomplete first-run connection setup visible and actionable", () => {
  assert.match(source, /id="setup-callout" role="region" aria-labelledby="setup-callout-title"/);
  assert.match(source, /id="model-provider"/);
  assert.match(source, /Connect ' \+ \(liteLlm\.providerLabel \|\| 'LiteLLM'\)/);
  assert.match(source, /savedConnectionReady = Boolean\(liteLlm\.endpoint && liteLlm\.model && \(!liteLlm\.requiresKey \|\| liteLlm\.hasApiKey\)\)/);
  assert.match(source, /setupCallout\.classList\.toggle\('hidden', savedConnectionReady\)/);
  assert.match(source, /setupCalloutAction\.addEventListener\('click', openLiteLlmSettings\)/);
});

test("shows only build-authorized model providers and keeps their keys separate", () => {
  assert.match(source, /availableProviders: AVAILABLE_MODEL_PROVIDERS/);
  assert.match(source, /providerKeyStates: \{ litellm: liteLlmKey, ollama: false, openai: openAiKey \}/);
  assert.match(source, /provider: modelProvider\.value/);
  assert.match(source, /activeProvider === 'ollama'[\s\S]*http:\/\/127\.0\.0\.1:11434\/v1/);
  assert.match(source, /activeProvider === 'openai'[\s\S]*https:\/\/api\.openai\.com\/v1/);
  assert.match(source, /providerKeyField\.classList\.toggle\('hidden', isOllama\)/);
  assert.match(source, /modelCatalogField\.classList\.toggle\('hidden', !isLiteLlm\)/);
  assert.match(source, /profileActions\.classList\.toggle\('hidden', !isLiteLlm\)/);
});

test("renders structured connection fixes and retests applied recommendations", () => {
  assert.match(source, /data-diagnostic-fix/);
  assert.match(source, /function applyDiagnosticFix/);
  assert.match(source, /fix\.kind === 'set-reasoning'/);
  assert.match(source, /fix\.kind === 'clear-sampling'/);
  assert.match(source, /fix\.kind === 'set-auth-header'/);
  assert.match(source, /fix\.kind === 'open-ca-setup'/);
  assert.match(source, /requestAnimationFrame\(testLiteLlmSettings\)/);
  assert.match(source, /Correction verified/);
  assert.match(source, /Save the connection to keep them/);
});

test("surfaces model compatibility before the connection test", () => {
  assert.match(source, /id="model-compatibility" role="status" aria-live="polite"/);
  assert.match(source, /function previewModelCompatibility/);
  assert.match(source, /function renderModelCompatibility/);
  assert.match(source, /Compatibility profile ready to test/);
  assert.match(source, /Compatibility could not be inferred/);
  assert.match(source, /Not compatible with this agent/);
  assert.match(source, /Reasoning none is required for tools/);
  assert.match(source, /Run Test connection to verify the actual gateway deployment/);
  assert.match(source, /liteLlmModel\.addEventListener\('input', previewModelCompatibility\)/);
});

test("keeps first-run connection setup split into three validated steps", () => {
  assert.match(source, /data-setup-step="1"/);
  assert.match(source, /data-setup-step="2"/);
  assert.match(source, /data-setup-step="3"/);
  assert.match(source, /Connect the provider/);
  assert.match(source, /Choose the models/);
  assert.match(source, /Verify and save/);
  assert.match(source, /function showConnectionSetupStep/);
  assert.match(source, /function moveToConnectionSetupStep/);
  assert.match(source, /setupStepComplete\(1\)/);
  assert.match(source, /setupStepComplete\(2\)/);
  assert.match(source, /Add the provider key before choosing models/);
  assert.match(source, /Choose or enter the chat model alias before testing/);
});

test("opens the same guided connection form reliably from the command palette", () => {
  assert.match(source, /public async openConnectionSettings/);
  assert.match(source, /this\.connectionSettingsRequested = true/);
  assert.match(source, /type: "openConnectionSettings"/);
  assert.match(source, /type: 'connectionSettingsOpened'/);
  assert.match(source, /case "connectionSettingsOpened"/);
  assert.match(source, /showConnectionSetupStep\(1, false\)/);
  assert.match(source, /openLiteLlmSettings\(\)/);
});

test("keeps corporate CA management independent from the full connection wizard", () => {
  assertMessageType("configureGatewayCa");
  assert.match(source, /private async configureGatewayCa/);
  assert.match(source, /Replace corporate CA PEM/);
  assert.match(source, /Use operating system trust only/);
  assert.match(source, /importGatewayCa\(this\.extensionContext/);
  assert.match(source, /clearImportedGatewayCa\(this\.extensionContext\)/);
  assert.match(source, /vscode\.postMessage\(\{ type: 'configureGatewayCa' \}\)/);
});

test("turns the empty conversation into safe task-oriented onboarding", () => {
  assert.match(source, /aria-label="Suggested development tasks"/);
  assert.match(source, /Understand this project/);
  assert.match(source, /Fix a problem/);
  assert.match(source, /Implement a change/);
  assert.match(source, /Review current changes/);
  assert.match(source, /Nothing runs until you review the draft and press Send/);
  assert.match(source, /prompt\.setSelectionRange\(placeholderStart, placeholderEnd \+ 1\)/);
  assert.match(source, /Editable task draft prepared\. Nothing runs until you press Send/);
});

test("notifies only according to the local completion preference and opens the result", () => {
  assert.match(source, /parseCompletionNotificationMode\(configuration\.get\("completionNotifications"\)\)/);
  assert.match(source, /completionNotification\(mode, Boolean\(this\.view\?\.visible\), outcome\)/);
  assert.match(source, /view\.onDidChangeVisibility/);
  assert.match(source, /view\.onDidDispose/);
  assert.match(source, /if \(this\.view === view\) this\.view = undefined/);
  assert.match(source, /view\.badge = \{ value: 1, tooltip: notification\.message \}/);
  assert.match(source, /workbench\.view\.extension\.localAgentCompanion/);
  assert.match(source, /currentRunSummary\.cancelled = data\.outcome === 'cancelled'/);
  assert.match(source, /currentRunSummary\.failed = data\.outcome === 'failed'/);
});

test("shows a confirmed stopping state without declaring cancellation early", () => {
  assert.match(source, /type: "cancelState", state: cancellation/);
  assert.match(source, /Stopping current operation/);
  assert.match(source, /cancel\.disabled = cancellationPending/);
  assert.match(source, /cancel\.textContent = cancellationPending \? 'Stopping…' : 'Cancel run'/);
  assert.match(source, /aria-busy/);
  assert.doesNotMatch(
    source,
    /cancel\.addEventListener\('click',[\s\S]{0,180}currentRunSummary\.cancelled = true/
  );
});

test("offers compact response actions without storing raw chat as memory", () => {
  assert.match(source, /data-copy-message/);
  assert.match(source, /data-add-memory-message/);
  assert.match(source, /vscode\.env\.clipboard\.writeText\(text\)/);
  assert.match(source, /type: 'copyMessage'/);
  assert.match(source, /case 'messageCopied'/);
  assert.match(source, /vscode\.postMessage\(\{ type: 'addMemoryEntry' \}\)/);
  assert.match(source, /Add a confirmed project-memory entry from this response/);
  assert.doesNotMatch(
    source,
    /data-add-memory-message[\s\S]{0,500}type: 'remember',[\s\S]{0,120}messageSources/
  );
  assert.match(source, /timeline\.querySelectorAll\('\[data-add-memory-message\]'\)/);
  assert.match(source, /id="branch-thread"/);
  assert.match(source, /type: 'branchThread', id: activeThreadId/);
  assert.match(source, /Memory layers and storage/);
});

test("keeps long conversations compact and reveals older complete turns incrementally", () => {
  assert.match(source, /const RECENT_HISTORY_MESSAGES = 14/);
  assert.match(source, /const HISTORY_REVEAL_BATCH = 20/);
  assert.match(source, /function renderConversationHistory/);
  assert.match(source, /function revealEarlierHistory/);
  assert.match(source, /messages\[start\]\?\.role === 'assistant'/);
  assert.match(source, /data-show-earlier/);
  assert.match(source, /Show earlier conversation messages/);
  assert.match(source, /timeline\.scrollTop \+= Math\.max\(0, timeline\.scrollHeight - previousHeight\)/);
  assert.match(source, /renderConversationHistory\(history\)/);
  assert.doesNotMatch(source, /\(history \|\| \[\]\)\.forEach\(message => appendMessage/);
});

test("preserves the reader position and offers an explicit jump to new activity", () => {
  assert.match(source, /class="conversation-stage"/);
  assert.match(source, /id="jump-latest"/);
  assert.match(source, /const SCROLL_STICK_THRESHOLD = 48/);
  assert.match(source, /let conversationPinnedToBottom = true/);
  assert.match(source, /if \(!force && !conversationPinnedToBottom\)/);
  assert.match(source, /unseenConversationUpdates \+= 1/);
  assert.match(source, /New conversation activity is available below/);
  assert.match(source, /jumpLatest\.addEventListener\('click'/);
  assert.match(source, /timeline\.addEventListener\('scroll'/);
  assert.match(source, /scrollConversationToBottom\(\{ force: message\.role === 'user' \}\)/);
  assert.match(source, /scrollConversationToBottom\(\{ force: true, countUpdate: false \}\)/);
});

test("streams one stable assistant message without counting every token as a new update", () => {
  assert.match(source, /case 'assistantStart'/);
  assert.match(source, /case 'assistantDelta'/);
  assert.match(source, /case 'assistantReset'/);
  assert.match(source, /function startAssistantStream/);
  assert.match(source, /function appendAssistantDelta/);
  assert.match(source, /requestAnimationFrame\(\(\) => flushAssistantStream/);
  assert.match(source, /scrollConversationToBottom\(\{ countUpdate: false \}\)/);
  assert.match(source, /function completeAssistantMessage/);
  assert.match(source, /existing\.replaceWith\(completed\)/);
});

test("restores partial assistant output with an explicit non-final state", () => {
  assert.match(source, /recovery\?\.partialAssistant\?\.content/);
  assert.match(source, /partial response was preserved/);
  assert.match(source, /function markAssistantStreamsInterrupted/);
  assert.match(source, /data-message-status/);
  assert.match(source, /partial · interrupted/);
});

test("renders trusted locally sanitized Markdown instead of parsing model HTML in the webview", () => {
  assert.match(source, /import \{ renderSafeMarkdown \} from "\.\/safe-markdown"/);
  assert.match(source, /html: renderSafeMarkdown\(event\.text\)/);
  assert.match(source, /html: renderSafeMarkdown\(message\.content\)/);
  assert.match(source, /message\.html \|\| renderText\(message\.text\)/);
  assert.doesNotMatch(source, /safe\.split\(\/\\`\\`\\`\//);
  assert.doesNotMatch(source, /replace\(\/\^\[\^\\n\]\*\\n\?\//);
});

test("admits only one send while local readiness is being checked", () => {
  assert.match(source, /private sendPending = false/);
  assert.match(source, /if \(this\.sendPending\)/);
  assert.match(source, /this\.sendPending = true/);
  assert.match(source, /finally \{\s*this\.sendPending = false/);
  assert.ok(
    source.indexOf("setBusy(true);", source.indexOf("function submit()")) <
      source.indexOf("vscode.postMessage({", source.indexOf("function submit()"))
  );
  assert.match(source, /Checking local readiness/);
  assert.match(source, /!event\.isComposing/);
});
