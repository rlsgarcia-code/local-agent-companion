# Changelog

## 0.11.4

- Added evidence-type filtering in Review run and grouped diff, test, command, diagnostic, browser, and MCP evidence for faster verification.
- Added quick commands `/status`, `/resume`, `/pause`, and `/evidence` in the composer.

## 0.11.3

- Added a workspace-wide Goals center in the sidebar with status, criteria progress, iteration count, and one-click navigation to each goal thread.

## 0.11.2

- Hardened packaged-VSIX verification on Windows when the VS Code CLI exits after successfully installing the isolated extension copy.

## 0.11.1

- Added a collapsible persistent-goal panel with inline acceptance-criteria editing, pause/cancel controls, and automatic continuation after restart without duplicating goal turns in chat history.
- Added typed, criterion-linked evidence references for tests, diagnostics, diffs, visual validation, approved commands, and MCP tools actually invoked; goal completion remains blocked without concrete evidence.
- Added workspace lease protection for goal iterations across VS Code windows and expanded regression coverage for persistence, recovery, and evidence association.

## 0.11.0

- Added persistent workspace goals under `.local-agent/goals/`: create a goal from the composer, keep criteria/milestones/evidence and bounded progress history, resume active goals after restart, and evaluate completion through a structured evidence-only LangChain call. Goals pause after repeated stagnation or the 20-iteration safety limit and preserve the selected runtime, autonomy mode, approvals, and final-review policy.

- Optional provider packages now open on their named provider until the user explicitly selects another available provider.
- Added local Ollama model discovery in the setup form through the loopback `/api/tags` endpoint, equivalent to `ollama list` without shell execution.
- Added explicit Ollama and OpenAI VSIX variants while keeping the default package LiteLLM-only; provider allowlists are build-bound, Ollama is restricted to loopback without a key, OpenAI is fixed to `api.openai.com`, and all model traffic retains exact-route Chat Completions guards.
- Stream agent text through the native LangChain event lifecycle into one stable sidebar message, discard transient tool-call prose, consolidate the final answer without duplication, and preserve bounded partial output across cancellation, failure, or Extension Host restart.
- Added corporate local `stdio` MCP imports with exact no-shell commands, pinned `npx` packages, per-process HTTPS registries, secure environment secrets, wildcard tool discovery followed by explicit selection, and subprocess cleanup with the MCP session.
- Added VS Code-native corporate MCP onboarding from clipboard or JSON files, with placeholder resolution, per-header Secret Storage, explicit tool allowlists, enable/disable/remove controls, and a read-only handshake/catalog test.
- Added official LangChain MCP tool adaptation for both agent runtimes, exact-route HTTPS transport with redirects blocked and corporate CA reuse, plus approval before every MCP tool call and no MCP access in Plan-only mode.
- Added OAuth authorization-code + PKCE support for approved HTTPS MCP servers, with browser login, loopback callback validation, refresh-token reuse, and Secret Storage persistence.
- Added VS Code-native Problems, symbol, definition/reference, call-hierarchy, code-action, and bounded multi-file rename tools, with diagnostic baseline/compare evidence.
- Added an invalidatable local structural project map, related-test suggestions, and repository playbooks under `.local-agent/playbooks`, without source-code embeddings or a hosted index.
- Added approval-gated managed local server/watcher processes with direct spawn, bounded logs, loopback URL discovery, readiness, restart, and process-tree cleanup; no shell, daemon, native module, or elevation is introduced.
- Added categorized source-derived memory with file fingerprints, automatic stale-recall suppression, module-summary guidance, and exact recalled-memory previews in the run receipt.
- Added an optional independent completion reviewer through the same configured LiteLLM model, using redacted bounded diff excerpts plus command, diagnostic, process, and browser evidence.
- Added ephemeral browser baselines and multimodal before/after comparison, with redacted textual observations preserved in **Review run**.
- Added a subtle, accessible browser-control toggle to the chat header; access is opt-in per workspace, locked during runs, and revoking it immediately closes the isolated session.
- Added an agent completion gate for visible web-interface changes: validate the affected local flow, page/console errors, responsive layouts when relevant, and final visuals when the selected model accepts images, or report exactly what remains unverified.
- Added approval-gated LangChain browser tools for opening, inspecting, interacting with, and visually checking loopback applications while showing the same local URL to the user.
- Keep browser validation local and installation-safe by using `playwright-core` with an already-installed Edge, Chrome, or configured Chromium executable; no browser download, lifecycle script, native build, or administrator access is attempted.
- Isolate every browser session with ephemeral storage, blocked downloads and service workers, password-field refusal, loopback-only HTTP/WebSocket routing, bounded temporary screenshots, and explicit disclosure before page data is sent to the configured LiteLLM model.
- Invoke the installed VSCE CLI directly through Node during local packaging, avoiding the Windows `spawnSync("npx.cmd")` `EINVAL` failure, and print the generated VSIX's absolute path on success.
- Separate end-user packaging from maintainer verification: `npm run package` now builds a VSIX without tests, local smoke servers, VS Code configuration, or LiteLLM credentials, while `npm run package:verified` retains the complete local release gate.
- Allow the Windows packaging gate to run for standard corporate users without Developer Mode or symbolic-link privileges; symlink-specific security cases remain covered on Linux and macOS.
- Expanded the persistent run strip into a two-line progress monitor with elapsed time, plan completion, file/command counts, and the three latest actions, while preserving the compact collapsed state.
- Stopped live updates from pulling readers away from earlier messages; a bounded new-activity indicator now offers an explicit jump back to the latest conversation point.
- Added structured GitHub forms for sanitized bug reports and feature requests, disabled unstructured public issues, and routed vulnerability reports to the repository's private security channel.
- Pinned every CI and release GitHub Action to a reviewed immutable commit and added weekly Dependabot pull requests for npm and workflow dependencies without automatic merge or publication.
- Restricted provider transport to exact configured HTTPS Chat Completions and embeddings routes, POST-only with redirects disabled, and disabled redirects for the explicit model catalog so gateway credentials cannot be forwarded to an unconfigured destination.
- Extended real Extension Host and packaged-VSIX activation gates to Windows x64, matching the primary corporate pilot platform instead of relying only on Linux execution.
- Added a packaged-artifact gate that installs the generated VSIX into a clean VS Code profile, verifies the loaded copy came from that installation, and exercises activation and core commands so source-mode tests cannot mask an incomplete distributable.
- Made the production dependency audit fail closed when npm returns a network error or incomplete JSON instead of misreporting an unavailable registry as zero findings, and reject exceptions after their matching advisory disappears.
- Added a real VS Code Extension Host integration gate that activates the extension and verifies command registration, sidebar opening, new-thread responsiveness, and connection-settings navigation without credentials or provider traffic.
- Added a sanitized corporate-pilot checklist covering target-host compatibility, gateway and PEM setup, model profiles, Chroma, multi-window coordination, recovery, and privacy before stable promotion.
- Updated the official VS Code packaging tool to its corrected major release, leaving only the separately mitigated Deep Agent glob advisory in the production audit policy.
- Made local packaging platform-explicit: supported hosts now produce a versioned target-specific VSIX and unsupported hosts fail instead of emitting a misleading universal package containing a native Chroma binary.
- Made the production audit gate invoke npm through its Node CLI path so the same checked policy runs reliably on Windows, macOS, and Linux without shell interpolation.
- Mitigated `GHSA-vfj7-8cjw-p6xm` at every model-controlled glob boundary by rejecting brace expansion and bounding pattern length, operators, and path segments before filesystem matchers run.
- Added a CI production-dependency audit with explicit, expiring, verification-backed exceptions; unknown, mismatched, unverifiable, or expired high/critical findings fail the build.
- Added bounded, local repository-guidance discovery for applicable `AGENTS.md`, `.github/copilot-instructions.md`, `CONTRIBUTING.md`, and `README.md`, prioritizing nearer active-file instructions and refusing symlinks outside the workspace.
- Split the visible message-context budget into user-pinned context, project guidance, and automatic editor signals so repository instructions remain predictable without hiding all live editor evidence.
- Show the exact included repository-guidance paths before send and add a content-free context receipt to each local run review, including pinned sources, workspace signal counts, memory mode, truncation, and semantic fallback.
- Lock context-selection controls while a run is active so late UI changes cannot be mistaken for inputs to the in-flight request.
- Made restore state truthful when VS Code applies an edit but cannot save it: every document is attempted, applied changes remain marked restored, and the sidebar lists a bounded manual-save warning instead of offering an invalid retry.
- Added an optional local task brief for objective, scope, acceptance criteria, and constraints; it persists as bounded webview draft state, appends an editable structured request, and never sends or invokes the model automatically.
- Replaced permanently exposed runtime and autonomy selectors with one compact, accessible run-setup control that explains each choice, opens above the composer, closes predictably, and locks across local or remote runs.
- Added a confirmed **Discard request** recovery action that removes only the unanswered user turn, preserves completed conversation history, clears its LangGraph checkpoint, and explicitly leaves prior file, command, and memory effects for separate review.
- Added a guarded **Undo all file changes** action for complete run snapshots: every target is prevalidated before one workspace edit, newer user work blocks the whole operation, and commands or memory updates are explicitly excluded.
- Added a strict, size-bounded Zod protocol for every webview-to-extension message and a sanitized top-level error boundary; malformed messages perform no action.
- Regression-test the closed webview CSP (`default-src 'none'`, nonce-only scripts/styles), rejected extra fields, oversized payloads, and unserializable diagnostics.
- Close the duplicate-send race during local preflight with immediate composer locking plus a provider-side admission guard, while preserving rejected drafts.
- Respect IME composition in the Enter-to-send shortcut so composing text cannot submit prematurely.
- Replaced the lossy webview Markdown formatter with a tested local renderer for headings, lists, quotes, emphasis, inline code, and fenced code; unlabeled fences no longer lose their first line.
- Escape model HTML and control characters before the webview, keep link/image syntax inert, and accept only a constrained language class on code blocks.
- Keep long threads calm and responsive by initially rendering only the latest complete turns, with accessible incremental reveal for older local messages and preserved scroll position.
- Added compact **Copy** and **Add memory…** actions to agent responses; clipboard writes stay local to VS Code and report success accessibly.
- Keep durable memory deliberate: response text is never prefilled or persisted, the action opens the existing validated blank-entry flow, and the unused arbitrary webview-memory write path was removed.
- Added a network-free run preflight that verifies workspace trust, cross-window exclusivity, stored connection credentials, model compatibility, and the corporate CA before accepting a request.
- Preserve the complete draft and open the relevant setup step when preflight fails; critical checks run again after the workspace lease and before the local thread is mutated.
- Declare untrusted VS Code workspaces unsupported because the extension reads project files and can run explicitly approved local tools.
- Made cancellation state authoritative: **Stopping…** is now distinct from a confirmed cancelled outcome, repeated stop requests are disabled, and the request remains recoverable after acknowledgement.
- Propagate one run abort signal through model transport, semantic-memory embeddings, LangChain invocation, and local tools; aborts during semantic recall no longer fall through into a new model call.
- Centralized all runtime approvals in one privacy-safe modal presenter and mirrored waiting, target/risk, approved, and declined states into the live execution timeline.
- Added an always-visible model compatibility summary that distinguishes inferred profiles, required reasoning settings, Chat Completions incompatibility, and opaque gateway aliases before testing.
- Unified Command Palette and sidebar LiteLLM setup into one three-step form with a load-safe open/acknowledge handshake, removing the stale eight-dialog configuration path.
- Added local conversation search by title/status and persistent pinning, with pinned-first bounded retention and cross-window mutation guards while a run is active.
- Added privacy-safe run completion notifications with a view badge, one-click result opening, and explicit `whenHidden`, `always`, or `never` preferences; cancelled runs stay quiet.
- Replaced the generic empty chat state with four explained, task-oriented starters that prepare editable drafts, select the required placeholder, and never run until the user explicitly sends them.
- Added a user-initiated sanitized support bundle with bounded environment, configuration, memory, thread, and diagnostic metadata while omitting chats, prompts, paths, commands, filenames, endpoints, model aliases, keys, and certificates.
- Added versioned connection-profile import/export for moving gateway, model compatibility, semantic-memory, runtime, and autonomy settings between machines without serializing the gateway key or corporate CA.
- Validate imported profiles strictly: require HTTPS, known schema fields and model parameters, a separate Secret Storage key, explicit user confirmation, and a 256 KB file limit; provider mutations are blocked during active runs.
- Added a local durable-memory center to inspect recent entries, add or edit verified facts, confirm individual deletion, open the Markdown source, and understand whether retrieval is recent or semantic.
- Keep `memory.md` as the only durable source: the center is a bounded projection, vector reindexing remains automatic on the next retrieval, and memory mutations are blocked while an agent run is active in any VS Code window.
- Prevent partial memory rewrites by reading the complete bounded source before mutation, refusing files above 2 MB, limiting individual managed entries to 4,000 characters, and rejecting stale entry identifiers.
- Added a pre-send context budget that explains approximate tokens, configured-limit utilization, automatic workspace context, each pinned item, prompt size, and durable-memory retrieval mode without exposing their contents.
- Keep explicitly pinned context available when automatic editor context is disabled, and reserve bounded context capacity for user-selected files and selections before lower-priority workspace samples.
- Exclude sensitive active-file names, selections, diagnostics, and open-file entries from automatic context while explaining the local exclusion in the sidebar.
- Added tag-driven GitHub Releases with permanent, versioned VSIX packages for all five supported native targets and a generated SHA-256 checksum manifest.
- Verify release tag, package version, changelog entry, and the complete native asset set before publication; published releases are never overwritten by reruns.
- Reworked installation guidance around prebuilt VSIX downloads so end users no longer need Git, Node.js, npm, or a local build.
- Added a professional connection-readiness surface to the sidebar with clear setup, testing, verified, and failure states.
- Added an explicit diagnostic that validates local form values and then checks the configured model catalog, streaming Chat Completions with function-tool metadata, and optional embeddings route.
- Kept diagnostics safe and user initiated: the chat probe does not execute tools, the embedding probe sends only a fixed diagnostic phrase, and no credentials are displayed or persisted outside Secret Storage.
- Moved model compatibility and sampling controls into a collapsed advanced section so the primary setup path stays focused.
- Added a live message-context inspector above the composer with active-editor visibility, pinned-selection ranges, individual removal, and clear-all controls.
- Added a compact **＋ File** action that opens the native VS Code file picker and pins a bounded text file directly from the composer.
- Reject binary, oversized, or out-of-workspace files before adding them to message context, and label file versus selection entries explicitly.
- Refresh the context indicator when the active editor or automatic-context setting changes, and clear pinned selections visibly when starting a new thread.
- Added an end-of-run evidence summary with changed files, completed commands, memory updates, token usage, failure/cancellation state, and a shortcut to the VS Code Source Control view.
- Added a unified **Review run** drawer with outcome, final plan, direct file changes, native diff/restore actions, command outputs, recognized verification results, model usage, and memory updates.
- Keep up to ten run reviews associated with their original timeline summaries during the sidebar session, including synchronized restore state.
- Consolidated live tool activity into one expandable execution strip with the current stage, latest action, elapsed time, plan progress, file/command counts, and bounded detailed history.
- Preserve expanded command output while execution updates arrive, keep the compact state readable at 340 px, and replace the live strip with the existing reviewable run summary on completion.
- Added workspace-persisted **Ask first**, **Auto edits**, and **Plan only** autonomy modes with a safe Ask-first default.
- Apply the same approval policy to standard LangChain tools and the Deep Agent filesystem backend: Ask-first guards every mutation, Auto-edits permits scoped file/memory writes, and commands plus deletions remain confirmed in every executable mode.
- Added cross-platform GitHub Actions verification and native VSIX packaging for macOS arm64/x64, Linux arm64/x64, and Windows x64.
- Added monthly Dependabot maintenance for npm and GitHub Actions dependencies.
- Added contribution and private vulnerability-reporting guidance, richer extension-manifest metadata, and a dedicated package icon.
- Generate a deterministic third-party manifest and combined license text from the actual production bundle, include both in every VSIX, and fail packaging for missing or unreviewed license metadata.
- Prevent starting a new thread while a run is still active to avoid cancellation/reset races.
- Replaced the single disposable conversation with up to 30 bounded local threads per workspace, including switching, automatic titles, renaming, deletion, and restart restoration.
- Kept `MemorySaver` as the LangGraph checkpoint implementation while storing only bounded UI/restoration projections in VS Code `workspaceState`.
- Added automatic migration and cleanup for both the previous single-conversation projection and legacy flat sidebar history.
- Added bounded, per-thread draft persistence so unfinished prompts survive thread switches and sidebar reloads.
- Added retry and edit-and-resend recovery for failed, cancelled, or interrupted requests without duplicating the pending user message in LangChain context.
- Persist minimal per-thread run-recovery metadata and detect when the owning Extension Host process disappears before saving an answer.
- Added an honest **Restart request** flow that replays an interrupted request from the beginning while preserving its original autonomy mode.
- Prevent concurrent agent runs across VS Code windows when a live process still owns a run in the same workspace, with a manual status refresh action.
- Back cross-window coordination with an atomic, process-owned lease in private extension storage and safely reclaim leases left by terminated Extension Hosts.
- Delay optimistic user-message insertion until the run lease and local thread state are accepted, restoring the composer draft when startup is rejected.
- Made the composer grow with longer prompts while retaining a compact maximum height.
- Added bounded in-memory before/after snapshots for direct file writes in both the LangChain Agent tools and the Deep Agent filesystem backend.
- Added native VS Code per-file diffs and guarded restore actions that refuse to overwrite files changed after the run.
- Added real-path and symlink containment checks to the review snapshot and restoration paths.
- Require explicit modal approval for every Deep Agent filesystem deletion, with a recursive-directory warning and safe denial returned through the backend result.
- Hardened command approval with a testable local policy that blocks shell interpreters, inline code, command wrappers, network clients, remote URLs, package downloads/publication, and networked Git operations.
- Added a distinct destructive-command warning for operations that can remove, replace, or discard workspace data.
- Kept command-driven changes visible through Source Control while clearly distinguishing them from directly snapshotted file-tool writes.
- Added automated webview syntax and duplicate-element-ID regression checks.
- Improved sidebar accessibility with deterministic panel focus/return, Escape-to-close behavior, labeled repeated actions, collapsed-region semantics, concise live announcements, visible keyboard focus, and forced-colors support.
- Added a calm first-run connection prompt that exposes LiteLLM setup immediately and disappears only after a gateway, chat model alias, and Secret Storage key are saved.
- Hardened the bundled ChromaDB lifecycle with process-owned startup locks, race-safe timeout ordering, strict heartbeat validation, atomic metadata, stale-owner recovery, and cleanup when the owning extension host is disposed.
- Added per-client Chroma leases so closing one VS Code window cannot stop semantic memory while another live Extension Host is still using the shared local service.
- Surface the exact local semantic-memory failure in the run timeline while continuing safely with the auditable `memory.md` source of truth.
- Made local VSIX packaging a release gate that runs type-checking, the complete test suite, both local-only runtime smokes, and the native build before invoking `vsce`.
- Added centralized credential redaction for provider errors, connection diagnostics, tool failures, file/search results, command previews, stdout/stderr, and run-review output without rewriting ordinary chat messages.
- Prevent detected credentials, private-key material, known gateway keys, and common token signatures from being appended to durable project memory.
- Hide common credential-bearing files from automatic context, file pickers, listings, and broad searches; direct reads require a one-time local confirmation and still return only locally redacted text.
- Turn recognized connection failures into structured local actions: apply compatible reasoning/sampling settings and retest, choose the expected subscription-key header, focus the field that needs review, or open corporate-CA setup.
- Keep remediation explicit and reversible: no provider setting is guessed silently, successful corrections must still be saved by the user, and unknown errors remain unchanged with their technical detail.
- Reorganized the dense connection form into three keyboard-accessible stages — gateway, models, and verification — with progress, required-field guidance, back/next navigation, and advanced controls kept out of the primary path.
- Separated corporate-CA management from the legacy eight-step command wizard so the sidebar can import, replace, or remove its private PEM copy without asking for unrelated connection values again.

## 0.10.2

- Replaced the permanently compressed plan/status area with an expandable activity dock above the composer.
- Keep the collapsed dock compact with only live activity, status, and workspace context visible.
- Automatically expand the first plan update while respecting a manual collapse for subsequent updates in the same run.
- Added keyboard focus, `aria-expanded`, and reduced-motion-compatible transitions to the plan toggle.
- Reused the existing model-catalog request for both selectors, keeping aliases containing `embedd` only in the embedding list and excluding them from the chat list.
- Removed the separate embeddings URL setting; embedding requests now always use the same LiteLLM base, key, headers, and corporate CA as Chat Completions.

## 0.10.1

- Removed the native SQLite checkpoint dependency to keep installation portable across restricted and heterogeneous development environments.
- Kept LangGraph `MemorySaver` for active threads and the bounded local VS Code workspace-state projection for conversation restoration.
- Kept ChromaDB as the only platform-specific local component; its npm packages contain prebuilt binaries and no install scripts.
- Disabled npm dependency lifecycle scripts for this project; required platform binaries are supplied through npm optional packages.

## 0.10.0

- Added optional LangChain Chroma vector-store retrieval for `.local-agent/memory.md`, backed by a bundled local-only ChromaDB service with no Docker requirement.
- Added an embedding-model selector populated by the same authenticated LiteLLM model catalog used by the chat model, while reusing the Secret Storage key, gateway header, and imported corporate CA.
- Persist active LangGraph checkpoints with `MemorySaver` and keep a bounded local conversation projection for restoration.
- Keep transient editor context out of persisted human messages and inject only semantically relevant durable memory when embeddings are configured.
- Removed the Deep Agent recursion limit of 50 and enabled its native high-limit compaction/offload path with a composite state/workspace backend.
- Package the platform-specific ChromaDB native binary in the VSIX.

## 0.9.2

- Added one-time corporate CA PEM import into the extension's global local storage so every workspace in the same VS Code profile and environment can reuse it.
- Automatically migrates a previously configured workspace PEM after its first successful local read.
- Added setup controls to keep, replace, or remove the imported CA and clearer guidance for generic TLS connection errors.

## 0.9.1

- Docked the live agent status and current plan directly above the composer so they remain visible at the active end of long conversations.
- Made the conversation timeline independently scrollable and bounded long plans and settings panels to the available sidebar height.
- Clear the previous plan when a new request is sent and keep the newest conversation activity in view as the plan changes.

## 0.9.0

- Added documented GPT and Claude compatibility presets with model-aware reasoning, tool-calling, and sampling validation.
- Added optional `top_p` configuration and the `max` reasoning effort while retaining a custom gateway-defined profile.
- Added an optional user-configured model catalog URL loaded with `Cache-Control: no-cache` and the Secret Storage key in `api-key`.
- Added a model picker that applies and remembers distinct capabilities for each exact LiteLLM alias.

## 0.8.2

- Added model-specific Chat Completions profiles for optional `reasoning_effort` and `temperature` values.
- Omit both parameters by default instead of inferring capabilities from a model name or forcing `temperature: 0`.
- Added sidebar and setup-wizard controls that remember distinct capabilities for each exact LiteLLM model alias.
- Added regression coverage for an explicitly configured `gpt-6-luna` tool call with `reasoning_effort: "none"` and no temperature.

## 0.8.1

- Added selectable gateway authentication headers: `Authorization: Bearer`, `api-key`, and `Ocp-Apim-Subscription-Key`.
- Kept the API/subscription key exclusively in VS Code Secret Storage while supporting Azure-compatible corporate gateways.
- Added header-mapping tests and local routing coverage for Azure API Management subscription-key authentication.

## 0.8.0

- Added a workspace-level choice between the focused `createAgent` runtime and the advanced `createDeepAgent` runtime.
- Added the runtime selector directly to the sidebar composer and to the first step of the setup wizard.
- Restricted Deep Agent filesystem access to the opened workspace and made its built-in filesystem tools read-only in Plan mode.
- Kept command execution behind the existing local confirmation flow and kept both runtimes on the same LiteLLM Chat Completions client.
- Added read-only local routing smoke coverage for both runtimes.

## 0.7.0

- Rebuilt the complete agent runtime with LangChain primitives: `ChatOpenAICompletions`, `createAgent`, `tool`, Zod schemas, callbacks, middleware, and `MemorySaver`.
- Removed the custom HTTP/SSE client, hand-written tool-call loop, and custom model-message/tool definitions.
- Forced Chat Completions routing through the LangChain OpenAI integration and kept optional corporate CA support through its configured transport.
- Added LangChain context-window middleware, checkpointed thread state, and per-run token-usage callbacks.
- Explicitly disabled LangSmith/LangChain external tracing so LiteLLM remains the only external request destination.

## 0.6.0

- Replaced the previous hosted SDK runtime with a custom local agent loop over LiteLLM Chat Completions.
- Added local function tools for workspace search, bounded file reads, exact edits, file creation, planning, project memory, and approved command execution.
- Added streamed Chat Completions parsing, including fragmented tool calls, usage, cancellation, and non-streaming fallback.
- Persist recent user/assistant context locally with bounded conversation compaction.
- Removed Responses API, hosted model catalogs, hosted binaries, and the previous SDK dependency.
- Kept the LiteLLM virtual key exclusively in VS Code Secret Storage and corporate CA support inside the workspace.

## 0.5.0

- Replaced the Azure-specific provider with a LiteLLM Responses gateway provider.
- Added setup for HTTPS `/v1` base URL, model alias, scoped virtual key, optional CA PEM, and model catalog.
- Send the LiteLLM virtual key as a Bearer token from VS Code Secret Storage.
- Removed Azure deployment ID, API version, Azure hostname checks, and `api-key` header configuration.

## 0.2.4

- Added workspace-scoped corporate CA PEM selection for Azure gateways.
- Pass the selected certificate to the local Local Agent runtime through `LOCAL_AGENT_CA_CERTIFICATE`.
- Reject certificate paths and symbolic links that resolve outside the opened workspace.

## 0.2.3

- Added explicit support for HTTPS corporate gateways that route to Azure OpenAI.
- Preserve gateway API paths and send Azure credentials through the `api-key` header.
- Require a modal confirmation before trusting a non-Azure hostname.

## 0.2.2

- Aligned Azure setup labels with existing `AzureChatOpenAI` values: OpenAI API Base, Deployment ID, API Version, and API Key.
- Reject deployment-specific URLs so Local Agent can construct the Azure Responses route correctly.

## 0.2.1

- Turned Azure configuration into an explicit four-step flow with inline validation.
- Added clear cancellation feedback and support for retaining an existing secret key.

## 0.2.0

- Enforced a fully local Local Agent runtime with Azure OpenAI as the only external model endpoint.
- Added isolated `LOCAL_AGENT_HOME` state and a minimal environment allowlist.
- Added secure Azure API-key storage through VS Code Secret Storage.
- Disabled hosted web search, runtime update checks, and network access for agent shell commands.
- Added Azure provider validation and unit tests.

## 0.1.0

- Initial VS Code sidebar experience.
- Initial local agent thread start, streaming, resume, and cancellation.
- Automatic editor context and pinned selections.
- Project memory in `.local-agent/memory.md`.
- Plan, command, file-change, tool, and usage events.
