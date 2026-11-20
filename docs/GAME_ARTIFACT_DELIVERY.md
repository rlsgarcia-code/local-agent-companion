# Entrega privada dos recursos de jogo

Fonte de desenvolvimento em **2026-11-13 UTC**. Integra a
[observação de navegador](GAME_BROWSER_OBSERVATIONS.md), o
[preview de modelos](GAME_MODEL_VIEWER.md) e o [plano integral](GAME_DESIGN_IMPLEMENTATION_PLAN.md).
Não constitui atualização instalada, release ou qualificação física/humana.

## Responsabilidade

`packages/adapter-game-browser/src/resources.ts` é o único transporte HTTP
privado de blobs no preview e na coleta. O motor continua por IPC autenticado.
A interceptação do navegador confere origem, método e inventário, depois deixa
seguir o pedido para esse listener. Não fabrica a resposta de WASM/JS fora do
HTTP. AudioWorklets usam a mesma fronteira. Não há proxy, Agent API, arquivo do
host, diretório navegável, download externo ou nova permissão do jogo.

O listener continua em porta loopback aleatória, com cookie efêmero HttpOnly,
conferência de Host/Origin/GET, CSP e restrições de dispositivos. **Cada pedido**
lê e confere tamanho/SHA-256 dos bytes originais antes de servir, inclusive ao
reutilizar a representação comprimida. Um cache não prova que a fonte permanece
válida. A compressão não altera o projeto, artefato, hashes ou exportação.

## Compressão e limites

`encoding.ts` negocia gzip/identity segundo `Accept-Encoding`, respeitando pesos,
recusas explícitas e wildcard. Duplicatas ambíguas preservam a recusa; parâmetros
inválidos não autorizam gzip. Ausência do campo usa identity. Não havendo uma
representação aceitável, responde406. Consulte o
[RFC9110, seção12.5.3](https://www.rfc-editor.org/rfc/rfc9110.html#section-12.5.3).

Somente texto, JavaScript, JSON, SVG e WASM entre1KiB e64MiB entram no compressor.
PNG/JPEG, áudio, GLB e pacotes binários não recebem compressão adicional.
Gzip assíncrono nível6 usa a implementação nativa do Node22: no máximo dois jobs
por listener, pedidos iguais compartilham o trabalho. Saturação permite identity
quando aceita; nunca ignora uma recusa para disfarçar disponibilidade. O cache
LRU privado tem teto de16MiB, somente representações menores que a original,
e desaparece no fechamento. Não há cache novo em disco ou armazenamento do browser.
Leia a [implementação oficial do Node22](https://github.com/nodejs/node/blob/v22.23.4/doc/api/zlib.md).

`Content-Encoding`, `Content-Length` e `Vary: Accept-Encoding` descrevem os bytes
da representação; MIME, CSP, `no-store` e demais barreiras permanecem iguais.
Fechamento interrompe conexões e aguarda os dois jobs limitados eventualmente
ativos. Não confirma encerramento enquanto esse trabalho nativo estiver pendente.
O limite existente de16 respostas ativas/32 conexões permanece.

## Qualificação

`test/engine-game-resources.test.ts` verifica negociação, recusas, bytes HTTP
comprimidos/descomprimidos, leituras concorrentes, fonte alterada após cache e
encerramento durante compressão. Casos anteriores de autenticação, origem,
caminhos, métodos e hash continuam obrigatórios.

`scripts/qualify-mare-loading.mjs --attempt=output/playwright/mare/runs/<ensaio>`
usa somente o artefato Godot concluído escolhido e Chromium instalado/verificado.
Passa pelas mesmas barreiras de produção, com perfil/contexto descartável e rede
emulada de20Mb/s/100ms, antes da primeira navegação, cache desabilitado.
Conserva cabeçalhos/tamanhos observados pelo navegador e captura PNG da primeira
cena jogável após entradas usuais. Não lê objetos internos, injeta save ou usa IA.
Identity e gzip têm listeners/contextos separados, sem aquecimento por um reload.
A observação tem teto diagnóstico de60s; resultado acima de10s continua falhando
a meta do plano, mesmo que a cena apareça antes desse teto. A interceptação e a
compressão não elevam o timeout de navegação de produção.

O primeiro ensaio `loading-2026-11-13T04-27-14-083Z-26b37cbb` permaneceu
**rejeitado**: a revisão dos PNGs identificou barco decorativo na tela de título,
apesar do resultado inicial positivo do observador. `review.json` conserva essa
correção sem apagar a saída original. O detector agora exige também a superfície
de água do tabuleiro, com uma regressão da captura original. Nenhuma regra ou
arte do jogo foi alterada para satisfazer o teste.

A qualificação deve registrar o hash da implementação atual do transporte
separadamente do motor histórico que construiu o jogo. Medição local em rede
emulada não certifica iPhone/Android, GPU, FPS, áudio, carregamento em produção,
integração protegida KidOS ou distribuição. Não reutilizar um manifesto antigo
para anunciar o transporte novo como instalado.

## Medição corrigida

A repetição `loading-2026-11-13T04-28-49-368Z-636c7cf1`, sob
`output/playwright/mare/runs/2026-11-13T03-27-00-513Z-68999ae4/`, mostrou o
primeiro tabuleiro de fato jogável, com barco perto de(120,450), cabeçalho
“Um só ritmo”, portos e dois painéis de remo. As capturas foram inspecionadas.
O WASM permaneceu o mesmo do build:

| Representação | Corpo WASM | Cena jogável observada | Meta de10s nesse ensaio |
|---|---:|---:|---|
| Identity | 39.514.754 bytes | 17,43s | Não |
| Gzip | 10.185.394 bytes | 6,07s | Sim |

Ambos os casos terminaram sem erros/recursos bloqueados e confirmaram browser e
listener fechados. O toque emulado também passou pelo transporte atualizado em
`touch-2026-11-13T04-29-14-381Z-790dbe25`: dois remos, liberação parcial,
cancelamento, pausa e preferência/checkpoint após reload. Esse novo ensaio
continua sem afirmar toque físico ou audição. A medição possui uma amostra por
representação, com fontes atuais de transporte registradas em `control.json`;
não caracteriza latência de toda a matriz nem gera aceite dos jogos.

A campanha inteira também foi repetida no transporte atualizado em
`campaign-2026-11-13T04-31-20-242Z-f5b750b7`: doze travessias, encerramento,
mapa e retomada após reload, sem erros/recursos bloqueados e com fechamento
confirmado. A fonte do jogo não foi alterada. `npm run check`, build,
**666 testes aprovados/um opt-in ignorado**,31 verificações do repositório,
roteamento local somente leitura e conferência de diferenças passaram.
Relatório consolidado: `output/game-generation/mare-compressed-delivery-20261113-a1/report.json`.
Nada foi instalado/publicado e não houve nova invocação de IA.
