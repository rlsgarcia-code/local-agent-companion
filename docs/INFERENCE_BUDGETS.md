# Orçamento compartilhado de inferência

Estado em **2026-11-10**: fonte e artefato de desenvolvimento, sem nova instalação
ou publicação. Leia a [arquitetura](SUITE_ARCHITECTURE.md), o
[plano integral de jogos](GAME_DESIGN_IMPLEMENTATION_PLAN.md) e as
[etapas de produção](GAME_PRODUCTION_WORKFLOWS.md).

Atualização de fonte em **2026-11-13**: a
[reserva por tamanho do pedido](INFERENCE_REQUEST_RESERVATIONS.md) complementa
o piso, preservando a política, os ledgers e a autoridade do serviço. Não é
instalação, nova autorização de inferência ou teto rígido de faturamento.

## Fronteiras e cobertura

O Agent Service controla a admissão; LangChain/DeepAgents continuam sendo donos
das chamadas, ferramentas, streaming e checkpoints. Não há novo cliente HTTP,
provedor, endpoint de inferência ou loop de agente. A implementação usa callbacks
inherentes à execução LangChain, com admissão aguardada antes da chamada e
contabilização ao terminar. São referências os contratos oficiais de
[callbacks](https://reference.langchain.com/javascript/langchain-core/callbacks/base/BaseCallbackHandler)
e de [metadados de uso](https://docs.langchain.com/oss/javascript/langchain/messages#token-usage).

| Componente | Responsabilidade |
|---|---|
| `packages/contracts/src/inference-budget.ts` | Política, escopos, contadores e snapshot públicos |
| `packages/agent-core/src/inference-budget.ts` | Callback e porta interna, sem persistência ou autoridade própria |
| `packages/agent-service/src/inference-budgets.ts` | Admissão e contabilização transacionais, recuperação e concessões |
| Agent Service | Resolve os escopos autenticados e solicita confirmação pelo fluxo de aprovação existente |
| Mac e VS Code | Exibem consumo e decisões; não definem a política enviada ao motor |

Os caminhos Standard/Deep do executor comum e do runtime Mac repassam o mesmo
callback às invocações de planejamento, execução, especialistas, compactação,
interpretação da tarefa, revisão de conclusão e avaliação de objetivos. A
herança de callbacks cobre chamadas aninhadas. Os testes forçam compactação e
delegação para verificar essa propriedade; o teste Mac usa modelos LangChain
reais com respostas HTTP/SSE simuladas, incluindo JSON estruturado e streaming.

Esta frente não inclui as operações manuais `modelAssistance`, embeddings,
conexões/testes/downloads de modelos ou geradores de assets externos. Não é um
limite de todo processo de IA da máquina. O adaptador protegido KidOS ainda
precisa de integração própria: o serviço não injeta a porta workspace no Navi
nem oferece estas rotas genéricas como autoridade parental.

A [integração protegida KidOS](GAME_KIDOS_INFERENCE.md) liga em fonte o registro
da autoridade, gateway Unix e consumidor opcional do adaptador (ABI 1). IDs e
vínculos persistidos, ausência de retentativa automática, espera tipada e inspeção
do recibo original têm testes próprios. Não usa esta concessão genérica do
serviço como autoridade parental. Composição instalada, corte do HTTP legado e
workflow técnico protegido continuam pendentes; as guardas permanecem.

No KidOS, a revisão posterior já integra alocações Root de inferência por
projeto/etapa, seleção vinculada ao run e referência conferida no transporte.
Leia `docs/PROTECTED_PROJECT_INFERENCE.md` no KidOS e
[o estado conjunto](GAME_KIDOS_INFERENCE.md). A integração instalada e os
workflows técnicos continuam pendentes; a alocação Root não libera as rotas
genéricas nem aprova QA. Contabilidade/autoridade de orçamento e critérios de
qualidade são controles diferentes, sem outro executor de inteligência.

## Escopos e política

Cada invocação reserva capacidade nos escopos ativos antes de chamar o modelo:

1. **Namespace:** produto, perfil e workspace autenticados no serviço por
   usuário. Agrega execuções, sessões e projetos desse ambiente, sem expor dados
   dos demais namespaces. Criar outra conversa ou projeto não zera o consumo.
2. **Etapa:** quando há um projeto vinculado e ciclo ativo, sua identidade de
   workflow e etapa. O débito pertence à etapa vigente na admissão; mudar de
   etapa ou projeto não transfere um débito já feito.

Chamadas anteriores à criação/seleção de um projeto consomem o namespace. Os
escopos não são selecionados pelo modelo ou por parâmetros públicos. Não há
um total comum entre produtos/workspaces diferentes nesta implementação;
isolamento de estado permanece válido. A fila de CPU/RAM por usuário e a
alocação de pedidos de build/teste/mídia continuam sendo controles distintos.

| Política padrão | Chamadas por bloco | Tokens por bloco | Máximo de blocos |
|---|---:|---:|---:|
| Namespace | 512 | 16.777.216 | 16 |
| Etapa | 128 | 4.194.304 | 16 |

Uma invocação tem piso padrão de **65.536 tokens** em cada escopo envolvente.
Com metadados suportados no callback oficial, reserva o maior entre os pisos
instalados e a estimativa das mensagens/ferramentas mais margem de resposta;
sem esses metadados, conserva o piso. Veja o
[cálculo e seus limites](INFERENCE_REQUEST_RESERVATIONS.md).
O primeiro limite atingido — chamadas ou capacidade para a reserva — bloqueia
a próxima admissão; o total de chamadas da tabela não é uma franquia independente
do limite de tokens.
`inferenceBudgetPolicy` só é fornecida pelo processo proprietário. A API pública
não aceita limites, preços ou concessões. O tamanho dos blocos existentes não
aumenta automaticamente após instalar uma política maior. Limites menores são
aplicados ao consultar/admitir. O teto de renovações vem da política instalada;
elevá-lo permite uma nova confirmação, sem adicionar blocos por si só.

Os contadores persistem no SQLite e não têm reinício automático diário. Apagar
uma conversa não concede outro orçamento: o registro de uso não fixa a conversa
por chave estrangeira nem depende de seu histórico permanecer na interface.
Revisão/configuração administrativa da política ainda não tem superfície própria
nos aplicativos; o parâmetro atual pertence à configuração interna do serviço.

## Uso informado e uso desconhecido

Ao terminar uma invocação, `usage_metadata.input_tokens` e `output_tokens`
válidos ajustam a reserva para o total informado. Se faltarem metadados,
houver erro ou a chamada estiver pendente durante uma queda, a reserva continua
contabilizada e a medição aparece como não informada. Ausência de metadados não
significa custo zero. A recuperação converte pendências em uso não informado,
sem reembolso ou repetição automática da chamada.

O snapshot distingue `calls`, `chargedTokens`, `reportedInput`, `reportedOutput`,
`unreportedCalls` e `pendingCalls`. Uma operação admitida não recupera sua
contagem de chamadas em caso de falha/cancelamento. Admissão e reservas são
transacionais em todos os escopos; uma falha de gravação não deixa débito parcial.

Os identificadores das tentativas vêm do LangChain. Hooks duplicados da mesma
tentativa pendente compartilham a admissão; respostas repetidas não debitam duas
vezes. Uma tentativa já encerrada não autoriza executar novamente um provedor
sem outra identidade. O registro contém IDs, escopos, contadores e políticas;
não recebe prompts, respostas, raciocínio, anexos ou credenciais.

Isso é controle de **invocações LangChain e tokens informados/reservados**, não
medição independente de cobrança. A quantidade real de tokens pode exceder a
reserva de uma chamada já iniciada; o excesso é registrado integralmente e
bloqueia a próxima admissão. Uma chamada não tem aqui teto de entrada/saída
imposto ao provedor. Retentativas HTTP internas do SDK também não constituem
necessariamente novas invocações LangChain. Não apresentar este contador como
limite financeiro rígido ou prova da fatura do provedor.

## Pausa, decisão e recuperação

Quando um escopo não cobre outra chamada/reserva, o serviço interrompe a
admissão e solicita uma confirmação pelo fluxo durável de aprovações existente.
O run aparece em `awaiting_approval`; nenhum novo pedido daquele callback chega
ao modelo enquanto aguarda. O pedido mostra a ampliação concreta de chamadas e
tokens. Não cancela builds independentes nem amplia ferramentas ou permissões.

Cada decisão acrescenta um bloco aos escopos bloqueados, dentro do teto
instalado. Versão, política, escopo e identidade da decisão são vinculados.
Decisões concorrentes sobre o mesmo bloco não multiplicam a concessão; callbacks
duplicados e modelos paralelos compartilham a espera correspondente. Se outros
pedidos continuam pendentes, responder a um deles não apresenta o run como
livre de espera. O cliente só responde aos pedidos despachados à sua identidade
e namespace.

Fechar/desconectar o cliente conserva a espera. Após reiniciar o motor, o cliente
retoma o run pelos mesmos mecanismos de checkpoint/recibos; a confirmação
pendente volta a ser apresentada. Aprovações respondidas não são consumidas
novamente. Negar a continuação impede a chamada seguinte e preserva projetos e
checkpoints; o turno termina em falha ou incompletude conforme a fase. Ao
atingir o teto instalado, o diagnóstico exige revisão administrativa, sem
iniciar outro projeto, provedor ou mecanismo silenciosamente.

## API e interfaces

`inference.budgets.get` aceita somente `{ sessionId }`, valida a sessão pelo
registro autenticado e retorna os escopos atuais com política efetiva, consumo,
alocações e condição de continuação. A capacidade `shared-inference-budgets`
indica suporte a esse contrato. Os SDKs oferecem `getInferenceBudgets` e
`get_inference_budgets`. Não há RPC público de redefinição/concessão nem
ferramenta de orçamento no catálogo do modelo.

O controlador compartilhado consulta o snapshot; a aba **Builds e testes** do
Game Studio apresenta uso do ambiente e da etapa junto do ciclo. As mensagens
distinguem chamadas dos modelos dos pedidos de build/mídia. A decisão de
continuação aparece na conversa que está executando, pelo fluxo existente.
Dados de uso na UI não são autoridade para executar ou conceder capacidade.

## Verificação e trabalho restante

`test/engine-inference-budgets.test.ts` cobre as transações, tokens/overages,
concorrência antes do provedor, herança Standard/Deep, subagentes paralelos,
hooks duplicados, compactação oficial, Mac com modelos/streaming/JSON oficiais,
recusa, isolamento, política após reinício e confirmação recuperada. Os testes
usam inferência simulada, sem alterar provedores reais. O ensaio TLS/IPC em
`engine-game-workflows.test.ts` verifica também leitura nos SDKs TS/Python.

O smoke compartilhado de Game Studio faz uma invocação de leitura por namespace
contra um servidor HTTP/SSE simulado privado, através do motor empacotado e do
modelo LangChain real. Verifica o débito informado, exibição e isolamento; não
usa o Ollama pessoal. Sua evidência em `output/playwright/game-studio/ui-evidence.json`
inclui os snapshots de inferência e o manifesto. As bridges são emuladas nesse
percurso. Os ensaios Electron/VS Code reais usam perfis temporários e verificam
a integração de leitura/layout; não certificam a conversa final instalada ou
o custo/desempenho de um modelo real.

Continuam pendentes orçamento monetário com preços administrativos verificáveis,
limites de duração/saída antes da chamada, cobertura de retentativas de transporte,
assistência/embeddings/geração de assets, configuração administrativa na UI,
qualificação/implantação protegida KidOS e aceitação/distribuição nas demais plataformas. Os
marcos de jogos, qualidade criativa, portfólio e playtests do plano não são
substituídos por essa proteção de execução.
