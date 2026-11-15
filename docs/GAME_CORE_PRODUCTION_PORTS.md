# Portas de produção do adaptador protegido KidOS

O KidOS já tem em fonte um protocolo Root/Core de reserva antecipada:
`admission_mode: "queue"`, operação `admit`, estados `reserving`/
`admission_unknown`, `admitted` e `queue_budget_abi: 1`. Os schemas deste
repositório o reconhecem. Hooks privados `admission.reserve/cancel` já integram
a fila em fonte, com journal anterior ao efeito, inspeção após queda e ABI
`installedCoreGameQueueVersion: 1`/`installedCoreGameQueueABI: 1`.
`--game-production-queue` exige projeto e composição exata; catálogo
`queueAdmission: { schema: 1 }`. Somente essa opção atende `require_queue`;
portas legadas/somente por projeto recusam a exigência sem fallback.
`cancel.request` fecha um begin atrasado pelo descritor original, sem nova admissão.
Leia `docs/PROTECTED_BUILD_QUEUE.md` no KidOS. A composição atual passou em 11
cenários com Root/UIDs reais e compilador/transportes Core de fixture; os ensaios
históricos abaixo não qualificam esse protocolo. Sem instalação ou perfil Navi v2.

Revisão posterior: há opção de alocação Root por projeto/etapa para as admissões
de compilação. O kit declara `installedCoreGameProjectVersion: 1`, o manifesto
`installedCoreGameProjectABI: 1`, e o Core anuncia `project_budget_abi: 1`.
`--game-production-projects` exige a produção Core e a composição exata; o catálogo
assinado recebe `projectBudgets: { schema: 1 }`. Nada disso ativa o perfil instalado.

A porta resolve o ref Root pelo projeto persistido no job e inclui o par
`production_ref`/`project_id` no descritor e em seu vínculo de entrada. O broker
guarda o grant antes do despacho; os recibos acrescentam projeto/ref/etapa e a
porta confere sua identidade/continuidade. Conferência preserva a admissão
original sem compilar. Porta legada fica indisponível quando a política exige
o novo vínculo; autoridade indisponível não autoriza fallback no host.

Alocações de inferência antigas/novas começam com `requests_per_block: 0`;
habilitar builds é decisão Root/responsável, separada da ativação da IA.
O contador da porta anterior cobre admissões no compilador; a opção de fila
também conta builds admitidos e cancelados enquanto aguardam recursos. Testes/
mídia continuam pendentes. Mudar a etapa de orçamento não libera efeitos desconhecidos
do Core ou aprova QA. O contrato operacional fica em
`docs/PROTECTED_PROJECT_BUILDS.md` no KidOS.

Passaram catorze cenários de porta e dez de composição SDK/serviço/assinatura/
broker/autoridade em Linux descartável. O caso novo preservou a admissão após
SIGKILL do serviço, impediu outro build sem alocação, autorizou um bloco e produziu
novamente com inferência desligada. Compilador/ciclo de vida e transporte Core
são fixtures em torno do domínio real: não certificam isolamento, permissões/
auditoria completas, compilador real, jogo ou instalação. Os ensaios anteriores
de compilação real abaixo permanecem históricos, vinculados às suas fontes.

Estado em 2026-11-10: **integração em fonte; ensaio SDK/serviço/Core em Linux x64;
sem instalação ou ativação do perfil Navi v2**. Leia a
[arquitetura](SUITE_ARCHITECTURE.md), a [produção comum](GAME_PRODUCTION_API.md),
o [compilador web](GAME_WEB_COMPILER.md) e o
[plano integral](GAME_DESIGN_IMPLEMENTATION_PLAN.md).

A [admissão de validações](GAME_VALIDATION_ADMISSION.md) acrescenta hooks e
coletores instalados no kit/serviço e o tipo `validate` na autoridade KidOS.
Novos catálogos declaram `budgetPolicyABI: 2`, com motor/kit de validações ABI 1;
catálogos antigos conservam sua identidade de rollback. O [candidato](GAME_BROWSER_CORE_CANDIDATE.md)
e [broker/protocolo Core](GAME_CORE_VALIDATION_PROTOCOL.md) existem agora em fonte.
A [porta opt-in](GAME_CORE_VALIDATION_PORT.md) também existe em fonte e passou
pela factory assinada em fixture. Composição de release e qualificação Linux
ainda faltam; não habilita Navi v2.

## Fronteira instalada e seleção por produto

O `InstalledAdapter` pode fornecer `gameAdapters` ao processo dono do Agent
Service. A fábrica recebe `installedGameProductionVersion: 1`, schemas do broker,
schemas de compilação, hash de conteúdo e os mesmos construtores de erro usados
pelo serviço. Estes objetos pertencem à composição executável; não são recebidos
por RPC, registro de cliente, prompt ou argumentos de ferramenta.

O carregador continua verificando assinatura Ed25519, árvore imutável, ownership
e vínculo com o artefato exato do motor. Aceita somente portas com autoridade
`kidos-core`, produto exclusivo `kidos` e hooks tipados de produção. A assinatura
da composição não substitui as decisões do Core ou da autoridade parental.

O serviço combina essas portas com seus adaptadores autorizados. A seleção de
engine e a unicidade são por produto: uma porta de workspace para Phaser/Babylon
no Mac ou VS Code não pode satisfazer uma produção infantil. IDs de adaptador
continuam únicos; uma engine repetida no mesmo produto é recusada. O consumidor
não pode registrar uma porta ou escolher outra autoridade para contornar uma
capacidade indisponível.

## Contrato privado com o Core

`packages/contracts/src/kidos-game-builds.ts` define o ABI 1 interno do broker.
Não adiciona um endpoint Agent API ou exporta autoridade para as interfaces.
O Core anuncia `broker_abi: 1`; versões antigas ou ferramentas divergentes
produzem indisponibilidade explícita. O catálogo fixa exatamente as ferramentas
Phaser/Babylon da composição Linux verificada, incluindo o hash do manifesto.

No repositório KidOS, `production.cjs` implementa somente operações fixas pela
ponte Python assinada. Não possui acesso a filesystem, shell, Docker, modelos
ou execução direta de código do projeto. A ponte resolve o socket Core da sessão
sob UID real. A construção do catálogo usa `--game-production` explicitamente e
exige os insumos exatos de motor/SDK; a opção não muda o catálogo de ferramentas
do agente, os grupos semânticos ou o perfil legado por padrão.

Cada pedido deriva sua identidade do UID, namespace autenticado e job persistido
do serviço. O Core vincula `request_id` ao SHA-256 do descritor original,
devolvendo `input_binding`. A porta confere esse vínculo e o ID opaco em cada
recibo. Blocos têm posição, tamanho e hash verificados; resultados são baixados
por páginas/blocos e seus bytes são conferidos novamente pelo serviço.

## Recuperação e cancelamento

- `begin` registra transferência; o Core admite e lança apenas em `start`.
  A porta verifica fonte, composição e progresso antes de enviar blocos restantes.
- `lookup` consulta exclusivamente o pedido original, sem criá-lo ou lançá-lo.
  Ausência de recibo ou vínculo divergente mantém reconciliação.
- A conferência de um job interrompido consulta `lookup`/`reconcile` e o candidato
  original. Nunca chama `start` para tentar recuperar um resultado desconhecido.
- Transferência interrompida antes de executar é fechada pelo Core e preservada;
  outra produção exige pedido explícito. Não converter uma inspeção em build.
- Cancelamento usa um controle independente para pedir parada da unidade original.
  Somente confirmação terminal permite liberar a reserva. Resposta perdida,
  saída inválida ou encerramento sem confirmação preservam o estado desconhecido.
- Candidatos e recibos permanecem no Core. O adaptador não apaga histórico nem
  publica automaticamente um build.

As etapas e os orçamentos do serviço continuam separados da admissão parental
do Core. Esta integração não retira os bloqueios do perfil Game Design v2,
workflows ou inferência infantil nem habilita ferramentas genéricas.

## Evidências e limites

Testes do carregador rejeitam portas de outra autoridade/produto e catálogos
inválidos. Testes do serviço exercitam seleção por produto e isolamento. O teste
CJS KidOS cobre os dois compiladores, resposta perdida, saída adulterada, recibo
ausente e cancelamento confirmado/desconhecido. O teste de regressão Core cobre
progresso paginado e upload parcial pela API autorizada: o primeiro ensaio real
encontrou e corrigiu a falta desse encaminhamento no dispatch.

`test/kidos-production-harness.ts` é um helper explícito de qualificação, não
entrypoint de release. No Alien Linux x64/UID 1000, o SDK real usou TLS/Unix IPC,
serviço/SQLite reais, adaptador assinado por chave efêmera de teste, ponte Python
e Core/autoridade temporários. O registro público provisionado pelo sistema foi
validado, com token novo no serviço privado; nenhuma credencial instalada foi lida.
Após o Core confirmar o início de cada build, o ensaio interrompeu o serviço
com SIGKILL, reabriu o mesmo estado e recuperou Phaser/Lume e Babylon, com nove
e dez arquivos verificados. A repetição idempotente preservou o mesmo job;
houve um `start` por pedido, duas admissões e duas unidades encerradas com PIDs
zero e cgroups vazios. A qualidade permaneceu não aprovada.

Relatório Core SHA-256:
`f982ac27b47738c5bc762445c70548af0719f750a74dd1443693f8ae3fd5076a`.
Relatório SDK/serviço:
`6c546fa4cbf4ce468644f2402b9fcf9b1f42f8d6740636b3309a7ae7b9de5955`.
No checkout KidOS, os relatórios e a conferência de hashes estão em
`build/production-service-port/native-9CcT2k/evidence`. Tentativas recusadas por
registro e pelo dispatch de progresso foram preservadas, sem ocultar suas falhas.

A autoridade temporária roda sob o UID do ensaio, não como root instalado.
Ownership/assinatura de teste não certificam a composição de release. Este
resultado não prova proteção física do banco, perfil Isaac, GTK/terminal Navi,
geração pelo agente, gameplay, mídia, qualidade humana ou instalação/rollback.
Permanecem a integração protegida completa v2, quatro adaptadores, seis jogos,
pedidos inéditos, matriz física, playtests e distribuição do plano integral.
