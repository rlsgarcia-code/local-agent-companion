# Integração de novas aplicações

Este é o contrato canônico para conectar uma aplicação ao Local Agent Companion. O Companion permanece em seu próprio repositório e artefato; a aplicação consumidora mantém apenas um adaptador fino em seu repositório. Não copie o runtime, o grafo LangChain, o planner, os checkpoints, a memória, o cliente de modelo ou o loop de ferramentas.

O arquivo legível por máquina [`application-adapter-contract.json`](application-adapter-contract.json) fixa a versão mínima, a identidade de produto, as capacidades obrigatórias e a superfície mínima dos SDKs. O CI compara esse arquivo ao código. Uma mudança pública que não atualizar este documento e o contrato falha no gate de repositório.

## O que significa integração completa

Uma aplicação está completamente integrada quando:

1. instala um engine e um SDK assinados da mesma release;
2. registra-se como `companion-app`, com `profile` estável e exclusivo para a aplicação;
3. negocia protocolo, versão e capacidades por `engineInfo()` antes de habilitar ações;
4. usa sessões, runs, eventos, approvals, goals, memória e modelos do engine em vez de recriá-los;
5. fornece um catálogo exato das ferramentas do domínio e executa apenas pedidos devolvidos pelo callback oficial;
6. mantém credenciais no host original e concede ao engine somente leases efêmeros;
7. projeta eventos e estados no design system da aplicação, sem incorporar a UI do Companion;
8. degrada por capacidade: uma função ausente fica indisponível e explicada, nunca recebe um fallback paralelo.

“Completa” refere-se às capacidades genéricas declaradas pelo engine. Recursos exclusivos de um host — contexto do editor no VS Code, controles nativos do Mac ou um MCP específico da aplicação — exigem o adaptador correspondente e não são magicamente transportados para outra interface.

## Artefatos e isolamento

Baixe na mesma release:

- `companion-engine-<versão>-<plataforma>.tar.gz` e seu SHA-256;
- `companion-sdks-<versão>.tar.gz` e seu SHA-256;
- a chave pública Ed25519 de release já fixada pela aplicação instaladora.

O SDK verifica assinatura, manifesto, versão, protocolo, plataforma, Node empacotado e todos os hashes antes da ativação. O adaptador não importa o repositório Companion por caminho, submódulo, workspace npm ou dependência `file:`. Atualizações trocam somente artefatos imutáveis e preservam o estado privado do engine.

Para aplicações Node, use o SDK TypeScript e `ensureEngine()`. Para aplicações Python, Swift, Kotlin ou outras, prefira um sidecar Node mínimo para bootstrap e use o cliente Python ou o protocolo local somente atrás desse adaptador. Não reimplemente verificação de release em cada linguagem.

## Registro da aplicação

O bootstrap precisa declarar autoridade antes de abrir qualquer sessão:

```ts
const client = await ensureEngine({
  bundleDirectory: verifiedEngineBundle,
  publicKey: companionReleasePublicKey,
  product: "companion-app",
  profile: "com.example.clinical-workspace",
  workspace: "",
  providers: ["ollama", "openai"],
  hostTools: toolCatalog.map((tool) => tool.name),
  toolCatalog,
  activation: "idle",
});
```

Use um `profile` estável por aplicação. `workspace` vazio cria uma experiência global daquele produto; um caminho real cria isolamento por workspace. A identidade é imutável: mudar providers, profile, workspace ou catálogo gera outra identidade registrada.

`toolCatalog` é autoridade instalada, não uma sugestão de prompt. Cada ferramenta declara `name`, `description`, JSON Schema estrito, `effect` (`read`, `write` ou `external`), `host` e tipo de evidência. O `RunSpec.tools` deve ser exatamente igual ao catálogo instalado. O engine rejeita ferramentas acrescentadas ou alteradas pelo modelo ou pelo cliente.

## Handshake obrigatório

Imediatamente após `ensureEngine()`:

```ts
const info = await client.engineInfo();
if (info.protocol !== "1.0") throw new Error("Protocolo incompatível");
const required = new Set(adapterContract.requiredEngineCapabilities);
const missing = [...required].filter((name) => !info.capabilities.includes(name));
if (missing.length) throw new Error(`Atualize o Companion: ${missing.join(", ")}`);
```

O baseline 1.0.8 inclui:

- `sessions`: conversas duráveis por namespace;
- `runs`: execução idempotente e estados terminais explícitos;
- `events`: streaming público reproduzível por cursor;
- `approvals`: decisões humanas antes de efeitos;
- `goals`: objetivos persistentes e progresso;
- `sqlite-checkpoints`: checkpoints oficiais LangGraph;
- `chunked-transfers`: anexos grandes com hash;
- `durable-approvals`: aprovação recuperável após reinício;
- `bound-tool-receipts`: identidade e recibo de efeitos;
- `ollama-model-jobs`: operações locais de modelos;
- `model-assistance`: tarefas pontuais e somente leitura;
- `public-session-snapshots`: snapshot público sem estado privado do grafo.

Não presuma que uma versão futura manterá toda capacidade opcional. Faça feature gating pela lista retornada, registre diagnóstico sem conteúdo e mostre ao usuário como atualizar.

## Fluxo mínimo de execução

1. `sessions.list` ou `sessions.create` define a conversa.
2. O adaptador monta `RunSpec` com contexto mínimo, provider autorizado e catálogo exato.
3. `startRun()` usa chave de idempotência exclusiva para aquela intenção.
4. `waitForRun()` entrega eventos progressivos e pedidos ao host.
5. Pedidos `approval` são apresentados ao usuário; pedidos `tool` são validados e executados pelo adaptador do domínio.
6. `host.respond`, `host.failed` e `approvals.respond` retornam somente o resultado necessário.
7. Estados `awaiting_host`, `awaiting_approval`, `awaiting_credentials` e `awaiting_reconciliation` aparecem como estados recuperáveis, não como nova execução.
8. `sessions.snapshot` reidrata a interface após reconexão sem duplicar mensagens ou efeitos.

Nunca reinicie automaticamente um run porque o polling expirou. Consulte `runs.get`, eventos e recibos; efeitos desconhecidos exigem reconciliação explícita.

## Modelos e credenciais

Use `modelConfiguration()`, `configureModels()`, `modelCatalog()` e `assistModel()`. O adaptador não cria um cliente Ollama/OpenAI/LiteLLM paralelo.

Quando o aplicativo Mac for o host de configuração e credencial, use `CompanionInterfaceBroker` do SDK. Não copie a leitura do descriptor nem crie outra rota HTTP:

```ts
const broker = await CompanionInterfaceBroker.connect();
const shared = await broker.modelConfiguration();
const current = await client.modelConfiguration();
await client.configureModels({
  revision: current?.revision ?? 0,
  provider: shared.provider,
  endpoint: shared.provider === "openai"
    ? "https://api.openai.com/v1"
    : "http://127.0.0.1:11434/v1",
  ...(shared.provider === "openai" ? { credentialRef: "openai-platform" } : {}),
  selectionMode: shared.selectionMode,
  optimizationProfile: shared.optimizationProfile,
  roles: shared.assignments,
});
if (shared.provider === "openai")
  await broker.leaseOpenAiCredential(client.options.credential.registration.id);
```

O broker também oferece `configureModels()` para alterar a configuração compartilhada e `openSettings()` para levar o usuário à interface nativa. A aplicação nunca recebe a chave.

- Ollama é loopback e não usa chave.
- OpenAI direta usa somente o endpoint fixo autorizado pela instalação.
- LiteLLM usa o endpoint corporativo configurado pelo usuário.
- KidOS gateway nunca está disponível para `companion-app`.

Chaves permanecem no Keychain, Secret Storage ou gateway protegido. O Mac pode delegar um lease OpenAI efêmero à identidade exata de um `companion-app` registrado; o valor nunca é retornado ao adaptador nem persistido pelo engine. Se o host de credencial estiver bloqueado ou ausente, o run entra em estado explícito e a interface orienta a reconexão.

## Dados, memória e design

O namespace é derivado de usuário, produto, profile e workspace. Sessões, goals, memória, checkpoints, transferências e recibos não atravessam namespaces. Dados de domínio permanecem na aplicação de origem e entram no modelo somente como contexto transitório ou resultado de ferramenta autorizado.

O Companion fornece conteúdo e estados, não a aparência da aplicação. O adaptador deve renderizar composer, streaming, atividade, aprovação, cancelamento e recuperação no design system do produto consumidor. Esse limite permite que o Med-Graph preserve o Scribe e que outras aplicações tenham experiências próprias sem bifurcar o engine.

## Checklist de conformidade

- [ ] Artefatos assinados, da mesma versão e sem dependência por caminho.
- [ ] `product: "companion-app"` e profile estável.
- [ ] `engineInfo()` validado antes de habilitar a UI.
- [ ] Catálogo de ferramentas exato e efeitos declarados.
- [ ] Sessões e runs idempotentes; reconexão por snapshot/cursor.
- [ ] Aprovação, cancelamento, erro, credencial ausente e reconciliação representados.
- [ ] Nenhum segredo em descriptor, logs, eventos, prompts ou persistência.
- [ ] Nenhum runtime, planner, memória, checkpoint ou cliente de modelo duplicado.
- [ ] Testes de negação para ferramenta não instalada, provider não autorizado e namespace incorreto.
- [ ] Smoke test instalado com prompt somente leitura.
- [ ] Matriz de capacidades registrada na documentação da aplicação.

Comece pelo exemplo em [`examples/application-adapter`](../examples/application-adapter/README.md). Ele verifica o artefato, registra uma aplicação isolada e falha fechado quando o engine não oferece o baseline esperado.
