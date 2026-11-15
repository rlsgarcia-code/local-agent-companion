# Porta de coleta protegida KidOS

Estado em **2026-11-11**: porta/factory e builder em fonte, com assinatura efêmera
de teste. **Sem publicação, provisionamento Linux completo ou instalação Navi.**
Leia [o protocolo](GAME_CORE_VALIDATION_PROTOCOL.md), [admissão](GAME_VALIDATION_ADMISSION.md)
e [o candidato](GAME_BROWSER_CORE_CANDIDATE.md). A referência local KidOS fica em
`docs/PROTECTED_GAME_VALIDATION.md`.

## Serviço, produto e identidade

No KidOS, `integrations/agent-engine/src/validation.cjs` fornece
`createCoreGameValidation`. A factory do adaptador retorna `gameValidationCollectors`
somente quando seu catálogo contém `gameValidation`. O carregador assinado e o
serviço continuam exigindo autoridade `kidos-core`, produto exclusivo `kidos`,
probe, admissão/cancelamento e inspeção. Não existe registro desse coletor por RPC.

O motor/kit declara `installedCoreGameValidationPortVersion: 1`; o manifesto
declara `installedCoreGameValidationPortABI: 1`. É negociação adicional ao ABI
de admissão de validações, também 1. Um kit antigo com apenas os hooks de fila
não satisfaz esta porta. O build inclui o flag; empacotar preserva os campos do
manifesto. Flag/API disponíveis não comprovam browser instalado ou isolamento.

`prepare` recebe somente o contexto autenticado do serviço. Confere job, coletor,
build/revisão/projeto/fonte/engine e hash do documento original. O request é
idempotente por UID, produto, perfil, workspace e job. Arquivos vêm apenas do
artefato fixado, não dos arquivos-fonte de workspace. O hash do request usa seus
bytes originais. A alocação Root é consultada pelo projeto persistido; a UI não
fornece refs, etapa, consumo ou decisões administrativas.

`admission.reserve` registra e admite o pedido antes de esperar na fila comum.
Só `validate` transfere os blobs e solicita `start`. Depois de confirmação perdida,
`reconcile` usa lookup/inspeção e baixa o candidato original; nunca reserva,
envia os arquivos de novo ou inicia outra coleta. Uma reserva ainda sem despacho
é cercada por cancelamento do descritor original. Ausência não prova parada.

Probe exige Core/fila exatos, política `validate`, toolchain e as engines declaradas.
Indisponibilidade não habilita browser de workspace, perfil pessoal, shell,
filesystem, Docker ou outro mecanismo. As guardas Game Design/workflow Navi v2
continuam; disponibilizar uma porta não as remove.

## Resultado e evidências

`core-exchange.cjs` reutiliza a transferência existente de builds/mídia. Para
validações, confere o cabeçalho de cada página e os vínculos de request, fonte,
artefato, suíte e toolchain. Primeiro baixa `report.json` por posição/tamanho/hash;
só então aceita o schema de resultado automatizado.

O mapa de até 2.000 evidências deve coincidir **exatamente** com o relatório:
ordem, numeração por observação/arquivo, MIME, tamanho e hash. Arquivo extra,
ausente, trocado ou metadata alterada conserva reconciliação. Relatório e
evidências somam até 68 MiB; cada resposta Core continua abaixo de 1 MiB.
Cada blob é conferido antes de devolver `CollectedGameObservation[]`, com seus
nomes originais. Nenhum resultado ganha cobertura semântica ou aceite humano.

Cancelamento usa controle independente e só admite confirmação terminal do Core.
Erro após `start`, hash divergente, encerramento não confirmado ou resposta perdida
não viram falha conhecida que libere recursos. Cota e recibos continuam no Root/Core.
Nenhum browser é aberto pelo processo da porta e não existe outro loop de IA.

## Catálogo e distribuição

O builder KidOS aceita `--game-validation-browser <manifesto-browser>`, somente
junto de produção, projeto e fila protegidos. Exige o worker e ABI de porta no
artefato Linux exato, driver fixado e manifesto browser da mesma plataforma.
Recusa links de arquivo, caminhos conflitantes, árvore inválida e limites excedidos.
O catálogo fixa hash do motor, hash dos bytes do manifesto browser, plataforma e
toolchain. Esse input é administrativo; não faz download nem certifica sua origem,
licença, browser instalado ou prontidão de release.

O catálogo de ferramentas/grupos do Navi não muda. Sem opção explícita não há
coletor. Catálogos anteriores continuam válidos com seus artefatos de rollback.
O instalador KidOS agora exige um quarto componente browser autenticado, com
partes e árvore derivada verificadas, apontamento e rollback. Consulte
`docs/PROTECTED_BROWSER_DISTRIBUTION.md` no KidOS. A composição fixa também
`browser_component_manifest_sha256`, requer ABI/kit de componente 1 e inclui
esse SHA externo na toolchain. Catálogos de teste com apenas o manifesto runtime
continuam recusados. Composição Root/Linux real e aceite instalado ainda faltam.

## Evidência

- 28 cenários simulados: normal e relatório grande, autoridade antiga, produto,
  projeto/build, quota, acknowledgments perdidos, report/hash/suíte/escopo trocados,
  mapa extra/ausente, paginação, blocos/base64, cancelamento e unidade desconhecida.
- Factory **real** do adaptador, módulo e catálogo gerados carregados por
  `loadSignedAdapter` com Ed25519 temporário: uma admissão/coleta, recuperação sem
  repetir e recusa de módulo adulterado. Owner, pin do engine e ponte são fixtures;
  não é assinatura de release ou composição Root/Linux instalada.
- 14 cenários de mídia e 25 de build continuaram passando após reutilizar o leitor
  de blocos. 44 testes selecionados de catálogo/instalador passaram, incluindo
  recusa do ABI ausente/booleano e preservação das ativações anteriores válidas.
- Regressão: 934 KidOS passaram, dois ignorados; 509 de 510 Companion passaram,
  um opt-in ignorado, mais 30 verificações. Tipos, builds e smoke de leitura com
  provedor simulado passaram. Evidência local: `output/core-validation-port/attempt-1/`.

O primeiro ensaio assinado recusou o carregador compilado antigo pelo ABI novo;
após recompilar o mesmo código atual, passou. O log foi preservado, sem relaxar
o gate. Isso não demonstra SDK/serviço/Core/Root/browser juntos nem qualifica
systemd/bwrap, instalação, GPU, licença Unity, jogos completos ou aceite humano.
O plano integral permanece aberto.


## Composição posterior do protocolo com Root

A composição descartável KidOS `docs/PROTECTED_VALIDATION_COMPOSITION.md` agora
liga SDK, serviço, porta assinada, Core e autoridade Root com UIDs reais. Passou
em 18 cenários: validação compartilha cota, conserva débito ao cancelar na fila
e recupera relatório após SIGKILL sem readmitir/coletar. Browser e gerenciamento
de processos são simulados nesse conjunto; a observação fica unverified e a
qualidade pronta continua false. Não soma aceite nativo/instalado com a prova
Linux separada. Evidência no KidOS: `build/inference-composition/attempt-22-validation/`;
no Companion: `output/core-validation-composition/attempt-22/`.
