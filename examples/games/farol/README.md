# Farol — caminhos de luz

Puzzle 2D original em Godot para o portfólio Game Design. Fonte autoral de
referência, não prova de geração autônoma pelo Companion. A entrega pretendida
é uma campanha fechada de 16 ilhas, com progressão, save, teclado/toque, som,
pausa, undo, ajuda e exportação offline. Qualificação e aceite ficam separados.

## Direção antes da implementação

**Tese visual:** uma carta náutica noturna, com papel claro, cobre, mar azul
profundo e luz dourada que torna as rotas imediatamente legíveis.

**Conteúdo:** a abertura apresenta nome/farol e um único começo; o mapa organiza
quatro arquipélagos; o tabuleiro é a área principal, com objetivo, movimentos e
ações curtas; a conclusão devolve contexto e acesso à ilha seguinte.

**Interação:** o feixe percorre a nova rota ao girar uma peça, os faróis acendem
com um pulso e pequenas partículas, e água/luz dão profundidade à abertura.
Movimento reduzido conserva todos os estados sem animação necessária.

## Regras

Gire espelhos, lentes e divisores para acender todos os faróis. A luz viaja em
quatro direções; peças fixas, obstáculos e circuitos entram progressivamente.
Não há vidas, relógio obrigatório, anúncios, rede ou inferência durante o jogo.
Undo e reinício permitem experimentar. As estrelas recompensam rotas econômicas;
nunca impedem continuar a campanha.

Fontes, arte vetorial desenhada no motor e síntese sonora são originais locais,
sob MIT. O editor e runtime Godot mantêm suas próprias licenças no build. Não
apresentar arte provisória ou teste automatizado como aceite artístico/humano.

## Organização

- `board.gd`: regras determinísticas; sem UI, acesso de sistema ou IA.
- `main.gd`: apresentação, controles, som e ciclo de jogo.
- `save_store.gd`: save versionado e proteção de versões incompatíveis.
- `data/levels.json`: campanha estática; QA tem soluções separadas do jogador.
- `qa/`: provas de regras/solvabilidade, sem teleport/debug bridge no jogo web.
- `game.document.json`: briefing/design/proveniência importados pelo serviço.

O plano integral da suíte continua exigindo os quatro adaptadores, seis jogos,
pedidos inéditos e testes físicos/humanos. Este jogo não substitui esses gates.

## Verificação e exportação

`npm run qualify:game-farol` importa o projeto pelo SDK e usa o serviço/Node
empacotados, editor isolado e Chromium temporário. Requer a ferramenta Godot
provisionada explicitamente; não instala editores nem usa modelos. Resultados,
fonte editável e build ficam em `output/playwright/farol/runs/` na raiz Companion.
O navegador percorre as ilhas por cliques comuns; rotas `qa/solutions.json` ficam
no qualificador, fora da fonte importada/build do jogo. Sem ponte privilegiada.

`qa/check.gd` verifica regras, undo e dicas nas dezesseis ilhas; `qa/save_check.gd`
verifica persistência e quinze formatos inválidos. Scripts do projeto devem
executar somente no editor isolado, inclusive durante QA. Save após reload
recupera rota/contadores; o histórico de undo reinicia e abrange ações novas.

Este é conteúdo autoral de referência. Build, capturas e testes não representam
geração autônoma, áudio/desempenho físico ou aprovação humana. Os dez playtests
consentidos e o restante do aceite do plano continuam pendentes.
