# PNG menor sem perda de pixels

Fonte de desenvolvimento, **2026-11-13**. Entrega delimitada de GD-03/GD-08:
composição e atlas podem escolher uma representação PNG menor, preservando
exatamente os samples RGBA8 que o processamento produziu. Não conclui a cadeia
de arte, compressão de outros formatos ou o aceite do produto instalado.

## Contrato e responsabilidade

`packages/contracts/src/game-assets.ts` acrescenta `pngEncoding` opcional apenas
a `image.compose` e `image.atlas`. Omitir o campo mantém a receita sem esse campo,
seu hash normalizado e os bytes RGBA8 anteriores. `rgba8` é uma escolha explícita
da representação anterior. `lossless-smallest` compara candidatos limitados:

- RGBA8, sempre como referência inicial.
- RGB8, somente se todos os samples alpha forem255.
- Cinza G8 ou GA8, somente quando R, G e B forem iguais em cada pixel.
- Paleta de índices de8 bits, somente com até256 cores RGBA exatas, incluindo
  transparência parcial. A ordem da primeira ocorrência define a paleta.

`packages/adapter-game-assets/src/png-encoding.ts` executa essa escolha no worker
local. Compara os bytes efetivos e só substitui a referência por um candidato
estritamente menor; empates preservam o anterior. Não quantiza, redimensiona,
altera perfil ou descarta cores e alpha. Inclusive RGB escondido por alpha0 é
preservado pelo encoder. Isso não altera a composição source-over já existente:
a igualdade é entre os pixels **resultantes** da mesma receita e sua nova
codificação, não entre uma camada isolada e o resultado composto.

Não promete o mínimo matemático global de PNG, nem um arquivo menor que toda
fonte importada. A referência é o RGBA8 produzido pela mesma receita. O resultado
registra `format`, `pngEncoding`, `rgba8Bytes`, `encodedBytes` e `bytesSaved`;
atlas soma as páginas. Economia zero é válida. Não altera disposição, trim,
padding, nomes de frames, fps, loop ou JSON do atlas. `RGBA8888` no metadado do
atlas descreve pixels decodificados da textura, não o color type do arquivo.

O encoder de paleta usa filtros PNG limitados, DEFLATE e CRC do Node empacotado
22.23.4; nenhuma dependência ou addon foi acrescentado. Os limites existentes
de dimensão, pixels, inflação, CRC, APNG e ICC continuam. As saídas de8 bits
podem voltar como fontes registradas de outra composição ou atlas. Esse campo
não foi adicionado a `image.vector` ou a outras operações.

## Serviço e interfaces

`engine.info` anuncia `game-png-lossless-v1` somente nos produtos Mac/VS Code.
A capacidade descreve suporte ao contrato; não provisiona processadores ou
concede acesso. O guia de `local-media-v1` explica a escolha ao agente, que usa
o mesmo serviço e as ferramentas existentes. Não há RPC, loop ou provedor novo.

O controlador compartilhado consulta a capacidade. **Ajustar imagem** oferece
**Tamanho do PNG → Menor, sem perda de pixels**. O padrão omite o campo;
rascunhos antigos não são reescritos para uma escolha explícita. Uma escolha
restaurada em motor incompatível fica visível e desabilitada, com diagnóstico;
o controlador recusa antes e depois da confirmação, preservando o pedido.

O renderer só edita a receita. O worker produz um candidato imutável; aplicar
continua uma operação explícita de outra revisão. Fontes, alvo, proveniência,
licenças e ancestralidade placeholder são preservados. A escolha participa dos
mesmos rascunhos privados, CAS, fsync, confirmação nativa e replay do pedido
congelado. Reiniciar a interface não envia nada automaticamente, e negar um
reenvio não resolve um efeito anterior desconhecido.

**KidOS não está habilitado.** `game-media-worker.ts` recusa a presença de
`pngEncoding`, inclusive `rgba8`, no contrato fixo do worker Core. Ampliar o
schema comum não amplia silenciosamente essa fronteira. O pacote Root original,
política e ABI existentes permanecem intactos; integração protegida e qualificação
próprias continuam necessárias.

## Verificação e limites da evidência

`test/game-png-encoding.test.ts` cobre bytes legados, determinismo,256/257 cores,
alpha parcial/transparente, cinza, RGB, pixels, reuso e metadados multiatlas.
Os testes do worker recusam o campo forjado mesmo com hash recalculado. O
controlador testa capacidade ausente, confirmação, concorrência e recuperação.
Passaram **718 testes e31 verificações do repositório**, com um opt-in ignorado.

`scripts/qualify-game-png-lossless.mjs --engine=<bundle-exato>` usa serviço/Node
empacotados, SDK/TLS, worker real, rascunhos em arquivos privados e renderer real
em Chromium. Pontes e decisões dos hosts Mac/VS Code são **emuladas**. Em cada
namespace confere escolha/restauração, resposta perdida após processamento,
reinício do serviço, campos congelados, recusa e replay exato: só uma variante,
original intacto, aplicação separada. Depois gera duas páginas e as carrega com
o loader multiatlas Phaser; no outro produto usa a textura no Babylon. Teclado
e capturas verificam mudança visual, sem consultar estado interno do jogo.

O ensaio `2026-11-13T11-21-04-707Z-82ba30d7` passou nos dois produtos. O PNG
sintético de216.127 bytes virou46.083 bytes; as duas páginas somadas passaram
de446.740 para95.912 bytes. Todos os samples decodificados permaneceram iguais.
Serviço encerrou com código0, navegador fechou, pacote foi reverificado e não
houve inferência. Esses números dependem da fixture e não são promessa de taxa.

A primeira tentativa `2026-11-13T11-17-32-738Z-90798def` falhou porque o roteiro
chamava `owns` em vez do método `handles` do armazenamento. Falha e PNG foram
preservados; serviço encerrou normalmente. A correção foi só do roteiro.

O [dossiê](../output/game-generation/png-lossless-20261113-a1/report.json)
vincula fontes, logs, pacote e capturas. Pixels sintéticos e ponte emulada não
demonstram qualidade artística, jogo final, acessibilidade física, cliente
instalado ou rollout. Qualidade integral permanece falsa. Não houve instalação,
publicação, chamada de modelo ou renovação de orçamento.
