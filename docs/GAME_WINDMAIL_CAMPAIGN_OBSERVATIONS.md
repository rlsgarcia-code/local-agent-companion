# Correio: campanha, recorde, mute e vento

Evidência de desenvolvimento em **2026-11-13**, posterior à
[integração manual de save](GAME_WINDMAIL_SAVE_INTEGRATION.md). Mesmo build,
sem modificar jogo, física, assets, dados ou relatórios anteriores; sem outra
inferência do motor. Não é nova geração, jogo aprovado ou instalação.

Fonte `1bbb96a6dba7b1728cb169885d5dc216571e7542f36a6c59fe310856570372b2`,
artefato `3462eb872d162bf670446f68bcffcb1b3231fd8d937471513cf97061110ee882`.
Revisão52 existe só na cópia privada; Luna51 original permanece preservado.

## Método e resultados

`scripts/observe-windmail-campaign.mjs` repete23 movimentos cronometrados.
`scripts/observe-windmail-manual-campaign.mjs` recebe movimentos do operador
Codex após inspeção dos PNGs. Este segundo protocolo reserva15min para interação,
como o observador interativo anterior; não estende nem reclassifica o teste
automático de120s. Teclas/comandos, duração real e frames ficam registrados.
Somente controles normais, botões, HUD/status visíveis, PNGs e reload. Sem
variáveis da engine, writes em storage, mudanças de relógio, coletores ou QA.

| Percurso | Resultado observado |
|---|---|
| Chrome, replay fixo | 5/5,1693pontos,25s mostrados,0 colisões |
| Firefox Playwright, mesmo replay | Falhou:0/5, cinco colisões ao final |
| WebKit Playwright, mesmo replay | Falhou:2/5,384pontos, cinco colisões |
| Firefox Playwright, correções por PNG | 5/5,1360pontos,27s mostrados,5 colisões |
| WebKit Playwright, correções por PNG | 5/5,1695pontos,21s mostrados,0 colisões |

Falhas dos replays permanecem falhas. A observação manual encontrou percursos
jogáveis no mesmo artefato, sem estabelecer a causa exata das divergências ou
provar que um roteiro temporal deve produzir a mesma trajetória entre browsers.
Capturas e pausas fazem parte deste protocolo; não é jogo contínuo humano.

Cada campanha concluída verifica também: mute por teclaM, reload com resumo5/5
e pontuação, botão **Ver resultado**, recorde preservado ao iniciar nova viagem,
e mute recuperado. Ver resultado não grava outro checkpoint; seu indicador
**Viagem recuperada** é mantido distinto de uma nova confirmação de gravação.
Os PNGs do resultado e da nova viagem mostram recorde/mute; não há leitura de
objetos internos para afirmá-los.

Na nova viagem,34s de teclas normais de ré/direção exercitam a mudança de vento.
Pausa/save, reload, continuar e pausar mostram a direção recuperada. Chrome
mostrou14° antes/15° após retomar; Firefox mostrou14° após retomar. O pequeno
avanço normal após continuar impede alegar igualdade numérica exata por PNG.
Isso observa vento/retomada; não comprova balanceamento ou desafios suficientes.

## Isolamento e conservação

O observador verifica cada recurso contra o artefato antes/depois. Usa listener
autenticado, origem/perfil privados, mesmas barreiras de rede/dispositivos/CSP e
browser qualificado. Não há Agent Service durante a reprodução. Firefox/WebKit
são distribuições de teste já instaladas, com inventários completos antes/depois;
nenhum download, fallback ou perfil pessoal. Metadados/fechamentos estão no dossiê.
Chrome25408 confirmou exit0/desconexão/perfil removido. Wrappers de Firefox/WebKit
confirmam fechamento/desconexão, recursos/HOME removidos e inventário inalterado;
não registram exit code do processo do browser e não devem ser descritos como0.

## Pendências encontradas e limites

- Em390×844, os menus DOM cabem e têm ações legíveis. O canvas usa letterboxing;
  HUD/controles ficam pequenos. **Não aprovado para celular**; requer layout de
  gameplay responsivo, além de testes físicos de toque.
- O banner atrás do desfecho pode continuar dizendo “Retomando a rota”. É uma
  pendência de apresentação, preservada nas capturas; o resultado aparece no
  painel correto e no save.
- Arrecifes puderam reduzir pontos repetidamente no Firefox até a rota ser
  corrigida. Não houve bloqueio irreversível nesse percurso. Isso precisa entrar
  no playtest/balanceamento; não é certificado de colisão ou dificuldade ideal.
- Arte placeholder, áudio físico, FPS/GPU, browsers comerciais/dispositivos,
  dez pessoas, jogos inéditos, Unity, KidOS protegido, instalação e rollback final
  continuam no plano. Não converter estes PNGs em relatório humano/confiável ou
  aprovação de qualidade. Preview temporário continua temporário.

O [dossiê agregado](../output/game-generation/windmail-campaign-20261113-a1/report.json)
reúne os cinco percursos, fontes dos observadores, revisão visual e verificações.
Um novo probe readonly do Alien não observou diretório/processos da tentativa5
preparada; não iniciou sudo ou instalador, e não comprova composição Root positiva.
