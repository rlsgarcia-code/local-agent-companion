# Integração autoral de save no Correio das Correntes

Integração manual de desenvolvimento sobre o export Luna51. Não é continuação
autônoma do modelo, novo pedido inédito, arte final ou entrada extra no portfólio.
Fonte/build/ledger originais permanecem imutáveis. A qualificação usa uma cópia
privada de metadados, o mesmo projeto/namespace e credencial sem provedores ou
ferramentas de host; contadores de inferência precisam permanecer iguais.

Direção visual: conservar o mar azul e o dourado do jogo como contexto, com uma
camada de decisão discreta, legível e sem explicar mecanismos internos ao jogador.

Conteúdo: estado de carregamento; resumo da viagem recuperada; continuar como
ação principal; nova viagem com confirmação; falha com tentar novamente ou jogar
sem salvar; indicador de gravação somente após confirmação.

Interação: entrada breve da camada; foco/hover dos botões; transição do indicador
de save. Respeitar movimento reduzido, teclado e contraste. Sem imagens/fontes
externas, popups do host ou dependência da IA.

Os arquivos deste diretório são aplicados como arquivos normais do projeto via
SDK/commit. O patch de integração exige o hash exato de src/main.ts e não altera
física/mapa/arte para facilitar o percurso. Os testes do jogo devem usar somente
entradas/tela normais, sem ler ou modificar variáveis, storage ou relógios.
