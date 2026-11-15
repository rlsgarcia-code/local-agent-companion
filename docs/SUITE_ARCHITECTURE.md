# Arquitetura e contrato de desacoplamento da suíte

O [estado verificável da integração](GAME_DESIGN_IMPLEMENTATION_STATUS.md)
separa o candidato de fonte, pacotes assinados, instalação e aceite. Os testes
descartáveis de editor usam Secret Storage em memória; isso não muda os cofres
dos produtos nem qualifica suas credenciais. O executor permanece no serviço.

**Integração de 15/11/2026:** o candidato motor 1.1.0 / clientes 0.13.0 incorpora
o `main` até `a6f3977`, preservando a cópia anterior de Game Design. O Studio Mac
consome o SDK empacotado; seus adaptadores nativos de preview usam os validadores
publicados nesse mesmo SDK. Não há grafo ou inteligência no renderer/SDK.
Jobs de jogo e reconciliações também impedem ativação de outro motor enquanto
estão em andamento. Os testes locais e builds não comprovam instalação, aceite
visual nem a conclusão do plano integral. A política de provedores do Mac deve
ser conciliada com a decisão do usuário antes de ativar esta composição: a base
atual permite troca explícita; as descrições abaixo de Ollama exclusivo refletem
a composição histórica e não devem justificar uma ampliação silenciosa.

A [restauração de foco do Correio](GAME_WINDMAIL_FOCUS_RECOVERY.md) é comportamento
do jogo exportado; o guia comum apenas orienta. Eventos DOM de diagnóstico não
criam uma ponte de controle de estado, executor de IA ou autoridade infantil.

A [visibilidade do barco no Correio](GAME_WINDMAIL_LABEL_VISIBILITY.md) pertence
à apresentação do jogo exportado. O guia puro ensina a evitar oclusões; não executa
outra inteligência. Controladores externos de QA não integram as interfaces,
ferramentas do modelo ou autoridades KidOS e não concedem qualidade.

O [HUD responsivo do Correio](GAME_WINDMAIL_RESPONSIVE_UI.md) é interface do jogo
exportado, não do Companion. O módulo puro fornece orientação neutra; SDK/serviço
constroem; o jogo interpreta sua entrada. Não acrescenta loop de IA no renderer,
ferramentas, permissões ou capacidade ao consumidor KidOS legado.

A [campanha do Correio observada externamente](GAME_WINDMAIL_CAMPAIGN_OBSERVATIONS.md)
usa controles normais e recursos verificados, sem serviço de IA durante o jogo.
Observadores de mantenedor não são executores nas interfaces ou coletores de
qualidade confiáveis; tampouco concedem capacidades ao KidOS.

A [integração manual de save no Correio](GAME_WINDMAIL_SAVE_INTEGRATION.md) roda
no jogo exportado. Serviço/SDK constroem; runtime/browser persistem e apresentam
a decisão do jogador. Não cria inteligência na UI, estado compartilhado entre
produtos ou nova autoridade. Revisão copiada não é instalação/geração autônoma.

O [save opcional de gameplay](GAME_SAVE_RUNTIME.md) roda no jogo web exportado,
com IndexedDB e esquema/concorrência próprios. Não é persistência do Agent
Service, host, conversa ou autoridade infantil. Compiladores workspace fixam o
runtime/licença; o Core1 o recusa. Native fixtures não provam jogo/cliente final.

As [páginas de código de jogo](GAME_SOURCE_TEXT_PAGES.md) pertencem aos contratos,
processamento puro e serviço. Os grafos comuns consomem o catálogo; interfaces
não executam outro agente nem ganham filesystem. Revisão/hash vinculam cada
leitura, e o adaptador protegido KidOS continua separado.

A [reserva de inferência por pedido](INFERENCE_REQUEST_RESERVATIONS.md) divide
estimativa transitória no callback comum e admissão/ledger no serviço. Interfaces
não definem cotas; o KidOS conserva sua autoridade protegida. O pacote qualificado
com provedor simulado não comprova instalação ou teto rígido de faturamento.

A [correção auditada de playtests](GAME_PLAYTEST_CORRECTIONS.md) mantém estado,
histórico e CAS no serviço; SDKs/interface apenas registram a decisão confirmada
do operador. Não cria inteligência na UI, relatório humano confiável ou autoridade
parental. Os dados privados continuam fora dos grafos e ferramentas do modelo.

As [metas proporcionais de playtest](GAME_PLAYTEST_TARGETS.md) são conhecimento
puro compartilhado em `game-design`. O serviço conta/aplica e as interfaces
mostram o resultado; estudos do operador e relatórios confiáveis continuam fontes
de evidência distintas. Compartilhar matemática não concede autoridade ou aceite.

O [rollback de domínio com binários reais](GAME_DOMAIN_ROLLBACK.md) verifica
serviços/SDKs e dados por produto. A versão anterior pode recusar funções novas
preservando seus dados; isso não autoriza fallback de inteligência ou ferramentas.
Fixture de processos não equivale a instalar/validar interfaces ou perfis completos.

A [integridade do motor no VSIX](GAME_VSIX_INTEGRITY.md) compara metadados
assinados capturados antes do empacotador e cada payload dentro do ZIP. Fica
na infraestrutura Companion; interfaces não ganham inteligência ou autoridade.
VSCE real em fixture não equivale a assinatura oficial ou cliente instalado.

A [assinatura imutável de pacotes](IMMUTABLE_ENGINE_PACKAGING.md) mantém o motor
de entrada intacto e entrega uma cópia verificada aos builders dos clientes.
É infraestrutura de distribuição, sem autoridade ou inteligência adicional nas
interfaces. Chaves de fixture não alteram o trust root nem comprovam release real.

A [qualificação nativa de recursos do build](GAME_DELIVERY_NATIVE_HOSTS.md)
observou três processos de host Mac e três do editor sobre serviços independentes
do mesmo pacote. Janelas, bridges e arquivos privados usam as implementações de
produção, com conexões/falhas de fixture explícitas. Não introduz inteligência
nas interfaces, altera instalações pessoais ou comprova a entrega integral.

Referência canônica para desenvolvimento. Conferência: **2026-11-11**.

Adição de fonte **2026-11-13**: o [parecer visual de jogos](GAME_VISUAL_OPINIONS.md)
é uma chamada limitada do papel `vision` dentro do grafo/motor comum. O serviço
resolve PNGs e recibos; interfaces e SDKs não executam inteligência adicional.
Mantém orçamento, privacidade, namespace, Mac/Ollama e exclusão do caminho KidOS.
Inferência simulada e pacote local não comprovam visão real ou instalação.

A [linha do tempo 3D do Studio](GAME_KEY_TIMELINE.md), também em fonte de 13/11,
edita somente dados do rascunho compartilhado Mac/VS Code. Blender, deformação e
produção permanecem no adaptador/serviço; não há inteligência ou codec no renderer.
Confirmação, pedido congelado e aplicação explícita continuam nas mesmas fronteiras.

Os [roteiros de compatibilidade de jogos](GAME_BROWSER_COMPATIBILITY.md) são
qualificação de mantenedor fora do motor, usando os mesmos recursos privados e
entradas normais. Não registram coletores, alteram qualidade ou introduzem um
coordenador de produção nas interfaces. Browser de teste não é aceite físico ou
instalado; resultados antigos e limitações da coleta ficam vinculados ao artefato.

A [correção posterior da captura WebKit](GAME_EMPTY_STYLE_POLICY.md) fica no
compilador de novos artefatos Phaser/Babylon: um hash fixo permite somente uma
regra CSS vazia, sem permissão ampla ou autoridade nova. Os builds anteriores
preservam sua política e resultados; a referência acima é histórica para eles.
Não é mudança no SDK, inteligência, Core/jogador legado, biblioteca ou instalação.
Esta referência descreve responsabilidades e caminhos ativos; versões instaladas
exigem evidência própria. Leia também o [guia dos agentes](../AGENTS.md).

**Integrações externas:** a auditoria do Med-Graph encontrou consumo da ponte
legada hospedada na extensão, fora da migração dos três clientes desta suíte.
O estado “conectado” dessa ponte não comprova uso do motor extraído. Leia
[clientes independentes](EXTERNAL_CLIENT_INTEGRATION.md) para o desvio, lacunas
de contrato e aceite. Outro produto não deve exigir VS Code nem se registrar
como a extensão para obter ferramentas; a migração externa permanece pendente.

## 1. Produtos, pacotes e nomes

**Local Agent Companion** é o repositório do motor comum, contratos, SDKs e clientes
Mac/VS Code. **macOS Companion** é seu aplicativo de uso no Mac. **KidOS** é outro
produto/repositório, que contém o sistema, o Navi e a administração familiar.
**KidOS Responsáveis**, embora também rode no Mac, não é o macOS Companion.

| Componente | Fonte e responsabilidade | Limite |
|---|---|---|
| Agent Core | `packages/agent-core`: grafos, planejamento, compactação, papéis de modelo e avaliação de conclusão | Sem frameworks de interface ou dependência de KidOS |
| Agent Service | `packages/agent-service`: coordenação por usuário, sessões, estado, eventos, recibos, recuperação e recursos gerenciados | Sem autoridade parental ou privilégios administrativos implícitos |
| Contratos e SDKs | `packages/contracts`, `packages/client-ts`, `packages/client-python`: tipos, protocolo, bootstrap e transporte | SDK não contém outro agente ou loop de ferramentas |
| Especializações | Pacotes como `packages/game-design`: conhecimento e preparação de perfis | Sem ferramentas, serviço, armazenamento ou permissões próprios |
| Adaptadores Companion | `packages/adapter-workspace` e integrações do serviço/host | Operações específicas de workspace, processos, Docker e MCP, com as políticas existentes |
| macOS Companion | `desktop`: interface Electron, contexto, previews, decisões e credenciais do host | Cliente do serviço; Ollama continua sendo o único provedor do app |
| VS Code | `src`: extensão, contexto do editor, diagnósticos, revisão, Secret Storage e ferramentas que exigem o editor | Cliente do serviço; variantes de provedores permanecem restritas |
| Navi e adaptador KidOS | Repositório `rlsgarcia-code/kidos`: GTK, terminal, contexto infantil, Coleções e ponte protegida | Consome Agent API; ações do sistema passam pelo Core sob UID real |
| KidOS Core/autoridades | Repositório KidOS: capacidades, políticas, cotas, sites, Store, aprovações e auditoria | Funciona sem motor de inteligência; MCP é apenas um adaptador de protocolo |
| KidOS Responsáveis | Repositório KidOS: gestão, pareamento, acompanhamento de tela e chamadas | Independente da IA; sua conexão de mídia/gestão não é Agent API |

O módulo Game Design fica **no mesmo repositório do Companion, em pacote separado**.

A [seleção de recursos para distribuição](GAME_WEB_DELIVERY_SELECTION.md) fica
no contrato e compilador workspace, preservando fontes e avisos registrados.
Não cria inteligência nas interfaces, remove arquivos do projeto ou amplia o
compilador Core; este recusa a opção até sua própria qualificação protegida.
O [formulário no Studio](GAME_DELIVERY_STUDIO.md) usa o controlador SDK e commits
de revisão existentes, com arquivo privado de rascunho. Escolha, upload e gravação
permanecem distintos; recuperar um recibo conhecido não repete efeitos. Não há
editor de projeto ou inteligência adicional no renderer.

O [codec AAC opcional](GAME_AUDIO_CODEC.md) fica no adaptador/serviço, usando o
dono de processos isolados já existente. Contratos definem variantes e fontes;
interfaces apenas inspecionam candidatos autenticados e pedem aplicação. Não há
codec ou inteligência no host UI, fallback para FFmpeg global ou nova autoridade
KidOS. Masters/estado/permissões permanecem distintos dos bytes de distribuição.

O [formulário de variantes](GAME_AUDIO_VARIANTS_STUDIO.md) fica no renderer e
controlador SDK compartilhados. A consulta somente de leitura de pedidos mantém
os recibos na produção comum; fechar/reabrir a UI não os reinterpreta como novos
efeitos. Fonte/revisão, confirmação do host, arquivo privado durável e aplicação
continuam sendo fronteiras separadas, sem outro motor ou autoridade parental.

O [mixer de áudio web](GAME_AUDIO_RUNTIME.md) pertence ao runtime dos jogos,
opcional e fixado pelo compilador. Conhecimento/guia no módulo de produção,
processamento no worker e playback no jogo têm responsabilidades distintas;
nenhum deles cria outro motor de inteligência. O perfil workspace2 inclui a
identidade do helper; o perfil Core1 continua recusando o novo import.

O [mixer1.1 com AAC](GAME_AUDIO_AAC_RUNTIME.md) mantém essa fronteira: inspeção
de container e reserva para o codec nativo ficam no jogo; encode continua no
adaptador isolado. Escolha de variante não muda autoridade ou cria outra fonte
silenciosa. Novos builds recebem o lock1.1; fontes/artefatos anteriores permanecem.

A [análise digital do WAV](GAME_AUDIO_ANALYSIS.md) é produzida no worker comum,
sobre os bytes codificados. Contrato/vínculo no SDK e desenho no renderer não
movem codecs, DSP ou inteligência para as interfaces. O campo é recusado pelo
worker Core legado até qualificação própria, sem ampliar autoridade infantil.

A [comparação histórica de imagem/áudio](GAME_MEDIA_COMPARISON.md) pertence ao
SDK/controlador e renderer compartilhados. Consome revisões e transferências já
autenticadas do serviço, sem novo executor, processamento ou autoridade. Hashes,
seleção e arquivos registrados são conferidos antes de apresentar; o browser
decodifica mídia, e apenas o usuário inicia reprodução.

A [redução PNG sem perda](GAME_PNG_OPTIMIZATION.md) exemplifica essa fronteira:
contrato e worker no serviço, escolha/restauração no SDK e renderer compartilhado,
confirmação no host e aplicação explícita. O worker fixo KidOS recusa o campo
até sua própria qualificação; compartilhar o schema não amplia autoridade.
Adaptadores específicos de KidOS ficam no KidOS. Uma integração Unity/Godot para
Mac/VS Code pertence inicialmente a um pacote de adaptador no Companion; só deve
ganhar outro repositório quando tiver ciclo de manutenção/distribuição independente.

## 2. Dependências e caminhos ativos

```text
macOS Companion ── SDK TypeScript ──┐
VS Code ────────── SDK TypeScript ──┼── Agent Service local por usuário
Navi GTK/terminal ─ SDK Python ────┘       ├── Agent Core + LangChain/DeepAgents
                                        ├── persistência SQLite oficial
                                        └── adaptadores autorizados do produto
                                             └── KidOS: gateway / Core no UID real

KidOS Responsáveis ── serviço de gestão/mídia KidOS ── autoridades do sistema
Comandos KidOS / MCP / apps ── Core ── autoridades do sistema
```

As linhas dos três clientes representam a mesma implementação de serviço,
executada localmente em cada computador/usuário, não um servidor central no Mac.
O IPC Agent API usa JSON-RPC autenticado por TLS com identidade fixada em socket
Unix/named pipe, sem listener TCP/LAN. Isso é distinto da rede local autorizada
para gestão/mídia ou de um provedor de inferência escolhido pelo administrador.

Pontos de entrada para conferir mudanças:

- Mac: `desktop/main.ts` → `desktop/runtime-client.ts` → SDK/serviço. O perfil
  desktop preparado está em `packages/agent-core/src/desktop-runtime.ts`.
- VS Code: `src/agent.ts`/`src/service-runtime.ts` → SDK → `runs.*` e adaptadores
  do serviço/editor. `DevelopmentAgent` é o integrador do cliente, não a fonte
  de um novo grafo dentro da extensão.
- Navi, no outro repositório: `local_companion.py` → cliente Python verificado →
  serviço → adaptador KidOS instalado/assinado → ponte imutável → Core/gateway.
- Os perfis do serviço convergem em `graph-executor.ts`/`graph.ts` no Agent Core.
  LangChain/DeepAgents são donos do loop e dos checkpoints. Perfis e prompts
  específicos não significam motores independentes dentro das interfaces.

O build independente (`scripts/build-engine.mjs`) rejeita imports dos diretórios
de interface `src/` e `desktop/`, bem como frameworks de UI. Tipos compartilhados
pertencem aos contratos; código de host reutilizável pertence aos adaptadores.

## 3. Regras para preservar o desacoplamento

1. **Inteligência no motor.** Planejamento, inferência do agente, compactação,
   recuperação, objetivos e avaliação não ganham um segundo loop em Electron,
   VS Code, GTK, SDKs ou ponte MCP. Não adicionar outro coordenador ao Game Design.
2. **Contexto e ferramentas por contrato.** O host entrega contexto e capacidades
   explícitas. Dados de conversa/MCP, texto de prompt e seleções da UI não são
   fonte de autoridade. O catálogo e o registro autenticado limitam ferramentas,
   provedores e recursos; cada operação continua validada na fronteira apropriada.
3. **Permissões no produto responsável.** O motor aplica suas restrições de
   registro, execução e aprovação; não concede privilégios do sistema. No KidOS,
   Core/autoridades decidem acesso parental, instalação, sites e cotas. Aprovar
   um plano não concede essas permissões. Sem shell, filesystem ou Docker
   genéricos para contornar o Core infantil.
4. **Estado isolado.** Namespace é vinculado ao usuário do sistema, produto,
   perfil e workspace autenticados. O mesmo projeto no Mac e VS Code não
   compartilha automaticamente conversas/memória. Configurações e preferências
   mantêm o escopo do produto. Projeções de histórico nas UIs não são checkpoints.
5. **Credenciais no armazenamento original.** Keychain, Secret Storage ou gateway
   protegido continuam sendo a origem. Concessões temporárias do motor ficam em
   memória; não salvar segredos em logs, eventos, checkpoints ou documentação.
   Respeitar as restrições de rede/provedor já definidas no guia dos agentes.
6. **Ciclo de vida do serviço.** Fechar uma UI não cancela trabalho independente
   dela. Recursos dependentes do host aguardam sua volta. Credenciais ausentes
   ou efeitos desconhecidos produzem estados explícitos de espera/reconciliação;
   não apresentar isso como execução ativa nem repetir efeitos automaticamente.
7. **Independência operacional.** Core e Responsáveis funcionam com IA desligada.
   Cada máquina executa o próprio motor. Usar Ollama do Mac no Alien é uma
   configuração atual de inferência: nesse arranjo, a IA precisa do Mac, mas
   isso não torna o Mac responsável pelo agente ou pelas autoridades KidOS.
8. **Evolução coordenada.** Ao mudar uma fronteira, atualizar contratos, consumidores,
   testes de compatibilidade e estes documentos no mesmo conjunto de trabalho.
   Não criar dependência direta de um cliente para a implementação de outro.

## 4. Onde desenvolver cada mudança

| Pedido | Destino e verificação |
|---|---|
| Streaming, retomada, cancelamento ou recuperação | Agent Core/Service + eventos/SDK quando necessário; testar replay, deduplicação, snapshots e desconexão |
| Aparência de mensagem/indicador | Cliente afetado; preservar IDs/eventos do serviço, sem reconstruir um loop de execução |
| Ferramentas, contexto ou diagnósticos do editor | Host VS Code; mover parte independente da janela para adaptadores do serviço e testar espera pelo editor |
| Planejamento e revisão de jogos | Game Design no Companion; especializações neutras e modelos por papel, sem conceder ferramentas |
| Integração Unity/Godot | Adaptador de produção com sondagem de capacidades e operações autorizadas; interface apresenta resultados; KidOS exige integração Core própria |
| Sites, tempo de tela, Store e aprovação parental | Autoridades/Core KidOS; Responsáveis configura pelas APIs administrativas; não implementar como prompt do agente |
| Acompanhamento parental, tela ou chamada | KidOS Responsáveis e serviços de gestão/mídia; testar sem IA |
| Migração, instalação e rollback | Publicação/bootstrap Companion ou atualizador por computador KidOS; fixar composição exata e preservar estado de domínio |

## 5. Legados, maturidade e evidências

| Situação | Tratamento |
|---|---|
| Clientes ativos pelo serviço | Caminho de desenvolvimento vigente; falha do serviço gera diagnóstico recuperável |
| Rotas `desktop.*` | Compatibilidade de perfil/RPC dentro do serviço, não autorização para reembutir o motor; retirar somente após migrar e validar os consumidores |
| Reexports e nomes históricos | `desktop/runtime.ts` e helpers remanescentes não definem outro produto; conferir o caminho ativo antes de remover código ou renomear APIs |
| Executor/checkpoints Python antigos no KidOS | Compatibilidade/importação/rollback; nunca fallback silencioso. Não copiar checkpoints Python para TypeScript nem reexecutar ferramentas na importação |
| Game Design 0.1.0 | Extraído no código-fonte, exportado no kit e consumido pelo adaptador Navi em desenvolvimento; não incluído automaticamente na release 1.0.2 |
| Projetos/produção de jogos v2 | Fonte de desenvolvimento: persistência, SDKs, jobs, artefatos e compiladores web; [escopo e limites](GAME_PRODUCTION_API.md); sem nova instalação ou aceite integral |
| Perfil de produção v2 | Fonte 0.2.0 conectada aos grafos compartilhados Mac/VS Code; [integração e limites](GAME_AGENT_PRODUCTION.md); KidOS continua protegido no consumidor legado |
| Processamento de assets | [Bibliotecas offline em fonte](GAME_LICENSED_LIBRARIES.md), com seleção exata, dependências/licenças e candidato; [pipeline local em fonte](GAME_ASSET_PIPELINE.md): imagem, atlas, WAV e [Blender isolado](GAME_BLENDER_ADAPTER.md) com GLB/rig/clips, candidato e aplicação explícitos; [broker/porta de mídia KidOS](GAME_MEDIA_WORKER.md) opt-in com alocação Root compartilhada em fonte; composição Linux SDK/porta assinada/Core oficial/Root/worker real e prova systemd/bwrap no Alien com runtime temporário do UID ensaiadas; composição Root instalada, geração por provedor e aceite artístico pendentes |
| Bundles no Core KidOS | Fonte no repositório KidOS, documentada em `docs/GAME_BUNDLES.md`: transferência/publicações e lançamento com recibos; Lume por Core/IPC/WebKit Linux temporário, reinício sem janela duplicada e save recuperado; não ativa broker/Navi v2 nem altera instalação |
| Conferência do adaptador instalado | [Identidade e inspeção em fonte](INSTALLED_TOOL_INSPECTION.md): serviço injeta correlação persistente, Core confirma a operação original e Navi retoma sem resultado fornecido pela UI; catálogo de bundles opcional, ainda sem instalação ou broker de produção |
| Compilador web, broker e porta Core | [Worker/contrato privados](GAME_WEB_COMPILER.md), domínio KidOS e [porta instalada em fonte](GAME_CORE_PRODUCTION_PORTS.md), exclusivos do produto; alocação de admissões por projeto/etapa opt-in e independente da IA em fonte; SDK/TLS/IPC/Linux x64 recuperado após SIGKILL sem relançar; assinatura/autoridade temporárias, sem composição de release/perfil v2 instalado |
| Recursos de produção | [Fila comum em fonte](GAME_PRODUCTION_API.md#fila-e-recursos-de-produção) para builds, validações e mídia por usuário; estimativas dos adaptadores, cancelamento e reservas de efeitos desconhecidos; orçamentos por etapa e inferência permanecem separados |
| Etapas de produção | [Ciclos persistentes em fonte](GAME_PRODUCTION_WORKFLOWS.md), critérios cumulativos da fonte atual, pedidos por projeto/etapa e continuação pelo host; sem novo executor; inferência tem controle separado e KidOS exige integração protegida própria |
| Inferência compartilhada | [Admissão/contabilização em fonte](INFERENCE_BUDGETS.md) por namespace/etapa e [backend protegido KidOS](GAME_KIDOS_INFERENCE.md) por UID na autoridade, com gateway Unix sem privilégios administrativos; consumidor opcional ABI 1, IDs/hash persistidos e inspeção em fonte, com composição SDK/serviço/assinatura e UIDs reais em contêiner; alocação Root por projeto/etapa e seleção vinculada ao run em fonte; workflow técnico protegido, composição instalada e corte do HTTP ainda pendentes; sem teto financeiro rígido ou cobertura de toda IA da máquina |
| Recuperação do coletor web | [Supervisor ABI 4](GAME_BROWSER_OBSERVATIONS.md#supervisor-e-recuperação-durável) com IPC herdado, recibos e candidato por build; sem loop de IA ou endpoint de controle; queda do coordenador verificada no Mac ARM64, demais hosts/falhas e distribuição pendentes |
| Godot web isolado | [Base funcional em desenvolvimento](GAME_GODOT_ADAPTER.md), com projetos nativos e observação 2D/3D no Mac ARM64; sem distribuição, broker KidOS ou qualificação integral |
| Unity LTS | [Preparação verificada](GAME_UNITY_QUALIFICATION.md) e [preflight/exportador em fonte](GAME_UNITY_PROJECTS.md), com C# compilado contra a LTS, fonte/locks e inspetor puro de saída empacotados; TAR/UnityWebData e diagnóstico não são recibo/QA; [player candidato](GAME_UNITY_PLAYER.md) com shell/CSP e protocolo simulado, sem runtime Unity real; sem adaptador registrado, licença/build de jogo ou isolamento completo comprovados |
| Comparação de versões e arquivos | [API comum somente de leitura](GAME_REVISION_COMPARISON.md), com revisões exatas, diff textual limitado/paginado, SDKs e apresentação Mac/VS Code; sem execução em cliente, alteração da fonte ou QA; binários preservados e exportação histórica explícita |
| Superfícies de Game Design nas UIs | [Game Studio em desenvolvimento](GAME_STUDIO_UI.md), renderer/SDK e ensaios Electron/VS Code reais com perfis temporários no Mac; aceite das instalações, demais plataformas e distribuição pendentes |

A manutenção ainda deve reconciliar resíduos históricos e perfis de compatibilidade
sem confundi-los com novos executores de interface. Esta documentação não afirma
que todo helper legado já foi eliminado, nem muda o comportamento desses arquivos.

**Referência de versão:** motor 1.0.2, protocolo 1.0, Node 22.23.4 e clientes Mac/VSIX
0.12.4; fonte do artefato do motor `0d5030bfe244c1bbfd33f3b24eb8037bd4ba012a`.
O [PR #15](https://github.com/rlsgarcia-code/local-agent-companion/pull/15) foi
integrado e registra a publicação final aprovada em 2026-11-09. O
[relatório de aceite](desktop-final-acceptance.json) é a fotografia anterior à
publicação; seu campo de revisão não representa a situação atual do PR.
O [relato anterior](history/COMPANION_ACCEPTANCE_1_0_2.md) fica como histórico.

Não extrapolar aceite de Apple Silicon para provas físicas nas outras plataformas:
a matriz nativa e a verificação visual são evidências distintas. A assinatura
Apple daquele aceite é ad-hoc, sem notarização. O estado instalado do KidOS e
sua revisão de release são independentes do aceite Companion.

Para qualquer nova entrega, distinguir: **implementado → testado → empacotado e
verificado → instalado → demonstrado no alvo → publicado**. Registrar commit,
versão, alvo e hashes nas evidências. Um build ou smoke simulado não comprova
instalação, funcionamento visual, acesso a uma engine ou jogo completável.

## 6. Compatibilidade, distribuição e leitura seguinte

Usar as versões centrais dos contratos para motor/protocolo/Node. Pacotes de
especialização têm versão própria; mudanças incompatíveis exigem migração
explícita. KidOS fixa motor/SDK/artefatos e mantém assinatura própria de seu
adaptador. O snapshot de Game Design tem versão/hash; a cópia de desenvolvimento
offline não substitui o futuro artefato de release assinado.

Versões são imutáveis, instaladas lado a lado. Verificar assinatura, plataforma,
protocolo e hashes antes de executar; ativar em ponto seguro, sem cancelar trabalho
automaticamente. Preservar versão anterior, dados posteriores à atualização e
recibos. Rollback incompatível usa exportação/importação de domínio e continuação
explícita, sem repetir ações. Merge/publicação seguem a revisão autorizada, não
decorrem de editar documentação ou rodar testes.

Leia o [módulo Game Design](GAME_DESIGN.md) para sua API e maturidade. Para trabalhar
no KidOS, leia a referência local `docs/COMPANION_SUITE.md` no
[repositório KidOS](https://github.com/rlsgarcia-code/kidos); ela inclui informações
suficientes para trabalhar sem ter o checkout Companion ao lado. Relatórios de
instalação são fotografias datadas, não fontes de regras arquiteturais.

O [plano Game Design 1.0](GAME_DESIGN_IMPLEMENTATION_PLAN.md) define a expansão
planejada para produção completa e os quatro adaptadores; não altera os estados
de implementação/instalação registrados nesta arquitetura.
