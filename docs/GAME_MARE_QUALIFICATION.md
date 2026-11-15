# Maré a Dois: referência cooperativa e observação independente

Fonte de desenvolvimento em **2026-11-13 UTC**. Leia o [plano integral](GAME_DESIGN_IMPLEMENTATION_PLAN.md),
a [arquitetura](SUITE_ARCHITECTURE.md), os [jogos de referência](GAME_REFERENCE_GAMES.md)
e a [captura de navegador](GAME_BROWSER_OBSERVATIONS.md). Esta é uma referência
autoral, não prova de geração autônoma ou de qualidade comparável à Poki.

## Fonte e separação

`examples/games/mare` contém o projeto Godot editável: regras em `river.gd`,
apresentação/controles em `main.gd`, persistência em `save_store.gd` e partitura
original/PCM em `sound.gd`. Doze rotas em três capítulos têm três entregas cada,
carta opcional, correntes, vento, colisões/checkpoints, pontuação, estrelas e final.
As pessoas controlam remos diferentes; somar forças avança e diferenciar gira.

A fonte de QA permanece em `qa/` e é excluída da importação/build. Controladores
de campanha e leitura de PNG ficam em `scripts`, fora do jogo e do pacote puro
Game Design. Não há endpoint de conclusão, busca de soluções dentro do jogador,
setter de posição/progresso, injeção de storage ou novo loop de inteligência.
Nenhum desses controladores é ferramenta do modelo ou do Navi.

## Build e métodos

O serviço comum, Node **22.23.4**, importou a fonte e construiu pelo adaptador
Godot isolado **4.7.2** previamente provisionado. Runtime/licenças foram conferidos
contra o lock. Exportação editável e reinício do serviço preservaram o projeto.
Nada foi instalado/publicado e nenhuma IA foi chamada nessa qualificação.

O ensaio-base é
`output/playwright/mare/runs/2026-11-13T03-27-00-513Z-68999ae4/`:

- fonte: `691933c8bafc8c98227c4dbc6108f7068101fd1a9cbffb494647b48481ffd0b6`;
- artefato: `89d3aaa9261ee581b4d057ff3d7bdca5b61fa5f3b547aae1550984454819dc9b`;
- motor: `3f4dfc66ce3fb104a9a49aa0abf4ec9c76252b8f1073f2bd90bed222e18cddd5`.

O README recebeu documentação após esse build. Os bytes de runtime foram
conferidos contra a exportação; não afirmar que todo arquivo atual tem o mesmo
hash do documento antigo. Fonte/build novos exigem evidência própria.

Com testes e motor compilados usando o Node fixado:

```sh
node scripts/qualify-mare-rules.mjs --suite=rules
node scripts/qualify-mare-rules.mjs --suite=scene
node scripts/qualify-game-mare.mjs
node scripts/qualify-mare-campaign.mjs --attempt=output/playwright/mare/runs/<ensaio-concluido>
node scripts/qualify-mare-touch.mjs --attempt=output/playwright/mare/runs/<ensaio-concluido>
```

Os scripts nativos só executam GDScript no contêiner offline, com fonte somente
leitura, UID sem privilégio, imagem exata e ausência do contêiner confirmada ao
fechar. O teste da cena comprova dois contatos sintéticos, inclusive liberação
parcial, mas não equivale ao caminho web ou a dois dedos físicos.

## Campanha pelo navegador

O observador lê PNGs compostos e envia somente teclas usuais W/S e cima/baixo.
Detecta casco/remadores na imagem, consulta a geometria autoral da rota e ajusta
os dois remos. Não consulta objetos do jogo ou armazena progresso fabricado.
A cada chegada conserva captura, ações e coordenadas observadas. A finalização
exige o resultado visível, seguida da ação normal para a próxima travessia.

O ensaio final
`campaign-2026-11-13T04-12-01-312Z-51458a10/` completou as doze travessias,
mostrou o encerramento, abriu o mapa, recarregou pelo navegador e retomou a
travessia12. As capturas foram inspecionadas: o mapa recuperou resultados das
doze rotas. Não foram lidos/escritos objetos internos ou IndexedDB pelo teste.
Isso é observação técnica de percurso; diversão/coordenação humana permanecem
pendentes.

## Toque, pausa e preferências

O ensaio
`touch-2026-11-13T04-10-34-395Z-793b2e75/` usou Chromium com viewport390×844,
densidade2 e dois contatos emulados. Os pixels mostraram avanço com os dois
remos, curva após soltar um contato, bordas inativas após cancelar e quadro
estável em pausa. O rótulo de mute permaneceu igual após reload e o barco retomou
visualmente perto da trajetória anterior. Isso não comprova audição ou toque
físico; a política do navegador continua recusando microfone/câmera.

O Chromium instalado foi exercitado em uma página DOM descartável para conferir
os contatos: omitir um ponto em `touchMove` **não** encerrou aquele contato;
`touchEnd` com o ponto a encerrar gerou a liberação correspondente. O método
observado está vinculado à versão ensaiada; não inferir esse comportamento nos
outros browsers a partir das declarações genéricas do protocolo. A prova está em
`output/playwright/mare/touch-protocol-2026-11-13T03-54-02-797Z-51f4ace7/`.

## Falhas preservadas e regressões

Todos os casos, inclusive os negativos, continuam no ensaio-base:

- `campaign-2026-11-13T03-42-51-478Z-ad1f7ff2`: o observador confundiu pixels do
  remo verde com a marca de uma entrega e pulou um alvo. A captura mostrava1/3,
  apesar do contador do observador. Agora o rótulo só é lido quando o barco não
  pode sobrepor seus pixels. As regras e os portos não foram alterados para passar.
- `touch-2026-11-13T03-45-58-374Z-a0ab4019`: a captura inicial estava pausada na
  sequência da emulação; não comprovou ausência do barco. A repetição permite
  retomada explícita quando essa pausa é observada, sem atribuir causa não medida.
- `touch-2026-11-13T03-51-52-007Z-66c6c8d6`: o comando de toque não soltou o
  primeiro contato. A fixture DOM separou a semântica do protocolo do jogo.
- `touch-2026-11-13T03-55-08-372Z-eceb1ccd`: a sombra do casco produziu um par
  falso de pontos e inverteu a direção observada. O detector agora exige também
  os pixels de papel do casco à frente e atrás dos remadores.
- `touch-2026-11-13T04-03-21-443Z-e901e86d`: os dois rótulos mostravam “Som: não”;
  a cor de hover tornava diferente o botão inteiro. A comparação dos caracteres
  confirmou pixels idênticos. Não houve correção de persistência no jogo.

`test/game-mare.test.ts` conserva regressões com PNGs originais, não editados,
com hashes/proveniência em `test/fixtures/mare-visual`. Validam contratos, direção,
rótulos e recusa de duas áreas vazias como prova de texto preservado. Esses
fixtures não são pontuação/consentimento de pessoas nem entram no jogo exportado.

## Lacunas que impedem aceite integral

Continuam pendentes gamepads físicos, duplas reais, audição/mix, desempenho/GPU,
Android e iPhone/iPad, Firefox/Safari/Edge e jogador KidOS, acessibilidade e revisão
artística/humana com os critérios do plano. O ambiente Godot headless sinalizou
fontconfig ausente; sua síntese PCM não comprova saída sonora física.

Há uma lacuna objetiva de carregamento: o WASM tem **39.514.754 bytes** e o
servidor privado daquele ensaio respondia sem compressão. Somente sua transferência a
20Mb/s exige idealmente15,8s, antes de RTT/compilação, acima da meta de10s.
Uma medição offline produziu gzip de10.185.394bytes e conferiu a descompressão;
isso não implementa entrega comprimida nem demonstra carregamento no perfil.
Leia `output/game-generation/mare-reference-development-20261113-a2/loading-gap.json`.
Esse registro é anterior à [correção de entrega](GAME_ARTIFACT_DELIVERY.md):
a fonte atual negocia gzip e uma repetição observou o tabuleiro jogável em6,07s
contra17,43s identity, com20Mb/s/100ms emulados. O runtime continua o mesmo; o
transporte novo ainda não está instalado/distribuído nem qualificado fisicamente.

Nenhum relatório aqui declara `quality.ready`, aceite físico/humano, instalação
ou distribuição. A integração protegida Navi e Unity funcional continuam requisitos
próprios, sem substituição por esta referência Godot.
