# Variantes de áudio no Studio

Fonte de desenvolvimento **2026-11-13**, GD-03/GD-08. Leia o [codec isolado](GAME_AUDIO_CODEC.md),
o [mixer web](GAME_AUDIO_AAC_RUNTIME.md), os [assets](GAME_ASSET_PIPELINE.md) e a
[arquitetura da suíte](SUITE_ARCHITECTURE.md). Não é instalação ou aceite final.

## Uso e responsabilidades

Em **Assets**, um recurso de áudio com WAV registrado oferece **Criar variantes
de áudio**. O formulário usa a revisão exibida, permite escolher o WAV quando
há mais de um, o nome do novo recurso, o arquivo-base de saída e até três
variantes. IDs de variantes são fixos; cada uma aceita64/96/128/192 kb/s.
Valores maiores priorizam fidelidade/arquivo maior, sem garantia de qualidade
musical. As escolhas de taxas desativadas também ficam no rascunho.

O novo alvo tem identidade própria, separada do master. Não se sobrescreve um
recurso/arquivo existente pelo formulário. Preparar pede confirmação nativa e
cria só o candidato. O WAV, a proveniência e a condição temporária continuam
preservados. Revisar/tocar/exportar/aplicar usam as ações existentes; aplicar
continua separado de aprovar processamento ou declarar qualidade.

Codificador/contrato indisponível produz indicação explícita. Não há instalação
automática, FFmpeg do host, escolha de provedor ou mudança de engine. A conversa
continua podendo usar as ferramentas autorizadas; a UI é outro cliente delas.

- `packages/contracts/src/game-studio.ts`: comandos estritos `encode-audio` e
  `resume-encode-audio`; receita fixa `audio-codec-isolated-v1`, fonte e hash.
- `packages/client-ts/src/game-studio.ts`: controlador compartilhado, catálogo,
  revisão/fonte/caminhos e permissões reconferidos antes/depois da confirmação.
- `packages/game-studio-ui`: apresentação, rascunho e escolhas; sem codec ou IA.
- Agent Service/adaptador: autoridade, operação, recursos, resultado e recibo.

## Recuperação sem novo efeito

`games.assets.inspect` recebe o mesmo `gameAssetProcessRequest` do processamento,
incluindo ID, projeto, revisão e receita completos. É somente leitura da linha
existente em `game_production_jobs`, sem probe, registro de job, agendamento,
aprovação, novo processamento ou consumo de alocação de produção.

O serviço confere namespace/projeto e o binding canônico exato. ID reaproveitado
com outro conteúdo é conflito. Retorna apenas estado `missing` ou `acknowledged`,
identidade/hash do pedido e, se registrado, o ID do job. `acknowledged` confirma
registro do pedido; não implica processamento concluído ou efeito conhecido.
O job pode ainda estar na fila, cancelado, falho ou aguardando reconciliação.

O SDK TypeScript valida schema e digest canônico do pedido normalizado. O Python
valida os campos/identidades e conserva o digest fornecido pelo serviço; não
reimplementa hashing JavaScript de floats. Os dois usam o IPC/TLS autenticado.
O endpoint e a capacidade `game-asset-request-inspection-v1` não são oferecidos
ao KidOS até integração protegida própria. Não é uma autoridade parental.

Antes do envio, o host confirma WAV registrado na revisão original e hash,
capacidade real, modo de edição, alvo novo e ausência de colisões de saída.
O pedido completo é congelado e o host confirma gravação durável no arquivo de
rascunho **antes** de disparar. Recusa conhecida da primeira tentativa reabre os
campos. Perda de resposta mantém os mesmos IDs/conteúdo, campos e Cancelar
desativados, sem dispatch automático ao reabrir.

**Conferir pedido** primeiro lê o binding original. Com recibo, o controlador
confere também job/receita/adaptador/fonte e devolve o mesmo ID, sem consentimento
ou processamento adicional, inclusive em modo somente leitura e após uma revisão
posterior. Não altera essa revisão. Se a inspeção disser `missing`, isso não é
prova de ausência/cancelamento: o rascunho permanece. Somente a mesma revisão,
permissões atuais e nova confirmação permitem reenviar o pedido exato pelo fluxo
idempotente normal. Revisão diferente recusa esse envio e conserva o original.

Recusa ou erro de uma consulta/repetição não apagam uma tentativa anterior de
resultado desconhecido. Recibo adulterado/divergente também conserva o pedido.
Somente confirmação exata permite limpar o rascunho; limpar a tela não cancela
ou aplica o job. Resultado incerto do codec continua na reconciliação existente.

## Rascunhos e compatibilidade

O campo opcional `audioEncodeEdit` usa o mesmo armazenamento privado, escopo
autenticado, CAS ordenado, limite2 MiB e fsync do Studio. Guardar dados de UI não
concede ferramenta, namespace ou licença. Reabrir restaura campos, taxas
desativadas e pedido congelado; não envia nada sozinho. Polling pausa durante
edição local para não interromper controles; pedidos congelados podem atualizar
o progresso. Nova seleção não transfere o rascunho para outro projeto.

Não usar sessionStorage como autoridade. Conteúdo incompatível é preservado e
apresentado como recuperação necessária. Leitores antigos que desconheçam o
novo campo podem recusar o arquivo preservado; ativação/rollback instalado deve
conservar esses dados e seus leitores, sem tratá-los como inexistentes ou apagar
o novo histórico. A qualificação local não conclui essa migração/distribuição.

## Verificação e limites

`test/game-studio-audio-encode.test.ts` usa serviço/SDK/TLS reais e processador
explicitamente simulado, sem AAC real. Verifica ausência de efeitos na consulta,
negação, modos, fonte/ID forjados, mudanças durante consentimento, namespaces,
recuperação após trabalho posterior e inspeção adulterada/ausente. O Python lê
o mesmo recibo por IPC, sem repetir processamento.

`scripts/qualify-game-audio-encode-studio.mjs --engine=<exato> --codec=<registro>`
usa o codec real, worker WAV, renderer/controlador e arquivos de rascunho. As
pontes Mac/VS Code são emuladas, e resposta perdida/uma consulta `missing` são
injeções identificadas. Não substitui os clientes instalados, audição física,
direção musical, qualidade final, jogadores reais ou integração infantil.

O [dossiê](../output/game-generation/audio-encode-studio-20261113-a1/) registra
fontes, resultados, falhas e encerramentos. Nunca inferir conclusão do plano
integral a partir de um formulário, codec ou número de testes.

### Resultado observado

O ensaio final `2026-11-13T14-27-37-640Z-dd8d2b2c`, motor de desenvolvimento
`fdeb6d7d…`, passou nas pontes Mac/VS Code emuladas. Em cada namespace, o worker
produziu o master e o codec isolado recebeu exatamente um pedido de variantes.
O formulário escolheu outro WAV do mesmo asset, restaurou nomes/taxas inclusive
uma desativada, pausou o polling durante edição e recusou processamento sem
consentimento. Nome acessível e layout normal/estreito foram conferidos.

Depois da resposta de processamento perdida, o pedido ficou congelado e foi
restaurado. Uma revisão posterior e uma consulta `missing` injetada não limparam
o original nem criaram outro job. A consulta real seguinte encontrou o mesmo
pedido, sem outra codificação. As duas variantes reais corresponderam ao WAV
mono22050 Hz selecionado; sua aplicação criou revisão5 preservando o título
posterior e os dois WAVs. Qualidade continuou não aprovada; serviço/browser
encerraram com código0/fechamento confirmado.

Passaram741 testes e31 verificações, um opt-in ignorado, checks/builds dos
clientes e roteamento simulado. O teste de autorização usa processador simulado:
seu primeiro fixture omitia um sidecar obrigatório e foi recusado. Uma expectativa
de texto de erro também foi ajustada para conferir o código de isolamento.
Essas falhas foram preservadas, sem enfraquecer o contrato.

O primeiro roteiro de UI encontrou dois labels iguais em formulários distintos;
o observador foi limitado ao formulário correto. Uma captura desktop de página
inteira após resize mostrou pintura repetida; ela foi conservada. A captura
posterior aguarda layout e registra o elemento do formulário, além de conferir
um único root/título; não é correção de produto nem prova de cliente instalado.
O layout estreito também tem captura inteira. Não se filtraram erros ou relaxaram
limites/políticas. Ensaios anteriores e seus encerramentos ficam no dossiê.

Nenhuma inferência, alocação extra, instalação ou publicação. Distribuição,
leitores de rollback, clientes nativos instalados, audição, quatro engines,
integração protegida e o aceite integral de jogos permanecem pendentes.
