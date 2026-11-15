# Lume: percurso da campanha no navegador

Qualificação de desenvolvimento em **2026-11-13 UTC**, vinculada ao
[plano integral](GAME_DESIGN_IMPLEMENTATION_PLAN.md) e aos
[jogos de referência](GAME_REFERENCE_GAMES.md). Lume é conteúdo autoral de
regressão, não um jogo gerado autonomamente pelo Companion.

## Percurso observado

O ensaio `2026-11-13T07-37-43-509Z-73b1daa7` passou no motor empacotado,
SDK/TLS, adaptador Phaser e navegador descartável reais:

- Importação da fonte/design, build e cinco relatórios do coletor, preservados.
- Reinício do serviço e recuperação do mesmo projeto, sem importar outra cópia.
- Exportação de fonte editável/histórico e build autocontido.
- Campanha pelos doze jardins em ordem, por teclas e botões usuais; cada saída
  foi observada por título/contagem e PNG do resultado.
- Reload de um checkpoint observado no quarto jardim: mesma fase, semente e
  retorno ao ponto seguro. Não se exige recuperar uma posição arbitrária no ar;
  o save do jogo é baseado em checkpoint.
- Desfecho “O jardim voltou a brilhar.”, mapa com doze fases habilitadas e
  respectivas sementes, mantidos após recarregar.
- Nenhum erro de página ou recurso bloqueado no preview; fechamento aguardado
  dos recursos próprios pelo roteiro, que terminou com código0.

| Vínculo | Valor |
|---|---|
| Projeto de teste | `62f92630-fcf3-4378-a33e-184bfcac24a5` |
| Hash da fonte | `fc68696f319ac876a0ee8c6b29d2651306af46c04cfa20978b099c23d44c9292` |
| Hash do artefato | `8f9806b70d43efa620d2053c648eca6e280f5a707481fda295b4d0d5ee68f97d` |
| Manifesto do motor | `b92b94f355c434e4e780ea1c2b21dca010b17db43366d8010f943e59dd8d646c` |
| Ambiente | Node22.23.4 empacotado, darwin-arm64, Chromium instalado e descartável |

O percurso recolheu22 das36 sementes; não demonstra todos os desafios opcionais.
Os primeiros onze resultados exibiram zero recomeços nesse percurso. O último
exibe o desfecho em vez dessa contagem. Nenhuma pontuação declarou diversão,
aprovação artística, teste físico ou qualidade integral; `quality.ready` segue
`false`.

### Build exportado sem Agent Service

O mesmo artefato passou novamente pelos doze jardins em
`output/playwright/lume/standalone/runs/2026-11-13T07-47-24-539Z-c4f0a060/`.
O roteiro verificou os nove arquivos do build contra seus hashes/tamanhos e os
serviu diretamente do disco ao navegador descartável. Não inicia Agent Service,
usa Agent API ou consulta inferência. Mantém a mesma barreira de recursos
empacotados; não usa perfil pessoal, rede externa ou credenciais de IA.

Foram novamente observados checkpoint, desfecho, mapa/sementes após reload,
pausa e viewport390×844 sem overflow horizontal, sem erros ou pedidos bloqueados.
O fechamento do preview foi aguardado. Isso comprova o percurso técnico desse
build exportado sem o serviço, não funcionamento físico/offline de qualquer
navegador ou dispositivo não testado.

## Como repetir

A [observação de carregamento com rede/cache frio](GAME_COLD_NETWORK_OBSERVATIONS.md)
usa o build posterior já qualificado, sem Agent Service ou IA. Registra o início
da primeira fase por PNG/HUD/teclas e requisições nativas; não substitui campanha,
FPS físico ou aceite do plano.

A [qualificação entre engines de navegador](GAME_BROWSER_COMPATIBILITY.md)
acrescenta Firefox/WebKit de teste já instalados, selecionados explicitamente
por `--browser`, sem habilitar coletores ou previews novos no produto. No primeiro
artefato, Firefox completou a campanha e WebKit ficou parcial por interferência
CSP da captura. Um novo build com [exceção da regra vazia por hash](GAME_EMPTY_STYLE_POLICY.md)
passou também em WebKit, preservando o candidato e falhas anteriores. A distinção de browsers comerciais/
dispositivos físicos permanecem visíveis no dossiê dessa frente.

Depois de construir os testes e um bundle de desenvolvimento em **destino novo**:

```sh
node scripts/qualify-game-lume.mjs --campaign --engine=/caminho/do/bundle-verificado
```

Para a prova separada sem serviço, com o resultado exato já concluído:

```sh
node scripts/qualify-lume-export.mjs --attempt=/caminho/do/ensaio/Lume
```

O argumento de engine é explícito e verificado antes de executar. Sem argumentos,
o percurso anterior continua usando `engine-dist` e cobre a primeira fase;
`--campaign` amplia a observação. Não usar o builder sem destino sobre uma
engine que esteja em uso. Não limpar `dist-tests` enquanto esse roteiro estiver
ativo. Não retomar um job desconhecido iniciando outro: inspecionar o original.

`scripts/lume-campaign-observer.mjs` fica fora de `examples/games/lume` e do
build entregue. Usa os layouts autorais como orientação de QA, o valor DOM do
indicador normal de progresso e os pixels PNG da face do personagem. As leituras
não entram em objetos Phaser, variáveis internas, storage, relógio ou estado da
simulação. As ações são `Keyboard.down/up`, foco e botões normais; não há
teletransporte, endpoint de teste ou escrita de save. Referências das APIs:
[teclado](https://playwright.dev/docs/api/class-keyboard) e
[capturas](https://playwright.dev/docs/screenshots).

Liberação de salto curto tem temporizador próprio e registra o tempo efetivo,
sem depender da duração de captura de tela. O observador pode soltar a direção
para aterrissar antes de outra borda. Essas são entradas externas de um teste
específico, não um controlador inserido no jogo, outro agente do produto ou uma
prova de que qualquer jogador conseguirá o mesmo percurso.

## Falhas preservadas

As tentativas anteriores permanecem com fontes, imagens, progresso e diagnóstico:

| Tentativa | Observação |
|---|---|
| `2026-11-13T07-28-17-622Z-32dbc319` | Três jardins concluídos; após reload do quarto, a asserção leu o contador antes do primeiro quadro atualizado. A captura posterior já mostra a semente recuperada. O observador passou a aguardar o mesmo valor renderizado, sem mudar o save. |
| `2026-11-13T07-30-15-361Z-d8e35896` | Dez jardins concluídos; saltos curtos e encadeados do observador falharam no décimo primeiro. Liberação da tecla dependia do polling de imagens. |
| `2026-11-13T07-33-42-845Z-e118dd75` | Dez jardins concluídos; o registro confirma liberação curta em141–143ms e passagem do primeiro salto encadeado. A rota seguinte após o vento caiu na borda. O observador passou a frear/aguardar aterrissagem e usar a tolerância de salto já existente no jogo. |

O jogo, a física, o save e os limites de falha não foram alterados entre esses
ensaios para obter o passe. Uma rota falha continua sendo evidência de falha
desse percurso; não se atribui sua causa a um modelo, dispositivo ou engine sem
prova. O controle não foi afrouxado para teleportar ou marcar uma fase concluída.

## Evidências e aceite restante

Em `output/playwright/lume/runs/2026-11-13T07-37-43-509Z-73b1daa7/`:

- `evidence.json`, `reports.json`, relatórios/capturas do coletor e build exato.
- `campaign/campaign.json`: observações, entradas, sementes e resultados das12
  fases; `campaign/01-completed.png` a `12-completed.png` e mapas antes/depois
  do reload.
- `campaign/checkpoint-before.png` e `checkpoint-restored.png`.
- `source-export/`: fonte editável e histórico exportados pelo SDK.

O [dossiê consolidado](../output/game-generation/lume-campaign-20261113-a1/report.json)
confere os bytes de todos os arquivos exportados contra a fonte atual, hashes
dos artefatos e o motor, scripts e logs, incluindo as falhas. Não houve inferência,
alteração do bloco Luna, instalação ou publicação.

Regressão desta ampliação:682 testes aprovados, um opt-in não executado,
31 verificações de repositório, typecheck e build da extensão passaram.
O código de runtime dos jogos e do motor não foi alterado por esta ampliação;
as mudanças são no roteiro externo de qualificação e na documentação.

Isso amplia a observação anterior da primeira fase até o fim da campanha. Não
comprova todos os caminhos/colecionáveis, originalidade de geração pelo motor,
arte/áudio finais, teclado/toque/GPU/áudio físicos, desempenho na matriz,
carregamento em rede controlada ou os dez playtests consentidos do plano.
Permanecem obrigatórios os seis jogos, Unity funcional, três clientes instalados,
integração protegida KidOS, distribuição assinada, migração e rollback.
