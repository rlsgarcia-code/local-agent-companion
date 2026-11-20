# Forma de onda e medições do WAV produzido

Fonte de desenvolvimento, **2026-11-13**, GD-03/GD-08. Complementa a
[edição dirigida](GAME_ASSET_PIPELINE.md) e a
[comparação histórica](GAME_MEDIA_COMPARISON.md). Não substitui ouvir o jogo,
direção musical, teste de dispositivos ou aceite artístico/humano.

## Contrato explícito e preservação

`audio.render` aceita `waveformBins` opcional: 128, 256, 512 ou 1024. Omitir preserva
o objeto da receita sem esse campo, seu hash normalizado, o WAV e a lista de
arquivos anteriores. Pedir análise acrescenta somente o irmão de nome fixo
`<nome>.audio.json` ao WAV; os bytes do WAV continuam idênticos à execução da
mesma receita sem análise. O caminho derivado deve respeitar os limites portáveis.

`packages/contracts/src/game-audio-analysis.ts` define a estrutura fechada v1.
`packages/adapter-game-assets/src/audio-analysis.ts` mede somente o PCM16
canônico que o próprio renderizador acabou de codificar. Não mede o mix float
anterior à quantização, não abre caminho do host, rede ou código de projeto e
não inicia ferramenta ou modelo adicional. Usa o mesmo worker, job, recibos,
limites e proveniência do processamento existente.

O relatório contém SHA-256 do WAV completo, sample rate, número de canais,
frames, duração e medições independentes por canal:

- Pico absoluto, RMS e média DC, sobre samples inteiros divididos por 32768.
- Pico/RMS em dBFS por `20 log10(amplitude)`. Zero digital usa `null` em vez
  de infinito; não vira um número fictício ou JSON inválido.
- Samples exatamente zero e nos limites PCM positivo 32767/negativo −32768.
- Mínimo, máximo e RMS de cada bloco contíguo de frames para a forma de onda.
- Frames em que **todos** os canais ficam abaixo da amplitude 0,001 (−60 dBFS),
  incluindo os trechos inicial e final. É um limiar de samples, não julgamento
  de silêncio perceptivo, gate ou medição de loudness por janela.

Os blocos cobrem `[0, frames)` uma única vez, com limites inteiros determinísticos.
Sons curtos usam no máximo um bloco por frame, nunca blocos vazios. O schema
confere contagem, canais, duração e cobertura. O worker não reamostra, normaliza,
corta ou altera o som para medi-lo. Não acrescenta dependência, codec externo
ou processo. A quantidade máxima de samples/duração permanece a do renderizador.

Samples no limite **não provam clipping**: um sinal válido pode atingir o limite.
O contador `clippedSamples` já existente no resultado do render continua sendo
a medida de excesso observado no mix antes da limitação/quantização. Esta
análise não calcula LUFS, true peak entre samples, percepção de ruído, balanço
musical ou correspondência entre efeitos e eventos do jogo.

Quando pedida, a análise também resume hash, quantidade de blocos, trechos abaixo
do limiar e pico/RMS/DC/limites por canal em `result.info`. O agente lê esses
campos pela ferramenta existente `game_asset_result`, antes de aplicar o asset.
Zero usa a string `digital silence` nesse resumo de tipos escalares; o JSON
estruturado conserva `null` em dBFS. Não é preciso abrir uma interface nem criar
outro loop para a revisão técnica. O resumo está ausente na receita legada.

## Serviço e Studio

O serviço anuncia `game-audio-analysis-v1` para Mac/VS Code, sem habilitar
processador ou conceder autoridade. O guia do processador expõe a opção ao
agente pelas ferramentas existentes. O Studio oferece **Forma de onda e
medições** em **Ajustar áudio** somente com suporte, ou para mostrar uma escolha
anterior preservada. Em motor antigo ela fica desabilitada com diagnóstico;
o controlador recusa um novo pedido incompatível antes e depois da confirmação.

A escolha integra os rascunhos privados e o pedido congelado. Reload não processa
automaticamente. A variante exige confirmação; aplicação ao projeto permanece
separada e registra outra revisão. Candidato original, fontes, licenças e
condição placeholder são preservados. O relatório aplicado também passa a
integrar os arquivos/hashes da revisão; não herda qualidade de um build anterior.

Ao inspecionar um candidato reconhecido, o comando de host
`asset-audio-analysis` deriva o caminho pela receita. O controlador exige o
processador local, operação/campo explícitos, WAV e JSON do mesmo resultado,
até 512 KiB no JSON, tamanho/hash dos bytes, schema válido e `audioSha256`
correspondente ao WAV. Revalida a seleção após a transferência.
Sample rate, canais e frames também devem coincidir com a receita e com o tamanho
do WAV canônico. Não recebe
URL, resultado calculado pela UI, namespace, arquivo arbitrário ou aprovação.
Não há novo RPC de produção ou loop no cliente.

O código do renderer desenha envelopes SVG a partir dos números já validados;
não implementa codec WAV, DSP ou alteração dos samples. Exibe um gráfico por canal, pico/RMS, DC,
samples no limite e durações abaixo do limiar. Ausência de relatório não fabrica
uma forma de onda. O player permanece sem autoplay. Nenhuma dessas observações
marca qualidade como aprovada.

**O worker fixo Core KidOS recusa a presença de `waveformBins`.** Seu contrato
e inventário anteriores continuam WAV-only; um schema comum mais amplo não
autoriza sidecars ou operação nova no processo protegido. Porta, pacote Root
original, ABI, política e instalação não foram atualizados. A integração
protegida exige qualificação própria.

## Verificação

`test/game-audio-analysis.test.ts` compara samples e medidas calculados
independentemente, canais, limites positivos/negativos, silêncio, DC, blocos
curtos, determinismo, bytes legados e caminho derivado. Recusa WAV truncado ou
formato incoerente, limites/campos inválidos e blocos sobrepostos. Os testes do
worker comprovam recusa do campo mesmo com hash da receita recalculado. O teste
de edição de áudio usa o novo campo em confirmação, perda de resposta, replay
exato e aplicação separada; leitura de análise recusa bytes adulterados e
candidato legado sem relatório.

`scripts/qualify-game-audio-analysis.mjs --engine=<bundle-exato>` usa serviço/Node
empacotados, SDK/TLS, worker real, arquivos privados de rascunho e renderer
Chromium. Reutiliza o percurso de edição de 25 notas, duplicação, paginação,
panorama, envelopes e normalização com os hosts emulados. Confere escolha da
análise após reload, bloqueio do pedido congelado, recusa/replay sem outro job,
WAV original intacto, JSON vinculado, dois gráficos e aplicação explícita.
Não é teste de geração autônoma, audição física ou cliente instalado.

O [dossiê](../output/game-generation/audio-analysis-20261113-a1/report.json)
registra hashes, relatórios, capturas, falhas, versões e limites da evidência.
Qualificação interrompida conserva serviço/estado se qualquer job não tiver
resultado terminal confirmado; ausência de resposta não autoriza outro processo
ou consumo de orçamento. Não limpar `dist-tests` durante um ensaio ativo.

O ensaio final `2026-11-13T11-55-52-692Z-b3b26109` passou nos dois produtos com
pacote imutável próprio, dois canais e512 blocos. Ambos produziram o mesmo WAV,
hash `a61959e8…`, com310,875 ms abaixo do limiar e RMS de−15,09/−15,44 dBFS.
Esses são valores da fixture sintética, não metas de mixagem. Pacote foi
reverificado; serviço encerrou com código0 e navegador fechou. Passaram723
testes e31 verificações, um opt-in ignorado, check/builds e roteamento simulado.
Nenhum modelo foi chamado e nenhuma instalação foi alterada.

Os ensaios `2026-11-13T11-49-35-167Z-423505f1` e
`2026-11-13T11-52-07-960Z-d9c23e63` passaram antes do resumo destinado ao agente
e da validação adicional de dimensões no SDK, com outro pacote preservado.
Não são reclassificados como execução da versão final. O erro inicial de
tipagem por nome duplicado ficou no log e foi corrigido antes dos ensaios.
