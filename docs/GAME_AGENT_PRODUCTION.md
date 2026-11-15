# Game Design no executor comum

O [guia de interface responsiva](GAME_WINDMAIL_RESPONSIVE_UI.md) acrescenta
requisitos de tamanho CSS, orientação, múltiplos contatos e cancelamento ao
conteúdo comum. Não introduz coordenador/template obrigatório ou ferramentas.
Seu efeito em geração real continua sem avaliação de inferência autorizada.

Estado: **fonte de desenvolvimento; sem nova instalação ou aceite visual**.
Leia a [arquitetura](SUITE_ARCHITECTURE.md), o [plano integral](GAME_DESIGN_IMPLEMENTATION_PLAN.md)
e a [API de produção](GAME_PRODUCTION_API.md).

## Perfil v2 e contrato legado

`packages/game-design/production.json` define o perfil de produção **0.2.0**, com
schema de design v2 e sete especializações: direção de design, engenharia de
jogabilidade, direção de arte, áudio, conteúdo, revisão de qualidade e desempenho.
`prepareGameProduction` prepara conteúdo/perfis; não chama modelos nem ferramentas.
Os papéis são executor, planner e evaluator já configurados no produto; o
[parecer sobre PNGs](GAME_VISUAL_OPINIONS.md) exige o papel `vision` explícito.

O contrato v1 em `module.json` permanece em **0.1.0** para o snapshot/consumidor
KidOS e importadores existentes. Ele não recebe as ferramentas workspace desta
frente. O pacote-fonte agora é 0.2.0; essas versões não substituem a versão do
motor ou a release 1.0.2 instalada.

## Caminhos ativos em desenvolvimento

O Agent Service fornece uma porta interna `GameAgentPort`, com catálogo próprio,
operações e evidências. Ela nunca é desserializada de um pedido de cliente.

- VS Code: `runs.*` → `executeGraph` → `gameProductionProfile` → grafo oficial.
- Mac: `desktop.*` → `OllamaDesktopRuntime` do Agent Core → mesmo preparador →
  grafo oficial. Não há executor novo dentro do Electron.
- Navi: continua no adaptador protegido, sem essa porta workspace. A integração
  v2 exige ferramentas Core próprias, broker e atualização fixada do consumidor.

O supervisor escolhe semanticamente as ferramentas pelo pedido e pelo contexto.
`game_studio` retorna a orientação completa, o projeto vinculado à conversa e as
capacidades realmente sondadas. Não existe detector isolado da palavra “jogo”.
No Deep Agent, os sete especialistas são subagentes síncronos oficiais, sem outro
coordenador. No Standard, o supervisor dispõe do perfil e das mesmas ferramentas;
a delegação em sete subagentes é uma capacidade do caminho Deep.

O supervisor recebe o guia completo por orientação dinâmica oficial quando o
contrato semântico é `game_delivery`/`game_project_change`. O schema de estado é
compartilhado com o gate: cada middleware declara os campos que precisa ler.
Sem contrato (execução SDK genérica), o perfil também fornece o guia; contratos
de respostas e edições comuns conservam apenas o roteamento curto. A orientação
é anexada ao `SystemMessage` daquela chamada, sem criar mensagens adicionais na
conversa ou outro loop. Especialistas conservam seu guia próprio. `game_studio`
continua sendo a sondagem das capacidades reais; nomes citados no texto não
concedem autoridade. Uma edição limitada não vira entrega integral ou reescrita.

O guia distingue criar um jogo novo de continuar o projeto vinculado: receita
inválida, build falho ou orçamento esgotado não são motivo para substituí-lo.
Outro jogo existente exige descoberta e seleção explícitas. Isso é orientação
comum do módulo, não classificação por palavras, trava da UI ou garantia de que
um modelo a seguirá. A qualificação real deve conservar a identidade original e
registrar desvios, sem mudar uma execução ativa para uma nova versão do guia.
As instruções de mídia refletem os formatos reais: SVG ou PNG conforme a operação,
PNG registrado antes de composição/atlas e WAV no renderizador de áudio; mudar
extensões não converte arquivos nem produz assets ausentes.

Áudio pode pedir [`waveformBins`](GAME_AUDIO_ANALYSIS.md) explicitamente. O worker
mede o WAV codificado e `game_asset_result` expõe o resumo digital por canal,
hash e trechos de baixo nível antes de qualquer aplicação. O sidecar conserva
o envelope detalhado; o Studio apenas desenha os valores. Pico/RMS ou ausência
de clipping não certificam música, efeitos, audição física ou conclusão do jogo.

Os compiladores workspace oferecem o import opcional e verificado
[`@companion/game-audio`](GAME_AUDIO_RUNTIME.md). Planejar estados sonoros e
eventos com assets reais, preload, gesto inicial, erros, mute/pausa e encerramento;
não tratar o módulo como geração de música ou prova de mixagem. O Core fixo não
oferece esse import, e um snapshot do mixer não é evidência de som percebido.

A [versão1.1 do mixer](GAME_AUDIO_AAC_RUNTIME.md) recebe WAV ou a variante M4A
AAC-LC produzida pelo codec isolado. Escolher o caminho explicitamente, preservar
o master e considerar orçamento de PCM/reamostragem; MP4 genérico é recusado.
Uma variante menor não equivale a pacote inteiro menor ou mixagem aprovada.

O import opcional e fixado [`@companion/game-save`](GAME_SAVE_RUNTIME.md) fornece
estado JSON versionado dentro do jogo web. Usar identidade estável, validação,
load e stamp exatos; migração/descarte são explícitos. Preservar o progresso do
design, não só o recorde, e testar reload/retomada real. Não confundir save do
jogo com memória do agente ou persistência de previews temporários. Core1 o recusa.

Especialistas recebem apenas ferramentas de leitura aprovadas e negação explícita
de escrita do filesystem herdado. Testes exercitam a delegação real e a tentativa
de escrita bloqueada. O supervisor persiste as alterações; o parecer de um
especialista não altera arquivo, projeto, licença ou qualidade por si só.
A produção continua usando cancelamento, checkpoint, callbacks e limites de
execução do motor. As [etapas persistentes](GAME_PRODUCTION_WORKFLOWS.md) reúnem
critérios e alocação de pedidos de build/teste/mídia. Contadores ou limites de
recursão não comprovam orçamento compartilhado. A
[admissão de inferência](INFERENCE_BUDGETS.md) agrega invocações e tokens
informados/reservados entre sessões/projetos e na etapa, com confirmação durável;
custos, duração e cobertura de toda operação de IA continuam pendentes.

## Ferramentas e autoridade

| Ferramenta | Resultado |
|---|---|
| `game_studio` | Projeto da conversa, guia e capacidades |
| `game_libraries` | Busca paginada de seleções exatas do catálogo offline, arquivos dependentes/licenças e nomes de animações; somente leitura |
| `game_projects`, `game_select` | Descoberta e seleção explícita de um projeto do namespace |
| `game_project`, `game_design`, `game_assets`, `game_read_file` | Leitura de metadados, seções/páginas e arquivos da revisão |
| `game_check_tests` | Conferência somente de leitura da receita web salva e das referências ao design, sem navegador ou aceite |
| `game_create` | Abre um projeto persistente com título, briefing tipado e engine; design/arquivos/assets omitidos começam vazios, sem aprovação de produção |
| `game_update_design` | Nova revisão, preservando arquivos/engine |
| `game_write_file` | Arquivo UTF-8/binário verificado e nova revisão transacional |
| `game_edit_file` | Edições literais sequenciais de texto, com hash do arquivo e revisão exatos; commit atômico e recibos comuns |
| `game_build`, `game_job` | Build da revisão exata e consulta do job |
| `game_jobs` | Descoberta paginada dos IDs reais e resumos de build/validação/mídia do projeto, mais recentes primeiro |
| `game_validate`, `game_quality` | Coleta instalada e pendências independentes de qualidade |
| `game_workflow`, `game_advance_stage` | Leitura da etapa/alocação e avanço condicionado à fonte atual; sem concessão de pedidos extras |

O catálogo pertence ao serviço. Declarações de cliente com os mesmos nomes ou
host `service-game` são rejeitadas. Não é possível trocar o efeito de uma operação
para classificá-la como leitura. Modo Plano não oferece ferramentas mutantes e
continua recusando uma invocação forjada. Revisar exige aprovação exata; build e
coleta externa também exigem confirmação em Auto edits. A forma do pedido atende
os contratos de aprovação Mac e VS Code. Negativa preservada impede um falso
aceite, mesmo após outras alterações parciais.

A identidade persistida de LangGraph determina a chave de cada operação. Repetir
um mesmo passo recupera o recibo. Alterações usam `expectedRevision`; conflito
preserva a fonte e pede atualização. Arquivo, blob e revisão são gravados na mesma
transação. Falhas desconhecidas usam a reconciliação existente, sem repetição.
A porta não oferece shell, filesystem genérico ou escolha de provedor.

A [edição dirigida](GAME_FILE_EDITS.md) permite alterar trechos de um arquivo
existente preservando o restante. Match ambíguo ou ausente não escolhe uma
ocorrência nem aplica parte do pedido. O hash é do arquivo lido, não do projeto;
revisão e recibo mantêm as garantias de concorrência/replay. A
[leitura dirigida de fontes](GAME_SOURCE_TEXT_PAGES.md) complementa esse percurso:
`game_read_file.textPage` usa revisão/hash obrigatórios e páginas UTF-8 de até
16 KiB sobre fontes de até 8 MiB. Omitir a opção conserva a leitura anterior;
não cria editor de diff, build ou autoridade KidOS.

`game_check_tests` lê um `data/playtests.json` ou `data/playtests/*.json` da
revisão indicada (atual por padrão), usando o schema canônico do coletor. Recusa
JSON/UTF-8 inválido, conteúdo acima de1 MiB, ações/limites incompatíveis,
baseline ausente, teclas desequilibradas e referências de design inválidas.
Retorna revisão/hash de fonte e arquivo, até20 diagnósticos limitados e a
contagem omitida, sem ecoar chaves extras ou o arquivo. Não corrige o conteúdo,
constrói, coleta ou concede evidência de qualidade. O formato pode estar válido
e o jogo falhar. O arquivo precisa pertencer ao build real a testar. O caminho
workspace continua indisponível ao KidOS; não substitui operações Core.

A orientação separa as dependências: conferir/editar → construir → consultar o
job retornado até conclusão → coletar o build reconhecido. Leituras independentes
podem ser paralelas; a coleta de um build novo não pode antecipar o resultado do
build na mesma rodada. IDs históricos continuam consultáveis e não comprovam
uma fonte posterior. Não há outro scheduler ou loop de ferramentas.

`game_jobs` é leitura, inclusive em modo Plano e nos especialistas autorizados.
Retorna a revisão/hash da fotografia e `matchesSource` por job; isso compara a
fonte, sem certificar qualidade. Não inclui receitas ou bytes. Retomar uma conversa
não exige adivinhar IDs: o artefato e o job têm identidades distintas. Uma edição
posterior exige outro build para testar esses novos arquivos.

Antes da confirmação de `game_validate`, uma conferência sem efeitos verifica o
build concluído do namespace e o coletor registrado/permitido. Para coletores que
declaram o formato privado `browser-v1`, também decodifica a receita **dos bytes
do artefato exato**, usando o design daquela revisão de build. Usa o mesmo
validador limitado de `game_check_tests` e do coletor, sem ler a fonte mais nova.
Uma receita inválida ou uma suíte solicitada ausente é recusada antes de pedir
autorização, sondar, reservar, debitar etapa ou criar job. O diagnóstico limitado
indica campo/limite, sem ecoar conteúdo ou chaves desconhecidas. Um alvo impossível
retorna erro de domínio com `rejectedBeforeExternalDispatch`, sem pedir aprovação,
criar job ou registrar recusa humana. Não é rejeição de schema sem recibo. A
admissão real repete a conferência após a aprovação e só então sonda disponibilidade
e reserva recursos. Recibos anteriores continuam sendo recuperados antes de entrar
nessa operação; efeito desconhecido exige reconciliação, sem nova execução.

Sem caminho explícito nem `data/playtests.json` no build, o coletor pode observar
apenas o boot; isso não satisfaz testes ausentes ou aceite. A declaração de
formato pertence ao registro do processo dono, ausente do pedido RPC/modelo.
Coletores legados ou de outras categorias preservam seu contrato. A admissão
repete a conferência após consentimento e o coletor a repete antes de abrir o
navegador. Recibos/jobs anteriores são recuperados antes dessas novas verificações,
sem repetir efeitos, invalidar histórico ou refazer uma falha antiga.

Ao faltar um arquivo da fonte fixada para produção, o diagnóstico inclui somente
seu caminho relativo validado e a revisão. Nomes inválidos não são reproduzidos.
A classe do erro não muda: falha conhecida do compilador web pode terminar
`failed`; efeito despachado de estado desconhecido continua em reconciliação,
sem repetição. Identificar `game.web.json` ausente orienta o modelo, sem criar o
arquivo por ele nem substituir validação ou aceite.

O middleware comum também confere o schema canônico antes do handler oficial.
Argumentos rejeitados retornam campos/tipos limitados, sem repetir o documento
inteiro ou admitir efeito/recibo. Não há coerção, remoção silenciosa de campos
ou afrouxamento da validação final. `GameToolInputRejection` tipa o evento
`game.tool_rejected`; as atividades existentes mostram o problema nos clientes.
Exceções após despacho e resultados desconhecidos continuam exigindo inspeção,
sem serem convertidos em rejeição de argumentos nem nova tentativa automática.

Cada erro pode acrescentar `hint`, derivado apenas da descrição do campo no
schema instalado que já foi apresentado ao modelo. São até 160 caracteres
Unicode, sem valores enviados, preenchimento automático ou descarte de conteúdo.
A consulta acompanha propriedades/itens e uniões declaradas: caminhos de até
12 componentes, 64 expansões de nós, 16 alternativas por união e descrições de
até 4.096 unidades de texto. Ambiguidade, metadados herdados, referência `$ref`
ou limite atingido omitem a orientação; não resolvem URLs nem adivinham formato.
As descrições distinguem `progression.stages[].completion` (texto da etapa) de
`progression.completion` (objeto de conclusão global). Isso não altera tipos,
refinamentos ou critérios de qualidade. Os testes conferem também o retorno
recebido pelo grafo e a ausência de despacho/recibo para argumentos inválidos.

O catálogo publica o schema de **entrada**, preservando como opcionais os campos
que têm valor padrão. Só nos tools `game_create`/`game_update_design`, as duas
constantes internas `schemaVersion` podem ser omitidas e são preenchidas com o
número 2. Informar outra versão, texto, `null` ou documento serializado como string
continua inválido. Os schemas usam os mesmos construtores/refinamentos de domínio;
o contrato público de documento, arquivos e importação continua exigindo as
versões explícitas. Isso não preenche design, conteúdo, arquivos ou permissões.

Na abertura, `game_create.document` pode conter apenas `title`, `brief` e
`engine`. `design` omitido vira `null`, e `files`/`assets` omitidos viram arrays
vazios. O documento armazenado continua completo na forma v2; o design é
persistido depois por `game_update_design`, com as mesmas regras e referências.
O schema de entrada passa pelo documento canônico após esses defaults, sem
conversão de strings ou descarte de conteúdo inválido. A API/arquivo público
continua exigindo todos os campos de serialização. Rascunho não avança a etapa
Design nem ganha qualidade: `design-missing` continua bloqueando. Payloads
completos anteriores permanecem válidos; não há migração de banco/checkpoint.

`games.projects.linked` recebe `sessionId`; `games.projects.select` recebe
`sessionId` e `projectId`. Ambos validam o namespace da sessão e do projeto. A
seleção pública aguarda uma execução ativa terminar; a seleção interna do agente
faz parte de sua operação autorizada. Os SDKs oferecem `linkedGameProject` /
`selectGameProject` e equivalentes Python. Compartilhar o workspace não compartilha
conversas ou projetos entre os produtos.

## Conclusão do turno e do jogo

A classificação semântica inicial recebe os nomes das ferramentas do executor e,
quando fornecida pela porta privada do serviço, uma fotografia estrita do projeto
vinculado à sessão autenticada: ID, engine, revisão/hash, contagens e presença de
design. O serviço resolve namespace e seleção; nomes no prompt não selecionam
projeto. Não entram título, briefing, arquivos, credenciais ou indicadores de
permissão/qualidade. Não existe campo correspondente em RunSpec/RPC.

Ausência de arquivos colados no chat e projeto ainda vazio não significam falta
de referência: a execução pode inspecionar o estado salvo pelas ferramentas.
A fotografia não equivale a ler conteúdo, executar ferramenta, autorizar operação
ou provar conclusão. Não impõe um resultado ao classificador; perguntas distintas
e referências realmente ambíguas mantêm sua interpretação semântica. Os caminhos
Mac e VS Code usam o mesmo middleware oficial `beforeAgent`, sem outra chamada,
loop ou regra de palavras-chave. Contexto privado inválido falha explicitamente.

O classificador deve interpretar a intenção
do usuário, separada da viabilidade: falta de software, credenciais, ferramentas
ou aceite não transforma um pedido claro em contexto incerto. A consulta das
capacidades e os impedimentos acontecem na execução. Modo Plano, contexto
realmente ausente e os gates de conclusão continuam validados. A
[avaliação com modelo real](GAME_GENERATION_EVALUATION.md) conserva a falha que
motivou essa correção e distingue geração, observação e aceite.

O verificador semântico distingue:

- `game_project_change`: mudança delimitada no design/arquivo, comprovada por uma
  revisão real, sem inventar um diff no diretório do host.
- `game_delivery`: entrega do jogo completo, dependente da avaliação de qualidade
  vigente, do ciclo concluído com aceite da revisão/hash atuais e da ausência de
  produção pendente ou desconhecida. Compilar, salvar arquivos ou receber
  “satisfeito” do modelo não atende esse estado enquanto houver critérios pendentes.

O serviço calcula evidências pelas revisões/recibos e pela qualidade atual do
build. Interfaces e modelos não fornecem o campo `ready`. Um projeto pode ter uma
alteração concluída e continuar sem aceite de jogo completo. Preview executável,
exportação de fonte, pacotes e playtests conservam seus próprios requisitos.

## O que falta

`game_review_image` oferece parecer textual sobre uma PNG exata do projeto ou
relatório, por uma chamada privada do motor ao modelo de visão configurado.
Imagem não entra no checkpoint pai ou ToolMessage, e o helper não transmite
deltas públicos. Mantém limites/recibos compartilhados e qualidade falsa;
sem papel configurado não escolhe outro modelo. Fonte e serialização simulada
não comprovam interpretação real, melhoria artística ou aceite instalado.

Os grafos também podem ler [diagnósticos completos de relatórios](GAME_REPORT_READS.md)
pelas operações comuns de leitura, preservando IDs, hashes e falhas anteriores.
Isso fecha o acesso aos erros textuais do navegador; não demonstra que o modelo
real produziu uma correção, analisou imagens ou entregou um jogo aprovado.

A fonte conecta as ferramentas aos executores e agora inclui a superfície
[Game Studio](GAME_STUDIO_UI.md) de projeto/preview/exportação em desenvolvimento.
O painel passou pelo VS Code real e a janela Electron em perfis temporários no
Mac; ainda faltam o aceite dos aplicativos/VSIX instalados e demais plataformas. A
cadeia de assets, coletores de qualidade além da
[observação automatizada de navegador](GAME_BROWSER_OBSERVATIONS.md), produção completa dos quatro adaptadores,
integração Core/Navi, orçamento financeiro/de duração e cobertura integral da IA,
portfólio, dispositivos físicos e
playtests continuam obrigatórios. Não promover esta frente como produto final.

Verificar `npm run check`, `npm test`, `npm run build`, `npm run engine:build` e o
smoke local de leitura. `test/engine-game-agent.test.ts` usa inferência simulada
com o grafo oficial e builds reais em pastas temporárias: não é uma avaliação de
qualidade de jogos gerados por modelos reais ou das interfaces instaladas.
