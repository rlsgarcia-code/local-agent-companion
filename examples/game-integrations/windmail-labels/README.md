# Correio: nomes dos portos sem esconder o barco

Integração manual, separada da revisão responsiva53. A fonte anterior permanece
em `../windmail-responsive`; este arquivo substitui somente `src/chrome.ts` no
projeto exportado. O patch também passa os limites visuais atuais do barco pela
projeção local de apresentação. Não muda mapa, regras, assets, save ou autoridade.

O espaço de leitura é o mapa; o barco deve manter sua silhueta legível ao passar
por um nome. Um rótulo sobreposto ao retângulo visual rotacionado do barco fica
temporariamente invisível; reaparece quando o barco se afasta. O destino continua
no título do HUD. `visibility` preserva a posição/tamanho do rótulo e os controles.
Não há animação adicional nem inteligência no renderer.

Caixas DOM são convertidas para as coordenadas fixas do mapa e armazenadas até o
próximo resize. A margem visual de3px protege a borda do barco; não é um colisor
ou tolerância de entrega. Não ler todas as caixas a cada quadro. O retângulo Phaser
é reutilizado e considera escala/rotação; não define ou altera posição física.

Construção pelo SDK/serviço em cópia privada e qualificação por entradas normais
ficam no [relato da integração](../../../docs/GAME_WINDMAIL_LABEL_VISIBILITY.md). Build, PNGs e percurso técnico
não comprovam arte final, diversão, dispositivos físicos ou instalação.
