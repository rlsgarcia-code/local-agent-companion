# Produção de jogos: jobs, artefatos e evidências

Estado: **implementação em fonte e build de desenvolvimento; não distribuída**.
Leia a [arquitetura](SUITE_ARCHITECTURE.md), a [API de projetos](GAME_PROJECTS_API.md)
e o [plano integral](GAME_DESIGN_IMPLEMENTATION_PLAN.md). Esta frente não conclui
os adaptadores completos, a produção autônoma ou o aceite dos jogos.

A [integração com os executores](GAME_AGENT_PRODUCTION.md) descreve o perfil v2,
as ferramentas internas do serviço, os especialistas e a continuidade por conversa.

O [processamento de assets](GAME_ASSET_PIPELINE.md) usa os mesmos jobs e recibos.

A [consulta de pedido de asset](GAME_AUDIO_VARIANTS_STUDIO.md) `games.assets.inspect`
lê o binding do pedido original, sem iniciar outro job. A capacidade de inspeção
é anunciada somente a Mac/VS Code; `missing` não prova ausência de efeito.
SDKs e Studio preservam pedido congelado e reconferem o resultado, inclusive
depois de novas revisões, sem transformar confirmação de registro em sucesso.
Produz candidatos privados de imagem/atlas/áudio e modelos 3D pela
[porta Blender isolada](GAME_BLENDER_ADAPTER.md); aplicação ao projeto é uma
operação explícita e transacional, separada da aprovação de qualidade.

As [etapas persistentes](GAME_PRODUCTION_WORKFLOWS.md) coordenam o ciclo de domínio,
critérios e alocação de pedidos. Builds, testes e mídia debitam a mesma etapa
na transação de admissão; replay não duplica consumo. Essa alocação por projeto
é distinta da fila de recursos por usuário e de um orçamento de inferência.
O [controle de inferência](INFERENCE_BUDGETS.md) usa callbacks do grafo existente
e agrega invocações/tokens informados ou reservados por namespace e etapa;
não debita esses contadores por um build, preview ou processamento local de mídia.

## Responsabilidades

- `packages/game-design/src/quality.ts`: avaliação pura dos relatórios coletados.
- `packages/game-production`: portas dos adaptadores/coletores instalados, sem
  loop de agente, interface ou autoridade própria.
- `packages/agent-service/src/game-production.ts`: persistência, jobs, recibos,
  eventos, artefatos e reconciliação. Usa o armazenamento do serviço existente.
- `packages/adapter-game-web`: compilação offline de revisões imutáveis em builds
  Phaser/Babylon.js. Não executa scripts do projeto durante a compilação.
- `packages/contracts/src/game-production.ts`: contratos públicos dos SDKs.

Os novos HTMLs incluem a [permissão por hash de uma regra CSS vazia](GAME_EMPTY_STYLE_POLICY.md)
para sincronização de capturas WebKit. Não há permissão ampla de CSS/script,
mudança de autoridade/ABI ou reescrita de artefatos anteriores. O build e a
implementação exatos devem ser registrados e qualificados novamente.

Somente o processo proprietário registra adaptadores e coletores. Não existe RPC
para cadastrar ferramentas, inserir relatórios ou declarar qualidade aprovada.
A identidade vem do registro autenticado do cliente. Adaptadores workspace não
aceitam KidOS; este exige um adaptador `kidos-core` com operações do Core/broker.
O pacote web não concede ao Navi compilação genérica ou acesso ao sistema.

## API

| Método | Entrada | Resultado |
|---|---|---|
| `games.production.capabilities` | Objeto vazio | Adaptadores sondados, coletores permitidos, estimativas de recursos e orçamento de admissão |
| `games.assets.libraries` | Processador, biblioteca opcional, busca, cursor/limite | [Seleções offline fixadas](GAME_LICENSED_LIBRARIES.md), sem execução ou autoridade de licença |
| `games.builds.start` | `requestId`, `projectId`, `revision` | Job com revisão/hash e toolchain fixados |
| `games.validation.start` | `requestId`, `buildId`, `collectorId` | Job do coletor instalado, vinculado ao build concluído |
| `games.production.get` | `id` | Estado persistido do job |
| `games.production.cancel` | `id` | Cancelamento solicitado; estado final só após a ferramenta parar |
| `games.production.reconcile` | `id` | Inspeção pela toolchain original, sem repetir a operação |
| `games.production.list` | `projectId`, `cursor`, `limit` | Página de jobs |
| `games.production.events` | `projectId`, `cursor`, `limit` | Eventos com sequência e retomada |
| `games.builds.artifact` | `id` do build | Transferência JSON do manifesto de artefato |
| `games.builds.file` | `buildId`, `path` | Transferência verificada do arquivo naquele artefato |
| `games.validation.reports` | `id` do build | Transferência JSON dos relatórios |
| `games.quality.get` | `projectId`, `revision` opcional | Transferência JSON da avaliação e pendências |

Os SDKs TypeScript e Python encapsulam essas rotas e hidratam transferências.
A capacidade `game-production-jobs` indica suporte ao protocolo, não disponibilidade
de todas as engines ou coletores. Consultar as capacidades atuais antes de usar.

O catálogo interno do agente expõe a listagem existente como `game_jobs`: páginas
mais recentes primeiro, IDs reais, estados e comparação com a fotografia atual da
fonte. Não cria outra rota pública nem fornece receitas/bytes. `game_job` continua
sendo a consulta completa de um ID conhecido. Um ID de artefato não é ID de build.

A confirmação do agente para validar usa a mesma conferência de alvo da admissão:
build concluído no namespace e coletor instalado/permitido. Essa leitura não sonda
processos, reserva recursos ou despacha trabalho. Alvos impossíveis são erros de
domínio anteriores ao despacho, não recusas do usuário. A execução real confere
novamente depois da confirmação; a recuperação idempotente antecede essa leitura
e efeitos desconhecidos continuam exigindo reconciliação.

## Recuperação e efeitos

Um projeto admite um job ativo ou não reconciliado de cada vez. Repetir o mesmo
pedido recupera seu recibo; reutilizar sua identidade com outro conteúdo falha.
O build nunca acompanha alterações posteriores da revisão de origem.

Estados: `admitting`, `queued`, `running`, `cancelling`, `awaiting_reconciliation`, `completed`,
`cancelled` e `failed`. Reinício não repete automaticamente trabalhos interrompidos.
Resultados desconhecidos bloqueiam uma nova execução até inspeção pela mesma
identidade, versão e hash de ferramenta. `GameProductionFailure` é o reconhecimento
explícito, pelo adaptador instalado, de falha com resultado conhecido; outras
falhas exigem reconciliação. A interface não pode fornecer uma prova substituta.

Solicitar cancelamento não torna uma falha desconhecida segura. O adaptador só
confirma parada lançando o motivo de aborto depois de encerrar seus recursos,
ou reconhecendo uma falha conhecida. `GameProductionUncertain` conserva a espera
por reconciliação mesmo se o pedido de cancelamento já chegou. O hook opcional
`dispose` de adaptadores, coletores e processadores limpa candidatos apenas após resultado terminal persistido; não remove
histórico nem invalida um artefato publicado. Leia o
[percurso Godot isolado](GAME_GODOT_ADAPTER.md).

O coletor de navegador usa um [supervisor durável](GAME_BROWSER_OBSERVATIONS.md#supervisor-e-recuperação-durável)
sem runtime de agente. Uma queda do serviço cancela sua coleta por perda do IPC;
um candidato já salvo pode ser reconciliado sem abrir outro navegador. Ausência
do auxiliar sem confirmação de parada não libera a reserva. Seu payload só é
descartado após o commit terminal, preservando relatórios e blobs no serviço.

Capacidades de adaptadores e coletores podem incluir `projectGuide`, instruções
fornecidas pelo processo instalado sobre os arquivos/formato exigidos; o serviço
limita esses guias a 4.000 caracteres. No coletor web, a referência descreve as
receitas de interação estritas do contrato compartilhado. Esse conteúdo não
registra ferramentas, altera disponibilidade, inicia coleta ou concede autoridade
à interface/modelo. Coletores anteriores sem o campo continuam compatíveis.

Publicar um artefato grava blobs, manifesto, referências e conclusão do job na
mesma transação. Falha no reconhecimento não deixa um candidato parcialmente
publicado. Os blobs ficam fixados pelo artefato; leitores verificam seus hashes.
O desligamento aguarda os recursos antes de fechar o banco. Atualizações aguardam
jobs ativos e resultados ainda não reconciliados.

## Fila e recursos de produção

A capacidade aditiva `game-production-resource-queue` identifica a fila comum
do Agent Service. Builds, validações e processamento de assets dos produtos e
projetos daquele usuário disputam o mesmo orçamento. O namespace continua
isolando dados e decisões; uma consulta não revela os jobs dos outros produtos.
Previews interativos do host e inferência ainda não participam desta fila.

As portas instaladas declaram `resources`: `memoryMiB`, `cpuSlots` e
`exclusiveGroups`. O serviço fixa a estimativa no recibo de cada job. Clientes e
modelos não escolhem custo, prioridade ou orçamento; campos extras nas entradas
são rejeitados. Uma porta antiga sem estimativa reserva todo o orçamento,
conservadoramente, em vez de obter paralelismo ilimitado.

O orçamento padrão reserva para admissão metade da RAM física, até **8192 MiB**,
até quatro slots de CPU (preservando um processador lógico quando disponível),
**duas tarefas simultâneas** e **128 pedidos na fila**. Em uma máquina com apenas
um processador lógico, há um slot. `gameResourceBudget` é uma opção do processo
proprietário, não uma configuração enviada por RPC. Ferramentas cujo custo
excede o orçamento ficam indisponíveis antes da criação do job; não se escolhe
outro adaptador silenciosamente.

| Porta atual | Estimativa de RAM | Slots de CPU | Exclusividade |
|---|---:|---:|---|
| Compilação web Phaser/Babylon | 1024 MiB | 1 | Sem grupo exclusivo |
| Editor Godot isolado | 4096 MiB | 2 | Um editor Godot por vez |
| Observação Chromium | 2048 MiB | 1 | Uma coleta de navegador por vez |
| Processamento local de mídia | 768 MiB | 1 | Um worker de mídia por vez |
| Modelos Blender isolados | 4096 MiB | 2 | Um editor Blender por vez |

Esses valores são **estimativas de admissão**, não medição de RAM livre nem
limites impostos pelo sistema operacional. Os limites efetivos do contêiner
Godot e do worker de codecs continuam definidos nos respectivos adaptadores.
A fila reduz a concorrência da produção; não garante ausência de pressão de
memória provocada pelo próprio jogo, modelo ou outros programas.

A ordem de recursos é FIFO depois das admissões necessárias: um pedido pequeno não ultrapassa
um build mais antigo apenas por caber no espaço restante. Enquanto aguarda,
o job permanece `queued` com `waitingReason: "resources"`; interfaces exibem
espera por recursos, sem apresentar a operação como execução ativa. Pedidos
iguais recuperam o mesmo recibo e não ganham outra posição. As sondagens de
disponibilidade antecedem a admissão; não são builds ou processamento de assets.

Cancelar um job ainda na fila impede a chamada ao build e ao seu hook de
limpeza. Quando a porta tem admissão externa, chama o fechamento da reserva e
exige seu reconhecimento; a cota consumida não é devolvida. Cancelar uma tarefa
iniciada continua dependendo da parada confirmada.
Resultados desconhecidos mantêm a reserva, inclusive após reinício ou redução
do orçamento, até reconciliação pela ferramenta original. Uma inspeção que
informa `running` não libera recursos. Nem uma falha de inspeção nem uma
declaração do cliente permite ultrapassar essa espera.

No desligamento ordenado, pedidos em fila são cancelados sem executar. Em uma
queda, pedidos `queued` sem admissão externa são encerrados com diagnóstico de
que não começaram; uma nova tentativa exige pedido explícito. Jobs `admitting`
ou `queued` com admissão externa passam a reconciliação, assim como operações
que já tinham iniciado, sem repetição automática. A reserva
terminal só é liberada após o término da tarefa e da tentativa de limpeza de
candidatos do adaptador. Falha nessa limpeza conserva o cache para manutenção;
não desfaz um resultado reconhecido. Fechar uma interface não desliga essa fila.

Portas do processo dono podem declarar `admission.reserve/cancel`, sempre com
`reconcile`. O serviço persiste `state: "admitting"` e `admission: "pending"`
antes da chamada externa; só uma reserva reconhecida muda o journal para
`reserved` e permite aguardar recursos. A UI mostra “Confirmando cota”. Admissões
pendentes contam no limite da fila. Esses campos e hooks não são escolhidos por
RPC ou pelo modelo. No KidOS, a opção de fila do catálogo assinado negocia ABI
próprio e usa autoridade Root/Core; veja [portas protegidas](GAME_CORE_PRODUCTION_PORTS.md).

A [admissão de validações](GAME_VALIDATION_ADMISSION.md) agora usa os mesmos
hooks, recebendo apenas o build fixado e leitura de seus arquivos. O adaptador
assinado pode fornecer coletores Core exclusivos de KidOS, com admissão e
inspeção obrigatórias. A contabilidade Root reconhece esse tipo em fonte; browser,
worker/porta Core, composição e ativação Navi v2 continuam pendentes.

Este controle não conclui os orçamentos de tokens, custos, duração e inferência
por etapa previstos no plano. A alocação de pedidos nas etapas está descrita
separadamente; as demais frentes permanecem no acompanhamento.

## Builds web disponíveis em desenvolvimento

O lock `packages/adapter-game-web/runtime.lock.json` fixa Phaser **4.2.1**,
Babylon.js **9.35.0**, esbuild **0.25.12**, origem e hashes dos arquivos. O builder
verifica e inclui runtimes, licenças, compilador e binário da plataforma no motor.
Nenhum CDN ou instalação de pacotes é consultado durante um build de jogo.

Um projeto contém `game.web.json`:

```json
{"schemaVersion":1,"entry":"src/main.ts","engineVersion":"4.2.1"}
```

Usar `9.35.0` no projeto Babylon. O entrypoint pode importar arquivos relativos
JS/TS, JSON e CSS, além de `phaser` ou `babylonjs` conforme a engine. O compilador
resolve apenas arquivos da revisão e o runtime fixado. Configurações/plugins do
projeto, pacotes arbitrários, caminhos do host e URLs não são executados/resolvidos.
Por padrão, arquivos sob `assets/` e `data/` são empacotados e usados por URL
relativa. O perfil workspace3 oferece [seleção explícita de recursos](GAME_WEB_DELIVERY_SELECTION.md)
em `game.web.json`, conservando avisos/metadata registrados e masters no projeto
editável. O Core fixo1 recusa a opção; não existe poda inferida ou fallback.

A saída inclui `index.html`, canvas `#game`, `game.js`, estilos, runtime e licenças.
Uma política de conteúdo restringe rede e conteúdo externo. Isso não substitui o
isolamento do jogador/preview e o broker exigidos no KidOS. A criação de projetos,
edição dirigida, física, áudio, assets complexos e testes completos ainda precisam
ser integrados ao fluxo de produção e às interfaces.

## Qualidade e comprovação

As [metas numéricas de playtest](GAME_PLAYTEST_TARGETS.md) usam mínimo de dez,
80% de compreensão e 70% de notas positivas sobre o grupo completo, arredondados
para cima. Estudos do operador usam a mesma função pura, mas não fornecem
relatórios de qualidade: preservar essa separação e a origem exata do coletor.

Há uma [API local de estudos de playtest](GAME_PLAYTESTS.md) para dados declarados
pelo operador, fora do catálogo do modelo e dos relatórios de coletores. Preserva
build/revisão, códigos, confirmações, retirada e resumo; atingir seus números não
aprova este gate. Interface, revisão da rodada e pessoas reais continuam necessárias.

Build concluído não equivale a jogo aprovado. Relatórios devem corresponder ao
projeto, revisão, hash de fonte, build e hash de artefato. Mudança da revisão torna
o aceite anterior obsoleto. Coletores precisam estar instalados com a toolchain
exata e autorização para a categoria; relatórios históricos continuam legíveis.

A avaliação exige checks de runtime, conteúdo, visual, áudio, desempenho, licenças
e experiência humana, cobertura do conteúdo e dos cenários de design. Uma revisão
estática não certifica execução. Há exigências separadas de medições físicas de
FPS/carregamento e playtest consentido com as metas do plano. Placeholders,
resultados desconhecidos e checks faltantes impedem aprovação.

O serviço de desenvolvimento registra um
[coletor real de navegador](GAME_BROWSER_OBSERVATIONS.md), com sondagem da
instalação e evidências PNG/JSON. Seus checks de início, erros e casos declarativos
não certificam sozinhos a semântica, arte, áudio, desempenho físico ou experiência
humana. Coletores sintéticos usados em outros testes verificam apenas a política
e o isolamento. A matriz de browsers/dispositivos e o portfólio completos
continuam obrigatórios.

## Verificação

Além de `npm run check`, `npm test`, `npm run build` e `npm run smoke:litellm`:

```sh
npm run smoke:game-builds
npm run smoke:game-scheduling
```

O smoke de builds constrói o motor independente, inicia seu Node empacotado com estado
privado temporário e usa o SDK autenticado para compilar dois projetos pequenos.
Os builds ficam em `output/playwright/game-builds/` para inspeção no navegador.
Os projetos são fixtures de integração, não exemplos do portfólio final nem
substitutos dos testes humanos. Não alteram os históricos ou instalações do usuário.

O smoke de fila usa o Node empacotado, dois registros autenticados (Mac/VS Code),
workers reais de áudio e o compilador Phaser. Verifica espera FIFO, cancelamento
de trabalho iniciado e não iniciado, isolamento e avanço do pedido seguinte.
Seu relatório fica em `output/playwright/game-scheduling/evidence.json`; não
certifica desempenho físico, qualidade de áudio ou aceite de um jogo completo.
