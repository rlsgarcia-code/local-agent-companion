# Etapas persistentes de produção de jogos

Estado em **2026-11-10**: implementação em fonte de desenvolvimento. Leia a
[arquitetura](SUITE_ARCHITECTURE.md), o [plano integral](GAME_DESIGN_IMPLEMENTATION_PLAN.md),
a [integração do executor](GAME_AGENT_PRODUCTION.md) e a
[API de produção](GAME_PRODUCTION_API.md). Esta frente não conclui Game Design 1.0.

## Responsabilidades

`packages/game-design/src/workflow.ts` agrupa critérios técnicos de qualidade em
etapas. `packages/contracts/src/game-workflow.ts` define os tipos e pedidos
fechados. `packages/agent-service/src/game-workflows.ts` persiste o ciclo, eventos,
consumo de pedidos e aceites. Não contém outro executor, loop de ferramentas ou
chamadas de modelo. Agent Core e LangChain/DeepAgents continuam executando os
perfis e especialistas; os adaptadores existentes fazem builds, testes e mídia.

O ciclo pertence ao projeto dentro do namespace autenticado. Conversas daquele
produto podem continuar o mesmo projeto, sem compartilhar estado com outro
produto ou perfil. O processo proprietário instala a política; parâmetros da UI
ou do modelo não podem escolher limites, inserir evidência ou forjar qualidade.

As rotas genéricas de workflow e suas ferramentas **não estão habilitadas para
KidOS**. A integração v2 exige política e operações próprias do Core/broker.
Confirmações no Companion não concedem autoridade parental.

## Etapas e critérios

O ciclo segue `design → core → systems → content → polish → testing → corrections
→ candidate`. Cada avanço muda uma etapa. No último, o ciclo passa de `active`
para `completed` e fixa revisão, hash e build aceitos.

| Etapa | Evidência exigida antes de avançar |
|---|---|
| Design | Documento de design presente; revisão legada reconhecida |
| Experiência central | Build da fonte atual, início e controles observados |
| Sistemas | Demais verificações de runtime e multiplayer local quando aplicável |
| Conteúdo | Escopo, progressão, conclusão e cobertura dos conteúdos |
| Acabamento | Verificações visuais, áudio, proveniência/licenças e ausência de placeholders |
| Testes | Desempenho físico e metas de avaliação humana |
| Correções | Ausência de verificações coletadas falhas ou ainda não comprovadas |
| Candidato | Todos os critérios anteriores, cenários previstos e qualidade integral |

Os critérios são cumulativos e recalculados para a fonte atual. Mudar o código
ou o design invalida a evidência anterior conforme a API de qualidade, mesmo que
a etapa persistida já esteja adiante. Um job pendente, em cancelamento ou com
resultado desconhecido também impede avançar. Cancelar ou reconciliar preserva
os requisitos de parada e toolchain original da API de produção.

Esse agrupamento não transforma presença de design em qualidade criativa,
captura de pixels em prova semântica de jogabilidade, declaração de licença em
licença verificada ou teste simulado em playtest humano. Os coletores reais ainda
não cobrem todos os critérios do plano. Sem eles, a etapa correspondente continua
pendente; não há RPC para inserir um parecer do modelo como evidência.

`game_delivery` recebe evidência conservadora: qualidade vigente, ciclo concluído,
aceite vinculado ao ciclo/revisão/hash atuais e ausência de trabalhos pendentes.
`game_project_change` continua permitindo concluir uma alteração delimitada,
com revisão real, sem declarar o jogo completo. Metadados de etapa ou seleção
não produzem um diff fictício no workspace.

## Alocação de pedidos

Cada etapa tem inicialmente **64 pedidos** de produção, com até **16 blocos** por
etapa na política padrão. Builds, validações e processamento de mídia consomem a
mesma alocação daquele projeto/etapa. Um pedido admitido é contado mesmo se for
cancelado na fila ou terminar em falha. Uma operação recusada antes da admissão
não é contada. Se a transação falhar, consumo e job são revertidos juntos.

Repetir a identidade exata recupera o mesmo job, sem novo débito. A cobrança fixa
projeto, revisão/hash, tipo de operação, ferramenta/toolchain e parâmetros
específicos. Reutilizar a identidade com outro conteúdo é rejeitado. Cancelamento
e reconciliação não reembolsam nem repetem o processamento.

Ao esgotar um bloco, o trabalho permanece salvo. A UI oferece **Autorizar
continuação**, com confirmação nativa e modo de edição/confiança do host. O
serviço adiciona exatamente um bloco da política instalada, apenas quando o
atual estiver esgotado e dentro do máximo. Não aceita quantidade escolhida pelo
cliente. Repetir a confirmação com o mesmo identificador não concede outro bloco.
O catálogo do modelo não oferece continuação nem reabertura.

A política fixada no ciclo é combinada conservadoramente com a política
instalada: prevalece o menor limite. Reiniciar com limites menores não permite
mais pedidos; instalar limites maiores não amplia automaticamente um ciclo já
existente. `gameWorkflowPolicy` é configuração interna do processo proprietário,
sem endpoint público de alteração.

Esses contadores são **pedidos admitidos por projeto e etapa**. Não medem tokens,
dinheiro, tempo de modelo ou um orçamento agregado da sessão/usuário. Criar outro
projeto não compartilha o consumo de pedidos; a orientação proíbe usá-lo para
evadir a alocação, mas ainda falta agregar esses pedidos entre projetos.
Separadamente, o [orçamento de inferência](INFERENCE_BUDGETS.md) agrega chamadas e
tokens informados/reservados entre projetos/sessões do namespace, além da etapa.
Não é um teto financeiro ou de duração. A
[fila de memória/CPU](GAME_PRODUCTION_API.md#fila-e-recursos-de-produção) é outra
proteção, comum por usuário, e não substitui esses controles.

## API, SDKs e concorrência

A capacidade `game-production-workflows` identifica o contrato, não o aceite de
um jogo ou a disponibilidade de todos os coletores.

| Método | Entrada | Resultado |
|---|---|---|
| `games.workflows.get` | `projectId` | Transferência JSON de ciclo, gates, consumo, fonte e cursor de eventos |
| `games.workflows.advance` | Identidade e versões abaixo | Avança uma etapa após revalidar os critérios |
| `games.workflows.continue` | Identidade e versões abaixo | Concede um bloco instalado, sem redefinir o consumo |
| `games.workflows.reopen` | Identidade e versões abaixo | Inicia explicitamente outro ciclo após uma conclusão |
| `games.workflows.events` | `projectId`, `cursor`, `limit`, `until` opcional | Transferência JSON com eventos, cursor e `hasMore` |

Mutações exigem `requestId`, `projectId`, `expectedVersion` do workflow e
`expectedRevision` do projeto. O serviço verifica as duas versões na transação;
duas janelas não podem sobrescrever silenciosamente etapa, fonte ou alocação.
TS oferece `getGameWorkflow`, `advanceGameStage`, `continueGameProduction`,
`reopenGameProduction` e `readGameWorkflowEvents`, com equivalentes no SDK Python.
Transferências usam o contrato comum, sem aumentar o limite de transporte.

`game_workflow` oferece leitura paginada ao modelo. `game_advance_stage` usa a
identidade persistente da invocação do grafo e a mesma validação de avanço.
Aprovações de ferramenta continuam respeitando Plano/Revisar/Auto edits; nenhum
indicador enviado pelo cliente substitui os critérios.

O snapshot lê fonte, ciclo, avaliação e cursor na mesma transação. Eventos são
append-only e sequenciados. `until: eventCursor` permite exportar todas as páginas
até aquele snapshot, sem incluir alterações posteriores ou truncar o histórico.
Campos desconhecidos como `ready` ou `maxRequests` são rejeitados.

## Aceite, novo ciclo e preservação

A conclusão fixa referências relacionais para a revisão e o artefato aceitos.
Reabrir preserva o aceite anterior e os eventos, cria outra identidade de ciclo e
reinicia as etapas sob a política instalada. Requer fonte alterada ou evidência
invalidada; não permite zerar o consumo de um ciclo ativo ou do mesmo jogo já
aceito. Novas revisões não herdam um campo de aceite da interface.

A exportação de fonte acrescenta `production.json`: snapshot e eventos até seu
cursor, junto de `history.json`, blobs e fonte editável. É dado histórico de
domínio/auditoria, **não autoridade importável, concessão de orçamento ou
certificado de qualidade**. O importador atual não restaura automaticamente um
ciclo ativo nem seus aceites. Essa migração e o rollback integrado às instalações
continuam pendentes; preservar o arquivo não comprova uma migração concluída.

Fechar a UI não cancela o serviço nem apaga o ciclo. Um ciclo ativo sem jobs não
impede por si só a atualização em ponto seguro; operações com efeito em curso
continuam sujeitas às verificações de quiescência do motor.

## Verificação e pendências

`test/engine-game-workflows.test.ts` verifica consumo compartilhado de pedidos,
transações, repetição idempotente, queda/reinício, políticas reduzidas, bloqueio
por fonte antiga/resultado desconhecido, ciclos/aceites, isolamento e SDKs
TS/Python sobre TLS/IPC real. O coletor completo desse teste é uma fixture
explicitamente sintética; não representa os jogadores, dispositivos ou jogos
finais exigidos no plano.
Standard e Deep também percorrem as oito etapas pelo grafo oficial, usando
modelos simulados e recibos persistentes, sem um executor de produção paralelo.

`scripts/smoke-game-studio.mjs` exercita as superfícies compartilhadas contra o
motor empacotado, com builds Phaser e navegador reais, avanço Design/Core,
impedimento por controles não comprovados, esgotamento e continuação autorizada.
As bridges do host são emuladas: a prova nativa/instalada deve ser feita à parte.
Os ensaios `smoke-game-studio-electron.mjs` e `smoke-game-studio-vscode.mjs`
verificam adicionalmente avanço, bloqueio, exportação e preservação da etapa em
janelas/webview reais, com perfis de desenvolvimento temporários. O primeiro
simula diálogos somente no harness; o segundo usa os diálogos customizados reais
do editor. Nenhum deles substitui o aceite das instalações finais.

Permanecem obrigatórios limites de custos/duração e cobertura integral da inferência,
todos os coletores técnicos e humanos, migração dos ciclos, integração protegida
KidOS, quatro adaptadores completos, jogos finais, matriz física e distribuição.
Registre as evidências reais no [acompanhamento](GAME_DESIGN_IMPLEMENTATION_STATUS.md).
