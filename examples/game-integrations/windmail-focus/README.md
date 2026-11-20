# Correio: foco após recuperar ou fechar um diálogo

Correção manual de apresentação sobre a revisão54, sem alterar o jogo anterior,
mapa, física, assets, save, permissões ou orçamento. O patch exato substitui apenas
`src/ui.ts` pela classe deste diretório, conservando `recovery.css` e as demais fontes.

O diagnóstico DOM reproduziu a primeira tecla no botão de um diálogo oculto.
Sua captura de `keydown` interrompia a propagação antes do teclado do jogo.
Agora o handler só atua enquanto o diálogo está aberto. Ao fechar, tenta devolver
o foco ao controle anterior conectado/habilitado e fora de regiões inertes/ocultas;
se o foco não foi aceito, foca o canvas. Não acrescenta timer, polling, outra
entrada global ou necessidade de clique do jogador. O diálogo aberto conserva
o Tab contido e a saída explícita por P/Esc.

Build/diagnósticos novos permanecem separados. Ensaios usam eventos DOM
aditivos, teclas/cliques e reload normais, sem estado interno, armazenamento
injetado ou controle de relógio. Leia [evidências e limites](../../../docs/GAME_WINDMAIL_FOCUS_RECOVERY.md).
