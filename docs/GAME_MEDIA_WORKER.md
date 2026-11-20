# Worker e integração protegida de mídia

Estado em **2026-11-10**: contrato, worker real, broker Core, porta e admissão
compartilhada com builds em fonte, com opções desativadas por padrão. Composição
Linux offline de SDK, serviço, porta assinada, Core oficial, Root e codecs reais
passou. Há também prova nativa de systemd/bwrap no Alien em diretório temporário
com runtime do UID. **A composição Root instalada e o Navi ainda não foram qualificados.**
Leia a [arquitetura da suíte](SUITE_ARCHITECTURE.md),
o [pipeline de assets](GAME_ASSET_PIPELINE.md) e o [plano integral](GAME_DESIGN_IMPLEMENTATION_PLAN.md).

## Responsabilidades

| Componente | Conteúdo e limite |
|---|---|
| [Contrato privado](../packages/contracts/src/game-media-worker.ts) | Request/result versionados, fontes registradas, hashes e limites; não é uma operação Agent API ou permissão Core |
| [Validação de fontes](../packages/contracts/src/game-assets.ts) | `assetSourceInputs`: identidades/tipos, arquivos da revisão, orçamento e ciclos; compartilhada pelo serviço e worker |
| [Codecs puros](../packages/adapter-game-assets/src/process.ts) | Composição PNG, atlas e renderização WAV; usados também pelo worker local existente |
| [Candidato durável](../packages/adapter-game-assets/src/candidate.ts) | Uma operação, entrada selada, arquivos endereçados por hash e confirmação sem sobrescrita |
| [I/O restrito](../packages/adapter-game-assets/src/candidate-io.ts) | Arquivos regulares, sem aliases, leituras limitadas e commit atômico |
| KidOS | `game_media_worker.py`: instalação/comando fixados e verificação dos bytes; `game_media.py`: ciclo durável e RPC protegidos |
| Porta KidOS | `media.cjs` no repositório KidOS, carregado pelo adaptador verificado; `installedCoreGameMediaVersion: 1`, admissão e inspeção obrigatórias |

O motor/grafo continua responsável pela inteligência. Este worker não tem agente,
provedor, credenciais, workspace genérico, shell, scripts ou plugins do projeto.
`model.scene` exige o adaptador Blender apropriado; não é convertido silenciosamente
para outro processamento. Mac/VS Code mantêm o processador local atual.
O processador local também tem `image.vector` para SVG original tipado. Essa
operação é recusada explicitamente neste contrato Core: os formatos fixos,
verificadores e qualificações PNG/WAV/JSON continuam iguais. Uma futura entrada
vetorial protegida exige contrato, verificação de resultados e qualificação
próprios; não usar o processador de workspace como alternativa no Navi.

## Entrada e saída

O request privado v1 contém `requestId`, `sourceHash`, `recipeHash`, `toolchain`,
`document`, `spec` e `sources`. Fontes precisam corresponder exatamente aos assets
registrados da revisão, na ordem da receita, com até 100 identidades distintas e
64 MiB. Um alvo não pode tornar-se seu próprio ancestral. Referências de
transferência não viram caminhos de host: o worker só lê `input/blobs/<sha256>`.

O diretório de entrada contém exclusivamente `request.json` e `blobs` declarados.
Metadata tem limite de 16 MiB; fontes têm tamanho/hash conferidos. O worker valida
novamente a receita normalizada, o hash do documento e a composição fixada.
Campos de comando, provedor, URL ou UID não fazem parte do contrato.

O resultado contém hash dos bytes do request, documento, receita e toolchain,
até 17 arquivos/128 MiB e informações escalares limitadas. PNG, WAV e JSON de
atlas têm nomes de saída vinculados à receita. Arquivos no candidato usam nomes
planos por hash; metadados conservam seus caminhos portáveis em `assets/`.
O marcador `result.lock` impede um segundo processamento no mesmo output.
`result.json` é publicado por criação atômica sem substituir resultado existente.
Erro ou cancelamento preserva fontes e candidato; não há nova execução automática.

`recipeHash` é verificado pelo Node contra a receita normalizada. O Core deve
conservar esse valor da entrada selada, junto a `requestSha256`; não recalcular
o JSON em Python, cuja representação de números como `1e-7` difere da do Node.
Integridade não comprova licença, direção de arte, som físico ou qualidade do jogo.

## Execução e autoridade

O build do motor inclui `game-media-worker.cjs`. O CLI exige Linux, Node empacotado
22.23.4 e três argumentos exclusivos do broker: input, output e hash da composição.
`processMediaCandidate` é testável com diretórios privados; a função sozinha não
é um sandbox do sistema operacional nem concede autoridade a seu chamador.

A preparação Core deriva da instalação imutável já usada pelo compilador web,
mantendo seus padrões anteriores. `MediaWorkerInstallation` fixa o worker, o
prefixo da unidade e limites preparados de 768 MiB, uma CPU, 64 processos e
60 segundos, com rede separada e mounts restritos. O verificador só deve rodar
após comprovar o encerramento da unidade original. Ter `result.json` não prova
que um processo terminou, nem permite liberar uma operação desconhecida.

O broker `game_media.*` reutiliza o armazenamento, bloqueio, slot único e ciclo
de reserva/claim/cancelamento dos builds. Exige projeto, admissão antecipada e
`production_kind: assets`; IDs de outro produtor são recusados. PNG/atlas/WAV
consomem a mesma alocação Root por projeto/etapa, com divisão por tipo no histórico.
Não há concessão independente por novo run, cancelamento ou reinício. O worker
continua sem política parental. A porta usa apenas Core e leitura da alocação
original, sem abrir workspace, filesystem, shell, Docker ou provedor alternativo.

O builder KidOS aceita `--game-media` somente com projeto/fila e ABI/hash/codec
exatos; o catálogo de ferramentas do modelo não muda. O serviço recebe os
processadores do adaptador assinado, reserva antes da espera por recursos e
conserva admissões desconhecidas. Processar não aplica os bytes à revisão.

Perda do recibo Core é conferida na autoridade pelo UID/ID original: sem despacho,
Root pode fechar a identidade sem devolver consumo; com claim ou grant legado,
a operação continua desconhecida e bloqueia novo despacho. Ausência de unidade
ou arquivo nunca comprova encerramento. Não habilitar Navi pelo arquivo no pacote.

## Evidências anteriores do worker isolado

Os totais abaixo são históricos, anteriores à integração do broker descrita acima.

Passaram **489 testes Companion e 30 verificações do repositório**, **764 testes
KidOS, com dois ignorados do legado**, TypeScript, builds e smoke Standard/Deep
de leitura simulado. Os testes incluem fonte/tipo/ancestralidade, orçamento,
bytes alterados, links, composição divergente, concorrência, cancelamento e
resultado anterior preservado. A API de erros de fontes do serviço foi mantida.

O ensaio de mídia passou em **sete cenários** com Node Linux real, runtime fixado
por Root, worker UID 1000 e contêiner offline x64 emulado no Mac ARM64. Conferiu
pixels PNG, duas páginas de atlas com frames/animação, WAV de 1.103 frames a
22.050 Hz, recibos pelo verificador Core e recusa de escrita no runtime Root.
Bytes/receita adulterados e repetição não publicaram/substituíram resultados.
O worker exercitado tem bytes idênticos ao componente do build atual do motor.

Relatório KidOS: `build/media-qualification/attempt-2/evidence/report.json`, SHA-256
`745d0ec1f0841f62384d46bb6dc1aba91b5c9a705660bf57c81594bc0b2e7321`.
Manifesto de 12 entradas:
`f98ff31caae83588cbf61cc2b06081837df695703ec1bf8e9311883f82d00ef3`.
São 137 inputs Companion conferidos. A tentativa 1 foi preservada: o tmpfs estava
`noexec` e o Node não iniciou; a montagem de fixture foi corrigida para executar
o runtime. Não foi alterada uma configuração de sistema do usuário.

Também passaram novamente os **11 cenários de regressão** SDK/serviço/assinatura/
porta/broker/autoridade, com três admissões e dois despachos de compilador de
fixture. O relatório KidOS atual é `attempt-15-media-base/evidence/report.json`
na árvore `build/inference-composition`. Essa regressão não integra o worker de
mídia ao broker: compilador e transporte Core desse ensaio continuam simulados.

## Verificação inicial da integração em fonte (histórico)

Passaram **783 testes KidOS, dois ignorados do legado**, **492 Companion e 30
verificações do repositório**, tipos, builds de motor/extensão/Mac e smoke
Standard/Deep simulado somente de leitura. São **14 cenários da porta de mídia**
e **25 de regressão da porta web**, com Core simulado; conferem respostas perdidas,
cancelamento desconhecido, hashes, receita, fontes, isolamento e recusa de downgrade.
Os testes do domínio usam autoridade transacional real, saída de worker controlada
e demonstram cota/slot compartilhados, restart e perda de recibo após claim.

Repetiram-se **11 cenários Linux** de regressão SDK/TLS/IPC/assinatura/Root:
`build/inference-composition/attempt-17-media-port/evidence/report.json` no KidOS,
SHA-256 `e1b073e2cc1d0530e1339e852456f55150e3ced8935983a2f8553bbb96f780e4`.
Inputs SHA-256 `1422e96654d8e8890e951a2ed33675454879546788cdfab1d7d1ee5832dec062`;
62 entradas e 1.642 fontes Companion conferidas, assinatura pública verificada.
Essa regressão usa compilador/ciclo/transporte Core simulados; não compõe o worker
de mídia real. A tentativa 16 não iniciou por entrypoint implícito da imagem;
erro preservado, corrigido só na invocação do contêiner na tentativa 17.

Naquela revisão estavam pendentes composição do worker real com broker/porta/autoridade,
contagem de testes, workflow protegido, bwrap/systemd reais, composição assinada
de release e instalação/migração/rollback. A política Root nova e ABI privado
exigem composição exata; não atualizar componentes isolados na instalação atual.
Os sete cenários não certificam GUI, GPU, áudio físico, arte, licenças ou aceite
dos jogos. O escopo integral do plano permanece obrigatório.

## Composição real por SDK, serviço, porta, Core e Root

O ensaio final passou em **15 cenários** offline Linux x64 emulado no Mac ARM64.
O SDK usa TLS/IPC do serviço e loader Ed25519 com wrapper de fixture assinado.
`CoreUnixServer` e `KidOSCore` reais usam o registro de capacidades, UID do kernel,
permissões e auditoria; o catálogo/home são sintéticos. Root é outro processo/UID,
com ledger transacional e inferência simulada por gateway separado. O worker
executa como UID 1000 com runtime Root e bytes idênticos ao build do motor.

Foram conferidos pixels de composição, duas páginas de atlas/frames/animação e
WAV de 1.103 frames a 22.050 Hz, incluindo receita com ganho `1e-7`. O candidato
não alterou a revisão antes da aplicação explícita. SIGKILL/reinício do serviço
recuperou o resultado original sem novo worker. Mídia não contornou a cota já
consumida por builds; cancelamento na fila conservou o débito sem processar.
O resultado contém sete admissões Root (três builds, três mídias executadas e
uma mídia cancelada na fila), com **três processos de mídia**.

O Core recusou outro UID e a ausência de escopo antes do efeito. Sua cadeia de
auditoria foi verificada; o relatório público contém contagens, sem exportar
audit log, banco, tokens, checkpoints ou chave privada. Um `admit` aceito pelo
Core pode devolver recusa de orçamento: não equivale a execução bem-sucedida.

Relatório KidOS: `build/inference-composition/attempt-21-official-core-media/evidence/report.json`,
SHA-256 `2b66fa83c6fab78ad9526f008bc486f802d8d53abd751e7f6ad8383b3c9865b6`.
Inputs SHA-256 `1662e330d75945f6d291c9c8bd02e99c5a55c9e2c628592e29930d17809b1c6f`;
182 entradas e 1.669 fontes Companion conferidas; assinatura pública verificada.
Worker SHA-256 `0dfaf573bdd89704b46a1b4ea3cccba74a163ec84b7ae8d68fc430cd183a3134`.
Passaram **786 testes KidOS, dois ignorados do legado**, **492 Companion e 30
verificações do repositório**, tipos e build. Guardas recusam execução fora da
fixture mesmo com Python otimizado e preservam saídas anteriores.

As tentativas 18–20 permanecem: 18 falhou na leitura do manifesto antes do
servidor; 19 passou com transporte Core de fixture; 20 passou pelo Core oficial
antes da última guarda. A 21 repete a versão final. O preparador copia apenas
código/catálogos públicos e Node/SQLite verificados, não contas ou repositório inteiro.

O gerenciador de processos é uma fixture que rastreia filhos reais e controla a
confirmação de término; **não executa systemd/bwrap**. O contêiner limita o ensaio,
não certifica os limites por job na instalação. O compilador web permanece
simulado. Não há GUI, audição física, licença/qualidade artística ou aceite dos
jogos. Permanecem contagem de validações, workflow protegido, isolamento real,
composição de release e instalação/migração/rollback, sem alterar as guardas Navi.

## Systemd/bubblewrap reais no Alien, sem instalação

Em 2026-11-10 passaram **nove cenários nativos** na conta alien/UID 1000:
PNG/atlas/WAV com decodificação, recusa de fontes/receita adulteradas, repetição
sem sobrescrita, filesystem/ambiente/rede isolados, cancelamento e timeout.
O comando veio de `MediaWorkerInstallation`; systemd e bubblewrap foram reais.
Foram observados 768 MiB, 64 tarefas, uma CPU e `NoNewPrivileges=yes`, com um
minuto de runtime configurado. A prova de timeout usa três segundos somente
na unidade de teste. Não houve benchmark ou stress de memória/tarefas.

Os nove cgroups/unidades confirmaram término e não houve novos heartbeats após
parada. O loopback do host recebeu zero conexões do canário. O candidato original,
as fontes e o runtime permaneceram íntegros. O Node veio de release Root já
instalada com bytes conferidos, mas o runtime de teste é **temporário do UID**;
isso não qualifica a provisão Root do novo worker ou o broker/Navi instalado.
Nenhuma política, pareamento, conversa, projeto ou serviço persistente foi alterado.

Referência operacional KidOS: `docs/GAME_MEDIA_NATIVE_QUALIFICATION.md`.
Relatório `build/native-media/attempt-2/report.json`, SHA-256
`53e04ab3dc8dc34fd2dd105f97b9bf3bbc6f71bbe0d7d891a0e61fed680872d9`.
Payload SHA-256 `4ef7997bcf78a0b24e47fe5e12f525f80a20798e50153e9818783de27afa4f36`;
11 entradas mais manifesto, 138 fontes Companion e mesmo worker do motor
conferidos. A tentativa 1 foi preservada; a 2 repete a revisão final, validando
os módulos antes de importá-los. Há recusa fora do ambiente, fonte não fixada,
sobrescrita e import de módulo adulterado mesmo com Python otimizado.

Passaram **792 testes KidOS**, dois ignorados do legado, **492 Companion + 30
de repositório**, tipos/build. Os helpers sintéticos foram compartilhados entre
as duas qualificações; a regressão Root/UID em contêiner passou novamente em sete
cenários (`build/media-qualification/attempt-3-shared-fixtures/evidence/report.json`
no KidOS), SHA-256 `7515ebc35357b9ee5399bf6d33ef90b20953a5d34e5835c496638ad860bb1790`.
As provas permanecem separadas: ainda é necessário compor release/autoridade,
worker Root, broker e Navi instalados, cota de validações, workflow, corte legado
e migração/rollback. Áudio físico, arte/licenças e aceite dos jogos não foram feitos.
