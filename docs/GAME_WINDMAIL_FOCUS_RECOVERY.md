# Correio: primeira tecla após recuperar a viagem

Desenvolvimento de **2026-11-13**, sem instalação/publicação ou inferência real.
Continua a [correção de rótulos54](GAME_WINDMAIL_LABEL_VISIBILITY.md), conservada
com suas campanhas e falhas. Integração manual não é geração autônoma, playtest
ou aprovação do produto completo.

## Reprodução e causa observada

O [diagnóstico externo](../scripts/diagnose-windmail-recovery-input.mjs) abriu
quatro perfis novos, criou/salvou uma viagem por botões normais, recarregou e
acionou **Continuar viagem**. Sem alterar estado/clock/storage ou fonte, comparou:

| Primeira ação após o clique | Revisão54/Chrome |
|---|---|
| P imediatamente, sem espera/captura anterior | Não pausou |
| Focar o canvas e P | Pausou |
| Capturar o primeiro quadro e P | Pausou |
| Botão Pausar | Pausou |

Na falha, um `keydown` confiável foi observado na captura do window, direcionado
a `BUTTON` dentro de `.wm-recovery-layer` com `hidden:true`; não chegou à fase
bubble do window. O `keyup` posterior chegou pelo body. O código confirma que o
handler de `keydown` daquela camada sempre interrompia propagação, inclusive
oculta. `hide()` tentava focar o body anterior, que não aceitava esse foco e
deixava temporariamente o botão oculto ativo. O controle com foco no canvas
direcionou o evento a `CANVAS#game` e pausou.

É causa localizada demonstrada nesse ensaio, sem leitura de objetos Phaser.
Não comprova retrospectivamente a causa de cada falha histórica não instrumentada,
nem reclassifica a falha54 após recuperar o vento. O baseline permanece em
`output/playwright/windmail-recovery-input-20261113-a1`.

## Correção de apresentação

A [classe separada](../examples/game-integrations/windmail-focus/recovery.ts)
recusa tratar teclas quando o diálogo está fechado. `hide()` verifica conexão,
regiões inertes/ocultas, estado disabled e aceitação real do foco anterior.
Se necessário, foca o canvas com `preventScroll`. O modal aberto conserva suas
regras de Tab/P/Esc. Não há timer, retry de tecla, espera artificial, bridge de
debug ou outra entrada de teclado no host/Agent Service.

O patch exige o hash exato de `src/ui.ts`54. Uma cópia privada sem provedores
recebeu a revisão55 pelo SDK, e o motor imutável `d9f826dd…` construiu o jogo.
Serviço61391 encerrou0. Apenas `src/ui.ts` mudou; os demais arquivos e design,
incluindo simulação, assets e esquema2/coordenador de save, permanecem iguais.
Original/cópia conservaram o ledger; não houve outra concessão de inferência.

| Identidade55 | Valor |
|---|---|
| Projeto | `5006ab22-93d5-4991-b29f-dbd1f8e60bf7` |
| Fonte | `bd2728555f3c732cf11130b96a6e6b26314fe184161e103bd8d38767f1728f61` |
| Artefato | `fbc14f953af57fa1a017e0039443014ace52ea70235ed190bd9b271614c06688` |

## Regressão pelo navegador

Os quatro métodos passaram na revisão55 em Chrome instalado, Firefox146.0.1
de Playwright e WebKit26.0 de Playwright: **12 cenários**. Cada um também fechou
e reabriu a pausa por duas teclas P consecutivas, sem acrescentar espera antes
da primeira ação. Nenhum keydown ficou na camada oculta. Na ação imediata, o
destino passou a ser o canvas. Eventos aditivos não alteram prevenção/propagação.

O [dossiê](../output/game-generation/windmail-focus-20261113-a1/qualification.json)
vincula arquivos, eventos, PNGs e fechamentos ao artefato. Wrappers confirmam
páginas fechadas; não registram exit code dos browsers. Firefox/WebKit conservam
os inventários completos e comprovam listener/HOME descartáveis encerrados.
Esses browsers com patches não são Safari/Firefox comerciais ou dispositivos reais.

O roteiro completo pode agora pedir `--keyboard-recovery`: mantém o percurso,
limite100/deadline15min e exige P imediatamente após a retomada do vento,
em vez de substituir por clique. O relatório dessa execução fica separado;
campanhas54 não certificam automaticamente o55. Não ampliar prazo ou apagar falhas.

O percurso55 no Chrome passou:5/5,1684pontos, zero colisões, desfecho/recorde/mute
após reload, nova viagem,34s de vento, outra recuperação e **P imediato**. São50
comandos normais, sem novas fontes/alteração do jogo durante a observação.
O browser62938 encerrou0, desconectou e removeu o HOME descartável. O ensaio tem
fontes de pai/filho capturadas antes da execução. Firefox/WebKit55 têm a regressão
de foco acima; suas campanhas completas anteriores pertencem ao54.

O [export SDK](../output/game-generation/windmail-focus-20261113-a1/editable-export/report.json)
preserva55 revisões,70 blobs/279236bytes e53 arquivos atuais. Serviço61953
encerrou0 e manteve os contadores. Arquivo de domínio não inclui bancos,
checkpoints, credenciais ou TLS privado. Sem reimportação deste export ou teste
do npm do projeto; o caminho de construção é o adaptador fixado.

## Motor comum e limites

O guia puro de `packages/game-design` passa a orientar foco válido ao fechar
diálogos e ausência de interceptação por camadas ocultas. Conhecimento nos sete
perfis do motor, sem outro executor, permissões ou ferramentas. Seu pacote de
desenvolvimento é separado do motor que construiu55; não foi instalado nem
avaliado por modelo real. O perfil KidOS legado permanece inalterado.

O plano integral ainda exige licença/broker Unity, composição protegida Navi,
clientes instalados, arte/áudio finais, seis jogos/pedidos inéditos, matriz física,
playtests consentidos e distribuição com rollback. Esta correção resolve uma
falha de entrada demonstrada; não concede aprovação de qualidade ou aceite final.

Tipos, build,779 testes/um opt-in ignorado,40 verificações e roteamento local
simulado passaram. O pacote separado do guia tem484 payloads verificados.
[Snapshots e verificação](../output/game-generation/windmail-focus-20261113-a1/verification.json).
