# Avaliação de produção pelo modelo real

Desenvolvimento em **2026-11-11**, sem instalação ou release. Leia o
[plano integral](GAME_DESIGN_IMPLEMENTATION_PLAN.md), a
[integração no executor](GAME_AGENT_PRODUCTION.md) e os
[jogos autorais de referência](GAME_REFERENCE_GAMES.md). São provas diferentes:
importar Lume/Farol não demonstra produção autônoma de um novo pedido.

Os relatos intermediários abaixo preservam fotografias de execuções que então
estavam ativas. A [atualização terminal](#atualização-terminal-e-diagnóstico-do-transporte--2026-11-11)
registra o encerramento da nona e décima continuações; não iniciar outra tentativa
com base nas descrições históricas de “em andamento”.

## Corpus e execução

`test/game-generation-cases.json` contém cinco pedidos: arcade 2D, exploração
3D, cooperação local, puzzle Godot e corrida Unity. Nenhum inclui documento de
design, arquivo de implementação, asset ou exemplo preparado. O arquivo é
fixado por SHA-256 antes da invocação e copiado no registro da tentativa.
Não editar pedidos já utilizados para ocultar uma falha. Novas versões precisam
de identificação própria e preservação das tentativas anteriores.

“Inédito” aqui significa primeira apresentação àquela execução, com perfil e
conversa novos e sem fornecer os exemplos de referência. Não é uma alegação
sobre dados de treinamento. Após uso para corrigir o produto, um caso passa a
servir também como calibração/regressão, sem representar um novo teste cego.
Os casos ainda não executados conservam seu valor como primeira apresentação.

```sh
npm run compile:tests
npm run engine:build
node scripts/qualify-game-generation.mjs --case=windmail --ollama-model=qwen3.5:latest --runtime=standard --max-schema-rejections=4
```

É possível escolher explicitamente papéis diferentes com
`--planner-model=gpt-oss:20b --evaluator-model=gpt-oss:20b`, mantendo
`--ollama-model` como executor. Sem essas opções, os três nomes continuam iguais
ao executor. `roles` em `control.json`, `input.json` e `report.json` registra a
configuração resolvida; um papel configurado não comprova que o grafo o invocou.
Nenhuma configuração dos aplicativos é alterada, e não há descoberta/download ou
troca automática de modelo após falha.

`--context-window=<tokens>` declara explicitamente a mesma janela de entrada
para os aliases dos três papéis. Use somente um valor efetivo verificado para
todos eles; o runner não usa máximos de família, descobre ou altera configuração
do servidor. O campo passa pelo perfil comum, fica em `control.json`, no spec
de `input.json` e no relatório, e exige `model-context-window-v1` no motor.
Ausência da opção conserva o comportamento anterior. Uma continuação é outro
run explícito sobre o domínio preservado; a declaração não modifica o spec,
checkpoint ou orçamento do run anterior. Leia a
[fronteira de contexto](MODEL_CONTEXT_WINDOWS.md).

O modelo precisa estar instalado e explicitamente escolhido; o runner não baixa
modelos, editores ou pacotes. Godot utiliza somente a provisão local existente
quando seu caso é selecionado. Unity indisponível continua sendo impedimento,
sem troca silenciosa de engine nem alteração do aceite exigido no plano.

O runner é cliente SDK do serviço/Node empacotados: usa o perfil de inteligência
do editor, com verificação de conclusão, mas sem editor ou ferramentas de host.
O grafo LangChain/DeepAgents existente faz todas as decisões e invocações. O
runner não escreve o design, corrige código gerado ou cria outro loop de agente.
Isso não é aceite do VSIX instalado ou da interface visual Mac.

## Escopo e confirmações

Novas tentativas iniciais usam armazenamento privado durável em um filho
exclusivo de `.cache/game-generation-state/`, com namespace novo;
a continuação explícita preserva a sessão/namespace original conforme a seção
de retomada abaixo. A execução autoriza escritas apenas no domínio de jogos do
serviço. Nenhum filesystem,
shell, editor, processo genérico, credencial ou provedor adicional é registrado.
As confirmações automáticas de desenvolvimento são limitadas pelo helper
`test/game-generation-policy.ts`: run exato, contrato canônico, projeto/revisão
atuais e engine pedida. Permitem build, coletor de navegador instalado e worker
local de PNG/áudio. Não renovam orçamento, registram provedores nem concedem
autoridade parental. Não pertencem ao produto ou ao catálogo do modelo.

O limite de rejeições é declarado antes de admitir a tentativa (quatro por padrão).
Ao atingir esse número de diagnósticos canônicos distintos antes do despacho, o runner solicita
cancelamento do run original pela API e aguarda seu estado. Não é timeout,
tentativa de executar novamente ou mudança nos limites do produto. Trabalho já
admitido conserva seus recibos, recursos e requisitos de reconciliação.

Uma comparação de pixels não concede aprovação artística, semântica ou humana.
O fim do run e `completionOutcome` são registrados separados de builds, relatos
e `quality.ready`. O observador pode solicitar uma coleta independente quando
o modelo não o fez; isso aparece como `hostObservation`, sem creditá-la ao agente
ou repetir um caso que falhou. Não há geração de fonte ou novo build pelo runner.

## Evidência e recuperação

Saída por tentativa: `output/game-generation/<caso>/<data-id>/`. Inclui pedido,
hash do corpus/motor, eventos públicos sem deltas de texto, decisões, resultado,
projetos/fontes editáveis, builds e relatórios que realmente existirem. Falhas e
ausência de projeto também são resultados. O estado privado não é copiado para
evidência: não publicar chaves TLS, credenciais, banco ou checkpoints.

`control.json` registra PID, diretório privado, sessão e run originais para
inspeção. Se o run ou produção ainda não tiver resultado conhecido, o serviço
é preservado e não há reinício automático. Um timeout de observação não autoriza
outro job. Inspecionar a identidade original pela API antes de decidir retomada
ou encerramento; não executar novamente o comando apenas porque ficou sem saída.
O runner atual não instala nem reinicia o serviço da conta do usuário.

A partir da quinta tentativa, antes de iniciar o processo, o runner copia o motor
verificado para o estado privado, verifica novamente todos os arquivos e exige o
mesmo manifesto. O processo utiliza essa cópia fixa; builds posteriores na árvore
de desenvolvimento não substituem seus módulos. `engineDirectory` registra o
caminho. As tentativas anteriores conservam a indicação da ferramenta original;
não atribuir retroativamente a elas essa proteção adicional.

```sh
node scripts/inspect-game-generation.mjs --attempt=output/game-generation/<caso>/<tentativa>
```

Esse inspetor só autentica e lê a tentativa original: não usa `host.poll`, aprova,
cancela, registra ou inicia nada. Confere diretório privado, credencial regular
protegida, produto/perfil, PID original, certificado fixado e manifesto do motor.
A credencial fica somente no bootstrap privado temporário, nunca nas evidências.
As duas primeiras tentativas guardavam o token apenas na memória do observador;
o inspetor recusa esses casos antigos sem tentar recriar acesso. Essa limitação
foi corrigida antes da terceira tentativa. A segunda foi cancelada por um cliente
operador distinto provisionado somente no mesmo namespace temporário; o
cancelamento pela API e o estado final `cancelled` foram registrados, sem tocar
na instalação ou nas permissões pessoais.

Estados como `draft-only`, `design-only`, `source-only`, `built-not-observed`,
`runtime-observed-failed`, `runtime-observed-incomplete` e `runtime-observed-not-accepted`
descrevem o alcance observado, não qualidade equivalente à referência Poki.
O runner atual distingue metadados iniciais, design e arquivos registrados pelos
campos `documentState`. Nas primeiras nove tentativas, `source-only` também era
usado quando só existia o documento vazio: consultar `snapshot.json` e não inferir
implementação pelo nome desse estado. Os relatos históricos não foram reescritos.
Arte/áudio, performance física, dispositivos, pessoas, pedidos inéditos e o
restante da matriz permanecem os requisitos do plano. `fullProductAcceptance`
é sempre falso neste ensaio de desenvolvimento.

## Primeira falha preservada

No primeiro `windmail`, Qwen 3.5 encerrou a classificação como `uncertain` porque
“não pode executar”, apesar do pedido explícito e das ferramentas de jogo no
serviço. Não criou projeto. Evidência:
`output/game-generation/windmail/2026-11-11T08-32-12-850Z-d8b7fe47/`.

O classificador comum agora recebe os nomes das ferramentas fornecidas pelo
executor e separa intenção de viabilidade. Falta de software, credencial ou
prova de qualidade é impedimento de execução, não motivo para pedir ao usuário
que explique novamente um objetivo claro. Contexto realmente ausente continua
interrompendo; modo Plano, permissões e critérios de conclusão são preservados.
O hook continua no middleware oficial, sem outro executor.
[Middleware LangChain](https://docs.langchain.com/oss/javascript/langchain/middleware/custom).

Resultados posteriores devem ser lidos no
[acompanhamento](GAME_DESIGN_IMPLEMENTATION_STATUS.md) e nas tentativas exatas;
a existência deste runner e testes simulados não comprova que um jogo foi gerado.

## Rejeições reais e feedback ao modelo

Na segunda tentativa, o mesmo pedido/corpus/modelo foi classificado como
`game_delivery` e consultou `game_studio`, mas seis chamadas `game_create`
observadas foram rejeitadas. Entre os erros: documento codificado como string,
`camera` como objeto em vez de texto, campos fora de lugar e arrays obrigatórios
ausentes. Nenhum projeto/build foi criado. O operador encerrou a tentativa pela
API por essas rejeições concretas, sem repetir efeitos ou tratar a passagem do
tempo como autorização. Evidência:
`output/game-generation/windmail/2026-11-11T08-39-31-767Z-f3f4926a/`.

O diagnóstico revalidou somente argumentos rejeitados pelo schema canônico;
apenas nomes de ferramentas, caminhos/tipos e mensagens de validação foram
extraídos. Nenhum checkpoint, raciocínio do modelo ou credencial foi exportado.
`output/game-generation/intent-comparison-20261111-a1.json` conserva a comparação
de intenção. São observações de desenvolvimento, não evidência estatística.

O núcleo agora valida argumentos canônicos no middleware oficial antes do
handler e retorna `ToolMessage` de erro com caminhos/tipos limitados, sem ecoar
o documento enviado. Não converte strings em objetos, elimina campos extras ou
troca uma exceção de efeito desconhecido por erro de validação. A autoridade
continua validando novamente as chamadas aceitas. O evento tipado
`game.tool_rejected` e as atividades Mac/VS Code dão visibilidade à rejeição;
não constituem execução ou qualidade aprovada.

Standard e Deep têm testes com argumentos inválidos seguidos de correção: só a
chamada válida cria uma revisão/recibo. Um teste separado conserva
`awaiting_reconciliation` sem repetir um efeito desconhecido. O retorno recebido
pelo próprio grafo também é conferido para não ecoar argumentos grandes.
A terceira tentativa confirmou os diagnósticos reais limitados, mas o modelo
repetiu argumentos inválidos e atingiu quatro rejeições. O orçamento declarado
solicitou cancelamento, confirmado como `cancelled`; nenhum projeto foi criado.
Evidência: `output/game-generation/windmail/2026-11-11T09-09-23-960Z-ba6d4210/`.
O feedback/isolamento funcionaram; a produção de jogo nesse caso continua falha.
Uma comparação com outro modelo já instalado pode ser feita explicitamente em
novo namespace, registrando a escolha sem alterar os aplicativos ou anunciar
fallback de produção. Não atribuir generalização ou qualidade ao mero sucesso
de um diagnóstico.

## Constantes do contrato de entrada

A quarta tentativa escolheu explicitamente `qwen3-coder:30b`, já instalado, sem
mudar as configurações dos aplicativos, o corpus ou o limite de quatro rejeições.
Ela corrigiu os demais campos e alternou a posição de `schemaVersion`, deixando
uma das duas constantes obrigatórias ausente. Terminou `cancelled`, sem projeto
ou build. Evidência:
`output/game-generation/windmail/2026-11-11T09-23-31-052Z-2f450af9/`.
`diagnostics/version-fields.json` conserva apenas esses valores escalares, sem
exportar mensagens/checkpoints. Esse resultado continua sendo falha de produção.

O schema publicado ao modelo usava a forma de saída, fazendo campos com default
parecerem obrigatórios. Agora publica a entrada. Os tools de criação/design
preenchem somente as constantes de versão omitidas; os construtores canônicos
compartilham todas as regras de conteúdo e referências. O formato público e os
arquivos exportados continuam estritos. Versões incompatíveis e documentos
codificados como strings não são convertidos. Standard/Deep têm testes de
persistência do documento completo e rejeição desses casos, sem flexibilizar
autoridade ou qualidade.

A quinta tentativa conservou pedido/corpus/modelo/limite. As constantes deixaram
de falhar; houve um erro no tipo da câmera e três rejeições da relação entre
campanha e conclusão por pontuação. Terminou `cancelled`, sem projeto/build, em
`output/game-generation/windmail/2026-11-11T09-42-52-300Z-a77475db/`.
O diagnóstico anterior apontava o objeto `completion` e dizia apenas que campanha
precisava de encerramento. Agora identifica o campo `completion.type` e o literal
`ending`, com descrições das estruturas no schema. Não muda os valores aceitos
nem transforma um jogo por pontuação em campanha para satisfazer validação.
As cinco tentativas negativas continuam preservadas.

A sexta comparação, com o mesmo pedido/corpus/Qwen Coder/limite, também terminou
`cancelled` sem projeto/build:
`output/game-generation/windmail/2026-11-11T09-50-32-684Z-65e6233e/`.
Foram rejeitados documento como string, projectId nulo e duas invocações com
`progression.stages[].completion` como objeto em vez de texto. Nenhuma invocação
chegou a produzir projeto. Portanto esse ensaio não comprova resolução do problema
de produção pela nova descrição semântica. O resultado negativo e as fontes/logs
exatos permanecem em `verification/report.json`, separados das leituras bem-sucedidas.

A sétima tentativa escolheu explicitamente `gpt-oss:20b`, já instalado. Pedido,
corpus, motor, runtime Standard e limite quatro foram mantidos:
`output/game-generation/windmail/2026-11-11T09-55-17-607Z-4f6664cf/`.
O resultado terminal supera a inspeção viva anterior: `run.state=completed`,
`completionOutcome=incomplete`, sem projeto/build ou chamada de ferramenta.
O grafo realizou suas duas correções oficiais de conclusão; o modelo continuou
respondendo com texto/instruções. Não houve cancelamento ou rejeição de schema.
As leituras Standard/Deep anteriores passaram, mas não certificam produção.
`verification/report.json` preserva o resultado negativo e o hash de `report.json`.

A oitava tentativa recebeu orientação completa no supervisor por middleware
semântico. O GPT-OSS consultou `game_studio`, mas quatro documentos de criação
inválidos foram recusados. Terminou `cancelled`, sem projeto/build:
`output/game-generation/windmail/2026-11-11T10-19-50-398Z-b7ed63b7/`.
A prova adicional em `verification/wire-contract/` usa HTTP simulado para conferir
o schema e a orientação realmente enviados pelo conversor oficial; não certifica
que o provedor real os interpretou nem que um jogo foi produzido.

A nona tentativa avaliou uma abertura de projeto em duas etapas. `game_create`
aceita título, briefing tipado e engine; ausência de design/arquivos/assets inicia
um documento vazio válido. Isso não preenche conteúdo ou libera o avanço de
Design. A validação canônica e `game_update_design` completo continuam exigidos.
Não foi fornecido template, arquivo ou design ao modelo, e o pedido original
permanece intacto. Resultado terminal:
`output/game-generation/windmail/2026-11-11T10-35-43-218Z-820eac96/`.
O GPT-OSS criou e exportou o projeto `195d81bd-38bf-48ed-8c6a-8e10578ff4af`,
revisão 1, hash `0c1414f3a14f1fdd551dc039b26c016bb92dca590743437273488e2dec41c4c8`.
O documento tem `design:null`, zero arquivos/assets, nenhum job/build e
`quality.ready=false`. Após três rejeições de criação, a quarta foi o design
completo inválido; o limite declarado cancelou o run pela API. O inspetor chegou
depois do encerramento confirmado do observador e encontrou o socket fechado;
não reiniciou a tentativa. O resultado é persistência inicial, sem jogo gerado.

A décima tentativa manteve motor/pedido/corpus/runtime/limite, escolhendo Qwen
Coder como executor e GPT-OSS como avaliador (planner também declarado):
`output/game-generation/windmail/2026-11-11T10-43-09-157Z-e9ccdfaa/`.
Terminou `cancelled`, `draft-only`, após criar/exportar o projeto
`1410c52d-7bf6-4bdc-8f35-d747b6318abe`, sem design, arquivos, assets, jobs ou
build. Uma criação e três designs inválidos atingiram o orçamento declarado.
`documentState` e `quality.ready=false` conservam esse alcance. Configurar o
planner não demonstra uma chamada desse papel no runtime Standard sem objetivo.

Quatro rejeições foram escolhidas para diagnóstico inicial. Uma execução de
produção maior poderá declarar outro orçamento **antes** da admissão; deve
preservar todas as falhas e registrar a mudança de configuração. Não elevar o
limite de uma execução em andamento nem comparar tentativas com orçamentos
diferentes como se fossem a mesma condição. Mais tempo/correções não reduzem
critérios de conteúdo, build, qualidade, autoridades, dispositivos ou pessoas.

## Primeira avaliação de produção mais longa

A décima primeira tentativa declarou **12 rejeições** antes de iniciar, após os
dez ensaios curtos de diagnóstico. O motor ganhou descrições de campos e retorno
`hint` limitado ao schema instalado; pedido, corpus e modelos por papel continuam
os mesmos. Como motor e orçamento mudaram, não é comparação controlada com os
ensaios de quatro rejeições. Não foi reduzido o aceite do produto.

```sh
node scripts/qualify-game-generation.mjs --case=windmail --ollama-model=qwen3-coder:30b --planner-model=gpt-oss:20b --evaluator-model=gpt-oss:20b --runtime=standard --max-schema-rejections=12
```

Tentativa original:
`output/game-generation/windmail/2026-11-11T11-03-38-792Z-f0805f4c/`.
A inspeção autenticada de 11:08:39 UTC confirmou design presente e um arquivo
na revisão 3; ainda sem job ou build. É fotografia intermediária. O inspetor
agora acrescenta `documentState` vinculado ao hash/revisão do snapshot, separado
da leitura de metadados que pode ocorrer em outro instante. Não publica conteúdo
do design, código ou dados privados do bootstrap.

A consulta manual `ollama ps` durante o ensaio observou Qwen Coder com contexto
alocado 131.072 e GPU integral, no Mac com 64 GiB. A fotografia ficou em
`verification/ollama-context-observation.json`. Não alterou configurações,
não virou consulta periódica do produto e não comprova ausência de truncamento
em pedidos anteriores ou desempenho do jogo. A distinção entre contexto
alocado e configuração está na [documentação oficial](https://docs.ollama.com/context-length).

O resultado terminal da 11ª tentativa é `failed`, `source-only`, com zero
rejeições de schema. A revisão final 8 tem design e três arquivos, sem assets.
Dois builds anteriores falharam por arquivo ausente; não houve artefato ou QA.
A última chamada de inferência falhou por timeout ao receber cabeçalhos, depois
de a etapa avançar de Design para Core. `run.json`, `report.json` e
`verification/report.json` registram o resultado final; as inspeções anteriores
continuam datadas, sem serem convertidas em sucesso. O observador terminou,
preservando o estado privado e a fonte exportada. Não reiniciar o pedido em novo
namespace para ocultar esse resultado; continuar o projeto original após conferir
que run/jobs anteriores estão terminais, com histórico e alocações preservados.

Um candidato separado identifica o arquivo canônico ausente e sua revisão no
diagnóstico, omitindo nomes inválidos. Não modifica a classe do erro ou a
reconciliação. Foi qualificado com 527 testes mais 30 verificações e leitura
real Standard/Deep: `output/game-generation/source-diagnostic-20261111-a1/`.
Ele não foi o motor congelado da tentativa acima; sua aprovação não transforma
os dois builds malsucedidos em sucesso.

## Retomada de um projeto já gerado

O mesmo driver aceita `--continue-attempt=<diretório original>` junto de
`--feedback-file=<texto explícito, até 8 KiB>`. Mantém pedido/corpus, identidade,
namespace, sessão, projeto, recibos e alocações de inferência/produção. O feedback
é registrado como mensagem pública nova; não é código ou checkpoint importado.
Não recria credenciais, edita bancos ou reinscreve o produto. Uma nova execução
oficial lê o estado de domínio pelas ferramentas; não repete ferramentas antigas.

Antes de iniciar o serviço, exige run e todos os jobs anteriores terminais,
arquivos privados regulares, perfil/provedor/host vazios exatos, PID anterior
ausente e endpoint inexistente. PID vivo/reutilizado ou socket, mesmo possivelmente
antigo, causa recusa sem sinal ou remoção. Após conectar, confere novamente pela
API o run, todas as execuções da sessão, link de projeto, revisão/hash e jobs.
Uma divergência impede `runs.start` e conserva o estado para inspeção.

O candidato verificado do motor é copiado ao lado da versão anterior e congelado
antes de iniciar. A chave idempotente de continuação deriva do run anterior;
conflito não autoriza outra chave para repetir o efeito. Evidências registram
`evaluationKind: continuation`, origem, motor anterior/novo, feedback e baseline
de orçamento. O observador conserva a política estreita de aprovações e a mesma
regra de inspeção de estados desconhecidos. Não é uma rodada inédita, migração
de instalação ou aceite de recuperação em todos os clientes.

Os testes do verificador usam identidades descartáveis sem inferência: domínio
preservado, estados pendentes/desconhecidos, PID vivo, endpoint sentinela,
credencial exposta, autoridade de host e corpus alterado. Não representam execução
do jogo; o ensaio real deve ter seu próprio run, revisão, builds e relatórios.

## Descoberta após retomada e alvo de coleta

O catálogo comum agora oferece `game_jobs`, leitura paginada de IDs reais e
resumos do projeto. `matchesSource` compara com o hash da fotografia retornada,
sem conceder qualidade. A conferência antes da confirmação rejeita apenas alvos
impossíveis no namespace/coletor; não impede leitura/teste histórico autorizado
por um host. O harness deste ensaio tem política mais estreita: somente build
concluído da revisão atual. Uma recusa automática desse critério não é uma
pessoa recusando nem um erro de schema. A admissão real revalida depois da
confirmação e mantém recuperação/reconciliação anteriores ao despacho.

A terceira continuação `2026-11-11T13-16-09-385Z-c6ad46a2` consultou os jobs e
construiu a revisão22, mas pediu validar o build histórico13. O harness recusou
esse pedido; o run terminou sem resposta final confirmada. A coleta posterior
foi do **observador**, na revisão22, e falhou na receita antes do navegador.
Esperas excedentes e baseline ausente foram preservados, sem correção manual.
Consultar `verification/report.json` dessa tentativa e o acompanhamento para
estados/hashes; build atual não implica runtime observado ou jogo completo.

## Colisão de identidade e conferência antes da coleta

A inspeção estrutural posterior da terceira continuação localizou uma resposta
AI substituindo um turno anterior com o mesmo hash de ID. Os resultados de
ferramentas posteriores ficaram ao final. A correção está no middleware comum,
antes do reducer, conforme [identidade de mensagens](MODEL_MESSAGE_IDENTITY.md).
Não altera checkpoints antigos ou promove respostas intermediárias a finais.

O catálogo agora oferece `game_check_tests` para conferir a receita salva contra
o schema canônico e as referências de design. É leitura, não coleta, correção
manual ou aprovação de teste. O modelo deve persistir suas próprias correções,
construir a revisão e aguardar o job concluído antes de validar esse ID. O
arquivo empacotado continua sujeito à validação real. Esses recursos não mudam
a política estreita de aprovação do harness, limites ou requisitos de qualidade.

## Quarta continuação: compilação com runtime falho

`2026-11-11T13-46-10-028Z-15d96c9d` terminou com run `completed`, resultado
`incomplete`, na revisão23/hash
`422b1e8c9b24f1f653039a2ce2b8a5633d1409b3f48564420262b853cbe05045`.
O modelo corrigiu a receita, conferiu seu formato e compilou, mas não chamou
`game_validate`. A coleta posterior `f1dc3c56-489e-4ed1-9121-1df1bd89081e`
é do observador: o job completou e seus seis relatórios reprovaram runtime e
cenários. Foram observados canvas ausente e 84 erros, incluindo imagens e sons
referenciados sem arquivo empacotado. Não houve recusa humana nem QA aprovado.

O `report.json` original conserva `built-not-observed`, pois a classificação
anterior só distinguia observações totalmente aprovadas. Não foi reescrito.
`verification/report.json` agora contém o resultado terminal e os relatórios,
preservando a fotografia anterior separadamente. O runner seguinte distingue
coleta falha (`runtime-observed-failed`) e incompleta
(`runtime-observed-incomplete`) de ausência de coleta. Nenhuma dessas
classificações concede aceite integral, mesmo se o run ou coletor completar.

## Quinta continuação: backend ausente, sem novos efeitos

A execução Deep `0e4cd4ed-fab1-46c2-99b1-e8198e4f25f4`, tentativa
`2026-11-11T14-41-57-869Z-2499e9ad`, terminou `failed` com
`The editor backend is not registered.` Preservou revisão23, 14 arquivos e
zero assets; nenhum novo job ou coleta foi iniciado. Os seis relatórios
reprovados no relatório são históricos do build23, não outra coleta Deep.
A fotografia anterior e o estado terminal foram preservados separadamente.

A [correção de disponibilidade](WORKSPACE_BACKEND_AVAILABILITY.md) retorna o erro
V2 antes do despacho quando falta o registro, mantendo o mount reservado e o
tratamento de operações registradas. Não conecta um host fictício nem fornece
filesystem para contornar os projetos privados. O motor qualificado seguinte
usa manifesto `e36ef019d401bb6e8808ba1129990b852157bd633d21c98dc3e646aaf2d9bd44`.
A sexta continuação `2026-11-11T15-18-25-812Z-d8d9a3a9` usou o mesmo estado
privado, corpus, projeto, recibos e orçamento, sem arquivo ou recurso artístico
pronto fornecido pelo operador. O observador original terminou com saída 1:
run `cancelled` após atingir seu limite previamente declarado de 12 rejeições
canônicas de argumentos, a última em `game_update_design`. O relatório original
foi preservado e o resumo em `verification/terminal-outcome.json` o vincula por
hash. A revisão permaneceu 23, sem novos assets ou coleta. As falhas de navegador
incluídas são históricas da quarta continuação, não outra observação Deep.
A correção do backend permitiu avançar, mas não comprova produção artística,
design completo ou jogo completável. Não repetir por ausência do socket após o
encerramento normal do observador; qualquer continuação exige estado terminal
e decisão explícita, preservando dados/recibos/orçamento.

## Formatos e referência persistente na classificação — 2026-11-11

A descrição dos contratos passou a explicar RGBA com oito dígitos/alpha,
controles Q/C e `origin.referenceIds` obrigatório, sem coerção ou relaxamento.
O guia web também esclarece o canvas existente e as dependências GLB locais.
Tipagem, builds, **565 testes, um opt-in ignorado e 30 verificações** passaram
na composição `d324e8de133b79de8d52f64de71b0ffbb1a891b40ee367404a7090e1710ddb45`.
Houve um erro TypeScript intermediário no teste do schema de provedor; corrigido
antes da qualificação limpa, seu log continua preservado.

A sétima continuação `2026-11-11T16-47-23-925Z-b009e78e`, run
`113489e8-f551-4850-95d1-bb4ee7792cac`, terminou `completed/incomplete`
antes de chamar ferramentas. O classificador declarou faltar o projeto/contexto,
embora a sessão estivesse vinculada à revisão23 existente. Não criou recurso,
job ou coleta. `verification/terminal-outcome.json` fixa o hash do relato original;
as observações reprovadas inclusas nele continuam históricas.

A [referência privada do projeto](GAME_AGENT_PRODUCTION.md#conclusão-do-turno-e-do-jogo)
agora chega à interpretação semântica pelo serviço, nos caminhos Mac e editor.
Não vem de RunSpec, prompt ou interface; não inclui título/código nem concede
autoridade ou qualidade. Contexto inválido falha. A mesma interpretação oficial
continua decidindo o resultado; perguntas diferentes, ambiguidade real, Plano e
gates de evidência não são contornados. Não há outro loop ou chamada de reparo
da classificação.

Na composição `31cec5208d94a3927d0aeeea15fe4dedcc36a27a11569597a53959084002692c`,
passaram **569 testes, um opt-in ignorado, 30 verificações e 46 direcionados**,
tipagem, builds extensão/Mac/motor, roteamento simulado e smoke Ollama real
somente de leitura Standard/Deep. Evidências e fontes:
`output/game-generation/project-context-20261111-a1/report.json`.

A oitava continuação `2026-11-11T16-59-30-223Z-60d7c444` retém o mesmo
namespace, sessão, revisão inicial, recibos, corpus, papéis e limites. O primeiro
resultado observado foi a classificação correta do pedido e consultas reais
ao projeto/design/capacidades, sem fonte preparada pelo operador. No momento
deste registro a execução está em andamento: isso não demonstra novo build,
coleta, jogo completo ou aceite. Inspecionar seu handle/controle original;
não reiniciar pela ausência de saída nem recompilar os testes sob o runner ativo.

## Oitava continuação terminal e prévia de leitura — 2026-11-11

O handle original encerrou com saída1. Run
`efaae3c7-8c9f-44f0-8367-18be2cafa547`: `failed`, `Request timed out.`,
sem rejeição canônica de argumentos. Houve avanço real à revisão26/hash
`2108a4d6cf40ec99b2d55bffc12a1e76b89c8e88cfbd44d418030e2b24a6c962`
e build `0d819b57-08f1-4848-a900-4a4ebe451a20` concluído. O modelo não
produziu validação concluída nem resultado de entrega.

Após esse término, **o observador**, não o modelo, solicitou a validação
`1dfff065-6b3f-4fe1-96a1-cfb1a40041a0`. Ela falhou pela receita salva:
`scenarios[0].steps[1].ms` excede 2.000. Não publicou relatórios do build26.
Relatos/boot de builds anteriores no diretório continuam históricos. O resumo
`verification/terminal-outcome.json` fixa o hash do relatório original e atribui
corretamente essa tentativa, sem conceder QA à compilação.

Foi feita depois uma prévia isolada, somente de leitura, dos bytes exportados do
build26, com conferência de arquivos/hash. Não reiniciou o serviço, editou fonte
ou receita, repetiu validação ou registrou aprovação de qualidade. A captura de
boot ficou vazia e houve 14 erros, incluindo PNGs e MP3s referenciados sem recurso
empacotado. Registro:
`verification/preview-2026-11-11T18-02-19-307Z/`, dentro daquela tentativa.
Isso não é uma coleta autônoma ou aceite do jogo.

Próxima frente: validar a receita salva antes de consentir/admitir uma coleta,
reutilizando a validação canônica já oferecida por `game_check_tests`; conservar
as falhas e os limites. Recursos ausentes e o contrato do canvas precisam ser
resolvidos pelo próprio executor nas ferramentas disponíveis. Não preencher
arquivos, corrigir o código do caso ou trocar limites/provedor para transformar
esta avaliação em aprovação. O corpus usado continua calibração, não novo teste
cego. PNG vetorial e edição de áudio foram qualificados em fixtures separadas;
não foram retroativamente disponibilizados ao motor congelado dessa continuação.

## Conferência canônica antes da coleta — 2026-11-11

A composição `3073742de7459dd20d6262320af6c589906f59d49ebb4f17ee6135c04e918038`
passou **577 testes, um opt-in ignorado, 31 verificações e 22 direcionados**,
tipagem, builds de extensão/Mac/motor, roteamento simulado e smoke Ollama real
somente de leitura Standard/Deep. A primeira tentativa desse smoke usou o SDK
antigo da release e foi recusada por incompatibilidade **antes** do serviço;
seu log foi preservado. O driver isolado passou com o SDK da fonte corrente,
sem enfraquecer a verificação do artefato. Registro:
`output/game-generation/recipe-preflight-20261111-a1/report.json`.

O mesmo decoder canônico limitado agora atende `game_check_tests`, preflight,
admissão e coletor. O coletor web declara privadamente `browser-v1`; o serviço
lê os bytes do artefato e o design da revisão do build. Receita inválida ou
suíte explícita ausente é recusada antes de consentimento/probe/reserva/job.
Coletores de outro formato não são reinterpretados e replay tem precedência.
Isso não conserta o caso anterior nem muda seus relatórios/limites.

A nona continuação `2026-11-11T18-28-06-072Z-12672aa9`, run
`98d368b9-e1e2-487d-804e-6f012cd6cd35`, foi iniciada com essa composição.
Retém a sessão/projeto, corpus, papéis, orçamento e limite declarado de12
rejeições. O feedback informa as falhas preservadas do build26 e os formatos
PNG/WAV agora disponíveis; não fornece código/arte nem executa a correção pelo
modelo. No momento deste registro está **em andamento**, tendo consultado
`game_studio`; não há resultado ou aceite novo demonstrado. Preservar o handle
original e não recompilar `dist-tests` enquanto seu runner o utiliza. O corpus
continua sendo calibração, não pedido inédito.

## Continuidade e guia contraditório observados — 2026-11-11

A nona continuação permanece ativa no handle59131. Após consultar a receita
inválida da revisão26, executou `game_create`, criando
`1827304d-9c01-45e0-9f23-0417bf21da1a`, e escreveu arquivos nessa nova identidade,
em vez de corrigir o projeto vinculado. Não houve código/arte preparado pelo
operador ou renovação autorizada de orçamento. A observação é falha de fidelidade,
sem afirmar término ou qualidade do novo jogo. O namespace/inferência continuam
sob seus limites existentes; não corrigir o resultado substituindo arquivos.

A consulta de metadados por SQLite em modo somente leitura, sem nova conexão,
sinal, leitura de checkpoints ou modificação do run, confirmou o original
`28adbd09-3675-40a6-a472-b6934261fbe0` na revisão26/hash
`2108a4d6cf40ec99b2d55bffc12a1e76b89c8e88cfbd44d418030e2b24a6c962`.
O novo estava na revisão5/hash
`bda23637e7c6b26f4a9a4bd1a9aa679cc1c20ed9f5400f3fdfea49eba6855ce0`.
Registro: `output/game-generation/studio-drafts-20261111-a1/generation-state-readonly.json`.
Essa fotografia não substitui o relato terminal futuro do handle original.

Inspeção do `packages/game-design/production.json` encontrou contradição entre
roteamento (preservar o vinculado) e etapa2 (abrir primeiro um projeto sem condição).
A etapa11 também fala somente em SVG, embora o catálogo atual ofereça PNG real.
A próxima correção pertence ao conhecimento comum/perfil, seguida de qualificação;
não é justificativa para criar outro executor, colocar heurísticas nas interfaces,
fornecer conteúdo pronto ao caso ou alterar seus limites. Não há prova isolando
essa contradição como causa única do comportamento do modelo. O artefato congelado
da continuação ativa não será alterado retroativamente.

## Atualização terminal e diagnóstico do transporte — 2026-11-11

A nona continuação `2026-11-11T18-28-06-072Z-12672aa9` terminou em falha,
`Request timed out.`, com o projeto original na revisão26 e a cópia inesperada
na revisão6. A falha de fidelidade e a observação real falha permanecem no
registro; não houve aceite nem reparo manual dos arquivos.

A décima continuação `2026-11-11T20-32-39-879Z-fe144b11`, run
`35000285-f4a5-4897-85ba-b5299866d9c4`, usou o motor de fonte
`edab54c82c1f329c40abc07a6b42db968ead017dcd3f9dec64331f937483559f`
e `qwen3.6:latest` nos três papéis. O próprio grafo selecionou o projeto original,
que chegou à revisão31 com processamento/aplicação de assets. A cópia anterior
ficou na revisão6. Corpus, dados, reservas, limite de12 rejeições e critérios
foram preservados. O run terminou em falha com `terminated`, sem jogo aprovado;
essa mensagem não prova timeout, falta de memória ou queda do provedor.

A consulta delimitada ao armazenamento terminal encontrou 21 chamadas com usage
informado e uma `unreported`, ainda reservando 65.536 tokens. A leitura usou o
arquivo principal sem WAL e hash igual antes/depois, sem ler checkpoints ou
criar arquivos no estado original. A tentativa anterior de abertura somente
leitura pelo SQLite falhou; não foi tratada como banco ausente nem refeita com
permissão de escrita.

O [diagnóstico comum de transporte](MODEL_CAPABILITIES.md#falha-durante-a-resposta-do-modelo--fonte-de-2026-11-11)
foi qualificado separadamente, com duas causas simuladas para `terminated`,
propagação do erro raiz, eventos parciais/persistência, erros HTTP/autoridade e
reserva desconhecida. O novo motor de desenvolvimento tem manifesto
`512c1e6366a9354a9d483a0978e9f2988fe43304288b0ca737f7d17ed8bc9a29`.
Passaram oito cenários direcionados, 596 testes de aplicação (um opcional
ignorado), 31 verificações do repositório, builds e smokes somente de leitura
simulado e real Standard/Deep. Não houve nova geração, instalação, mudança de
prazo/modelo/contexto ou repetição automática da operação.

Registro de causa desconhecida, reprodução, hashes e limitações:
[`provider-termination-20261111-a1`](../output/game-generation/provider-termination-20261111-a1/report.json).
Os resultados anteriores permanecem intactos e não passam a contar como jogo
aprovado, pedido inédito, qualidade artística ou aceite físico/humano.

## Décima primeira continuação e recuperação — 2026-11-11

O run `9b7caa8c-1ac0-4f14-a160-1601e8ab424c`, diretório
`2026-11-11T21-47-46-521Z-f6dda6d8`, começou com o motor
`512c1e6366a9354a9d483a0978e9f2988fe43304288b0ca737f7d17ed8bc9a29`,
mesma sessão, `qwen3.6:latest` nos três papéis, corpus e limites preservados.
Não recebeu fonte ou arte pronta. Consultou o projeto/arquivos/jobs, registrou
sete chamadas com usage e chegou ao limite de 128 chamadas da etapa `core`.
A ampliação foi recusada pela política do ensaio, sem renovar blocos.

A observação perdeu conexão; seu handle 32693 terminou com exit1. O serviço
original estava ausente, mas o run armazenado ainda era `running`: não houve
resultado terminal válido que autorizasse outra continuação. Nenhuma revisão
nova, job pendente ou recibo de efeito `started` foi encontrado na inspeção
delimitada. Os projetos permaneceram nas revisões 31 e 6.

A [rejeição não observada da projeção do subagente](SUBAGENT_STREAM_RECOVERY.md)
foi reproduzida na composição anterior e corrigida no executor comum. A
recuperação oficial, com backup privado e motor congelado novo, deixou o run em
`awaiting_host` e preservou projetos/contadores. Não retomou IA ou ferramentas.
O serviço do ensaio foi encerrado normalmente. A autorização de um bloco
adicional está pendente; não se criou outro namespace/projeto para contornar a quota.

O registro de [recuperação real do estado privado](../output/game-generation/windmail/2026-11-11T21-47-46-521Z-f6dda6d8/recovery.json)
não é um relatório terminal de geração ou um jogo aprovado. Evidências da
correção, versões, testes, base dos playtests e pendências estão em
[`playtest-recovery-20261111-a1`](../output/game-generation/playtest-recovery-20261111-a1/report.json).

## Bloco adicional autorizado e falha identificada — 2026-11-11

Após a resposta explícita **“Autorizar um bloco adicional”**, a retomada do run
anterior em `2026-11-11T22-24-42-626Z-a9a607f7` releu a decisão antiga de recusa,
como previsto pelo checkpoint, e terminou em falha sem reescrever essa decisão
ou conceder cota. A fonte corrigida observou a rejeição do subagente e o serviço
não caiu como na composição anterior.

A continuação nova `2026-11-11T22-26-12-799Z-8fa8d753`, run
`3e459761-7276-43d3-839b-b09e85054023`, usou a mesma sessão, namespace, projetos,
corpus e `qwen3.6:latest` nos três papéis. O motor congelado tem manifesto
`0a7f0666fc7877b70acf4a4a439e54dccb7aea4c4f3ea382b7fe75039c13ca09`.
Uma política limitada ao projeto original/workflow/etapa `core`, bloco anterior 1,
aceitou uma única solicitação de continuação: até 128 chamadas e 4.194.304 tokens
adicionais. O recibo público `budget-authorization.json` vincula a autorização
ao run/approval; ele não altera o orçamento fora das rotas normais do serviço.
Não foi autorizado outro bloco, outro projeto ou um reset dos contadores.

O handle original 93049 terminou com exit1 e o run armazenado está **failed**.
O evento público `model.failure` identificou `response_inactivity` /
`UND_ERR_BODY_TIMEOUT`; desta vez a causa está preservada no limite de transporte,
sem inferi-la da mensagem genérica de uma tentativa histórica. Não houve mudança
de prazo, reparo manual da fonte ou apresentação da execução como sucesso.

O original permaneceu na revisão31/hash
`f6057b117efc7fbec00eeac0abc789d418417d75f4b3bf71d5f4588d24740e5c` e a
cópia anterior na revisão6/hash
`eca3c81b3ecb3c9443f42bc86ab5d8aa55071b2d9647b64b82c9ca605ccdc5fb`.
Não há novo build aprovado ou observação válida para o jogo original atual.
O relatório marca `runtime-observed-failed` e não conta como portfólio entregue,
pedido inédito, avaliação humana ou aceite do produto.

[Relatório terminal](../output/game-generation/windmail/2026-11-11T22-26-12-799Z-8fa8d753/report.json).

## Continuação com modelo explicitamente escolhido — 2026-11-11

A leitura limitada de uma cópia descartável do SQLite, depois das verificações
de estado terminal/PID/socket originais, confirmou `core` com dois blocos,
134 chamadas consumidas de 256, nenhuma chamada pendente e nenhum recibo de
ferramenta `started`. Restavam 122 chamadas do bloco já autorizado. Os hashes
do banco original ficaram iguais; checkpoints, prompts e credenciais não foram
copiados para a evidência.
[Inspeção da cota](../output/game-generation/windmail/2026-11-11T22-26-12-799Z-8fa8d753/remaining-quota-readonly.json).

O Ollama local estava disponível sem modelo carregado. Esta avaliação escolheu
explicitamente `qwen3-coder:30b`, já instalado, nos três papéis. O smoke de leitura
com o motor de manifesto
`0170d0c16704026ef4b7a2e2f26eb0d84ee0a3a8bfb34c12ce2ed814e9b52b62`
terminou em `MOTOR_OK` nos modos Standard e Deep. Não houve download, troca das
configurações dos aplicativos ou fallback silencioso dentro de uma execução.

A continuação `2026-11-11T23-13-22-156Z-5f9446fa`, run
`2cdb313c-1079-40c7-85eb-653c48a3a239`, mantém a sessão, namespace, projetos,
recibos, corpus e limites anteriores. O driver e o motor foram congelados em
cópias privadas; alterações posteriores de fonte/build/`dist-tests` não trocam
seus módulos. A política normal de desenvolvimento recusa qualquer nova
ampliação de inferência. A continuação não recebeu fonte, arte ou solução pronta.

A [inspeção autenticada de 23:32:45 UTC](../output/game-generation/windmail/2026-11-11T23-13-22-156Z-5f9446fa/inspections/2026-11-11T23-32-45-559Z.json)
confirmou o original na revisão32/hash
`a5cfc704a101a495e3cac7a666eb0655fd039cf6b747d7ed4b74b5159c6cc7e0`, 29 arquivos e
cinco assets, com 152 chamadas consumidas na etapa, uma pendente e nenhum job
de produção não terminal. É avanço real no mesmo projeto, sem correção manual.

A fotografia acima foi registrada enquanto a execução estava ativa. Depois, o
handle original **54965 terminou com exit1**; o run persistido está `failed`, com
`Request timed out.`. Não há evento `model.failure` nesta tentativa: não atribuir
a mesma causa de inatividade do ensaio anterior nem inferir HTTP/créditos/cota.
O [relatório terminal](../output/game-generation/windmail/2026-11-11T23-13-22-156Z-5f9446fa/report.json)
e a [auditoria delimitada](../output/game-generation/windmail/2026-11-11T23-13-22-156Z-5f9446fa/terminal-audit.json)
preservam os resultados.

O original avançou para a revisão34/hash
`001cb2c8d25605f2b3f7a1f1f59ba47974023ad3981299b455ba2c6b421f4f10`, ainda com 29
arquivos/cinco assets, sem build dessa revisão. A cópia antiga permanece na
revisão6. A leitura de 23:57:43 UTC observou 154 chamadas na etapa, uma pendente;
não é recibo terminal de consumo e a reserva desconhecida deve ser preservada.
Não houve novo bloco, reparo manual ou tentativa reiniciada. Avanço de fonte não
comprova campanha completa, QA, generalização ou jogo aprovado.


### Conferência posterior, sem nova geração

A [inspeção estrutural de leitura](../output/game-generation/windmail/2026-11-11T23-13-22-156Z-5f9446fa/context-shape-readonly.json)
conferiu run terminal, PID/socket ausentes, nenhum recibo de ferramenta `started`
e nenhuma execução ativa antes de copiar os bancos para um diretório privado.
Leu metadados e o último checkpoint pelo saver oficial, somente na cópia.
Hashes dos bancos originais ficaram iguais. Nenhum conteúdo de mensagem,
argumento, checkpoint, credencial ou fonte foi exportado, nem houve migração,
serviço, ferramenta, inferência ou concessão de orçamento.

A etapa `core` terminou com 154 chamadas de 256, sete sem usage, nenhuma
pendente e 4.111.837 tokens contabilizados. Restam 102 chamadas no bloco já
autorizado; não é autorização para renová-lo. O checkpoint contém 48 mensagens
(duas humanas, dezoito AI, 28 resultados), 105.506 bytes de conteúdo e 27.674
bytes de argumentos. A estimativa UTF-8 local de 61.328 tokens de mensagens
não é contagem Qwen nem inclui system prompt/catálogo de ferramentas. Não
comprova janela excedida ou causa de latência. Não havia evento de compactação.

A consulta offline ao factory encontrou perfil sem `maxInputTokens` para esse
alias; a versão fixada do DeepAgents usa então seu limiar padrão, não a janela
efetiva do Ollama. Isso é uma lacuna de configuração a qualificar, não permissão
para inventar contexto, truncar fonte ou mudar o modelo durante um run.

A [correção de diagnóstico](MODEL_CAPABILITIES.md#prazo-do-sdk-transformado-pelo-langchain--2026-11-11)
reproduziu `TimeoutError` após o wrapper oficial e passou em fonte/bundle. Não
prova retroativamente que esse era o objeto do caso original. Não houve nova
tentativa real; o original permanece na revisão34, sem build aprovado.

### Janela efetiva na fonte de desenvolvimento

A [configuração por alias](MODEL_CONTEXT_WINDOWS.md) agora alcança o grafo comum
e as interfaces Mac/VS Code. A compactação nativa e a privacidade de sua saída
foram qualificadas com SSE simulado em fonte e no serviço empacotado, incluindo
orçamento e replay. Isso não verifica a configuração do Ollama usado pelo
Windmail nem comprova que contexto causou a falha histórica. O avaliador real
permanece sem uma declaração aplicada; não retomar automaticamente, mudar um
run já admitido ou conceder outro bloco com base nesse ensaio.

### Continuação com janela verificada — 2026-11-12 UTC

Uma nova continuação explícita foi admitida, preservando identidade, sessão,
projetos, recibos e orçamento. Antes dela, a guarda original confirmou run
terminal, PID/socket ausentes, nenhum recibo iniciado e nenhuma inferência
pendente. A cópia somente de leitura manteve os hashes originais. A etapa
`core` tinha 154/256 chamadas e 4.111.837 tokens contabilizados; nenhum bloco
foi concedido ou contador reiniciado.

O runner recebeu `--context-window=131072`, com `qwen3-coder:30b` nos três papéis
e o mesmo limite de doze rejeições de schema. A verificação de configuração
encontrou servidor iniciado em 2026-11-05 com 131.072 tokens, sem `num_ctx`
específico no modelo. Depois de carregar, a
[consulta de estado](https://docs.ollama.com/api/ps) confirmou esse valor no
modelo exato, digest
`06c1097efce0431c2045fe7b2e5108366e43bee1b4603a7aded8f21689e90bca`.
Não houve troca de modelo, alteração do servidor ou das preferências dos apps.

Tentativa:
`output/game-generation/windmail/2026-11-12T01-05-22-188Z-253a018a/`.
Run `d16ace0a-07c1-468c-a2ba-2674abf9e78b`, sessão original
`300873f5-790f-4864-b52b-9d5c218be6d7`, handle original **57783**.
Motor congelado/verificado:
`3221eada75789d0c8b3f0f7970b174e848e36a472a4da8572b096ac2288794cb`.
`context-preflight.json`, `loaded-model-context.json`, `control.json` e
`input.json` preservam as referências; credenciais e checkpoints permanecem
apenas no diretório privado original.

Na consulta autenticada de **01:19:09 UTC**, o run estava `running`, com o
projeto original ainda na revisão34. O build
`4e028c64-7480-42ab-b7d6-3700ce4fed1d` dessa fonte estava `completed`.
A etapa tinha 166 chamadas, uma pendente e 4.424.526 tokens contabilizados.
Isso comprova build, não gameplay, apresentação, QA completo ou um jogo pronto.
Os [registros de inspeção](../output/game-generation/windmail/2026-11-12T01-05-22-188Z-253a018a/inspections/)
são fotografias datadas; acompanhar o handle original até resultado terminal,
sem reiniciar a avaliação por demora de observação.

A [edição por trechos](GAME_FILE_EDITS.md) foi desenvolvida depois que esse
processo iniciou. Não pertence ao motor congelado da tentativa nem lhe foi
injetada durante o trabalho. Falhas anteriores, placeholders declarados e
aceites pendentes continuam preservados; não atribuir a esta continuação a
fonte dos jogos autorais de referência.

### Conferência posterior: processo e estado temporário ausentes

Na conferência seguinte, o handle original não existia, o PID não estava
presente e `/tmp/cgg-8VkJmp` não foi encontrado. Não há `run.json` terminal ou
relatório final dessa continuação. A última consulta autenticada é uma fotografia
anterior; eventos públicos posteriores incluem uma revisão36, sem fonte completa
ou resultado terminal recuperado. Não tratar ausência de processo/estado como
conclusão, cancelamento confirmado, inferência não executada ou nova cota.
Nenhuma chamada real foi repetida nesta conferência.

O preview independente do build da revisão35 mostrou tela preta, ausência de
`assets/wind-arrow.png`, música e quatro efeitos de áudio, além do erro de
`backgroundMusic` ausente. O diagnóstico está nos dois diretórios de
`manual-preview/` da tentativa, com imagens, fonte e artefato vinculados.
A exportação preservada da revisão34 também foi exercitada sem correção manual:
a admissão recusou seu `data/playtests.json`, um array incompatível com a receita
canônica. Não transformar referências autorais ou fixtures em correção do jogo.

A nova [leitura de relatórios](GAME_REPORT_READS.md) e seu ciclo de correção
controlado existem no motor comum e foram exercitados com inferência simulada.
Não pertencem ao motor congelado desta tentativa, não foram injetados nela e
não mudam seu resultado de avaliação. A guarda de continuação permanece estrita;
naquele ponto, o bootstrap de futuras avaliações longas ainda precisava deixar de depender da
área temporária, sem recriar uma identidade/cota antiga ou publicar checkpoints.

### Preparação durável da recuperação — 2026-11-13 UTC

A dependência da área temporária foi removida para novas avaliações. O helper
compartilhado valida UID, permissões, diretório exato e symlinks sem recriar
estado ausente. Avaliações antigas em `/tmp/cgg-*` continuam reconhecidas para
inspeção/continuação com as mesmas guardas; não são migradas automaticamente.
Estado privado fica no cache ignorado, separado da evidência pública e sem
limpeza automática depois da avaliação. Isso não substitui backups administrados.

Foi preparada uma recuperação **de domínio**, não de checkpoint/execução:
`output/game-generation/windmail-recovery-preparation/2026-11-13T02-09-34-530Z-0983ff2f/`.
O export da revisão34 manteve as 34 revisões, origem, hashes e bytes dos arquivos.
Importação pelo SDK e novo build de referência não reexecutaram ferramentas
passadas nem consumiram aprovações antigas. O preview e a receita inválida
continuam negativos. Os resultados/saldo da execução original permanecem
desconhecidos, sem alteração de seus contadores.

O novo projeto é `0667e579-e854-4443-a737-f88a83385c62`, fonte
`001cb2c8d25605f2b3f7a1f1f59ba47974023ad3981299b455ba2c6b421f4f10`.
O serviço preparado usa o motor congelado
`3f4dfc66ce3fb104a9a49aa0abf4ec9c76252b8f1073f2bd90bed222e18cddd5`.
Foi encerrado de forma confirmada, mantendo identidade e dados privados.
Uma admissão posterior somente de leitura conferiu novamente source, engine,
identidade, ausência de PID/endpoint e o limite preparado. Não iniciou serviço.

O [teto de proprietário](OWNER_INFERENCE_LIMITS.md) restringe a nova avaliação a
128 invocações e alocação de 4.194.304 tokens por namespace/etapa, com um bloco.
Não há renovação automática nem liberação de saldo antigo. A preparação conferiu
zero runs/chamadas, uso pendente/desconhecido zero no **novo** namespace e qualidade
integral falsa. Esse zero não é uma afirmação sobre a tentativa perdida.

O Ollama loopback respondeu à consulta de versão/inventário, sem geração:
0.40.16, `qwen3-coder:30b` instalado com o digest anterior, descarregado.
Nenhuma janela foi inferida do daemon antigo; sem verificação efetiva atual,
não reutilizar sua declaração como fato de configuração.

A retomada tem um modo separado no mesmo cliente/observador:

```sh
node scripts/qualify-game-generation.mjs \
  --case=windmail --ollama-model=qwen3-coder:30b --runtime=deep \
  --prepared-recovery=output/game-generation/windmail-recovery-preparation/2026-11-13T02-09-34-530Z-0983ff2f \
  --feedback-file=output/game-generation/windmail-recovery-preparation/2026-11-13T02-09-34-530Z-0983ff2f/feedback.txt \
  --max-schema-rejections=12 --authorized-recovery-block
```

**Esse comando só pode ser executado após autorização explícita do novo bloco.**
A flag registra uma decisão externa confirmada; não é autoridade parental ou
aprovação que o agente possa fabricar. Sem ela, o runner recusa antes de ler
feedback, iniciar serviço ou inferência. A admissão também exige a sessão preparada
ainda sem runs, projeto inalterado, baseline concluído, credencial original privada
e limite exato, rechecados pelo SDK antes de iniciar.

A avaliação é marcada `recovery-from-domain-export`, `sourceProvided:true`.
Não equivale a pedido inédito, a sucesso da tentativa anterior ou a fonte autoral
de referência. O modelo continua responsável pela decisão e execução pelo grafo
comum. Até a autorização, a correção não começou.


### Seleção explícita de OpenAI na recuperação — 2026-11-13 UTC

O operador respondeu **“use openai”** ao pedido do novo bloco. Essa decisão
seleciona OpenAI para a avaliação de recuperação, mantendo até 128 admissões,
alocação de 4.194.304 tokens e um único bloco, sem renovação automática. Não
libera saldo desconhecido, amplia ferramentas ou habilita OpenAI no app Mac.
A preparação Ollama anterior permanece sem inferência e não tem sua identidade
alterada; a nova preparação precisa provisionar **somente OpenAI**, importar o
mesmo domínio verificado e concluir sua própria referência sem modelo.

O preparador aceita `--provider=openai`; sua ausência conserva Ollama. A admissão
confere o provedor exato no controle e na credencial original. O cliente de
avaliação aceita alternativamente `--openai-model=<alias>` ou
`--ollama-model=<alias>`, nunca ambos. OpenAI está restrito à recuperação explícita,
com a rota fixa `https://api.openai.com/v1/chat/completions` e o mesmo grafo comum.
A continuação legada mantém Ollama; não há troca silenciosa ou registro com os
dois provedores. Não confundir esse cliente de qualificação com outro executor
ou com o VSIX instalado.

A credencial OpenAI pode ser fornecida ao processo operador por `OPENAI_API_KEY`,
nunca por argumento, feedback ou arquivo da avaliação. O cliente a concede via
`credentials.lease` autenticado, somente em memória. A variável é retirada do
ambiente herdado pelo serviço e pelos seus workers. Falta de credencial recusa
antes de iniciar serviço/inferência; após reinício, uma credencial ausente exige
nova concessão explícita, sem fallback. Não imprimir o ambiente nem copiar a
chave para evidências, settings ou checkpoints.

Nesta seleção, o modelo encontrado na configuração do VS Code é `gpt-5-mini`.
A rota e suporte a streaming/function calling foram conferidos na
[documentação oficial OpenAI](https://developers.openai.com/api/docs/models/gpt-5-mini)
e no [contrato Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create).
Isso não prova acesso, crédito, qualidade ou resultado real da conta. O relatório
da nova tentativa deve registrar esses resultados separadamente e conservar as
falhas anteriores. Nenhuma instalação ou publicação decorre dessa seleção.


### OpenAI executado, escolha de Luna e limite atingido — 2026-11-13 UTC

A preparação OpenAI `2026-11-13T02-56-54-591Z-aecf3f81` conservou 34 revisões,
zero inferência, identidade própria somente OpenAI e o mesmo teto restritivo.
O `gpt-5-mini` encontrado na configuração fez seis chamadas com uso informado;
a sétima excedeu o prazo do provedor e permaneceu sem usage. Run `a57b1121-e8b4-407f-9ce4-857e43e628b5`
terminou `failed`, sem mudança de fonte. A tentativa preservou também a falha
do observador ao tentar coletar a receita inválida antiga. Uma observação terminal
com backup privado recuperou somente metadados do mesmo namespace, comprovou
que não havia produção pendente, não fez inferência nem devolveu reserva e
concluiu o relatório. Nenhum checkpoint ou credencial foi publicado.

A continuação explícita `2026-11-13T03-15-03-952Z-d9e9164f` usou `gpt-6-sol`
na mesma identidade/sessão/bloco e fez alterações até a revisão41, builds e
leituras reais de relatórios. Quando o usuário escolheu **“use o gpt luna”**,
o run `536ee293-0650-4ca6-86e0-d3e17acba2f5` foi cancelado pela API. O estado
`cancelled` e todos os jobs terminais foram confirmados antes de outra execução.
Uma chamada cancelada conservou uso desconhecido. Não foi mudança do provedor,
registro com dois provedores, fallback automático ou alteração dos aplicativos.

O modelo escolhido é **`gpt-6-luna`**, com `reasoning_effort:none`, conforme o
[contrato oficial de ferramentas nessa rota](https://developers.openai.com/api/docs/models/gpt-6-luna).
O cliente aceita esforço explícito por perfil do modelo; nunca muda o endpoint
OpenAI para Responses. A continuação verifica provedor original, sessão,
projetos/jobs, identidade privada e teto de um bloco, sem reenrollment ou reset.
A origem `sourceProvided:true` continua verdadeira nas continuações; não contar
a recuperação como teste cego.

A tentativa Luna `2026-11-13T03-18-15-133Z-a77c4fb1`, run
`4203b6be-7227-4e67-a788-ebcc0e4502c0`, fez 33 invocações com uso informado,
editou a fonte e aplicou recursos locais de imagem/áudio. Chegou à revisão47,
fonte `4c911a5872837dd3ecf82b4489e3ba21725f8256b4debbdb20774e7a9aa7286b`.
Parou em `failed` por limite de inferência, sem construção da nova revisão pelo
modelo. Não transformar essa interrupção em conclusão da tarefa.

O ledger compartilhado confirmou **75 chamadas** no bloco, 73 com uso informado
e duas sem usage, zero pendentes: 3.994.252 tokens de entrada, 18.043 de saída e
4.143.367 tokens cobrados/reservados. A reserva de outra chamada (65.536) não
cabe na alocação de 4.194.304. Por isso o limite efetivo está esgotado mesmo
antes das 128 chamadas. Reservas sem usage continuam retidas. Esses números são
admissão/contabilização local, não fatura ou teto financeiro do provedor.

A QA independente do operador construiu a revisão47 sem inferência nem edição.
O hash do artefato está fixado no seu
`operator-qa-2026-11-13T03-24-23-695Z/report.json`. Houve um canvas composto,
sem erros de recursos/console, dois cenários aprovados e um falho. Fonte,
consumo e bloqueios de qualidade permaneceram inalterados. Esse build é
**observação do operador**, não build autônomo de Luna ou aceite Poki/humano.
A imagem já mostra barco/ilhas/controles em vez da tela preta, com acabamento
artístico, controles, conteúdo e restante da qualidade ainda pendentes.

Um novo bloco depende de autorização adicional explícita; a decisão foi solicitada
após essa QA concreta, propondo limites **totais** de 256 admissões e 8.388.608
tokens, sem renovação automática. Até resposta, não mudar o teto instalado,
conceder quota, iniciar outra inferência ou criar um namespace para escapar dele.
A configuração e os dados continuam duráveis e separados das instalações.

### Bloco adicional autorizado e iniciado — 2026-11-13

O usuário autorizou posteriormente até mais 128 chamadas/4.194.304 tokens,
sem renovação automática. A [preparação e fronteira da continuação](GAME_GENERATION_ADDITIONAL_BLOCK.md)
preservam a mesma identidade, ledger e reservas. O teto global conservador permite
no máximo 127 admissões/4.194.303 tokens novos, sem reaproveitar saldo antigo.
Run `ebed52c9-760d-4b29-9322-842b1b3e8ade` foi iniciado com GPT Luna em todos os
papéis e a engine verificada `e14ce1b4…`. A primeira inspeção autenticada encontrou
revisão48, build/coleta concluídos e run ainda ativo. Isso não antecipa resultado,
qualidade ou encerramento; relatórios e inspeções ficam na tentativa
`windmail/2026-11-13T18-33-51-287Z-1271772d`. Não iniciar outra ao perder observação.

## Rota externa e divergência de recuperação — 2026-11-13

As [observações do build final Luna51](GAME_WINDMAIL_ROUTE_OBSERVATIONS.md)
confirmaram ciclo5/5 em dois percursos por teclado/PNGs; uma repetição idêntica
ficou4/5. Em ensaio distinto, reload durante3/5 e898 pontos voltou0/5/zero,
contrariando a estratégia de save do design salvo. Fonte, build, ledger e QA
antigos permanecem intactos. Não houve inferência, novo coletor, instalação,
correção de código, aceite ou renovação. O feedback preparado ainda não foi
executado. A observação muda o próximo diagnóstico, não a autoridade de qualidade.
