const appState = {
  snapshot: null,
  activities: [],
  changes: [],
  draftMessages: new Map(),
  approval: null,
  inspectorMode: "activity",
  inspectorOpen: false,
  sidebarCollapsed: localStorage.getItem("companion.sidebarCollapsed") === "true",
  threadQuery: "",
  recommendationBusy: false,
  recommendationNotice: null,
  selectedOutputs: null
};

const SCROLL_STICK_THRESHOLD = 48;
let conversationPinnedToBottom = true;
let readerAnchorLocked = false;
let unseenConversationUpdates = 0;
const countedUnseenMessages = new Set();

const el = Object.fromEntries([
  "thread-list", "thread-search", "new-thread", "workspace-button", "workspace-label", "ollama-dot", "ollama-label", "sidebar-collapse", "sidebar-reveal",
  "thread-title", "refresh-button", "model-button", "model-label", "settings-button", "conversation", "welcome", "prompt",
  "runtime-button", "runtime-label", "runtime-popover", "close-runtimes", "context-button",
  "jump-latest",
  "mode-control", "cancel-button", "send-button", "run-state", "run-pulse", "setup-panel", "setup-copy",
  "setup-action", "activity-count", "activity-list",
  "activity-view", "context-view", "context-count", "context-close", "inspector-resizer", "context-open-form", "context-input",
  "preview-mode-button", "preview-count", "changes-mode-button", "surface-changes-count", "commands-mode-button", "commands-count", "surface-changes-view", "surface-change-list", "commands-view", "command-list",
  "context-external-toggle", "context-tabs", "context-back", "context-forward", "context-reload",
  "context-address", "context-include", "context-browser-host", "context-empty",
  "privacy-title", "privacy-copy",
  "model-popover", "model-scrim", "close-models", "model-picker", "close-model-picker", "model-list", "pull-model-input", "pull-model-button", "pull-progress", "manual-pull", "theme-control",
  "active-model-roles", "active-model-status", "engine-status", "engine-detail", "restart-engine",
  "model-provider", "model-selection-mode", "model-optimization-profile", "openai-key-row", "openai-key", "clear-openai-key",
  "refresh-model-catalog", "provider-catalog-status", "provider-role-editor", "provider-model-options", "role-executor", "role-planner", "role-evaluator", "role-vision", "role-embedding", "save-model-settings", "model-settings-status", "model-advisor",
  "recommend-models", "cancel-recommendation", "docker-sandbox-toggle", "docker-sandbox-status", "public-catalog-toggle", "refresh-public-catalog", "public-catalog-status", "advisor-progress",
  "advisor-progress-title", "advisor-progress-detail", "recommendation", "recommendation-machine",
  "recommendation-roles", "recommendation-downloads", "recommendation-installed", "recommendation-installed-roles", "recommendation-installed-downloads", "recommendation-warnings", "recommendation-candidates",
  "recommendation-docker", "recommendation-docker-image", "recommendation-docker-reason", "recommendation-docker-command",
  "recommendation-candidate-list", "recommendation-status", "apply-recommendation", "apply-installed-recommendation", "pull-recommended", "reanalyze-models",
  "approval-modal", "approval-title", "approval-detail", "deny-approval", "allow-approval", "toast"
].map((id) => [id, document.getElementById(id)]));

initialize().catch(showError);

async function initialize() {
  applyUiPreferences();
  appState.snapshot = await window.companion.snapshot();
  render();
  const contextObserver = new ResizeObserver(syncContextBounds);
  contextObserver.observe(el["context-browser-host"]);
  window.addEventListener("resize", syncContextBounds);
  window.companion.onEvent(handleEvent);
  window.companion.onApproval(showApproval);
  window.companion.onPullProgress((progress) => {
    const message = progress.error || `${progress.model} · ${progress.line}`;
    el["pull-progress"].textContent = message;
    if (!el.recommendation.classList.contains("hidden")) {
      setRecommendationNotice(message, progress.error ? "error" : progress.done ? "success" : "active");
    }
  });
}

function handleEvent(event) {
  let conversationEffect = null;
  if (event.type === "run-state") {
    appState.snapshot.runState = event.state;
    appState.snapshot.running = Boolean(event.state && !["completed", "failed", "cancelled"].includes(event.state));
  }
  if (event.type === "snapshot") appState.snapshot = event.snapshot;
  if (event.type === "context-snapshot") appState.snapshot.context = event.snapshot;
  if (event.type === "context-focus") {
    appState.inspectorMode = "preview";
    appState.inspectorOpen = true;
  }
  if (event.type === "run-start") {
    appState.activities = [];
    appState.changes = [];
    appState.selectedOutputs = null;
    appState.snapshot.running = true;
    appState.inspectorMode = "activity";
    appState.inspectorOpen = true;
    const thread = appState.snapshot.threads.find((candidate) => candidate.id === event.threadId);
    if (thread && !thread.messages.some((message) => message.id === event.message.id)) {
      thread.messages.push(event.message);
      thread.updatedAt = Date.now();
      if (thread.messages.filter((message) => message.role === "user").length === 1) {
        thread.title = event.message.text.replace(/\s+/g, " ").trim().slice(0, 48) || "Nova conversa";
      }
    }
    appState.draftMessages.set(event.threadId, { id: event.assistantMessageId, role: "assistant", text: "", status: "streaming", createdAt: Date.now(), executionSteps: [] });
    conversationEffect = { type: "anchor-request", messageId: event.message.id };
  }
  if (event.type === "assistant-delta") {
    const draft = appState.draftMessages.get(event.threadId) || { id: event.messageId, role: "assistant", text: "", status: "streaming", createdAt: Date.now(), executionSteps: [] };
    draft.id = event.messageId;
    draft.text += event.delta;
    appState.draftMessages.set(event.threadId, draft);
    conversationEffect = { type: "stream", messageId: event.messageId };
  }
  if (event.type === "assistant-step") {
    const draft = appState.draftMessages.get(event.threadId);
    if (draft) {
      draft.executionSteps ||= [];
      const existing = draft.executionSteps.findIndex((step) => step.id === event.step.id);
      if (existing >= 0) draft.executionSteps.splice(existing, 1, event.step);
      else draft.executionSteps.push(event.step);
    }
  }
  if (event.type === "assistant-reset") {
    const draft = appState.draftMessages.get(event.threadId);
    if (draft) {
      const text = stripProtocolMarkers(draft.text).trim();
      draft.executionSteps ||= [];
      if (text && draft.executionSteps.at(-1)?.text !== text) {
        draft.executionSteps.push({ id: crypto.randomUUID(), text, createdAt: Date.now() });
      }
      draft.text = "";
    }
  }
  if (event.type === "assistant-complete") {
    appState.draftMessages.delete(event.threadId);
    appState.changes = event.changes;
    const thread = appState.snapshot.threads.find((candidate) => candidate.id === event.threadId);
    if (thread) {
      const existing = thread.messages.findIndex((message) => message.id === event.message.id);
      if (existing >= 0) thread.messages[existing] = event.message;
      else thread.messages.push(event.message);
    }
    conversationEffect = { type: "complete", messageId: event.message.id };
  }
  if (event.type === "activity") {
    const existing = appState.activities.findIndex((activity) => activity.id === event.activity.id);
    if (existing >= 0) appState.activities.splice(existing, 1, { ...appState.activities[existing], ...event.activity });
    else appState.activities.unshift(event.activity);
    appState.activities = appState.activities.slice(0, 40);
  }
  if (event.type === "run-error") {
    appState.draftMessages.delete(event.threadId);
    showError(event.message);
  }
  if (event.type === "run-done") {
    appState.snapshot.running = false;
    readerAnchorLocked = false;
  }
  render(conversationEffect);
}

function render(conversationEffect = null) {
  const snapshot = appState.snapshot;
  if (!snapshot) return;
  const active = snapshot.threads.find((thread) => thread.id === snapshot.activeThreadId) || snapshot.threads[0];
  const shell = document.querySelector(".app-shell");
  shell.classList.toggle("inspector-open", appState.inspectorOpen);
  shell.classList.toggle("sidebar-collapsed", appState.sidebarCollapsed);
  el["workspace-label"].textContent = snapshot.workspacePath ? basename(snapshot.workspacePath) : "Escolher projeto";
  el["workspace-label"].title = snapshot.workspacePath || "";
  el["ollama-dot"].classList.toggle("online", snapshot.ollama.connected);
  el["ollama-label"].textContent = snapshot.ollama.connected
    ? `Ollama ${snapshot.ollama.version || "conectado"}`
    : "Ollama desconectado";
  el["model-label"].textContent = `${snapshot.modelProvider === "openai" ? "OpenAI" : "Ollama"} · ${snapshot.modelRoles?.executor || "Escolher modelo"}`;
  el["runtime-label"].textContent = snapshot.agentRuntime === "deep" ? "Deep Agent" : "Agente padrão";
  el["thread-title"].textContent = active?.title || "Nova conversa";
  renderThreadList(snapshot.threads, active?.id);
  renderConversation(active, conversationEffect);
  renderModels();
  renderRecommendation();
  renderInspector();
  renderContext();
  document.querySelectorAll("[data-mode]").forEach((button) => button.classList.toggle("active", button.dataset.mode === snapshot.mode));
  document.querySelectorAll("[data-runtime]").forEach((button) => button.classList.toggle("active", button.dataset.runtime === snapshot.agentRuntime));
  el["cancel-button"].classList.toggle("hidden", !snapshot.running);
  el["send-button"].disabled = snapshot.running || Boolean(snapshot.workspaceRun?.busy);
  const activeContext = snapshot.context?.tabs.find((tab) => tab.id === snapshot.context.activeTabId);
  const inspectorTitles = {
    activity: ({
      running: "Agente trabalhando", cancelling: "Encerrando a execução…",
      awaiting_approval: "Aguardando sua aprovação", awaiting_host: "Aguardando o aplicativo",
      awaiting_credentials: "Aguardando credenciais", awaiting_reconciliation: "Aguardando verificação do resultado",
    })[snapshot.runState] || (snapshot.running ? "Agente trabalhando" : snapshot.workspaceRun?.busy ? "Execução preservada em outra conversa" : "Execução"),
    context: activeContext?.title || "Páginas e pesquisa",
    preview: activeContext?.title || "Preview local",
    changes: `${appState.selectedOutputs?.changeCount ?? appState.changes.length} arquivo${(appState.selectedOutputs?.changeCount ?? appState.changes.length) === 1 ? "" : "s"}`,
    commands: "Auditoria de comandos"
  };
  el["run-state"].textContent = inspectorTitles[appState.inspectorMode] || "Bancada";
  el["run-pulse"].classList.toggle("active", (snapshot.running && (!snapshot.runState || snapshot.runState === "running")) || (["context", "preview"].includes(appState.inspectorMode) && activeContext?.status === "loading"));
}

function renderThreadList(threads, activeThreadId) {
  const query = appState.threadQuery.trim().toLocaleLowerCase("pt-BR");
  const filtered = threads.filter((thread) => !query || thread.title.toLocaleLowerCase("pt-BR").includes(query));
  const groups = [
    ["FIXADAS", filtered.filter((thread) => thread.pinned)],
    [appState.snapshot.workspacePath ? basename(appState.snapshot.workspacePath).toLocaleUpperCase("pt-BR") : "CONVERSAS", filtered.filter((thread) => !thread.pinned)]
  ];
  const nodes = groups.flatMap(([label, values]) => {
    if (!values.length) return [];
    const heading = document.createElement("p");
    heading.className = "thread-group-label";
    heading.textContent = label;
    return [heading, ...values.map((thread) => threadButton(thread, activeThreadId))];
  });
  if (!nodes.length) nodes.push(paragraph(query ? "Nenhuma conversa encontrada." : "Nenhuma conversa.", "thread-empty"));
  el["thread-list"].replaceChildren(...nodes);
}

function threadButton(thread, activeThreadId) {
  const row = document.createElement("div");
  row.className = `thread-row${thread.id === activeThreadId ? " active" : ""}`;
  const button = document.createElement("button");
  button.className = "thread-item";
  button.textContent = thread.title;
  const small = document.createElement("small");
  small.textContent = relativeTime(thread.updatedAt);
  button.append(small);
  button.addEventListener("click", async () => {
      appState.selectedOutputs = null;
    appState.snapshot = await window.companion.selectThread(thread.id);
    render({ type: "reset" });
  });
  const pin = document.createElement("button");
  pin.className = "thread-pin";
  pin.textContent = thread.pinned ? "◆" : "◇";
  pin.title = thread.pinned ? "Desafixar conversa" : "Fixar conversa";
  pin.setAttribute("aria-label", pin.title);
  pin.addEventListener("click", async () => {
    appState.snapshot = await window.companion.toggleThreadPin(thread.id);
    render();
  });
  row.append(button, pin);
  return row;
}

function renderConversation(thread, effect) {
  const messages = [...(thread?.messages || [])];
  const draft = thread ? appState.draftMessages.get(thread.id) : null;
  if (draft) messages.push(draft);
  el.welcome.classList.toggle("hidden", messages.length > 0);
  const existing = new Map([...el.conversation.querySelectorAll(".message")].map((node) => [node.dataset.messageId, node]));
  const existingStepGroups = new Map([...el.conversation.querySelectorAll(".run-steps")].map((node) => [node.dataset.messageId, node]));
  const existingOutputGroups = new Map([...el.conversation.querySelectorAll(".message-outputs")].map((node) => [node.dataset.messageId, node]));
  const desiredIds = new Set(messages.map((message) => message.id));
  for (const [id, node] of existing) if (!desiredIds.has(id)) node.remove();
  for (const [id, node] of existingStepGroups) if (!desiredIds.has(id)) node.remove();
  for (const [id, node] of existingOutputGroups) if (!desiredIds.has(id)) node.remove();
  let position = el.welcome.nextSibling;
  for (const message of messages) {
    const steps = message.role === "assistant" && Array.isArray(message.executionSteps) ? message.executionSteps : [];
    let stepGroup = existingStepGroups.get(message.id);
    if (steps.length) {
      if (!stepGroup) stepGroup = createExecutionStepsElement(message.id);
      updateExecutionStepsElement(stepGroup, steps, message.status === "streaming");
      if (stepGroup !== position) el.conversation.insertBefore(stepGroup, position);
      position = stepGroup.nextSibling;
    } else {
      stepGroup?.remove();
    }
    let article = existing.get(message.id);
    if (!article) article = createMessageElement(message);
    updateMessageElement(article, message);
    if (article !== position) el.conversation.insertBefore(article, position);
    position = article.nextSibling;
    let outputs = existingOutputGroups.get(message.id);
    if (message.role === "assistant" && message.outputs && outputDescriptors(message.outputs).length) {
      if (!outputs) outputs = createMessageOutputsElement(message.id);
      updateMessageOutputsElement(outputs, message.outputs);
      if (outputs !== position) el.conversation.insertBefore(outputs, position);
      position = outputs.nextSibling;
    } else {
      outputs?.remove();
    }
  }
  applyConversationEffect(effect);
}

function outputDescriptors(outputs) {
  return [
    ...(outputs.previewUrls?.length ? [{ mode: "preview", icon: "▣", label: `${outputs.previewUrls.length} preview${outputs.previewUrls.length === 1 ? "" : "s"}`, url: outputs.previewUrls[0] }] : []),
    ...(outputs.changeCount ? [{ mode: "changes", icon: "±", label: `${outputs.changeCount} arquivo${outputs.changeCount === 1 ? "" : "s"}` }] : []),
    ...(outputs.activityCount ? [{ mode: "activity", icon: "↳", label: `${outputs.activityCount} ações` }] : []),
    ...(outputs.commandCount ? [{ mode: "commands", icon: ">_", label: `${outputs.commandCount} comando${outputs.commandCount === 1 ? "" : "s"}` }] : []),
    ...(outputs.contextCount ? [{ mode: "context", icon: "◎", label: `${outputs.contextCount} contexto${outputs.contextCount === 1 ? "" : "s"}` }] : [])
  ];
}

function createMessageOutputsElement(messageId) {
  const nav = document.createElement("nav");
  nav.className = "message-outputs";
  nav.dataset.messageId = messageId;
  nav.setAttribute("aria-label", "Resultados desta execução");
  return nav;
}

function updateMessageOutputsElement(nav, outputs) {
  const signature = JSON.stringify(outputs);
  if (nav.dataset.signature === signature) return;
  nav.dataset.signature = signature;
  nav.replaceChildren(...outputDescriptors(outputs).map((descriptor) => {
    const button = document.createElement("button");
    const icon = document.createElement("span");
    icon.textContent = descriptor.icon;
    const label = document.createElement("strong");
    label.textContent = descriptor.label;
    button.append(icon, label);
    button.addEventListener("click", () => void openInspectorSurface(descriptor.mode, descriptor.url, outputs));
    return button;
  }));
}

function createExecutionStepsElement(messageId) {
  const details = document.createElement("details");
  details.className = "run-steps";
  details.dataset.messageId = messageId;
  const summary = document.createElement("summary");
  const label = document.createElement("span");
  label.className = "run-steps-label";
  const count = document.createElement("small");
  count.className = "run-steps-count";
  summary.append(label, count);
  const list = document.createElement("div");
  list.className = "run-steps-list";
  details.append(summary, list);
  return details;
}

function updateExecutionStepsElement(details, steps, streaming) {
  details.classList.toggle("live", streaming);
  const label = details.querySelector(".run-steps-label");
  const count = details.querySelector(".run-steps-count");
  label.textContent = streaming ? "Etapas da execução · em andamento" : "Etapas da execução";
  count.textContent = `${steps.length} ${steps.length === 1 ? "etapa" : "etapas"}`;
  const signature = steps.map((step) => `${step.id}:${step.text.length}`).join("|");
  if (details.dataset.signature === signature) return;
  details.dataset.signature = signature;
  const list = details.querySelector(".run-steps-list");
  list.replaceChildren(...steps.map((step, index) => {
    const item = document.createElement("section");
    item.className = "run-step";
    const meta = document.createElement("div");
    meta.className = "run-step-meta";
    const title = document.createElement("strong");
    title.textContent = `Etapa ${index + 1}`;
    const time = document.createElement("time");
    time.dateTime = new Date(step.createdAt).toISOString();
    time.textContent = new Date(step.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    meta.append(title, time);
    const content = document.createElement("p");
    content.textContent = stripProtocolMarkers(step.text);
    item.append(meta, content);
    return item;
  }));
}

function createMessageElement(message) {
  const article = document.createElement("article");
  article.dataset.messageId = message.id;
  const label = document.createElement("div");
  label.className = "message-label";
  const content = document.createElement("div");
  content.className = "message-content";
  article.append(label, content);
  return article;
}

function updateMessageElement(article, message) {
  article.className = `message ${message.role}${message.status === "streaming" ? " streaming" : ""}${message.status === "failed" ? " failed" : ""}`;
  const label = article.querySelector(".message-label");
  const content = article.querySelector(".message-content");
  const nextLabel = message.role === "user" ? "VOCÊ" : message.status === "streaming" ? "COMPANION · RESPONDENDO" : "COMPANION";
  const nextText = (message.role === "assistant" ? stripProtocolMarkers(message.text) : message.text) || (message.status === "streaming" ? "Pensando…" : "");
  if (label.textContent !== nextLabel) label.textContent = nextLabel;
  if (content.textContent !== nextText) content.textContent = nextText;
}

function conversationIsNearBottom() {
  return el.conversation.scrollHeight - el.conversation.scrollTop - el.conversation.clientHeight <= SCROLL_STICK_THRESHOLD;
}

function renderJumpLatest() {
  const visible = !conversationPinnedToBottom && unseenConversationUpdates > 0;
  el["jump-latest"].classList.toggle("hidden", !visible);
  if (visible) el["jump-latest"].textContent = unseenConversationUpdates === 1 ? "1 nova atualização ↓" : `${unseenConversationUpdates} novas atualizações ↓`;
}

function resetConversationScroll() {
  conversationPinnedToBottom = true;
  readerAnchorLocked = false;
  unseenConversationUpdates = 0;
  countedUnseenMessages.clear();
  renderJumpLatest();
}

function scrollConversationToBottom() {
  requestAnimationFrame(() => {
    el.conversation.scrollTop = el.conversation.scrollHeight;
    resetConversationScroll();
  });
}

function applyConversationEffect(effect) {
  if (!effect) return;
  if (effect.type === "reset") {
    scrollConversationToBottom();
    return;
  }
  if (effect.type === "anchor-request") {
    requestAnimationFrame(() => {
      const request = el.conversation.querySelector(`[data-message-id="${CSS.escape(effect.messageId)}"]`);
      if (request) el.conversation.scrollTop = Math.max(0, request.offsetTop - 20);
      conversationPinnedToBottom = false;
      readerAnchorLocked = true;
      unseenConversationUpdates = 0;
      countedUnseenMessages.clear();
      renderJumpLatest();
    });
    return;
  }
  if (effect.type === "stream") {
    if (conversationPinnedToBottom && !readerAnchorLocked) {
      requestAnimationFrame(() => { el.conversation.scrollTop = el.conversation.scrollHeight; });
    } else if (!countedUnseenMessages.has(effect.messageId)) {
      countedUnseenMessages.add(effect.messageId);
      unseenConversationUpdates += 1;
      renderJumpLatest();
    }
  }
}

function renderModels() {
  const snapshot = appState.snapshot;
  const hosted = snapshot.modelProvider === "openai";
  const models = hosted
    ? (snapshot.providerCatalog?.models || []).map((name) => ({ name, size: 0 }))
    : snapshot.ollama.models;
  el["manual-pull"].classList.toggle("hidden", hosted);
  el["model-list"].replaceChildren(...(models.length ? models.map((model) => {
    const button = document.createElement("button");
    button.className = `model-option${model.name === appState.snapshot.modelRoles?.executor ? " active" : ""}`;
    const text = document.createElement("span");
    text.textContent = model.name;
    const size = document.createElement("small");
    size.textContent = hosted ? "servidor" : formatBytes(model.size);
    button.append(text, size);
    button.addEventListener("click", async () => {
      appState.snapshot = await window.companion.setModel(model.name);
      setModelPickerOpen(false);
      render();
    });
    return button;
  }) : [paragraph(hosted ? "Atualize o catálogo para ver os modelos disponíveis." : "Nenhum modelo instalado.", "empty-copy")]));
}

function renderInspector() {
  const snapshot = appState.snapshot;
  const selected = appState.selectedOutputs;
  const activities = selected
    ? (selected.activities || []).map((activity, index) => ({ ...activity, id: `saved-${index}` }))
    : appState.activities;
  const changes = selected ? (selected.changes || []) : appState.changes;
  const commands = selected
    ? (selected.commands || [])
    : activities.filter((activity) => activity.kind === "command");
  const hasWorkspace = Boolean(snapshot.workspacePath);
  const providerReady = snapshot.modelProvider === "openai"
    ? snapshot.openAiKeyStored && Boolean(snapshot.modelRoles?.executor)
    : snapshot.ollama.connected && snapshot.ollama.models.some((model) => model.name === snapshot.modelRoles?.executor);
  el["setup-panel"].classList.toggle("hidden", hasWorkspace && providerReady);
  if (snapshot.modelProvider === "openai" && !snapshot.openAiKeyStored) {
    el["setup-copy"].textContent = "Salve a chave OpenAI no Keychain para usar o provedor hospedado.";
    el["setup-action"].textContent = "Configurar provedor";
  } else if (snapshot.modelProvider === "ollama" && !snapshot.ollama.connected) {
    el["setup-copy"].textContent = "Inicie o Ollama neste Mac. O Companion acessa apenas o endpoint local 127.0.0.1.";
    el["setup-action"].textContent = "Verificar novamente";
  } else if (!hasWorkspace) {
    el["setup-copy"].textContent = "Escolha a pasta do projeto que o agente poderá ler e alterar.";
    el["setup-action"].textContent = "Escolher workspace";
  } else if (snapshot.modelProvider === "ollama") {
    el["setup-copy"].textContent = `O modelo ${snapshot.modelRoles?.executor} ainda não está instalado localmente.`;
    el["setup-action"].textContent = "Baixar modelo recomendado";
  } else {
    el["setup-copy"].textContent = "Escolha um modelo executor para continuar.";
    el["setup-action"].textContent = "Configurar provedor";
  }
  const activityCount = selected?.activityCount ?? activities.length;
  el["activity-count"].textContent = `${activityCount} evento${activityCount === 1 ? "" : "s"}`;
  el["activity-list"].replaceChildren(...(activities.length ? activities.map((activity) => {
    const item = document.createElement("div");
    item.className = `activity-item ${activity.status}`;
    item.dataset.kind = activity.kind;
    const icon = document.createElement("span");
    icon.className = "activity-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = activityIcon(activity.kind);
    const body = document.createElement("div");
    body.className = "activity-body";
    const heading = document.createElement("div");
    heading.className = "activity-title";
    const title = document.createElement("strong");
    title.textContent = activity.title;
    const status = document.createElement("small");
    status.textContent = activity.status === "active" ? "em andamento" : activity.status === "failed" ? "falhou" : "concluído";
    heading.append(title, status);
    body.append(heading);
    if (activity.detail) body.append(paragraph(activity.detail));
    item.append(icon, body);
    return item;
  }) : [paragraph("A leitura de arquivos, buscas, alterações e comandos aparecerão aqui.", "empty-copy")]));
  const localPreviews = selected?.previewUrls || snapshot.context?.tabs.filter((tab) => tab.kind === "local" && tab.status === "ready").map((tab) => tab.url) || [];
  const changeCount = selected?.changeCount ?? changes.length;
  const commandCount = selected?.commandCount ?? commands.length;
  el["preview-mode-button"].classList.toggle("hidden", !localPreviews.length);
  el["preview-count"].textContent = String(localPreviews.length);
  el["changes-mode-button"].classList.toggle("hidden", !changeCount);
  el["surface-changes-count"].textContent = String(changeCount);
  el["commands-mode-button"].classList.toggle("hidden", !commandCount);
  el["commands-count"].textContent = String(commandCount);
  el["surface-change-list"].replaceChildren(...(changes.length ? changes.map((change) => {
    const item = document.createElement("div");
    item.className = "surface-row change-surface-row";
    const mark = document.createElement("i");
    mark.textContent = change.kind === "created" ? "+" : change.kind === "deleted" ? "−" : "~";
    const body = document.createElement("span");
    const title = document.createElement("strong");
    title.textContent = change.path;
    const meta = document.createElement("small");
    meta.textContent = ({ created: "Criado", modified: "Modificado", deleted: "Excluído" })[change.kind];
    body.append(title, meta);
    item.append(mark, body);
    return item;
  }) : [paragraph(changeCount ? "O resumo foi preservado, mas esta execução antiga não possui detalhes por arquivo." : "Nenhuma alteração observada nesta execução.", "surface-empty")]));
  el["command-list"].replaceChildren(...(commands.length ? commands.map((activity) => {
    const item = document.createElement("div");
    item.className = `surface-row command-surface-row ${activity.status}`;
    const mark = document.createElement("i");
    mark.textContent = ">_";
    const body = document.createElement("span");
    const title = document.createElement("strong");
    title.textContent = activity.title;
    const meta = document.createElement("small");
    meta.textContent = [activity.detail, activity.status === "failed" ? "Falhou" : activity.status === "active" ? "Em andamento" : "Concluído"].filter(Boolean).join(" · ");
    body.append(title, meta);
    item.append(mark, body);
    return item;
  }) : [paragraph(commandCount ? "O resumo foi preservado, mas esta execução antiga não possui detalhes dos comandos." : "Nenhum comando foi executado.", "surface-empty")]));
}

function renderRecommendation() {
  const snapshot = appState.snapshot;
  renderModelSettings(snapshot);
  const blockerCount = Object.values(snapshot.engine.blockers || {}).reduce((sum, value) => sum + Number(value || 0), 0);
  el["engine-status"].textContent = `Motor ${snapshot.engine.version} · ${snapshot.engine.state === "ready" ? "pronto" : "ocupado"}`;
  el["engine-detail"].textContent = blockerCount ? `${blockerCount} recurso(s) em uso` : "Serviço compartilhado ativo";
  el["restart-engine"].disabled = Boolean(snapshot.running);
  const plan = snapshot.lastRecommendation;
  const activeLabels = { executor: "Executor", planner: "Planner", evaluator: "Evaluator", vision: "Vision", embedding: "Embedding" };
  el["active-model-roles"].replaceChildren(...Object.entries(snapshot.modelRoles || {}).map(([role, model]) => {
    const row = document.createElement("div");
    const label = document.createElement("span");
    const value = document.createElement("strong");
    label.textContent = activeLabels[role] || role;
    value.textContent = model;
    row.append(label, value);
    return row;
  }));
  el["active-model-status"].textContent = snapshot.modelRoleNotices?.length
    ? snapshot.modelRoleNotices.join(" ")
    : "Somente modelos instalados entram na configuração ativa.";
  el["docker-sandbox-toggle"].checked = Boolean(snapshot.dockerSandboxEnabled);
  el["docker-sandbox-status"].textContent = snapshot.dockerSandboxEnabled
    ? "Ativo: comandos usam somente Docker; não existe fallback nativo."
    : "Desativado: análise e edição continuam disponíveis, sem execução de comandos.";
  el["public-catalog-toggle"].checked = Boolean(snapshot.ollamaPublicCatalogEnabled);
  el["refresh-public-catalog"].classList.toggle("hidden", !snapshot.ollamaPublicCatalogEnabled);
  el["public-catalog-status"].textContent = !snapshot.ollamaPublicCatalogEnabled
    ? "Somente catálogo incorporado e modelos instalados."
    : snapshot.ollamaPublicCatalogLoaded
      ? "Catálogo público carregado nesta sessão."
      : "Será carregado ao analisar; use Atualizar para forçar um novo GET."
  el.recommendation.classList.toggle("hidden", !plan);
  if (!plan) return;
  el["recommendation-machine"].textContent = `${plan.machineSummary} · ${plan.source === "advisor" ? `análise por ${plan.advisorModel}` : "estimativa inicial"}`;
  const labels = { executor: "Executor", planner: "Planner", evaluator: "Evaluator", vision: "Vision", embedding: "Embedding" };
  const roleRows = (roles, rationaleByRole, attribute) => Object.entries(roles || {}).map(([role, model]) => {
    const row = document.createElement("div");
    row.className = "recommendation-role";
    const label = document.createElement("strong");
    label.textContent = labels[role] || role;
    const value = document.createElement("input");
    value.value = model;
    value.dataset[attribute] = role;
    value.setAttribute("aria-label", `${labels[role] || role} model`);
    const reason = document.createElement("small");
    reason.textContent = rationaleByRole?.[role] || "Seleção compatível com o perfil detectado.";
    row.append(label, value, reason);
    return row;
  });
  el["recommendation-roles"].replaceChildren(...roleRows(plan.roles, plan.rationaleByRole, "roleModel"));
  el["recommendation-downloads"].textContent = plan.requiredPulls.length
    ? `${plan.requiredPulls.length} ausente(s) · ${formatBytes(plan.downloadBytes)} de download estimado`
    : "Todos os modelos recomendados já estão instalados.";
  const installedAlternative = plan.installedAlternative;
  el["recommendation-installed"].classList.toggle("hidden", !installedAlternative);
  el["apply-installed-recommendation"].classList.toggle("hidden", !installedAlternative);
  if (installedAlternative) {
    el["recommendation-installed-roles"].replaceChildren(...roleRows(installedAlternative.roles, installedAlternative.rationaleByRole, "installedRoleModel"));
    el["recommendation-installed-downloads"].textContent = "Sem downloads adicionais · pronta para aplicar.";
  }
  el["recommendation-docker"].classList.toggle("hidden", !plan.docker);
  if (plan.docker) {
    el["recommendation-docker-image"].textContent = `${plan.docker.image} · ${plan.docker.installed ? "instalada" : "ausente"}`;
    el["recommendation-docker-reason"].textContent = `${plan.docker.rationale} Limite adaptativo: ${plan.docker.memoryLimitGb} GB RAM e ${plan.docker.cpuLimit} CPU. Gateway loopback: ${plan.docker.proxyImage} (${plan.docker.proxyInstalled ? "instalado" : "ausente"}).`;
    const commands = [
      ...(plan.docker.installed ? [] : [plan.docker.pullCommand]),
      ...(plan.docker.proxyInstalled ? [] : [plan.docker.proxyPullCommand])
    ];
    el["recommendation-docker-command"].textContent = commands.length ? commands.join(" · ") : "Pronta para execução";
  }
  el["recommendation-warnings"].replaceChildren(...(plan.warnings || []).map((warning) => {
    const item = document.createElement("li"); item.textContent = warning; return item;
  }));
  const considered = Object.entries(plan.consideredCandidates || {}).filter(([, aliases]) => Array.isArray(aliases) && aliases.length);
  el["recommendation-candidates"].classList.toggle("hidden", !considered.length);
  el["recommendation-candidate-list"].replaceChildren(...considered.map(([role, aliases]) => {
    const row = document.createElement("div");
    row.className = "recommendation-candidate-row";
    const label = document.createElement("strong");
    label.textContent = labels[role] || role;
    const values = document.createElement("span");
    values.textContent = aliases.join(" · ");
    row.append(label, values);
    return row;
  }));
  el["pull-recommended"].disabled = !plan.requiredPulls.length;
  el["apply-recommendation"].disabled = Boolean(plan.requiredPulls.length);
  if (appState.recommendationNotice) {
    setRecommendationNotice(appState.recommendationNotice.text, appState.recommendationNotice.kind);
  } else {
    const nextStep = plan.requiredPulls.length
      ? `A configuração ideal está pendente. Baixe ${plan.requiredPulls.length} modelo(s) antes de aplicá-la; a configuração ativa permanece pronta para uso.`
      : "Aplicar escolhe os papéis imediatamente; nenhum download adicional é necessário.";
    setRecommendationNotice(nextStep, "neutral", false);
  }
}

function renderModelSettings(snapshot) {
  el["model-provider"].value = snapshot.modelProvider || "ollama";
  el["model-selection-mode"].value = snapshot.modelSelectionMode || "custom";
  el["model-optimization-profile"].value = snapshot.modelOptimizationProfile || "balanced";
  const hosted = snapshot.modelProvider === "openai";
  const custom = snapshot.modelSelectionMode === "custom";
  el["openai-key-row"].classList.toggle("hidden", !hosted);
  el["clear-openai-key"].disabled = !snapshot.openAiKeyStored;
  el["clear-openai-key"].textContent = snapshot.openAiKeyStored ? "Remover" : "Não salva";
  el["provider-role-editor"].classList.toggle("read-only", !custom);
  for (const role of ["executor", "planner", "evaluator", "vision", "embedding"]) {
    const input = el[`role-${role}`];
    if (document.activeElement !== input) input.value = snapshot.modelRoles?.[role] || "";
    input.readOnly = !custom;
  }
  const catalog = snapshot.providerCatalog?.provider === snapshot.modelProvider ? snapshot.providerCatalog.models : [];
  el["provider-model-options"].replaceChildren(...catalog.map((model) => {
    const option = document.createElement("option"); option.value = model; return option;
  }));
  const loaded = snapshot.providerCatalog?.loadedAt
    ? new Date(snapshot.providerCatalog.loadedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
  el["provider-catalog-status"].textContent = hosted
    ? `${snapshot.openAiKeyStored ? "Chave protegida no Keychain" : "Chave ainda não configurada"}${catalog.length ? ` · ${catalog.length} modelos do servidor · ${loaded}` : " · atualize para consultar o servidor"}`
    : `${snapshot.ollama.connected ? `${catalog.length} modelos instalados` : "Ollama desconectado"}${loaded ? ` · ${loaded}` : ""}`;
  el["refresh-button"].classList.toggle("hidden", hosted);
  el["model-advisor"].classList.toggle("hidden", hosted);
}

function setRecommendationNotice(text, kind = "neutral", remember = true) {
  if (remember) appState.recommendationNotice = { text, kind };
  el["recommendation-status"].textContent = text;
  el["recommendation-status"].className = `recommendation-status ${kind === "neutral" ? "" : kind}`.trim();
}

function setRecommendationBusy(busy, title = "Analisando máquina e modelos…") {
  appState.recommendationBusy = busy;
  el["model-popover"].classList.toggle("is-recommending", busy);
  el["model-popover"].setAttribute("aria-busy", String(busy));
  el["advisor-progress"].classList.toggle("hidden", !busy);
  el["advisor-progress-title"].textContent = title;
  el["cancel-recommendation"].classList.toggle("hidden", !busy);
  el["recommend-models"].textContent = busy ? "Analisando…" : "Analisar";
  for (const control of ["recommend-models", "reanalyze-models", "refresh-public-catalog", "public-catalog-toggle", "docker-sandbox-toggle", "apply-recommendation", "apply-installed-recommendation", "pull-recommended", "close-models"]) {
    el[control].disabled = busy;
  }
  if (!busy && appState.snapshot?.lastRecommendation) {
    el["pull-recommended"].disabled = !appState.snapshot.lastRecommendation.requiredPulls.length;
    el["apply-recommendation"].disabled = Boolean(appState.snapshot.lastRecommendation.requiredPulls.length);
  }
}

async function runRecommendation(title = "Analisando máquina e modelos…", action = () => window.companion.recommendModels()) {
  if (appState.recommendationBusy) return;
  appState.recommendationNotice = null;
  setRecommendationBusy(true, title);
  try {
    appState.snapshot = await action();
    render();
  } catch (error) {
    showError(error?.message || String(error));
  } finally {
    setRecommendationBusy(false);
  }
}

async function applyRoleConfiguration(roles, label) {
  for (const control of ["apply-recommendation", "apply-installed-recommendation", "pull-recommended", "reanalyze-models"]) el[control].disabled = true;
  setRecommendationNotice(`Aplicando ${label.toLowerCase()}…`, "active");
  try {
    appState.snapshot = await window.companion.applyRecommendation(roles);
    setRecommendationNotice(`${label} aplicada e pronta para uso.`, "success");
    render();
  } catch (error) {
    setRecommendationNotice(error?.message || String(error), "error");
    showError(error);
  } finally {
    el["apply-recommendation"].disabled = Boolean(appState.snapshot?.lastRecommendation?.requiredPulls?.length);
    el["apply-installed-recommendation"].disabled = false;
    el["reanalyze-models"].disabled = false;
    el["pull-recommended"].disabled = !appState.snapshot?.lastRecommendation?.requiredPulls?.length;
  }
}

function renderContext() {
  const context = appState.snapshot.context || { externalAccess: false, tabs: [] };
  const active = context.tabs.find((tab) => tab.id === context.activeTabId);
  const browserVisible = appState.inspectorOpen && ["context", "preview"].includes(appState.inspectorMode);
  const shell = document.querySelector(".app-shell");
  shell.classList.toggle("context-mode", browserVisible);
  shell.classList.toggle("surface-wide", browserVisible);
  document.querySelector(".inspector").classList.toggle("preview-mode", appState.inspectorMode === "preview");
  document.querySelectorAll("[data-inspector-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.inspectorMode === appState.inspectorMode);
  });
  el["activity-view"].classList.toggle("hidden", appState.inspectorMode !== "activity");
  el["context-view"].classList.toggle("hidden", !browserVisible);
  el["surface-changes-view"].classList.toggle("hidden", appState.inspectorMode !== "changes");
  el["commands-view"].classList.toggle("hidden", appState.inspectorMode !== "commands");
  el["context-button"].classList.toggle("active", appState.inspectorOpen);
  el["privacy-title"].textContent = browserVisible ? (appState.inspectorMode === "preview" ? "Preview isolado" : "Contexto sob controle") : "Local por padrão";
  el["privacy-copy"].textContent = browserVisible ? (appState.inspectorMode === "preview" ? "A aplicação permanece no loopback deste Mac." : "Só abas marcadas entram no próximo pedido.") : "Projeto e conversas permanecem neste Mac.";
  el["context-count"].textContent = String(context.tabs.length);
  el["context-external-toggle"].classList.toggle("active", context.externalAccess);
  el["context-external-toggle"].querySelector("span").textContent = context.externalAccess ? "Internet permitida nesta sessão" : "Internet bloqueada";
  el["context-tabs"].replaceChildren(...context.tabs.map(contextTabButton));
  el["context-empty"].classList.toggle("hidden", Boolean(active));
  el["context-address"].textContent = active ? contextAddress(active.url) : "Nenhuma aba aberta";
  el["context-address"].title = active?.url || "";
  el["context-back"].disabled = !active?.canGoBack;
  el["context-forward"].disabled = !active?.canGoForward;
  el["context-reload"].disabled = !active;
  el["context-include"].disabled = !active || active.status !== "ready";
  el["context-include"].classList.toggle("active", Boolean(active?.included));
  el["context-include"].textContent = active?.included ? "No contexto ✓" : "Usar no agente";
  el["context-include"].title = active?.included
    ? "Esta página será anexada ao próximo pedido"
    : "Anexar o texto visível desta página ao próximo pedido";
  requestAnimationFrame(syncContextBounds);
}

function contextTabButton(tab) {
  const item = document.createElement("div");
  item.className = `context-tab${tab.id === appState.snapshot.context.activeTabId ? " active" : ""}${tab.included ? " included" : ""}`;
  item.setAttribute("role", "presentation");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "context-tab-select";
  button.setAttribute("role", "tab");
  button.setAttribute("aria-selected", String(tab.id === appState.snapshot.context.activeTabId));
  const kind = document.createElement("small");
  kind.textContent = tab.kind === "local" ? "LOCAL" : tab.kind === "search" ? "BUSCA" : "WEB";
  const title = document.createElement("span");
  title.textContent = tab.title;
  const status = document.createElement("i");
  status.className = tab.status;
  status.title = tab.error || tab.status;
  button.append(kind, title, status);
  button.addEventListener("click", () => performContextAction(() => window.companion.selectContextTab(tab.id)));
  const close = document.createElement("button");
  close.type = "button";
  close.className = "context-tab-close";
  close.setAttribute("aria-label", `Fechar ${tab.title}`);
  close.textContent = "×";
  close.addEventListener("click", () => performContextAction(() => window.companion.closeContextTab(tab.id)));
  item.append(button, close);
  return item;
}

function updateContext(snapshot) {
  appState.snapshot.context = snapshot;
  render();
}

async function performContextAction(action) {
  try {
    updateContext(await action());
  } catch (error) {
    showError(error);
  }
}

function setInspectorMode(mode, outputs = null) {
  appState.inspectorMode = mode;
  appState.inspectorOpen = true;
  appState.selectedOutputs = outputs;
  localStorage.setItem("companion.inspectorMode", mode);
  render();
}

async function openInspectorSurface(mode, url, outputs) {
  if (url) {
    const tab = appState.snapshot.context?.tabs.find((candidate) => candidate.url === url);
    appState.snapshot.context = tab
      ? await window.companion.selectContextTab(tab.id)
      : await window.companion.openContext(url);
  }
  setInspectorMode(mode, outputs);
}

function contextAddress(value) {
  try {
    const url = new URL(value);
    return `${url.host}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return value;
  }
}

function syncContextBounds() {
  if (!appState.snapshot) return;
  const active = appState.snapshot.context?.tabs.some((tab) => tab.id === appState.snapshot.context.activeTabId);
  const visible = appState.inspectorOpen
    && ["context", "preview"].includes(appState.inspectorMode)
    && Boolean(active)
    && !el["context-view"].classList.contains("hidden")
    && el["model-popover"].classList.contains("hidden")
    && el["model-picker"].classList.contains("hidden")
    && el["approval-modal"].classList.contains("hidden");
  const rect = el["context-browser-host"].getBoundingClientRect();
  void window.companion.setContextBounds({
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.max(0, Math.round(rect.width)),
    height: Math.max(0, Math.round(rect.height)),
    visible
  });
}

async function send() {
  const text = el.prompt.value.trim();
  if (!text || appState.snapshot.running) return;
  el.prompt.value = "";
  resizePrompt();
  try {
    await window.companion.send({ text, threadId: appState.snapshot.activeThreadId });
  } catch (error) {
    showError(error.message || String(error));
  }
}

function showApproval(request) {
  appState.approval = request;
  el["approval-title"].textContent = request.title;
  el["approval-detail"].textContent = request.detail;
  el["allow-approval"].textContent = request.confirmLabel;
  el["approval-modal"].classList.remove("hidden");
  void syncContextBounds();
}

async function answerApproval(approved) {
  if (!appState.approval) return;
  const { id } = appState.approval;
  appState.approval = null;
  el["approval-modal"].classList.add("hidden");
  void syncContextBounds();
  await window.companion.answerApproval(id, approved);
}

function showError(error) {
  el.toast.textContent = error instanceof Error ? error.message : String(error);
  el.toast.classList.remove("hidden");
  clearTimeout(showError.timer);
  showError.timer = setTimeout(() => el.toast.classList.add("hidden"), 5500);
}

function resizePrompt() {
  el.prompt.style.height = "auto";
  el.prompt.style.height = `${Math.min(el.prompt.scrollHeight, 180)}px`;
}

function applyUiPreferences() {
  const theme = localStorage.getItem("companion.theme") || "system";
  document.documentElement.dataset.theme = theme;
  const savedWidth = Number(localStorage.getItem("companion.inspectorWidth"));
  if (Number.isFinite(savedWidth) && savedWidth >= 310 && savedWidth <= 900) {
    document.documentElement.style.setProperty("--context-inspector", `${Math.round(savedWidth)}px`);
  }
  const savedMode = localStorage.getItem("companion.inspectorMode");
  if (["activity", "context", "preview", "changes", "commands"].includes(savedMode)) appState.inspectorMode = savedMode;
  document.querySelectorAll("[data-theme]").forEach((button) => button.classList.toggle("active", button.dataset.theme === theme));
}

function setTheme(theme) {
  if (!["system", "dark", "light"].includes(theme)) return;
  localStorage.setItem("companion.theme", theme);
  applyUiPreferences();
}

function setSidebarCollapsed(collapsed) {
  appState.sidebarCollapsed = collapsed;
  localStorage.setItem("companion.sidebarCollapsed", String(collapsed));
  render();
}

function setSettingsSheetOpen(open) {
  if (appState.recommendationBusy && !open) return;
  if (open) setModelPickerOpen(false);
  el["model-popover"].classList.toggle("hidden", !open);
  el["model-scrim"].classList.toggle("hidden", !open);
  el["settings-button"].classList.toggle("active", open);
  void syncContextBounds();
}

function setModelPickerOpen(open) {
  if (open && appState.recommendationBusy) return;
  if (open) setSettingsSheetOpen(false);
  el["model-picker"].classList.toggle("hidden", !open);
  el["model-button"].classList.toggle("active", open);
  void syncContextBounds();
}

el["new-thread"].addEventListener("click", async () => { appState.snapshot = await window.companion.newThread(); appState.activities = []; appState.changes = []; appState.selectedOutputs = null; render({ type: "reset" }); });
el["thread-search"].addEventListener("input", () => { appState.threadQuery = el["thread-search"].value; renderThreadList(appState.snapshot.threads, appState.snapshot.activeThreadId); });
el["sidebar-collapse"].addEventListener("click", () => setSidebarCollapsed(true));
el["sidebar-reveal"].addEventListener("click", () => setSidebarCollapsed(false));
el["workspace-button"].addEventListener("click", async () => { appState.snapshot = await window.companion.chooseWorkspace(); render(); });
el["refresh-button"].addEventListener("click", async () => { appState.snapshot = await window.companion.refreshOllama(); render(); });
el["restart-engine"].addEventListener("click", async () => {
  el["restart-engine"].disabled = true;
  try { appState.snapshot = await window.companion.restartEngine(); render(); }
  catch (error) { showError(error); }
  finally { el["restart-engine"].disabled = Boolean(appState.snapshot?.running); }
});
el["refresh-model-catalog"].addEventListener("click", async () => {
  el["model-settings-status"].textContent = "Atualizando catálogo…";
  try {
    appState.snapshot = await window.companion.refreshModelCatalog();
    render();
    el["model-settings-status"].textContent = "Catálogo atualizado.";
  } catch (error) {
    el["model-settings-status"].textContent = error?.message || String(error);
    showError(error);
  }
});
el["model-provider"].addEventListener("change", () => {
  el["openai-key-row"].classList.toggle("hidden", el["model-provider"].value !== "openai");
});
el["model-selection-mode"].addEventListener("change", () => {
  const custom = el["model-selection-mode"].value === "custom";
  el["provider-role-editor"].classList.toggle("read-only", !custom);
  el["provider-role-editor"].querySelectorAll("input").forEach((input) => { input.readOnly = !custom; });
});
el["save-model-settings"].addEventListener("click", async () => {
  const button = el["save-model-settings"];
  button.disabled = true;
  el["model-settings-status"].textContent = "Salvando…";
  try {
    const roles = Object.fromEntries(["executor", "planner", "evaluator", "vision", "embedding"]
      .map((role) => [role, el[`role-${role}`].value.trim()]).filter(([, value]) => value));
    appState.snapshot = await window.companion.saveModelSettings({
      provider: el["model-provider"].value,
      selectionMode: el["model-selection-mode"].value,
      optimizationProfile: el["model-optimization-profile"].value,
      roles,
      ...(el["openai-key"].value.trim() ? { openAiKey: el["openai-key"].value.trim() } : {})
    });
    el["openai-key"].value = "";
    render();
    el["model-settings-status"].textContent = "Configuração ativa e compartilhável.";
  } catch (error) {
    el["model-settings-status"].textContent = error?.message || String(error);
    showError(error);
  } finally {
    button.disabled = false;
  }
});
el["clear-openai-key"].addEventListener("click", async () => {
  try {
    appState.snapshot = await window.companion.clearOpenAiKey();
    render();
    el["model-settings-status"].textContent = "Chave removida do Keychain.";
  } catch (error) { showError(error); }
});
el["context-button"].addEventListener("click", () => {
  if (appState.inspectorOpen) {
    appState.inspectorOpen = false;
    render();
  } else {
    setInspectorMode("context");
  }
});
el["context-close"].addEventListener("click", () => { appState.inspectorOpen = false; render(); });
document.querySelectorAll("[data-inspector-mode]").forEach((button) => button.addEventListener("click", () => setInspectorMode(button.dataset.inspectorMode, appState.selectedOutputs)));
el["context-open-form"].addEventListener("submit", (event) => {
  event.preventDefault();
  const value = el["context-input"].value.trim();
  if (!value) return;
  void performContextAction(async () => {
    const snapshot = await window.companion.openContext(value);
    el["context-input"].value = "";
    return snapshot;
  });
});
el["context-external-toggle"].addEventListener("click", () => performContextAction(() => window.companion.setContextExternalAccess(!appState.snapshot.context.externalAccess)));
el["context-back"].addEventListener("click", () => performContextAction(() => window.companion.navigateContext("back")));
el["context-forward"].addEventListener("click", () => performContextAction(() => window.companion.navigateContext("forward")));
el["context-reload"].addEventListener("click", () => performContextAction(() => window.companion.navigateContext("reload")));
el["context-include"].addEventListener("click", () => {
  const id = appState.snapshot.context.activeTabId;
  if (id) void performContextAction(() => window.companion.toggleContextIncluded(id));
});
el["inspector-resizer"].addEventListener("pointerdown", (event) => {
  if (!appState.inspectorOpen || window.innerWidth <= 980) return;
  const startX = event.clientX;
  const startWidth = document.querySelector(".inspector").getBoundingClientRect().width;
  document.body.classList.add("resizing-inspector");
  const move = (moveEvent) => {
    const maximum = Math.min(900, window.innerWidth - 640);
    const minimum = ["context", "preview"].includes(appState.inspectorMode) ? 450 : 310;
    const width = Math.max(minimum, Math.min(maximum, startWidth + startX - moveEvent.clientX));
    document.documentElement.style.setProperty("--context-inspector", `${Math.round(width)}px`);
  };
  const stop = () => {
    const width = Math.round(document.querySelector(".inspector").getBoundingClientRect().width);
    if (width > 0) localStorage.setItem("companion.inspectorWidth", String(width));
    document.body.classList.remove("resizing-inspector");
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", stop);
});
el["model-button"].addEventListener("click", () => {
  setModelPickerOpen(el["model-picker"].classList.contains("hidden"));
});
el["settings-button"].addEventListener("click", () => {
  setSettingsSheetOpen(el["model-popover"].classList.contains("hidden"));
});
el["close-models"].addEventListener("click", () => {
  if (!appState.recommendationBusy) setSettingsSheetOpen(false);
});
el["close-model-picker"].addEventListener("click", () => setModelPickerOpen(false));
el["model-scrim"].addEventListener("click", () => setSettingsSheetOpen(false));
el["theme-control"].addEventListener("click", (event) => setTheme(event.target.dataset.theme));
el["runtime-button"].addEventListener("click", () => {
  setModelPickerOpen(false);
  if (!appState.recommendationBusy) setSettingsSheetOpen(false);
  el["runtime-popover"].classList.toggle("hidden");
});
el["close-runtimes"].addEventListener("click", () => el["runtime-popover"].classList.add("hidden"));
document.querySelectorAll("[data-runtime]").forEach((button) => button.addEventListener("click", async () => {
  appState.snapshot = await window.companion.setAgentRuntime(button.dataset.runtime);
  el["runtime-popover"].classList.add("hidden");
  render();
}));
el["pull-model-button"].addEventListener("click", async () => {
  el["pull-progress"].textContent = "Iniciando download…";
  try { appState.snapshot = await window.companion.pullModel(el["pull-model-input"].value.trim()); render(); }
  catch (error) { showError(error.message || String(error)); }
});
el["recommend-models"].addEventListener("click", () => runRecommendation());
el["reanalyze-models"].addEventListener("click", () => runRecommendation("Reanalisando com o modelo local…"));
el["cancel-recommendation"].addEventListener("click", async () => {
  el["advisor-progress-title"].textContent = "Cancelando análise…";
  el["cancel-recommendation"].disabled = true;
  try { await window.companion.cancelRecommendation(); }
  catch (error) { showError(error?.message || String(error)); }
  finally { el["cancel-recommendation"].disabled = false; }
});
el["public-catalog-toggle"].addEventListener("change", async () => {
  try { appState.snapshot = await window.companion.setPublicOllamaCatalog(el["public-catalog-toggle"].checked); render(); }
  catch (error) { showError(error); }
});
el["docker-sandbox-toggle"].addEventListener("change", async () => {
  try { appState.snapshot = await window.companion.setDockerSandbox(el["docker-sandbox-toggle"].checked); render(); }
  catch (error) { el["docker-sandbox-toggle"].checked = !el["docker-sandbox-toggle"].checked; showError(error); }
});
el["refresh-public-catalog"].addEventListener("click", async () => {
  await runRecommendation("Atualizando catálogo e analisando…", () => window.companion.refreshPublicOllamaCatalog());
});
el["apply-recommendation"].addEventListener("click", async () => {
  const roles = Object.fromEntries([...el["recommendation-roles"].querySelectorAll("[data-role-model]")]
    .map((input) => [input.dataset.roleModel, input.value.trim()]));
  await applyRoleConfiguration(roles, "Configuração ideal");
});
el["apply-installed-recommendation"].addEventListener("click", async () => {
  const roles = Object.fromEntries([...el["recommendation-installed-roles"].querySelectorAll("[data-installed-role-model]")]
    .map((input) => [input.dataset.installedRoleModel, input.value.trim()]));
  await applyRoleConfiguration(roles, "Configuração instalada");
});
el["pull-recommended"].addEventListener("click", async () => {
  const button = el["pull-recommended"];
  button.disabled = true;
  button.textContent = "Baixando…";
  setRecommendationNotice("Iniciando downloads dos modelos ausentes…", "active");
  try {
    appState.snapshot = await window.companion.pullRecommended();
    setRecommendationNotice("Downloads concluídos. A configuração ideal está pronta para uso.", "success");
    render();
  } catch (error) {
    setRecommendationNotice(error?.message || String(error), "error");
    showError(error);
  } finally {
    button.textContent = "Baixar ausentes";
    button.disabled = !appState.snapshot?.lastRecommendation?.requiredPulls?.length;
  }
});
el["setup-action"].addEventListener("click", async () => {
  if (appState.snapshot.modelProvider === "openai" && (!appState.snapshot.openAiKeyStored || !appState.snapshot.modelRoles?.executor)) {
    setSettingsSheetOpen(true);
    return;
  }
  if (appState.snapshot.modelProvider === "ollama" && !appState.snapshot.ollama.connected) appState.snapshot = await window.companion.refreshOllama();
  else if (!appState.snapshot.workspacePath) appState.snapshot = await window.companion.chooseWorkspace();
  else if (appState.snapshot.modelProvider === "ollama") appState.snapshot = await window.companion.pullModel(appState.snapshot.modelRoles?.executor || "qwen3-coder:30b");
  render();
});
el["mode-control"].addEventListener("click", async (event) => {
  const mode = event.target.dataset.mode;
  if (!mode) return;
  appState.snapshot = await window.companion.setMode(mode);
  render();
});
el.prompt.addEventListener("input", resizePrompt);
el.prompt.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } });
el["send-button"].addEventListener("click", send);
el["cancel-button"].addEventListener("click", () => window.companion.cancel());
el["deny-approval"].addEventListener("click", () => answerApproval(false));
el["allow-approval"].addEventListener("click", () => answerApproval(true));
document.querySelectorAll("[data-prompt]").forEach((button) => button.addEventListener("click", () => { el.prompt.value = button.dataset.prompt; resizePrompt(); el.prompt.focus(); }));
el["jump-latest"].addEventListener("click", scrollConversationToBottom);
el.conversation.addEventListener("wheel", () => { readerAnchorLocked = false; }, { passive: true });
el.conversation.addEventListener("pointerdown", () => { readerAnchorLocked = false; });
el.conversation.addEventListener("scroll", () => {
  if (readerAnchorLocked) return;
  conversationPinnedToBottom = conversationIsNearBottom();
  if (conversationPinnedToBottom) resetConversationScroll();
});
window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  setModelPickerOpen(false);
  el["runtime-popover"].classList.add("hidden");
  if (!appState.recommendationBusy) setSettingsSheetOpen(false);
});

function basename(value) { return value.split(/[\\/]/).filter(Boolean).at(-1) || value; }
function formatBytes(value) { if (!value) return ""; const units = ["B", "KB", "MB", "GB"]; const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1); return `${(value / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`; }
function relativeTime(value) { const minutes = Math.floor((Date.now() - value) / 60000); if (minutes < 1) return "agora"; if (minutes < 60) return `${minutes} min`; const hours = Math.floor(minutes / 60); if (hours < 24) return `${hours} h`; return new Date(value).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }); }
function paragraph(text, className) { const node = document.createElement("p"); node.textContent = text; if (className) node.className = className; return node; }
function activityIcon(kind) { return ({ context: "⌁", read: "▤", search: "⌕", edit: "✎", command: ">_", thinking: "◇", verification: "✓" })[kind] || "·"; }
function stripProtocolMarkers(value) { return String(value || "").replace(/<\/?tool_call>/gi, ""); }
