# Processamento de assets: contrato e limites atuais

Referência de desenvolvimento em **2026-11-11**. Esta frente implementa o
processamento local de imagens, atlas, áudio e a base isolada de modelos 3D; não conclui a cadeia de assets do
[plano Game Design 1.0](GAME_DESIGN_IMPLEMENTATION_PLAN.md).
Leia a [arquitetura](SUITE_ARCHITECTURE.md), a [API de projetos](GAME_PROJECTS_API.md)
e a [API de produção](GAME_PRODUCTION_API.md).

Para reproduzir esses WAVs em jogos Phaser/Babylon, há um
[runtime de áudio por estado](GAME_AUDIO_RUNTIME.md), opcional e fixado no
compilador workspace. O worker continua produzindo arquivos; o módulo do jogo
cuida de música/ambientes/efeitos, transições, volume e ciclo de vida, sem levar
processamento ou inteligência às interfaces. Core legado não resolve seu import.

O [mixer1.1](GAME_AUDIO_AAC_RUNTIME.md) também carrega a variante AAC do codec
isolado, por escolha explícita, conferindo o perfil MP4 e reservando PCM antes
do decode nativo. Isso não remove masters do pacote, faz streaming de trilhas
longas ou comprova qualidade por contagem de bytes.

## Responsabilidades

Para variantes de distribuição, leia o [codec AAC isolado](GAME_AUDIO_CODEC.md).
`audio.encode` recebe WAV PCM16 registrado e produz M4A/MP4 mais relatório,
preservando o master e a aplicação explícita. É outra porta opcional, sem
FFmpeg global, argumentos livres ou habilitação do worker fixo Core.

O [Studio](GAME_AUDIO_VARIANTS_STUDIO.md) prepara essas receitas com escolha
de fonte/qualidades e rascunho confirmado antes do envio. A consulta do pedido
recupera o registro original sem novo processamento; consulta ausente não apaga
um efeito desconhecido. Nenhuma alteração de arquivo é aplicada pelo formulário.

Nos contratos canônicos de composição/vetor, cores são `#RRGGBBAA` com alpha
explícito (`ff` opaco, `00` transparente). Descrições e erros de validação agora
explicam esse formato; entradas curtas ou nomes CSS continuam recusados, sem
normalização. Curvas vetoriais Q usam `cx,cy,x,y`; C usa `x1,y1,x2,y2,x,y`.
O catálogo mantém `origin.referenceIds` obrigatório, com `[]` quando não deriva
de outro asset do projeto. Essas descrições chegam ao schema das ferramentas no
Chat Completions dos dois modos. Feedback de argumentos continua limitado,
sem despejar o conteúdo submetido ou criar recibo de execução.

`game_update_design.assets` substitui o catálogo completo quando fornecido;
omiti-lo preserva o catálogo. Processar/aplicar pelo serviço mantém os arquivos
e a proveniência reais. Melhorar a descrição não cria arquivos ausentes nem
renomeia formatos. A rasterização vetorial tipada é uma operação explícita do
worker, descrita abaixo; WAV não vira MP3 por alteração do nome.

- `packages/contracts/src/game-assets.ts`: receitas, fontes, resultados e pedidos
  tipados. SDKs TypeScript/Python usam o contrato e transferência em partes.
- `packages/adapter-game-assets`: codecs locais em worker com duração limitada.
  Não executa código do projeto, scripts, plugins ou ferramentas de IA.
- `packages/adapter-game-library`: [catálogo offline fixado](GAME_LICENSED_LIBRARIES.md),
  cópia de grupos com dependências/licenças, sem download ou autoridade própria.
- `packages/adapter-game-blender`: [cenas 3D tipadas](GAME_BLENDER_ADAPTER.md),
  GLB registrado, materiais, rig rígido e clips, em editor fixado e isolado.
- `packages/agent-service/src/game-asset-results.ts`: proveniência, candidatos,
  vínculos de arquivos e aplicação transacional ao projeto.
- O coordenador de produção controla jobs, eventos, cancelamento e reconciliação.
  Standard e Deep continuam usando o grafo comum.

O serviço registra `local-media-v1`, com identidade da implementação no manifesto
empacotado, e a porta opcional `blender-model-isolated-v1`, cuja disponibilidade
exige provisionamento explícito da imagem verificada. Não há registro por RPC, descoberta de provedores ou acesso a caminhos
do host selecionados pelo projeto. Autorizado somente para Mac/VS Code; KidOS
precisa de integração própria do Core, sem shell, filesystem ou Docker infantis.

O [worker fixo de mídia](GAME_MEDIA_WORKER.md) já fornece em fonte um candidato
durável e contrato privado para o broker KidOS em fonte. Reutiliza os mesmos
codecs e validação de fontes, com ensaio de PNG/atlas/WAV real em Linux. Broker,
porta opt-in e admissão Root compartilhada com builds têm composição Linux
offline por SDK/assinatura/Core oficial e codecs reais, incluindo recuperação.
O gerenciador da composição Root é simulado. Separadamente, nove cenários
systemd/bwrap reais passaram no Alien com runtime temporário do UID; composição
Root instalada e aceite artístico/físico continuam pendentes.

O [visor de modelos do Studio](GAME_MODEL_VIEWER.md) agora permite conferir GLB,
texturas preservadas e clips reais antes da aplicação. Usa o preview isolado e o
runtime local verificado; não é processamento, licença aprovada ou QA de um jogo.
Instalações e demais critérios artísticos/físicos continuam pendentes.

## Operações em fonte

| Operação | Processamento |
|---|---|
| `image.vector` | Ilustração original por geometria, curvas e gradientes tipados; produz SVG autocontido ou PNG rasterizado localmente e receita `.vector.json` editável |
| `image.compose` | Camadas PNG, crop, escala nearest/bilinear com alfa pré-multiplicado, espelhamento, tint, opacidade e composição source-over |
| `image.atlas` | Empacotamento determinístico em múltiplas páginas, trim, padding extrudado, origem/tamanho dos frames e metadados de animação |
| `audio.render` | Clips WAV, reamostragem com filtro sinc/Blackman, ganho, pan, fades, normalização, diagnóstico de clipping e notas procedurais com envelope |
| `audio.encode` | Variantes AAC-LC/MP4 por taxas explícitas, em imagem fixada sem rede; relatório de fonte/hash/dimensões/roundtrip, sem remover o WAV original |
| `model.scene` | Cenas procedurais/GLB registrado, PBR/texturas, ossos, pesos explícitos por vértice e animações; produz GLB, fonte Blender, PNG de inspeção e relatório |
| `library.copy` | Seleção exata do catálogo instalado; conserva modelos, dependências e licença integral, produz candidato e exige aplicação explícita |

Entrada de imagem: PNG de 8 bits com samples compatíveis com sRGB. APNG, ICC e
outros espaços de cor exigem conversão explícita; são recusados preservando o
original. Verifica CRC, dimensões, chunks e tamanho descomprimido, inclusive
Adam7. Saída padrão: PNG RGBA8. Composição/atlas oferecem a escolha explícita
[`pngEncoding: "lossless-smallest"`](GAME_PNG_OPTIMIZATION.md): compara RGBA/RGB,
cinza e paleta exata de8 bits sem quantizar pixels. Omissão conserva bytes e
hashes legados; mede economia relativa ao RGBA8 da receita, sem garantir taxa.
O contrato fixo Core recusa a presença desse novo campo. Atlas gera páginas contíguas `*-page-00.png` e
`*.atlas.json` multiatlas, sem girar ou descartar frames. Mantém tamanho original,
trim, nomes, fps e loop. Os adaptadores interpretam as animações explicitamente;
o smoke usa o loader multiatlas real do Phaser.

### Ilustrações originais por geometria tipada

`packages/contracts/src/game-vector.ts` define `image.vector`; o worker local
serializa somente esse contrato fechado em
`packages/adapter-game-assets/src/vector.ts`. Não recebe SVG/XML arbitrário,
código ou um PNG preparado. Retângulos arredondados, elipses e caminhos M/L/Q/C/Z
suportam fill, stroke, alfa, transformações e gradientes lineares/radiais.
Há até 512 formas, 256 comandos por caminho e 4.096 no total, dimensões de
1–4.096 pixels e limite de 1 MiB para o SVG. Campos desconhecidos, números não
finitos, URLs, fontes, texto, imagens, CSS, scripts, eventos, entidades e
animação de markup são recusados; os únicos `url(#id)` são referências internas
criadas pelo serializador para seus gradientes.

O resultado contém `assets/nome.svg` ou `assets/nome.png`, a receita
`assets/nome.vector.json` e proveniência. A extensão seleciona o formato real.
A receita normalizada mantém os IDs das formas, geometria, cores e parâmetros;
os IDs nunca são interpolados como markup. Sua origem é procedural declarada,
com revisão independente de licença ainda necessária. O modelo consulta o guia
do processador em `game_studio`, usa `game_process_assets` e aplica explicitamente
o candidato, pelo mesmo ciclo transacional e limites de produção existentes.
Gerar outra ilustração não muda o candidato original nem certifica arte final.

SVG permanece autocontido, carregado pelo loader SVG no Phaser ou como textura
no Babylon. Ao escolher `.png`, o worker entrega o SVG produzido exclusivamente
pelo serializador tipado ao codec `@resvg/resvg-wasm` **2.6.2**; não recebe XML
do projeto, fontes ou imagens. O codec inicializa com bytes locais conferidos
por tamanho/SHA-256, sem fetch ou fontes do sistema; PNG mantém dimensões e
transparência e pode alimentar composição/atlas após aplicação explícita.
Não há conversão por renomeação ou importação de SVG arbitrário. A receita
editável acompanha ambos os formatos e a variante conserva o candidato anterior.

O manifesto inclui Wasm, fontes upstream declaradas pelo `gitHead` do pacote,
glue publicado, licença MPL-2.0 integral e notice em `game-codecs/resvg-source`.
`rasterizer.lock.json` fixa os bytes e `copy-game-rasterizer.mjs` recusa material
ausente/alterado. A exceção do inventário de licenças exige esse pacote/versão e
fontes exatos; MPL não foi adicionado à lista geral. O inventário não demonstra
reprodução do build Rust nem revisão jurídica independente. Referência da
licença: [FAQ oficial da Mozilla](https://www.mozilla.org/en-US/MPL/2.0/FAQ/).

O Studio escolhe SVG/PNG ao gerar a variante, conservando nome-base, pasta,
alvo, processador e verificações de consentimento/revisão. Renderers não
serializam SVG nem executam Wasm. Desenho direto, prévia contínua, importação
vetorial ampla, bibliotecas adicionais, animação de personagens e coerência
artística em jogos completos continuam pendentes.

O Studio usa `<img>` para prévia SVG somente quando o SDK resolve o resultado
reconhecido de `local-media-v1/image.vector`, com arquivo/hash correspondentes.
Na fonte aplicada, verifica também projeto/asset/job. SVG importado, modificado
ou copiado de outro projeto permanece preservado e exportável, sem prévia de
confiança. Não há inserção de XML via `innerHTML` nem execução no renderer.

O contrato privado do worker Core **recusa `image.vector` explicitamente**:
seus MIME, receitas e qualificação PNG/WAV/JSON não foram ampliados. O processador
local continua exclusivo de Mac/VS Code. Esta entrega não habilita vetor/PNG vetorial/Navi v2
no KidOS, nem modifica o pacote Root congelado em qualificação.

Qualificação PNG em desenvolvimento: **573 testes, um opt-in ignorado e 31
verificações**, mais os ensaios em Phaser/Babylon e Studio com pontes emuladas,
registrados no [acompanhamento](GAME_DESIGN_IMPLEMENTATION_STATUS.md#arte-vetorial-com-saída-png-e-uso-em-spritesatlas--2026-11-11).
Os testes usaram saída compilada independente para preservar o harness real ativo.
O smoke real de inferência adicional expirou; não foi contado como sucesso.
Relatório: `output/game-generation/vector-raster-20261111-a1/report.json`.
Essas provas de codec não são produção autônoma, instalação, arte final ou jogo
completo; o formato novo não foi fornecido à geração ainda ativa no motor anterior.

Entrada de áudio: RIFF/WAVE mono/stereo PCM 8/16/24/32 bits ou float32, inclusive
extensible compatível. Recusa truncamento, campos incoerentes e NaN/Infinity.
Saída: WAV PCM16, 22.050/44.100/48.000 Hz, mono/stereo. A opção explícita
[`waveformBins`](GAME_AUDIO_ANALYSIS.md) acrescenta medições digitais e envelope
por canal, vinculados ao SHA-256 do WAV codificado, sem alterar seus bytes.
Omissão conserva receita e arquivos legados; o worker fixo Core recusa a opção.
Notas suportam seno,
triângulo, quadrada, saw e noise com seed, variação de frequência, attack/release
e limite de frequência. Picos e clipping são medições, não aceite sonoro.

## Processar e aplicar são decisões distintas

1. `games.assets.process` recebe `requestId`, projeto, revisão exata e receita.
   Fontes precisam pertencer aos assets registrados nessa revisão.
2. O serviço fixa revisão, hash, processador e toolchain num job `kind: assets`.
   Reutilizar a identidade com outro conteúdo é rejeitado.
3. Candidato, blobs, proveniência, pins e confirmação são transacionais.
   `completed` significa **processado**, sem alterar a revisão do projeto.
4. `games.assets.result` e `games.assets.file` recuperam metadados e bytes
   privados; caminhos precisam pertencer ao candidato.
5. `games.assets.apply` exige identidade idempotente e `expectedRevision`.
   Gera uma revisão e recibo na mesma transação, sem reexecutar o processamento.

Uma edição posterior de design pode receber o candidato explicitamente se
fontes e alvo mantiverem seus fingerprints. Mudança de bytes, origem/licença,
metadados ou alvo exige reconciliação. Arquivos de outros assets, inclusive
compartilhados com o alvo, não podem ser substituídos. A aplicação verifica bytes
armazenados, rejeita ciclos de proveniência e respeita caminhos portáveis.
Conflitos preservam candidato e projeto atual.

SDK TypeScript: `processGameAsset`, `getGameAssetResult`,
`downloadGameAssetFile`, `applyGameAsset`. Python: equivalentes em snake_case.
Grafos: `game_process_assets`, `game_asset_result`, `game_apply_assets`.
Processar é operação externa sujeita à aprovação existente; aplicar é escrita
sujeita ao modo do produto. Processamento sozinho não conta como alteração
concluída de projeto. Nenhuma dessas operações certifica o jogo.

O [Game Studio](GAME_STUDIO_UI.md) tem revisão de candidatos em desenvolvimento:
consulta resultados concluídos e seus arquivos, permite prévia local de imagem/
WAV de até 4 MiB e aplica somente após confirmação nativa à revisão conferida.
A inspeção não reprocessa nem publica. Seleção/revisão concorrentes e modo de
escrita continuam validados; o serviço decide fingerprints, conflitos e nova
revisão. O renderer não executa codecs ou inteligência. A exportação de candidatos
não aplicados também está em fonte: todos os arquivos e o resultado completo,
com receita/proveniência/placeholder/toolchain, são verificados e publicados em
uma pasta nova escolhida no Mac/VS Code. Não muda o projeto, licença ou qualidade.
A edição dirigida de `image.compose` está em desenvolvimento na UI: dimensões,
fundo, posição/tamanho/cor/opacidade/espelhamento/escala/recorte de camadas
existentes, preservando fontes/saída/alvo e exigindo fingerprints atuais,
revisão e confirmação nativa. Produz outro candidato pelo mesmo job/worker, sem
aplicar automaticamente. `image.vector` tem controles próprios de formas,
curvas, cor/gradientes, contorno, transformações e ordem, pelo comando
`adjust-vector` e schema canônico. Pode acrescentar/duplicar/remover formas e
pontos, respeitando os limites da receita; não aceita XML, código, fontes ou
imagens externas. Modo, seleção, revisão, confirmação e identidade do pedido têm
o mesmo tratamento de recuperação. A prévia vem do candidato processado, sem
criar outro renderer/codec no cliente. `audio.render` também tem edição dirigida
no [Studio](GAME_STUDIO_UI.md): notas, faixas já referenciadas, cortes, ganho,
panorama, envelopes, taxa/canais e normalização, pelo mesmo schema canônico e
worker. Resultado continua sendo um candidato com aplicação explícita.
Atlas, modelos, seleção de novas fontes, timeline de edição de áudio e prévias contínuas
exigem evolução própria; o catálogo não encerra o editor artístico do plano.

## Origem, licenças e autoridade

O JSON de proveniência conserva receita/hash, revisão/hash de fonte, toolchain,
fingerprints, declarações completas das fontes, licenças e hashes dos arquivos.
O resumo de licença aponta para esse JSON; não apaga as condições originais.
`licenseStatus: declared-unverified` não verifica autoria, direitos ou
compatibilidade de licenças. Placeholder nas fontes propaga mesmo se o pedido
tentar removê-lo. `processing` no catálogo é metadado, não autoridade ou prova
independente; jobs e resultados são controlados pelo serviço.

## Recursos e falhas

Entradas: até 64 MiB por operação; PNG até 16 MiB/arquivo, 4.096 pixels por
dimensão e 16 milhões de pixels únicos. Composição: até 64 camadas e 32 milhões
de pixels de camadas. Atlas: até 256 frames, 16 páginas e 16 milhões de pixels
totais de páginas. Áudio: até 180 segundos, 32 clips/256 notas e 480 segundos
agregados declarados. Resultados: até 128 MiB, sujeitos à cota do namespace.

Worker com ambiente vazio, limite de heap e prazo de 60 segundos. Isso limita
recursos de codecs fixos; **não é isolamento de segurança do sistema operacional
nem autorização para código arbitrário**. No máximo um processador local ativo;
outros projetos aguardam a [fila comum de produção](GAME_PRODUCTION_API.md#fila-e-recursos-de-produção).
A sondagem distingue codec instalado de recurso ocupado; a exclusividade do
worker é reservada pelo serviço antes da execução. A verificação defensiva de
ocupação no adaptador continua existindo, sem conceder uma fila ou loop próprios.

Cancelamento passa por `cancelling` até confirmar término. Término incerto exige
`awaiting_reconciliation`. Workers do mesmo processo não sobrevivem à queda do
serviço. O inspetor original confirma ausência ou encerra um worker retido, sem
recalcular. Falha de confirmação não deixa aplicação parcial. Nova tentativa de
processamento exige decisão explícita e conserva originais.

## Verificação e trabalho restante

Testes cobrem pixels, trim/padding/páginas, PNG inválido e inflação excessiva,
formatos WAV independentes, NaN/Infinity, síntese, normalização e atenuação de
alias. O serviço exercita idempotência, concorrência, corrupção de blobs, falhas
transacionais, namespaces, cancelamento, reinício e SDKs TS/Python por TLS/IPC.
Grafos oficiais Standard/Deep exercitam aprovação, reconexão e aplicação.

```bash
npm run smoke:game-assets
```

O ensaio processa composição, atlas, síntese e mixagem; reinicia o serviço antes
de aplicar, inspeciona PCM com Python e compila/renderiza o atlas no Phaser com
o coletor real de navegador. Evidências: `output/playwright/game-assets/`, com
hashes, relatórios e qualidade integral falsa. São fixtures, não portfólio.

O ensaio `node scripts/smoke-game-vector.mjs` (após compilar testes e motor)
usa SDK/TLS/worker empacotado, reinício antes da aplicação, idempotência,
receita/proveniência e duas fixtures Phaser/Babylon no coletor real. Preserva
fontes, candidatos, builds, capturas e verificações de pixels/teclado em
`output/playwright/game-vector/runs/`. A ilustração é uma fixture declarada,
nunca fornecida à avaliação de geração real. Não demonstra qualidade artística,
jogo completo, dispositivo físico ou aceite humano.

O primeiro [catálogo licenciado](GAME_LICENSED_LIBRARIES.md) tem integração em
fonte com serviço, SDKs e ferramentas do agente Mac/VS Code. Não está habilitado
no Core KidOS nem instalado nos clientes atuais; sua fixture não é jogo final.

Continuam no plano: ampliar geração original além da geometria tipada, bibliotecas e
licenças verificadas, aceite da edição visual/audição nas interfaces, outros
formatos/compressão além do PNG sem perda já descrito,
carregamento progressivo, ampliação da produção 3D e rigging, consistência artística, integração
dos quatro adaptadores e Core KidOS, matriz física/humana e distribuição.
Esta frente não substitui instalações nem a release 1.0.2 existente.

Os limites e a recuperação do worker de codecs acima não descrevem o Blender.
Leia o [contrato específico](GAME_BLENDER_ADAPTER.md) e use
`npm run smoke:game-blender` para seu percurso isolado, edição GLB e uso no Babylon.
O ensaio adicional de pesos de 2026-11-13 usa serviço/SDK da fonte e imagem
separada: geração, edição registrada e deformação linear foram observadas no
navegador. Até quatro influências por vértice são qualificadas nesse percurso;
rigging avançado, qualidade artística e instalação continuam pendentes.
O Studio oferece [ajustes tipados da receita 3D](GAME_MODEL_EDITING.md), com
fontes limitadas ao candidato, rascunho do host, confirmação e aplicação separada;
isso não equivale a manipulação direta do modelo na viewport.
