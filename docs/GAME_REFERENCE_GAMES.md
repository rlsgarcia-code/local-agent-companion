# Jogos de referência e critérios de qualificação

Referência de desenvolvimento em **2026-11-13 UTC**. O
[plano integral](GAME_DESIGN_IMPLEMENTATION_PLAN.md) exige seis jogos completos,
pedidos inéditos, os quatro adaptadores e testes físicos/humanos. Esta página
organiza conteúdo e evidências; não reduz o aceite a exemplos compilados.

## Organização

Fontes editáveis pertencem a `examples/games/<nome>`, separadas do domínio puro
de `packages/game-design`, dos adaptadores e das interfaces. Não embutir um jogo
específico no grafo, transformar os exemplos num catálogo obrigatório ou
reintroduzir inteligência na UI para produzi-los.

Cada referência deve ter design versionado, arquivos locais, origem/licença,
conteúdo fechado adequado ao gênero, controles e save, roteiro de QA, fonte
editável e build pelo serviço. Coleta conserva fonte/build/toolchain e todos os
casos, inclusive falhas. O jogo exportado funciona sem IA, outro cliente ou
computador de inferência. Não ganha uma bridge privilegiada para os testes.

Referências escritas pelo mantenedor/agente de desenvolvimento ajudam a exercitar
o produto e servem como regressão. Elas **não comprovam geração autônoma** pelo
Companion. Essa capacidade e a generalização exigem produções pelo motor, com
pedidos inéditos e resultados avaliados, sem ocultar falhas ou trocar o escopo.

## Portfólio obrigatório

| Frente | Fonte atual | Aceite restante |
|---|---|---|
| Plataforma | [Lume — Jardim Suspenso](../examples/games/lume/README.md), Phaser | Campanha de doze jardins e save/mapa observados; revisão de arte/áudio, matriz física, desafios opcionais e playtests humanos pendentes |
| Puzzle | [Farol — caminhos de luz](../examples/games/farol/README.md), Godot | Campanha autoral de 16 ilhas; qualificação técnica em desenvolvimento, revisão artística/sonora, dispositivos físicos e playtests humanos pendentes |
| Arcade/física | [Arco — Oficina de Luz](../examples/games/arco/README.md), Phaser | Doze mesas observadas por teclado no build real; qualificação ampliada de arte/áudio, controles/dispositivos físicos e playtests humanos pendentes |
| Exploração 3D | [Vigília — Arquipélago das Marés](../examples/games/vigilia/README.md), Babylon.js | Três ilhas, doze memórias e três canções em fonte; qualificação técnica em desenvolvimento, revisão artística/sonora, matriz física e playtests humanos pendentes |
| Corrida | Pendente | Produção e aceite integral |
| Multiplayer local | [Maré a Dois](../examples/games/mare/README.md), Godot, em desenvolvimento | Doze travessias, final e mapa após reload observados por teclas normais; dois contatos emulados, pausa/mute/save e build/exportação ensaiados. Qualificação física, carregamento e aceite artístico/humano pendentes |

A distribuição das próximas referências deve garantir uso efetivo de Babylon,
Godot e Unity, além de Phaser; não aceitar os seis jogos somente em uma engine.
Cinco referências têm campanha observada em desenvolvimento; a corrida continua
pendente. Nenhum jogo da tabela foi registrado como aprovado nos playtests finais.
A [qualificação Maré](GAME_MARE_QUALIFICATION.md) detalha métodos, falhas e lacunas.

## Arco: arcade e física

Fonte em `examples/games/arco`, doze mesas autorais em três capítulos. O jogador
mira, regula força e lança uma bolinha para acender lanternas; colisões refletem
a velocidade, discos devolvem impulso limitado e as últimas quatro mesas
acrescentam vento lateral. Combos, pontuação, estrelas e economia de lançamentos
incentivam dominar outros trajetos. Há final, seleção de mesas, tentativas
ilimitadas, teclado/arrasto, pausa, mute, efeitos reduzidos e checkpoint de voo.
Arte em papel/cerâmica/latão e partitura sintetizada são originais em código,
com declarações de origem/licença e sem recursos remotos.

O primeiro ensaio `2026-11-13T01-37-40-952Z-6737c9f5` concluiu três mesas e
falhou na quarta: uma trajetória prevista não acendeu todas as lanternas.
Uma reprodução pura encontrou resultados distintos sob cadências diferentes de
frames. A integração foi corrigida para passos constantes de 1/240 s, com sobra
no checkpoint e limite para quadros longos. A regressão mantém igualdade de
trajetória, score, alvos e resultado entre cadências regulares e irregulares.
Isso não representa medição de FPS ou aprovação de desempenho físico.

O ensaio seguinte `2026-11-13T01-41-21-036Z-72ac1e76` concluiu a campanha.
Após ajustes de foco/áudio, atalhos e redução de mutações repetidas no indicador
acessível de progresso, a fonte final passou novamente em
`output/playwright/arco/runs/2026-11-13T01-45-03-490Z-db18638f/`:

- Fonte `8b0c23e28becdd13cf94365b8cb18f5dbbf552a3ddd9c7b47fcb1af853b48788`.
- Artefato `e2a391f16dc3affce4f697847421587acc6306b654fea77f5bf296e8f641abd8`.
- Motor `1559223aa114b264959714aa029f26b10f92317b4ef349c198ba82a345b89e60`.
- Build/observação pelo SDK e serviço real; checks de boot, console e cenário
  passaram. Falhas anteriores e screenshots permaneceram preservados.
- O observador percorreu as doze mesas com teclas, slider de força e controles
  normais. O solver externo calcula entradas; não integra o jogo, altera estado,
  injeta storage ou fornece uma rota oculta de conclusão.
- Fonte/histórico exportados, recuperação do projeto após reiniciar o serviço,
  final e mesas abertas preservados ao recarregar, indicador acessível sem
  atualização a cada frame e viewport de 390 × 844 sem overflow horizontal.

`evidence.json` e `campaign.json` vinculam observações ao build exato. São provas
técnicas de uma referência escrita para desenvolvimento, sem inferência real.
Não comprovam criação autônoma, diversão, audição, GPU ou toque físico; qualidade
integral continua `false`. Corrida/Unity ainda precisa de produção e qualificação. Maré acrescentou depois
a campanha cooperativa observada; as cinco referências mantêm aceite integral pendente.

### Cancelamento de toque e build atualizado

O ensaio emulado no build acima passou pelos controles, mas falhou ao exigir
console limpo: a captura padrão do Phaser chamava `preventDefault()` em
`touchcancel` não cancelável. A falha permanece em
`touch-2026-11-13T01-48-41-585Z-ec53684b/`, sem filtro de mensagens. A fonte foi
ajustada para `input.touch.capture:false`, mantendo `touch-action:none` no
canvas. A configuração está no runtime oficial fixado; a biblioteca não foi
modificada e os limites do coletor não foram relaxados.

A campanha inteira, recuperação, exportação e demais observações foram repetidas
no novo artefato:

- Tentativa `2026-11-13T01-50-14-268Z-24f4b109`.
- Fonte `70b9b50f7a93d12682114e6266400dde9febbe3fb056d0ada259ea8670a7a63b`.
- Artefato `ea723ffe081923c6b797ee81dda9306cdee133c785d1c51ba906dcca6fa9f9f3`.
- Toque `touch-2026-11-13T01-52-43-333Z-4e3828bb`: gesto cancelado sem lançamento,
  gesto solto com movimento visível, alvo aceso, checkpoint após reload, canvas
  estável em pausa e mute preservado, sem console/errors/recursos bloqueados.

O teste de toque inicia apenas o navegador descartável sobre bytes do build
exportado, verifica hashes e observa PNG/DOM. Não usa Agent Service, modelo,
escrita no storage ou acesso ao estado interno do jogo. CDP é emulação, sem
comprovação de hardware, áudio físico ou desempenho. Os limites de aceite final
permanecem os mesmos.

O [dossiê consolidado](../output/game-generation/arco-reference-20261113-a1/report.json)
registra seis testes específicos, regressão final de 643 aprovados/um opt-in
ignorado, 31 verificações do repositório, check/build/roteamento e verificação
dos bytes atuais contra a revisão exportada. Nenhum desses resultados registra
pessoas reais ou autoriza promover a qualidade integral para aprovada.

## Lume: escopo e evidências

O design descreve doze jardins em três capítulos, 36 sementes opcionais,
saídas ativadas por coleta, checkpoints, salto com altura variável, vento e
plataformas móveis. Arte vetorial e partitura/síntese são originais locais.
O usuário tem mapa, repetição, melhores resultados, pausa, reinício, mute,
teclado e botões de toque. A câmera adapta o campo visível ao retrato e paisagem;
armazenamento indisponível mantém a partida jogável, e save incompatível é
preservado. Nada disso depende de inferência.

```bash
npm run qualify:game-lume
```

O runner usa SDK, motor/Node empacotados e IPC autenticado, com namespace e
navegador temporários. Importa a fonte, compila, coleta e exporta domínio/fonte.
Resultados ficam em `output/playwright/lume/runs/`; `latest.json` aponta apenas
para o último ensaio concluído. Fontes, hashes, relatórios e capturas de tentativas
anteriores continuam preservados, inclusive as falhas iniciais.

Testes puros usam entradas de jogo na mesma simulação, sem teletransporte ou
mudanças diretas de estado, para verificar um percurso nas doze fases. Isso
verifica colisões e alcançabilidade naquele percurso; não é playtest humano nem
prova de todos os caminhos. Testes de save verificam retomada, tempo, checkpoints
e preservação de formatos incompatíveis.

O coletor real observa teclas mantidas, pausa/retorno, semente seguida de reload,
toque/redimensionamento e conclusão da primeira fase com abertura da segunda.
Asserções de DOM e pixels continuam genéricas; não concedem automaticamente
cobertura semântica de conteúdo, qualidade visual/sonora ou diversão.
`quality.ready` deve continuar falso enquanto esses aceites faltarem.

A [qualificação ampliada de2026-11-13](GAME_LUME_QUALIFICATION.md) passou pelos
doze jardins, checkpoint no quarto, desfecho e mapa recuperado após reload no
build exato. O observador fica fora do jogo, usando teclas, DOM normal e PNGs;
conserva três tentativas falhas e não modifica simulação/save. Foram observadas
22 das36 sementes. Isso amplia a antiga prova da primeira fase, mantendo
pendentes a arte/áudio, demais caminhos e toda a matriz física/humana.
O mesmo build exportado repetiu o percurso completo apenas por arquivos locais,
sem Agent Service/Agent API, com pausa, reload e viewport retrato observados.

As capturas também servem à revisão visual de desenvolvimento. Problemas
encontrados devem gerar correções e nova evidência para a fonte alterada.
Não reutilizar um relatório anterior como aceite de outra edição.

### Lume no Core e jogador KidOS

O repositório KidOS mantém o contrato em `docs/GAME_BUNDLES.md` e o ensaio
`integrations/agent-engine/test_game_bundle_lume.py`. Em 2026-11-10 o mesmo
artefato Lume foi publicado pelo Core/IPC real temporário no Alien e renderizado
em WebKit 2.52.6, por unidade gerenciada, com botões DOM e snapshots nativos.
Abertura, primeiro jardim e pausa foram observados. Reiniciar o Core manteve
janela/recibo/PID; fechar e abrir com novo pedido recuperou o save e a opção
“Continuar”. Os limites efetivos da unidade e seu término foram conferidos.

É evidência de desenvolvimento, com home/catálogos temporários, dependências
instaladas por hash, UID 1000 e backend Broadway/Cairo. Não houve instalação,
ativação Navi v2 ou uso de dados de Isaac. Não substitui a campanha completa,
teclado/toque/áudio físicos, GPU/FPS, controle parental na conta infantil ou
playtest humano. PNGs e relatórios do caminho final ficam no KidOS em
`build/game-bundles/native-lume/attempt-6/`; casos falhos são conservados à parte.
`quality.ready` permanece falso.

## Farol: puzzle Godot

Campanha autoral de dezesseis ilhas em quatro capítulos, com espelhos, lentes,
divisores, peças fixas e rochas. O jogador tem mapa, estrelas opcionais, undo,
reinício, dica de uma ação, pausa, preferências de som/movimento e save versionado.
Desenho vetorial e síntese sonora são locais; a origem é declarada em
`data/asset-origins.json`, sem presumir revisão artística/licenciamento concluída.
O runtime/fontes Godot mantêm seus avisos próprios. Nenhuma IA é usada na partida.

```sh
npm run qualify:game-farol
```

O serviço empacotado recebe fonte/design pelo SDK e compila pelo adaptador Godot
isolado. Usa apenas a imagem provisionada por hash, sem executar scripts do
projeto no Mac. O qualificador exporta fonte editável, reinicia o serviço e
confere o projeto, coleta teclado/toque/pausa/reload e percorre a campanha com
cliques normais a partir de rotas QA separadas. Captura os resultados renderizados
das dezesseis ilhas e o mapa final; nenhuma solução, ponte de teste ou endpoint
de sucesso é incluído no jogo. As expectativas de pixels comprovam somente os
controles de resultado visíveis, sem atribuir cobertura semântica genérica.

Evidências por tentativa ficam em `output/playwright/farol/runs/`; `latest.json`
aponta apenas o ensaio concluído mais recente. Falhas e fontes anteriores são
preservadas. Os testes GDScript em `qa/check.gd` verificam ações nas 16 ilhas,
undo e dicas; `qa/save_check.gd` verifica round-trip, melhores resultados,
progressão e preservação de quinze formatos inválidos em filesystem descartável.
Esse teste de arquivos não substitui a retomada real do armazenamento web.

As primeiras capturas identificaram glifos de estrela ausentes, substituídos por
desenho vetorial, e limites de layout em telas largas. As capturas da fonte
corrigida devem ser inspecionadas e vinculadas ao seu build. Nada disso prova
geração autônoma pelo motor ou aprovação dos dez jogadores exigidos. O
`quality.ready` permanece falso.

## Vigília: exploração Babylon.js

Campanha autoral de três ilhas conectadas por pontes, doze inscrições, nove
ressonadores com combinações diferentes e retorno ao cais para enviar a luz.
Há caminhada contínua com colisões, caderno, mapa, pausa/perda de foco, mute,
movimento reduzido, save versionado e toque. Arquitetura, vegetação, personagem,
água e partitura/síntese são originais locais; dependências Babylon/loader e seus
avisos permanecem fixados pelo adaptador. Qualidade artística não é inferida de
geometria compilada ou da declaração de origem.

```sh
npm run qualify:game-vigilia
```

O runner importa fonte/design por SDK/TLS/IPC, compila pelo serviço empacotado,
coleta cenários, reinicia o serviço e exporta domínio/fonte/build. Uma rota QA
separada percorre as três ilhas, lê inscrições, afina os faróis e volta ao cais
por teclas/botões normais; usa somente coordenadas do minimapa visível para
seguir os caminhos. Não há teletransporte, execução de código pelo teste,
escrita de save ou endpoint de teste no jogo. O oráculo da rota não aprova
qualidade: capturas/contagem/desfecho são observações delimitadas.

Testes puros percorrem o conteúdo pelo movimento/colisão reais e verificam
ponte fechada, costa, obstáculos, velocidade diagonal, frame longo, afinação,
memórias repetidas e save parcial/final. Formatos inválidos/incompatíveis ficam
intactos; armazenamento indisponível mantém uma partida em memória. Não
substituem retomada web nem comportamento físico de teclado, toque, GPU e áudio.

As tentativas em `output/playwright/vigilia/runs/` preservam um erro de contagem
do qualificador, um timeout de captura de canvas em dois segundos e uma rota QA
que parou rente a uma pedra. Capturas também revelaram contraste lavado e faces
das ilhas invertidas; a fonte foi corrigida e observada novamente, sem afrouxar
as colisões ou os limites do coletor. Uma tentativa posterior percorreu a
campanha e recarregou o save final. Alterações subsequentes exigem evidência
vinculada à própria fonte; `latest.json` aponta somente para ensaio concluído.

O [dossiê da fonte final](../output/game-generation/vigilia-reference-20261111-a1/report.json)
vincula a revisão/build de
`2026-11-12T00-06-56-387Z-74f2aa68`: três faróis, doze inscrições, desfecho e
reload observados, com quatro relatórios do coletor aprovados e `quality.ready`
falso. Fonte atual foi conferida byte a byte contra a exportação. O teste
separado `scripts/qualify-vigilia-touch.mjs --attempt=<diretório do ensaio>`
confere hashes e joga esse build sem Agent Service, simulando dois contatos CDP
simultâneos e cancelamento. Não certifica tela/dispositivo físico ou áudio.

Esse conteúdo foi escrito pelo mantenedor/agente de desenvolvimento e não foi
fornecido à produção Windmail. Não demonstra geração autônoma ou generalização.
O `quality.ready` permanece falso: quatro adaptadores completos, performance e
entradas físicas, revisão artística/sonora e dez participantes reais por jogo
continuam obrigatórios.

## Liberação do conjunto

Para cada jogo, aplicar integralmente o plano: avaliação de arte/áudio e conteúdo,
desempenho e carregamento físicos, navegadores e entradas, dez participantes
consentidos e metas de compreensão/diversão. Publicação, instalação e rollback
do produto têm evidências próprias. O
[acompanhamento](GAME_DESIGN_IMPLEMENTATION_STATUS.md) registra o progresso real.
