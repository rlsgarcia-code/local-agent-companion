# Interface responsiva do Correio

Integração manual sobre a revisão52 de save, em cópia privada do mesmo projeto.
Não é geração autônoma, modelo/template obrigatório, aceite físico ou release.
Manter Luna51, revisão52 qualificada, artefatos e resultados anteriores intactos.

Tese visual: mapa marítimo inteiro como área principal, com informação clara em
azul/dourado e controles que conservam tamanho legível em pixels CSS.
Conteúdo: destino/entregas/pontos/recorde, vento e colisões, mapa, controles e save.
Interação: entrada breve dos diálogos, resposta ao pressionar/segurar e indicador
de save; respeitar reduced-motion. Sem fontes, imagens ou recursos remotos.

O canvas continua1024×768, FIT no seu próprio elemento pai. HUD, nomes dos portos,
pausa/desfecho e controles ficam em DOM do jogo, sem UI/host Companion ou IA.
Não mudar coordenadas, física, regras ou esquema2 de save. Ré/aceleração por toque
equivalem às setas já existentes. Tamanho de interface não comprova toque físico.
