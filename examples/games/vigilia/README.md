# Vigília — Arquipélago das Marés

Referência autoral de exploração 3D para Babylon.js 9.35.0. A fonte pertence ao
portfólio, separada da especialização e dos grafos do motor. Não é um template
injetado no agente nem prova de geração autônoma a partir de um pedido.

**Direção visual:** litoral de pedra e cobre, vegetação facetada, água verde e luz
dourada; a guardiã de chapéu atravessa uma composição contínua sem menus de fases.
**Conteúdo:** três ilhas, doze inscrições, três canções diferentes, pontes
progressivas e um retorno ao cais que encerra a viagem; memórias opcionais
continuam acessíveis depois do desfecho.
**Interação:** caminhada e câmera oblíqua contínuas, afinação visual/sonora,
inscrições suspensas e vegetação suave. Movimento reduzido e mute são opções.

## Jogar

Setas ou WASD para caminhar; E ou botão contextual para ler, afinar e escutar.
Os quatro botões de direção permitem toque simultâneo. Não há captura do mouse,
vidas, anúncios ou limite de tempo. A costa, pedras, pilares e pedestais têm
colisão. Um mapa mostra posição e faróis, sem revelar inscrições não encontradas.

As inscrições ensinam a canção de Pedra, Folha e Concha. Cada ressonador tem
quatro notas; afine-os de acordo com as memórias para acordar o farol e abrir a
ponte a leste. Depois dos três faróis, volte ao cais inicial para enviar a luz.
O caderno conserva somente textos já descobertos.

P/Escape ou Pausa interrompem a caminhada e o áudio; perder foco também pausa.
Caderno suspende a partida. Save versionado conserva posição, notas, afinações,
faróis, desfecho, tempo e preferências. Sem armazenamento, a partida continua em
memória. Formatos inválidos ou incompatíveis ficam preservados sem sobrescrita;
novo percurso exige confirmação e fica indisponível nessa condição.

Arte e partitura/síntese são originais locais, declaradas em
`data/asset-origins.json`, sob a licença MIT da referência. Babylon/loader mantêm
os avisos Apache empacotados pelo adaptador. Declarações não equivalem à revisão
artística/licenciamento final. Não há fontes, samples, modelos ou serviços
externos durante a partida. O áudio inicia somente após gesto.

## Construir e verificar

Na raiz Companion:

```sh
npm run qualify:game-vigilia
```

O comando importa a fonte/design pelo SDK, compila pelo Agent Service empacotado,
coleta cenários Chromium, exporta fonte/build e reinicia o serviço para conferir
persistência. Perfis, sockets e navegador são temporários; não instala o jogo ou
altera a conta pessoal. Falhas permanecem em `output/playwright/vigilia/runs/`;
`latest.json` só aponta para uma tentativa concluída com sucesso.

O qualificador percorre a campanha por teclas e botões normais. Lê somente o
minimapa/HUD visíveis para seguir uma rota QA externa ao jogo. Não injeta código,
teletransporta, escreve armazenamento ou concede qualidade. Imagens/DOM comprovam
apenas o que observaram. A primeira tentativa preserva um erro do qualificador
(contava cinco relatórios onde havia quatro); outra conserva timeout de captura
de canvas em dois segundos. Não aumentar limites para esconder a falha.

Testes puros usam a colisão e o movimento reais para alcançar as doze inscrições,
afinar os nove ressonadores, atravessar pontes e voltar ao cais. Verificam também
normalização diagonal, frames longos, save parcial/final e dados incompatíveis.
Não há bridge de teste, solução ou rota QA embutida no build executável.

A fonte e os ensaios de desenvolvimento não são aceite do produto: revisão de
arte/áudio, controles e desempenho físicos, navegadores/dispositivos completos,
dez jogadores reais consentidos e distribuição continuam pendentes. O
`quality.ready` deve permanecer falso enquanto faltarem as evidências do plano.
