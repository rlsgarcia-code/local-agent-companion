# Admissão de validações antes da fila

Estado em **2026-11-11**: implementado no serviço e kit comuns, com contabilidade
Root no KidOS e testes. **Não habilita produção Navi v2, não instala um coletor
Core e não comprova qualidade de jogo.** Leia [produção comum](GAME_PRODUCTION_API.md),
[portas protegidas](GAME_CORE_PRODUCTION_PORTS.md) e o
[plano integral](GAME_DESIGN_IMPLEMENTATION_PLAN.md).

## Serviço e contexto fixado

O registro privado do coletor pode declarar `testSuiteFormat: "browser-v1"`.
O coletor Companion web o declara; o serviço recusa outros valores declarados.
Esse campo opcional não é aceito no pedido público, não muda ABI/autoridade nem
ativa coletores KidOS legados. Antes de consentimento ou admissão, o serviço
confere a receita do artefato/hash do build, junto do design daquela revisão:
schema canônico, até1 MiB, UTF-8/JSON, baselines, teclas e referências. Recusa
conhecida retorna diagnóstico limitado, sem probe, reserva, débito ou novo job.
Não usa a revisão atual do projeto como substituta. Ausência de suíte explícita
é erro; ausência do default implícito permite observação apenas de boot.

O mesmo decodificador é reutilizado por `game_check_tests`, pela admissão após
consentimento e pelo coletor antes do navegador. Replay de jobs/recibos tem
precedência, inclusive para estados desconhecidos; não reinterpreta uma coleta
antiga como recusa prévia nem a repete. Conferir formato não corrige fonte,
concede qualidade ou enfraquece limites. Coletores sem essa declaração mantêm
seu próprio contrato, sem inferência por nome ou categoria.

`GameValidationCollector` pode declarar `admission.reserve/cancel`. Ambos recebem
`GameValidationAccess`: identidade autenticada, job, revisão, sinal e o artefato do
build original. `readFile` resolve somente arquivos desse artefato, com a verificação
de bytes existente. Não oferece leitura genérica do workspace ou resultado enviado
pela UI. O pedido continua fixando build, coletor/toolchain e suíte de testes.

O serviço usa a mesma coordenação persistente de builds/mídia:

1. Grava job `admitting` e admissão `pending` antes de chamar a porta externa.
2. Só após confirmação grava `reserved` e aguarda os recursos compartilhados.
3. O coletor executa uma única vez quando recebe recursos; publica observações
   vinculadas a revisão, build, hash do artefato e toolchain.
4. Recusa conhecida encerra sem coletar. Cancelamento em fila fecha a reserva
   original; perda de confirmação mantém reconciliação e recursos conservados.
5. Após queda/reinício, admissão pendente/reservada não é repetida. A conferência
   usa o mesmo job/artefato e o inspetor instalado original, sem prova substituta
   do cliente ou nova execução de navegador.

Admissão não transforma um teste inconclusivo em qualidade aprovada. As regras de
categorias, evidências, cobertura, invalidação de revisão e aceitação humana
continuam independentes. Fechar a UI não encerra o serviço nem elimina a reserva.
Coletores workspace existentes podem continuar sem admissão externa; conservam
a fila de recursos e orçamento de workflow já implementados no Companion.

## Porta protegida por produto

O adaptador assinado pode fornecer `gameValidationCollectors` ao processo dono.
O serviço os combina com os demais coletores, mantendo seleção por produto. O
carregador só aceita esses coletores com produto exclusivo `kidos`, autoridade
`kidos-core`, probe, validação, reserva, cancelamento e reconciliação. Uma função
`dispose` opcional também precisa ser válida. Não há cadastro por RPC/modelo.
O construtor da produção revalida admissão/inspeção e recusa coletores KidOS sem
admissão, inclusive quando fornecidos diretamente pelo processo dono.

O kit declara `installedCoreGameValidationVersion: 1` e o manifesto do motor,
`installedCoreGameValidationABI: 1`. São a capacidade do **serviço/kit** para essa
integração; não declaram a existência de worker, browser, Core API ou coletor
instalado no KidOS. Não há `coreValidationSchemas` ou porta Core executável nessa
entrega. Nenhum coletor protegido foi registrado no adaptador Navi por este passo.

## Contabilidade Root e compatibilidade

No KidOS, o pedido de autoridade `child.game-build.reserve` aceita
`production_kind: "validate"` somente com projeto autorizado e `admission_mode:
"queue"`. Usa a mesma alocação `requests_per_block` de builds/mídia, além dos
limites por UID/dia. A classificação não concede execução, coleta, instalação ou
aprovação de qualidade. Concessões antigas de inferência mantêm zero pedidos.

O snapshot Root informa `production_by_kind` para `build`, `assets` e `validate`,
inicialmente zero. Cancelamento/falha conservam o débito; replay, inspeção,
virada do dia ou mudança de etapa não o transferem nem o apagam. UID vem da
fronteira autenticada; a interface não escolhe etapa, consumo ou outro projeto.
A implementação/operações administrativas ficam no repositório KidOS, em
`docs/PROTECTED_VALIDATION_BUDGET.md`.

A lista `production_kinds` passa a reconhecer `validate`. O schema compartilhado
aceita listas legadas e a nova lista; tipos desconhecidos continuam recusados.
Novos catálogos web/mídia KidOS declaram `budgetPolicyABI: 2` e exigem motor com
`installedCoreGameValidationABI: 1`. Builder, factory e instalador verificam esse
vínculo antes de publicar/carregar a nova composição. Não confundir schema de
política com ABI do worker/compilador, que tem versionamento próprio.

Catálogos anteriores sem essa declaração continuam verificáveis para rollback
com seu runtime de sistema correspondente. Não são reclassificados como leitores
da nova política. Um consumidor antigo pode recusar a lista nova; atualizar Core,
contratos e adaptador somente como composição exata e ensaiada, sem fallback.

## Evidência e próxima integração

Passaram **499 testes Companion e 30 verificações do repositório**, tipos,
build e build headless de desenvolvimento. O kit empacotado e seu manifesto
contêm o ABI 1. O smoke local Chat Completions, somente de leitura e com provedor
simulado, passou. **858 testes KidOS** passaram, dois legados ignorados.

Os casos novos verificam build/arquivos fixados antes da fila, recusa conhecida,
cancelamento desconhecido sem coleta, perda de confirmação e reinício sem nova
admissão, relatório inconclusivo sem qualidade aprovada, assinatura/autoridade e
isolamento de produto. A autoridade usa seu SQLite real nos testes: concorrência
entre três tipos, débito compartilhado, cancelamento/replay/reinício, UID/projeto,
etapa e concessão legada. A negociação da porta web passou em 25 cenários
simulados, incluindo as guardas de ABI executadas antes deles.

Esses ensaios são locais, com estados temporários, portas de fixture e modelos
simulados. Não demonstram reserva/coleta ponta a ponta por SDK→Core→Root num
perfil infantil instalado. Nenhuma inferência real, publicação ou instalação foi
necessária. Evidência local: `output/validation-admission/attempt-1/` neste checkout.

Na etapa posterior, [o candidato fixo](GAME_BROWSER_CORE_CANDIDATE.md) acrescentou
request/recibo/evidência, worker de um job e verificadores KidOS em fonte, com
browser real e bytes conferidos entre Node/Python no Mac. Faltam o coletor/broker
Core instalado, porta assinada, isolamento Linux e encerramento da unidade
comprovados, composição SDK/Root e instalação. Só depois integrar workflow/Navi v2 e cortar
caminhos legados. Quatro engines, três clientes instalados, assets, seis jogos,
pedidos inéditos e aceite físico/humano do plano continuam obrigatórios.

Depois desses ensaios, [o protocolo/broker Core](GAME_CORE_VALIDATION_PROTOCOL.md)
foi implementado em fonte, reutilizando o diário de build/mídia, Root e unidade
original. O relatório é transferido por blocos para preservar o limite Core de
1 MiB. Socket real e schemas entre linguagens têm testes próprios; porta assinada,
composição Linux e instalação continuam pendentes.
